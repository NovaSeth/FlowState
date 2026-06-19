import Foundation
import Network

/// Minimal local HTTP for controlling the server from the web (Settings).
///
/// Listens on 127.0.0.1:<port> (loopback ONLY - a LAN neighbor cannot reach it).
/// This lets the Settings page (already loaded) do Start/Stop/Restart even when
/// Next itself is down - it talks directly to THIS port, not through Next. CORS open
/// (local project). Routes: GET /status -> {state}, POST /start|/stop|/restart.
///
/// `@unchecked Sendable`: `statusToken` is guarded by `lock`, `listener`/`onCommand`
/// are written once on the main thread before start(), and the NW handlers run on
/// the private `queue` - safe to share, but not provable to the checker.
final class ControlServer: @unchecked Sendable {
    private let port: NWEndpoint.Port
    private var listener: NWListener?
    private let queue = DispatchQueue(label: "com.flowstate.control", qos: .utility)
    private let lock = NSLock()
    private var statusToken = "unknown"

    /// Called on the MAIN thread with "start" | "stop" | "restart".
    var onCommand: ((String) -> Void)?

    init(port: UInt16) {
        self.port = NWEndpoint.Port(rawValue: port)!
    }

    func updateStatus(_ token: String) {
        lock.lock(); statusToken = token; lock.unlock()
    }
    private func currentStatus() -> String {
        lock.lock(); defer { lock.unlock() }; return statusToken
    }

    func start() {
        let params = NWParameters.tcp
        params.requiredInterfaceType = .loopback   // 127.0.0.1 only
        params.allowLocalEndpointReuse = true
        guard let l = try? NWListener(using: params, on: port) else {
            NSLog("FlowState: control server failed to bind port \(port)")
            return
        }
        l.newConnectionHandler = { [weak self] conn in self?.handle(conn) }
        l.start(queue: queue)
        listener = l
        NSLog("FlowState: control server on 127.0.0.1:\(port)")
    }

    /// Hard cap on accumulated request bytes - we only ever parse a tiny request
    /// line + a few headers, so anything past this is bogus/hostile.
    private static let maxRequestBytes = 64 * 1024

    private func handle(_ conn: NWConnection) {
        conn.start(queue: queue)
        receiveLoop(conn, buffer: Data())
    }

    /// Accumulate bytes across TCP segments until the end-of-headers terminator
    /// (CRLFCRLF) is seen, then parse. A request split across segments would
    /// otherwise be parsed half-formed. Bounded by maxRequestBytes.
    private func receiveLoop(_ conn: NWConnection, buffer: Data) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, isComplete, error in
            guard let self = self else { conn.cancel(); return }

            var buffer = buffer
            if let data = data, !data.isEmpty { buffer.append(data) }

            // Headers complete? (We do not read a body - all routes are header-only.)
            let terminator = Data([0x0d, 0x0a, 0x0d, 0x0a])   // CRLF CRLF
            if let _ = buffer.range(of: terminator) {
                let req = String(data: buffer, encoding: .utf8) ?? ""
                self.route(req, conn: conn)
                return
            }

            if let error = error {
                NSLog("FlowState: control receive error: \(error)")
                conn.cancel()
                return
            }
            // Peer closed before we saw a full header, or we hit the cap: stop.
            if isComplete || buffer.count >= ControlServer.maxRequestBytes {
                if buffer.isEmpty {
                    conn.cancel()
                } else {
                    // Best-effort parse of whatever we got (e.g. a header-less GET).
                    self.route(String(data: buffer, encoding: .utf8) ?? "", conn: conn)
                }
                return
            }
            // Need more bytes - keep reading.
            self.receiveLoop(conn, buffer: buffer)
        }
    }

    private func route(_ req: String, conn: NWConnection) {
        let lines = req.components(separatedBy: "\r\n")
        let head = lines.first?.split(separator: " ") ?? []
        let method = head.count >= 1 ? String(head[0]) : ""
        let rawPath = head.count >= 2 ? String(head[1]) : ""
        let path = rawPath.split(separator: "?").first.map(String.init) ?? rawPath

        // Headers (lowercase keys).
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            if line.isEmpty { break }
            guard let idx = line.firstIndex(of: ":") else { continue }
            let k = line[..<idx].trimmingCharacters(in: .whitespaces).lowercased()
            let v = line[line.index(after: idx)...].trimmingCharacters(in: .whitespaces)
            headers[k] = v
        }
        // We reflect ACAO ONLY for a local origin (not '*'), so a foreign page cannot
        // read the response or pass preflight on mutations.
        let origin = isLocalOrigin(headers["origin"]) ? headers["origin"] : nil

        if method == "OPTIONS" {
            respond(conn, status: "204 No Content", body: nil, origin: origin)
            return
        }
        // Anti-DNS-rebinding: Host must be local (a rebinding attack carries a foreign Host).
        guard isLocalHost(headers["host"]) else {
            respond(conn, status: "403 Forbidden", body: "{\"error\":\"bad host\"}", origin: origin)
            return
        }
        if method == "GET", path == "/status" {
            respond(conn, status: "200 OK", body: "{\"state\":\"\(currentStatus())\"}", origin: origin)
            return
        }
        if method == "POST", path == "/start" || path == "/stop" || path == "/restart" {
            // CSRF: we require a non-standard header - this forces a CORS preflight for
            // cross-origin (a foreign page cannot do a simple POST). Missing -> 403.
            guard headers["x-flow-control"] != nil else {
                respond(conn, status: "403 Forbidden", body: "{\"error\":\"missing control header\"}", origin: origin)
                return
            }
            let cmd = String(path.dropFirst())   // start | stop | restart
            DispatchQueue.main.async { self.onCommand?(cmd) }
            respond(conn, status: "200 OK", body: "{\"ok\":true}", origin: origin)
            return
        }
        respond(conn, status: "404 Not Found", body: "{\"error\":\"not found\"}", origin: origin)
    }

    private func isLocalHost(_ host: String?) -> Bool {
        guard let host = host else { return false }
        let p = port.rawValue
        return host == "127.0.0.1:\(p)" || host == "localhost:\(p)"
    }

    private func isLocalOrigin(_ origin: String?) -> Bool {
        guard let origin = origin else { return false }
        return origin.range(
            of: "^https?://(127\\.0\\.0\\.1|localhost)(:[0-9]+)?$",
            options: .regularExpression
        ) != nil
    }

    private func respond(_ conn: NWConnection, status: String, body: String?, origin: String?) {
        var head = "HTTP/1.1 \(status)\r\n"
        if let origin = origin {
            head += "Access-Control-Allow-Origin: \(origin)\r\n"
            head += "Vary: Origin\r\n"
        }
        head += "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
        head += "Access-Control-Allow-Headers: Content-Type, X-Flow-Control\r\n"
        head += "Cache-Control: no-store\r\n"
        if let body = body {
            let count = body.utf8.count
            head += "Content-Type: application/json\r\n"
            head += "Content-Length: \(count)\r\n\r\n"
            head += body
        } else {
            head += "Content-Length: 0\r\n\r\n"
        }
        conn.send(content: head.data(using: .utf8), completion: .contentProcessed { _ in
            conn.cancel()
        })
    }
}
