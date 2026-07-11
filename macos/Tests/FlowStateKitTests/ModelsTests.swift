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

    func testDecodeKeysWithGrants() throws {
        let keys = try decode([ApiKey].self, "keys")
        XCTAssertEqual(keys.count, 3)

        // grants present: decoded verbatim (the source of truth).
        XCTAssertEqual(keys[0].grants.count, 2)
        XCTAssertEqual(keys[0].grants[0].projectId, "pr_dashboard01")
        XCTAssertNil(keys[0].grants[0].solutionId)
        XCTAssertEqual(keys[0].grants[0].scope, .write)
        XCTAssertEqual(keys[0].grants[1].solutionId, "so_hal9000kbase")
        XCTAssertNil(keys[0].grants[1].projectId)
        XCTAssertEqual(keys[0].grants[1].scope, .read)

        // Global grant: neither target id set.
        XCTAssertEqual(keys[1].grants.count, 1)
        XCTAssertNil(keys[1].grants[0].solutionId)
        XCTAssertNil(keys[1].grants[0].projectId)

        // Legacy payload without `grants`: falls back to a single grant derived
        // from the top-level solutionId+scope, like the server does.
        XCTAssertEqual(keys[2].grants.count, 1)
        XCTAssertEqual(keys[2].grants[0].solutionId, "so_hal9000kbase")
        XCTAssertNil(keys[2].grants[0].projectId)
        XCTAssertEqual(keys[2].grants[0].scope, .write)
    }
}
