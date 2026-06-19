import Foundation

/// A parsed Server-Sent Event from /api/events. A `change` carries the raw data
/// payload (the web treats it only as a "something changed" signal -> refetch);
/// `ping` is the 5s heartbeat used for liveness.
public enum SSEEvent: Equatable, Sendable {
    case change(String)
    case ping
}

/// Incremental SSE frame parser. Feed it lines; it returns an event when a frame
/// terminates (a blank line). Mirrors the server in src/app/api/events/route.ts:
/// data frames are real changes; a named `event: ping` is the heartbeat.
public struct SSEParser {
    private var eventName = ""
    private var data = ""

    public init() {}

    public mutating func feed(_ line: String) -> SSEEvent? {
        if line.isEmpty {
            defer { eventName = ""; data = "" }
            if eventName == "ping" { return .ping }
            return data.isEmpty ? nil : .change(data)
        }
        if line.hasPrefix(":") { return nil }   // comment line, e.g. ": connected"
        guard let colon = line.firstIndex(of: ":") else { return nil }
        let field = String(line[line.startIndex..<colon])
        var value = String(line[line.index(after: colon)...])
        if value.hasPrefix(" ") { value.removeFirst() }
        switch field {
        case "event": eventName = value
        case "data": data += data.isEmpty ? value : "\n" + value
        default: break   // id / retry ignored
        }
        return nil
    }
}

/// Liveness from heartbeat gaps: EventSource.onerror is unreliable against a
/// killed localhost server, so we treat "no ping within `timeoutSeconds`" as
/// offline (the web uses the same trick).
public struct Liveness: Sendable {
    public let timeoutSeconds: Double

    public init(timeoutSeconds: Double = 12) {
        self.timeoutSeconds = timeoutSeconds
    }

    public func isOnline(lastPing: Date, now: Date) -> Bool {
        now.timeIntervalSince(lastPing) <= timeoutSeconds
    }
}

/// Consumes /api/events and drives two callbacks: `onChange` (refetch) and
/// `onOnline` (liveness). Auto-reconnects with a short backoff.
///
/// Transport: a `URLSessionDataDelegate` that receives `didReceive data` chunks in
/// real time. This is deliberate - `URLSession.AsyncBytes.lines` buffers and does
/// NOT deliver an SSE stream's small, infrequent frames promptly, so the heartbeat
/// never arrived and the watchdog flipped the dashboard permanently offline. The
/// delegate sees each chunk as the network delivers it (exactly what an EventSource
/// needs). The pure parsing/liveness math (SSEParser, Liveness) is unit-tested.
///
/// `@unchecked Sendable`: all mutable state is guarded by `lock`; the URLSession
/// delegate callbacks arrive on a private serial queue.
public final class EventStream: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let eventsURL: URL
    private let liveness = Liveness()

    private let lock = NSLock()
    private var lastPing = Date()
    private var running = false
    private var onChange: (@Sendable () -> Void)?
    private var onOnline: (@Sendable (Bool) -> Void)?
    private var parser = SSEParser()
    private var byteBuffer = Data()
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var watchdogTask: _Concurrency.Task<Void, Never>?

    public init(baseURL: URL, session: URLSession = .shared) {
        var comps = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        comps.path = "/api/events"
        eventsURL = comps.url!
        super.init()
    }

    public func start(
        onChange: @escaping @Sendable () -> Void,
        onOnline: @escaping @Sendable (Bool) -> Void
    ) {
        lock.lock()
        self.onChange = onChange
        self.onOnline = onOnline
        if running { lock.unlock(); return }
        running = true
        lock.unlock()
        startWatchdog()
        connect()
    }

    public func stop() {
        lock.lock()
        running = false
        task?.cancel(); task = nil
        session?.invalidateAndCancel(); session = nil
        let w = watchdogTask; watchdogTask = nil
        lock.unlock()
        w?.cancel()
    }

    // MARK: - transport

    private func connect() {
        lock.lock()
        guard running else { lock.unlock(); return }
        parser = SSEParser()
        byteBuffer = Data()
        session?.invalidateAndCancel()
        let config = URLSessionConfiguration.ephemeral
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.waitsForConnectivity = false
        let newSession = URLSession(configuration: config, delegate: self, delegateQueue: nil)
        session = newSession
        var req = URLRequest(url: eventsURL)
        req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        req.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        // Ask for an uncompressed stream so frames are never withheld in a
        // decompression buffer.
        req.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        let newTask = newSession.dataTask(with: req)
        task = newTask
        lock.unlock()
        newTask.resume()
    }

    private func scheduleReconnect() {
        lock.lock(); let go = running; lock.unlock()
        guard go else { return }
        _Concurrency.Task { [weak self] in
            try? await _Concurrency.Task.sleep(nanoseconds: 2_000_000_000)
            self?.connect()
        }
    }

    // MARK: - liveness

    private func markAlive() {
        lock.lock(); lastPing = Date(); let cb = onOnline; lock.unlock()
        cb?(true)
    }

    private func emitOnline(_ value: Bool) {
        lock.lock(); let cb = onOnline; lock.unlock()
        cb?(value)
    }

    private func emitChange() {
        lock.lock(); let cb = onChange; lock.unlock()
        cb?()
    }

    private func startWatchdog() {
        lock.lock()
        watchdogTask?.cancel()
        watchdogTask = _Concurrency.Task { [weak self] in
            while true {
                try? await _Concurrency.Task.sleep(nanoseconds: 3_000_000_000)
                guard let self, !_Concurrency.Task.isCancelled else { return }
                if !self.tickWatchdog() { return }
            }
        }
        lock.unlock()
    }

    /// Returns false to stop the watchdog (stream stopped); emits offline on a gap.
    private func tickWatchdog() -> Bool {
        lock.lock()
        let run = running
        let stale = !liveness.isOnline(lastPing: lastPing, now: Date())
        lock.unlock()
        guard run else { return false }
        if stale { emitOnline(false) }
        return true
    }

    // MARK: - URLSessionDataDelegate

    public func urlSession(
        _ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        if (200..<300).contains(code) {
            markAlive()
            completionHandler(.allow)
        } else {
            // Non-2xx is not a live event channel: cancel and let didComplete back off.
            emitOnline(false)
            completionHandler(.cancel)
        }
    }

    public func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        var events: [SSEEvent] = []
        lock.lock()
        byteBuffer.append(data)
        while let nl = byteBuffer.firstIndex(of: 0x0A) {          // split on LF
            let lineData = byteBuffer.prefix(upTo: nl)
            byteBuffer = Data(byteBuffer.suffix(from: byteBuffer.index(after: nl)))
            var line = String(decoding: lineData, as: UTF8.self)
            if line.hasSuffix("\r") { line.removeLast() }         // tolerate CRLF
            if let ev = parser.feed(line) { events.append(ev) }
        }
        lock.unlock()
        for ev in events {
            switch ev {
            case .ping: markAlive()
            case .change: markAlive(); emitChange()
            }
        }
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        let isCurrent = (task === self.task)
        lock.unlock()
        guard isCurrent else { return }   // a superseded/old connection: ignore
        emitOnline(false)
        scheduleReconnect()
    }
}
