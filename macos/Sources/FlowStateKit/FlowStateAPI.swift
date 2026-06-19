import Foundation

public struct APIError: Error, CustomStringConvertible {
    public let status: Int
    public let body: String
    public var description: String { "Flow State API error \(status): \(body)" }
}

/// Async REST client for the Flow State server. Every request carries the
/// `x-fs-dashboard: 1` trust header, mirroring the web dashboard: this grants
/// keyless local read AND write (mutations) against the default local server.
public struct FlowStateAPI: Sendable {
    private let baseURL: URL
    private let session: URLSession

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    // MARK: - Reads

    public func dashboard() async throws -> DashboardPayload { try await get("/api/dashboard") }

    public func solutions() async throws -> [SolutionRollup] { try await get("/api/solutions") }

    public func projects(solutionId: String) async throws -> [ProjectRollup] {
        try await get("/api/projects", query: ["solutionId": solutionId])
    }

    public func milestones(projectId: String) async throws -> [MilestoneRollup] {
        try await get("/api/milestones", query: ["projectId": projectId])
    }

    public func tasks(milestoneId: String) async throws -> [TaskListItem] {
        try await get("/api/tasks", query: ["milestoneId": milestoneId])
    }

    public func taskDetail(id: String) async throws -> TaskDetail {
        try await get("/api/tasks/\(id)", query: ["expand": "comments"])
    }

    public func actors() async throws -> [Actor] { try await get("/api/actors") }

    public func keys(actorId: String? = nil) async throws -> [ApiKey] {
        var query: [String: String] = [:]
        if let actorId { query["actorId"] = actorId }
        return try await get("/api/keys", query: query)
    }

    public func activity(entityId: String? = nil, actorId: String? = nil, limit: Int? = nil) async throws -> [Activity] {
        var query: [String: String] = [:]
        if let entityId { query["entityId"] = entityId }
        if let actorId { query["actorId"] = actorId }
        if let limit { query["limit"] = String(limit) }
        return try await get("/api/activity", query: query)
    }

    // MARK: - Mutations

    @discardableResult
    public func setStatus(
        taskId: String, status: TaskStatus, reason: String? = nil, reasonAuthor: String? = nil
    ) async throws -> TaskDetail {
        var body: [String: Any] = ["status": status.rawValue]
        if let reason { body["reason"] = reason }
        if let reasonAuthor { body["reasonAuthor"] = reasonAuthor }
        return try await send("PATCH", "/api/tasks/\(taskId)", body: body)
    }

    @discardableResult
    public func setPriority(taskId: String, priority: TaskPriority) async throws -> TaskDetail {
        try await send("PATCH", "/api/tasks/\(taskId)", body: ["priority": priority.rawValue])
    }

    @discardableResult
    public func addComment(taskId: String, body text: String, author: String = "dashboard") async throws -> Comment {
        try await send("POST", "/api/tasks/\(taskId)/comments", body: ["body": text, "author": author])
    }

    // MARK: - Internals

    private func get<T: Decodable>(_ path: String, query: [String: String] = [:]) async throws -> T {
        var req = URLRequest(url: makeURL(path, query))
        req.setValue("1", forHTTPHeaderField: "x-fs-dashboard")
        return try await run(req)
    }

    private func send<T: Decodable>(_ method: String, _ path: String, body: [String: Any]) async throws -> T {
        var req = URLRequest(url: makeURL(path, [:]))
        req.httpMethod = method
        req.setValue("1", forHTTPHeaderField: "x-fs-dashboard")
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await run(req)
    }

    private func run<T: Decodable>(_ req: URLRequest) async throws -> T {
        let (data, resp) = try await session.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw APIError(status: status, body: String(data: data, encoding: .utf8) ?? "")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func makeURL(_ path: String, _ query: [String: String]) -> URL {
        var comps = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        comps.path = path
        if !query.isEmpty {
            comps.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        return comps.url!
    }
}
