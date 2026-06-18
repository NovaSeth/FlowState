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
/// `onOnline` (liveness). Auto-reconnects with a short backoff. The pure parsing
/// and liveness math (SSEParser, Liveness) are unit-tested; this transport shell
/// is exercised by the app smoke test.
public actor EventStream {
    private let eventsURL: URL
    private let session: URLSession
    private let liveness = Liveness()
    private var lastPing = Date()
    private var running = false
    private var onChange: (@Sendable () -> Void)?
    private var onOnline: (@Sendable (Bool) -> Void)?

    public init(baseURL: URL, session: URLSession = .shared) {
        var comps = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        comps.path = "/api/events"
        eventsURL = comps.url!
        self.session = session
    }

    public func start(
        onChange: @escaping @Sendable () -> Void,
        onOnline: @escaping @Sendable (Bool) -> Void
    ) {
        self.onChange = onChange
        self.onOnline = onOnline
        guard !running else { return }
        running = true
        _Concurrency.Task { await self.watchdog() }
        _Concurrency.Task { await self.readLoop() }
    }

    public func stop() {
        running = false
    }

    private func markAlive() {
        lastPing = Date()
        onOnline?(true)
    }

    private func watchdog() async {
        while running {
            try? await _Concurrency.Task.sleep(nanoseconds: 3_000_000_000)
            if running, !liveness.isOnline(lastPing: lastPing, now: Date()) {
                onOnline?(false)
            }
        }
    }

    private func readLoop() async {
        var parser = SSEParser()
        while running {
            do {
                let (bytes, _) = try await session.bytes(from: eventsURL)
                markAlive()
                for try await line in bytes.lines {
                    if !running { break }
                    switch parser.feed(line) {
                    case .ping: markAlive()
                    case .change: markAlive(); onChange?()
                    case nil: break
                    }
                }
            } catch {
                onOnline?(false)
            }
            if running { try? await _Concurrency.Task.sleep(nanoseconds: 2_000_000_000) }
        }
    }
}
