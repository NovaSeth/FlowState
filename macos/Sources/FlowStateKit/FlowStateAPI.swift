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

    /// All projects across every solution (no filter) - the Users screen uses
    /// this to resolve project names in key-grant labels.
    public func projects() async throws -> [ProjectRollup] {
        try await get("/api/projects")
    }

    public func milestones(projectId: String) async throws -> [MilestoneRollup] {
        try await get("/api/milestones", query: ["projectId": projectId])
    }

    public func tasks(milestoneId: String) async throws -> [TaskListItem] {
        try await get("/api/tasks", query: ["milestoneId": milestoneId])
    }

    /// Every task in a project (across milestones) - feeds the project dashboard
    /// view's milestone cards + status board.
    public func tasks(projectId: String) async throws -> [TaskListItem] {
        try await get("/api/tasks", query: ["projectId": projectId])
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

    /// Full token for the Users panel's "show" reveal. nil when the key
    /// predates plaintext-secret storage (unrecoverable from the hash).
    public func keySecret(id: String) async throws -> String? {
        struct Payload: Decodable { let token: String? }
        let payload: Payload = try await get("/api/keys/\(id)/secret")
        return payload.token
    }

    // MARK: - Multi-instance connections + app settings

    public func connections() async throws -> ConnectionsPayload {
        try await get("/api/connections")
    }

    @discardableResult
    public func createConnection(
        name: String, host: String, port: Int, apiKey: String
    ) async throws -> FSConnection {
        try await send("POST", "/api/connections",
                       body: ["name": name, "host": host, "port": port, "apiKey": apiKey])
    }

    public func deleteConnection(id: String) async throws {
        try await delete("/api/connections/\(id)")
    }

    /// Switch the data source (nil = back to local). Health-checked server-side.
    public func setActiveConnection(id: String?) async throws {
        struct Payload: Decodable { let activeId: String? }
        let _: Payload = try await send("PATCH", "/api/connections",
                                        body: ["activeId": id ?? NSNull()])
    }

    public func appSettings() async throws -> AppSettingsPayload {
        try await get("/api/settings")
    }

    @discardableResult
    public func setRequireKey(_ on: Bool) async throws -> AppSettingsPayload {
        try await send("PATCH", "/api/settings", body: ["requireKey": on])
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

    // MARK: - Creates (mirror the web forms.tsx + lib/api.ts create* helpers).
    // Title/name only - the server fills the rest (status, priority, position).

    @discardableResult
    public func createSolution(name: String) async throws -> Solution {
        try await send("POST", "/api/solutions", body: ["name": name])
    }

    @discardableResult
    public func createProject(solutionId: String, name: String) async throws -> Project {
        try await send("POST", "/api/projects", body: ["solutionId": solutionId, "name": name])
    }

    @discardableResult
    public func createMilestone(projectId: String, title: String) async throws -> Milestone {
        try await send("POST", "/api/milestones", body: ["projectId": projectId, "title": title])
    }

    @discardableResult
    public func createTask(milestoneId: String, title: String) async throws -> Task {
        try await send("POST", "/api/tasks", body: ["milestoneId": milestoneId, "title": title])
    }

    // MARK: - Updates (PATCH, partial body - only the provided fields are sent),
    // mirroring the web lib/api.ts update* helpers used by the row kebab menu.

    @discardableResult
    public func updateSolution(
        id: String, name: String? = nil, description: String? = nil,
        color: String? = nil, status: SolutionStatus? = nil
    ) async throws -> Solution {
        var body: [String: Any] = [:]
        if let name { body["name"] = name }
        if let description { body["description"] = description }
        if let color { body["color"] = color }
        if let status { body["status"] = status.rawValue }
        return try await send("PATCH", "/api/solutions/\(id)", body: body)
    }

    @discardableResult
    public func updateProject(
        id: String, name: String? = nil, description: String? = nil,
        status: ProjectStatus? = nil
    ) async throws -> Project {
        var body: [String: Any] = [:]
        if let name { body["name"] = name }
        if let description { body["description"] = description }
        if let status { body["status"] = status.rawValue }
        return try await send("PATCH", "/api/projects/\(id)", body: body)
    }

    /// `outcome` is a double optional: omit it (default) to leave the outcome
    /// untouched, pass `.some(nil)` to clear it (JSON null), or a value to set it.
    @discardableResult
    public func updateMilestone(
        id: String, title: String? = nil, description: String? = nil,
        status: MilestoneStatus? = nil, outcome: MilestoneOutcome?? = nil
    ) async throws -> Milestone {
        var body: [String: Any] = [:]
        if let title { body["title"] = title }
        if let description { body["description"] = description }
        if let status { body["status"] = status.rawValue }
        if let outcome {
            if let value = outcome { body["outcome"] = value.rawValue } else { body["outcome"] = NSNull() }
        }
        return try await send("PATCH", "/api/milestones/\(id)", body: body)
    }

    // MARK: - Deletes (the server answers 204 No Content).

    public func deleteSolution(id: String) async throws { try await delete("/api/solutions/\(id)") }
    public func deleteProject(id: String) async throws { try await delete("/api/projects/\(id)") }
    public func deleteMilestone(id: String) async throws { try await delete("/api/milestones/\(id)") }

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

    /// DELETE with no decodable response body (204 No Content on success).
    private func delete(_ path: String) async throws {
        var req = URLRequest(url: makeURL(path, [:]))
        req.httpMethod = "DELETE"
        req.setValue("1", forHTTPHeaderField: "x-fs-dashboard")
        let (data, resp) = try await session.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw APIError(status: status, body: String(data: data, encoding: .utf8) ?? "")
        }
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
