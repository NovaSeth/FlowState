import XCTest
@testable import FlowStateKit

final class LocalizationTests: XCTestCase {
    func testNestedKeyAndInterpolation() {
        let loc = Localization(locale: "en", tables: ["en": ["users": ["keyCount": "{n} keys"]]])
        XCTAssertEqual(loc.t("users.keyCount", ["n": "3"]), "3 keys")
    }

    func testFallsBackToEnThenKey() {
        let loc = Localization(
            locale: "pl",
            tables: ["en": ["a": ["b": "X"]], "pl": [:]]
        )
        XCTAssertEqual(loc.t("a.b"), "X")     // pl missing -> en
        XCTAssertEqual(loc.t("no.such"), "no.such")
    }

    func testRealTablesLoadAndResolve() throws {
        let loc = Localization.load(locale: "pl", bundle: .module)
        // A key that exists in src/i18n: status.todo. PL and EN both define it.
        XCTAssertNotEqual(loc.t("status.todo"), "status.todo")
    }

    func testEnAndPlHaveSameKeys() throws {
        let en = try flatKeys("en")
        let pl = try flatKeys("pl")
        XCTAssertEqual(en, pl, "en.json and pl.json key sets diverged")
    }

    // Flatten a fixture localization file into the set of dotted leaf keys.
    private func flatKeys(_ name: String) throws -> Set<String> {
        let url = try XCTUnwrap(
            Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "fixtures")
        )
        let table = Localization.parse(try Data(contentsOf: url))
        var keys = Set<String>()
        func walk(_ node: [String: Any], _ prefix: String) {
            for (k, v) in node {
                let path = prefix.isEmpty ? k : "\(prefix).\(k)"
                if let child = v as? [String: Any] {
                    walk(child, path)
                } else {
                    keys.insert(path)
                }
            }
        }
        walk(table, "")
        return keys
    }
}
