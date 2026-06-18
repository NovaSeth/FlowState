import XCTest
@testable import FlowStateKit

/// Decode the live API fixtures into the Codable models. These are the drift
/// guard against src/lib/types.ts: if the server payloads change shape, decoding
/// fails here.
final class ModelsTests: XCTestCase {
    private func fixture(_ name: String) throws -> Data {
        let url = try XCTUnwrap(
            Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "fixtures"),
            "missing fixture \(name).json"
        )
        return try Data(contentsOf: url)
    }

    private func decode<T: Decodable>(_ type: T.Type, _ name: String) throws -> T {
        try JSONDecoder().decode(type, from: try fixture(name))
    }

    func testDecodeDashboard() throws {
        let d = try decode(DashboardPayload.self, "dashboard")
        XCTAssertGreaterThan(d.totals.tasks, 0)
        XCTAssertFalse(d.solutions.isEmpty)
        XCTAssertGreaterThanOrEqual(d.progress.percent, 0)
        XCTAssertLessThanOrEqual(d.progress.percent, 100)
        // statusCounts sums to something sane; dailyByStatus is rectangular.
        for row in d.dailyByStatus.counts {
            XCTAssertEqual(row.count, d.dailyByStatus.statuses.count)
        }
    }

    func testDecodeSolutions() throws {
        let s = try decode([SolutionRollup].self, "solutions")
        XCTAssertFalse(s.isEmpty)
        XCTAssertFalse(s[0].base.name.isEmpty)
        XCTAssertGreaterThanOrEqual(s[0].projectCount, 0)
    }

    func testDecodeProjects() throws {
        let p = try decode([ProjectRollup].self, "projects")
        XCTAssertFalse(p.isEmpty)
        XCTAssertFalse(p[0].base.solutionId.isEmpty)
    }

    func testDecodeMilestones() throws {
        let m = try decode([MilestoneRollup].self, "milestones")
        XCTAssertFalse(m.isEmpty)
        XCTAssertFalse(m[0].base.projectId.isEmpty)
    }

    func testDecodeTasks() throws {
        let t = try decode([TaskListItem].self, "tasks")
        XCTAssertFalse(t.isEmpty)
        XCTAssertFalse(t[0].base.id.isEmpty)
        XCTAssertGreaterThanOrEqual(t[0].childCount, 0)
    }

    func testDecodeTaskDetail() throws {
        let t = try decode(TaskDetail.self, "task-detail")
        XCTAssertFalse(t.base.id.isEmpty)
        // base Task fields and the detail extras both decoded from the flat object.
        XCTAssertNotNil(t.artifacts)
        XCTAssertGreaterThanOrEqual(t.childCount, 0)
    }

    func testDecodeActors() throws {
        let a = try decode([Actor].self, "actors")
        XCTAssertFalse(a.isEmpty)
        XCTAssertFalse(a[0].name.isEmpty)
    }
}
