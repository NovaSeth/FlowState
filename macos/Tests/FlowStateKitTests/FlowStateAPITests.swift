import XCTest
@testable import FlowStateKit

/// Captures requests issued by the client so tests can assert method/path/query/
/// headers/body, and returns canned responses (status 200 + data).
final class MockURLProtocol: URLProtocol {
    struct Stub { let status: Int; let data: Data }

    final class State: @unchecked Sendable {
        var requests: [URLRequest] = []
        var stub: Stub = Stub(status: 200, data: Data("{}".utf8))
    }
    nonisolated(unsafe) static let state = State()

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.state.requests.append(request)
        let stub = Self.state.stub
        let resp = HTTPURLResponse(
            url: request.url!, statusCode: stub.status, httpVersion: "HTTP/1.1", headerFields: nil)!
        client?.urlProtocol(self, didReceive: resp, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: stub.data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class FlowStateAPITests: XCTestCase {
    private func makeAPI() -> FlowStateAPI {
        MockURLProtocol.state.requests.removeAll()
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        return FlowStateAPI(baseURL: URL(string: "http://localhost:3000")!, session: URLSession(configuration: config))
    }

    private func fixture(_ name: String) throws -> Data {
        let url = try XCTUnwrap(
            Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "fixtures"))
        return try Data(contentsOf: url)
    }

    private var lastRequest: URLRequest { MockURLProtocol.state.requests.last! }

    func testDashboardSendsTrustHeader() async throws {
        let api = makeAPI()
        MockURLProtocol.state.stub = .init(status: 200, data: try fixture("dashboard"))
        let d = try await api.dashboard()
        XCTAssertGreaterThan(d.totals.tasks, 0)
        XCTAssertEqual(lastRequest.url?.path, "/api/dashboard")
        XCTAssertEqual(lastRequest.value(forHTTPHeaderField: "x-fs-dashboard"), "1")
    }

    func testProjectsCarriesQuery() async throws {
        let api = makeAPI()
        MockURLProtocol.state.stub = .init(status: 200, data: try fixture("projects"))
        _ = try await api.projects(solutionId: "so_abc")
        let comps = URLComponents(url: lastRequest.url!, resolvingAgainstBaseURL: false)!
        XCTAssertEqual(comps.path, "/api/projects")
        XCTAssertEqual(comps.queryItems?.first(where: { $0.name == "solutionId" })?.value, "so_abc")
    }

    func testTaskDetailExpandsComments() async throws {
        let api = makeAPI()
        MockURLProtocol.state.stub = .init(status: 200, data: try fixture("task-detail"))
        _ = try await api.taskDetail(id: "ta_1")
        let comps = URLComponents(url: lastRequest.url!, resolvingAgainstBaseURL: false)!
        XCTAssertEqual(comps.path, "/api/tasks/ta_1")
        XCTAssertEqual(comps.queryItems?.first(where: { $0.name == "expand" })?.value, "comments")
    }

    func testSetStatusPatchesWithBody() async throws {
        let api = makeAPI()
        MockURLProtocol.state.stub = .init(status: 200, data: try fixture("task-detail"))
        _ = try await api.setStatus(taskId: "ta_1", status: .done)
        XCTAssertEqual(lastRequest.httpMethod, "PATCH")
        XCTAssertEqual(lastRequest.url?.path, "/api/tasks/ta_1")
        let body = try XCTUnwrap(bodyJSON(lastRequest))
        XCTAssertEqual(body["status"] as? String, "done")
    }

    func testAddCommentPostsWithBody() async throws {
        let api = makeAPI()
        let comment = #"{"id":"c1","taskId":"ta_1","author":"dashboard","body":"hi","createdAt":"2026-06-04T00:00:00.000Z"}"#
        MockURLProtocol.state.stub = .init(status: 200, data: Data(comment.utf8))
        let c = try await api.addComment(taskId: "ta_1", body: "hi")
        XCTAssertEqual(c.body, "hi")
        XCTAssertEqual(lastRequest.httpMethod, "POST")
        XCTAssertEqual(lastRequest.url?.path, "/api/tasks/ta_1/comments")
        let body = try XCTUnwrap(bodyJSON(lastRequest))
        XCTAssertEqual(body["body"] as? String, "hi")
        XCTAssertEqual(body["author"] as? String, "dashboard")
    }

    func testTasksByProjectCarriesQuery() async throws {
        let api = makeAPI()
        MockURLProtocol.state.stub = .init(status: 200, data: try fixture("tasks"))
        _ = try await api.tasks(projectId: "pr_abc")
        let comps = URLComponents(url: lastRequest.url!, resolvingAgainstBaseURL: false)!
        XCTAssertEqual(comps.path, "/api/tasks")
        XCTAssertEqual(comps.queryItems?.first(where: { $0.name == "projectId" })?.value, "pr_abc")
    }

    func testUpdateSolutionPatchesOnlyProvidedFields() async throws {
        let api = makeAPI()
        let solution = ##"{"id":"so_1","name":"S","description":"","color":"#0969da","status":"active","createdAt":"2026-06-04T00:00:00.000Z","updatedAt":"2026-06-04T00:00:00.000Z"}"##
        MockURLProtocol.state.stub = .init(status: 200, data: Data(solution.utf8))
        _ = try await api.updateSolution(id: "so_1", status: .archived)
        XCTAssertEqual(lastRequest.httpMethod, "PATCH")
        XCTAssertEqual(lastRequest.url?.path, "/api/solutions/so_1")
        let body = try XCTUnwrap(bodyJSON(lastRequest))
        XCTAssertEqual(body["status"] as? String, "archived")
        // Partial patch: untouched fields must not appear in the body at all.
        XCTAssertNil(body["name"])
        XCTAssertNil(body["color"])
    }

    func testUpdateMilestoneClearsOutcomeWithNull() async throws {
        let api = makeAPI()
        let milestone = #"{"id":"mi_1","projectId":"pr_1","title":"M","description":"","status":"active","position":0,"outcome":null,"createdAt":"2026-06-04T00:00:00.000Z","updatedAt":"2026-06-04T00:00:00.000Z"}"#
        MockURLProtocol.state.stub = .init(status: 200, data: Data(milestone.utf8))
        _ = try await api.updateMilestone(id: "mi_1", outcome: .some(nil))
        XCTAssertEqual(lastRequest.httpMethod, "PATCH")
        XCTAssertEqual(lastRequest.url?.path, "/api/milestones/mi_1")
        let body = try XCTUnwrap(bodyJSON(lastRequest))
        XCTAssertTrue(body["outcome"] is NSNull, "clearing must send JSON null")
    }

    func testUpdateMilestoneSetsOutcomeValue() async throws {
        let api = makeAPI()
        let milestone = #"{"id":"mi_1","projectId":"pr_1","title":"M","description":"","status":"active","position":0,"outcome":"shipped","createdAt":"2026-06-04T00:00:00.000Z","updatedAt":"2026-06-04T00:00:00.000Z"}"#
        MockURLProtocol.state.stub = .init(status: 200, data: Data(milestone.utf8))
        _ = try await api.updateMilestone(id: "mi_1", outcome: .shipped)
        let body = try XCTUnwrap(bodyJSON(lastRequest))
        XCTAssertEqual(body["outcome"] as? String, "shipped")
    }

    func testDeleteSendsDeleteWithTrustHeader() async throws {
        let api = makeAPI()
        MockURLProtocol.state.stub = .init(status: 204, data: Data())
        try await api.deleteProject(id: "pr_1")
        XCTAssertEqual(lastRequest.httpMethod, "DELETE")
        XCTAssertEqual(lastRequest.url?.path, "/api/projects/pr_1")
        XCTAssertEqual(lastRequest.value(forHTTPHeaderField: "x-fs-dashboard"), "1")
    }

    func testNon2xxThrowsAPIError() async throws {
        let api = makeAPI()
        MockURLProtocol.state.stub = .init(status: 422, data: Data(#"{"error":"bad"}"#.utf8))
        do {
            _ = try await api.dashboard()
            XCTFail("expected APIError")
        } catch let e as APIError {
            XCTAssertEqual(e.status, 422)
        }
    }

    // URLProtocol exposes the request body via httpBodyStream, not httpBody.
    private func bodyJSON(_ request: URLRequest) -> [String: Any]? {
        let data: Data
        if let b = request.httpBody {
            data = b
        } else if let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }
            var acc = Data()
            let size = 4096
            var buf = [UInt8](repeating: 0, count: size)
            while stream.hasBytesAvailable {
                let n = stream.read(&buf, maxLength: size)
                if n <= 0 { break }
                acc.append(buf, count: n)
            }
            data = acc
        } else {
            return nil
        }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }
}
