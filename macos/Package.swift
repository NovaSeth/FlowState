// swift-tools-version:6.0
import PackageDescription

// FlowStateKit holds the pure, testable core of the native dashboard (models,
// REST client, SSE consumer, localization). The AppKit/SwiftUI app in src/ also
// compiles these sources into its bundle via build.sh; this package exists so
// the core can be unit-tested with `swift test` independent of the GUI.
let package = Package(
    name: "FlowStateKit",
    platforms: [.macOS(.v13)],
    targets: [
        .target(name: "FlowStateKit", path: "Sources/FlowStateKit"),
        .testTarget(
            name: "FlowStateKitTests",
            dependencies: ["FlowStateKit"],
            path: "Tests/FlowStateKitTests",
            resources: [.copy("fixtures")]
        ),
    ]
)
