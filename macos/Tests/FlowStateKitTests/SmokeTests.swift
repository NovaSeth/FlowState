import XCTest
@testable import FlowStateKit

final class SmokeTests: XCTestCase {
    func testVersion() {
        XCTAssertEqual(FlowStateKit.version, "1.34.0")
    }
}
