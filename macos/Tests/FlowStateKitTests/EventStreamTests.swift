import XCTest
@testable import FlowStateKit

final class EventStreamTests: XCTestCase {
    func testParsesChangeFrame() {
        var p = SSEParser()
        XCTAssertNil(p.feed("data: {\"type\":\"x\",\"at\":\"t\"}"))
        XCTAssertEqual(p.feed(""), .change("{\"type\":\"x\",\"at\":\"t\"}"))
    }

    func testParsesPingFrame() {
        var p = SSEParser()
        XCTAssertNil(p.feed("event: ping"))
        XCTAssertNil(p.feed("data: 1"))
        XCTAssertEqual(p.feed(""), .ping)
    }

    func testIgnoresCommentsAndRetry() {
        var p = SSEParser()
        XCTAssertNil(p.feed(": connected"))
        XCTAssertNil(p.feed("retry: 3000"))
        XCTAssertNil(p.feed(""))   // nothing accumulated -> no event
    }

    func testMultiLineDataJoinsWithNewline() {
        var p = SSEParser()
        XCTAssertNil(p.feed("data: a"))
        XCTAssertNil(p.feed("data: b"))
        XCTAssertEqual(p.feed(""), .change("a\nb"))
    }

    func testLivenessFlipsOnGap() {
        let l = Liveness(timeoutSeconds: 12)
        let t0 = Date()
        XCTAssertTrue(l.isOnline(lastPing: t0, now: t0.addingTimeInterval(5)))
        XCTAssertFalse(l.isOnline(lastPing: t0, now: t0.addingTimeInterval(13)))
    }
}
