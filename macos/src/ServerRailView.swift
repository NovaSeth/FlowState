import SwiftUI

// The connections rail, mirroring the web ServerRail: a slim WHITE strip on
// the far left (the visual inverse of the blue nav rail - white background,
// blue active element) listing the data sources: "local" on top, saved remote
// Flow State instances below it (initials + host), and a "+" at the bottom.
// Clicking an entry switches the ACTIVE source on the LOCAL server (which then
// proxies everything); entries can be removed via the hover "x".
struct ServerRailView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.i18n) private var i18n

    @State private var adding = false

    var body: some View {
        VStack(spacing: 6) {
            entry(
                label: i18n.t("servers.local"), text: "local", status: true,
                active: store.activeConnectionId == nil,
                onTap: { switchTo(nil) }
            )

            if !store.connections.isEmpty {
                RoundedRectangle(cornerRadius: 1)
                    .fill(.white.opacity(0.2)).frame(width: 40, height: 1)
            }

            ForEach(store.connections) { c in
                entry(
                    label: c.name.isEmpty ? "\(c.host):\(c.port)" : "\(c.name) - \(c.host):\(c.port)",
                    // Show the custom name if given, else the host/IP.
                    text: c.name.isEmpty ? c.host : c.name,
                    status: store.connectionHealth[c.id],
                    active: store.activeConnectionId == c.id,
                    onTap: { switchTo(c.id) },
                    onRemove: { _Concurrency.Task { await store.removeConnection(c.id) } }
                )
            }

            Button { adding = true } label: {
                Text("+")
                    .font(.system(size: 16, design: .monospaced))
                    .frame(width: 64, height: 40)
                    .foregroundStyle(.white.opacity(0.6))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14)
                            .strokeBorder(.white.opacity(0.3), style: StrokeStyle(lineWidth: 1, dash: [3]))
                    )
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(i18n.t("servers.add"))

            Spacer()
        }
        .padding(.top, 10).padding(.bottom, 12)
        .frame(width: 80)
        .frame(maxHeight: .infinity)
        // Blue like the nav rail; a delicate white divider (inset 10px top and
        // bottom) separates the two rails.
        .background(DS.brand)
        .overlay(
            Rectangle()
                .frame(width: 1)
                .foregroundStyle(.white.opacity(0.4))
                .padding(.vertical, 10),
            alignment: .trailing
        )
        .sheet(isPresented: $adding) { AddConnectionSheet() }
    }

    private func switchTo(_ id: String?) {
        _Concurrency.Task { await store.switchConnection(id) }
    }

    // Workspace-switcher chip (Discord/Slack): a rounded chip with a left-edge
    // indicator pill - tall when active, short on hover, hidden otherwise.
    private func entry(
        label: String, text: String, status: Bool?, active: Bool,
        onTap: @escaping () -> Void,
        onRemove: (() -> Void)? = nil
    ) -> some View {
        RailChip(text: text, status: status, active: active, brand: DS.brand, onTap: onTap)
            .help(label)
            .contextMenu {
                if let onRemove {
                    Button(i18n.t("servers.remove"), role: .destructive) { onRemove() }
                }
            }
    }
}

// A single rail chip with its own hover state + a reachability status dot.
private struct RailChip: View {
    let text: String
    /// Reachability: true = green dot, false = red dot, nil = still checking.
    let status: Bool?
    let active: Bool
    let brand: Color
    let onTap: () -> Void
    @State private var hovering = false

    var body: some View {
        // Active = solid white chip (its own indicator); inactive = translucent
        // chip that brightens on hover. No detached edge pill - on a narrow
        // centered chip it reads as a stray element.
        Button(action: onTap) {
            HStack(spacing: 5) {
                Text(text)
                    .font(.system(size: 10, design: .monospaced))
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                // Reachability dot to the right of the name / host.
                if let status {
                    Circle()
                        .fill(status ? DS.success : DS.danger)
                        .frame(width: 6, height: 6)
                }
            }
            .padding(.horizontal, 8).padding(.vertical, 8)
            .frame(width: 68)
            .background(active ? Color.white : .white.opacity(hovering ? 0.2 : 0.1))
            .foregroundStyle(active ? brand : .white.opacity(hovering ? 1 : 0.7))
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}

// Small form sheet to register a remote instance: name, host, port, API key.
private struct AddConnectionSheet: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.i18n) private var i18n
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var host = ""
    @State private var port = "3000"
    @State private var apiKey = ""
    @State private var busy = false
    @State private var failed = false

    // Name is optional (the rail falls back to the host/IP); host + port required.
    private var valid: Bool {
        !host.trimmingCharacters(in: .whitespaces).isEmpty && Int(port) != nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(i18n.t("servers.add")).font(.system(size: 14, weight: .semibold)).foregroundStyle(DS.fg)
            TextField(i18n.t("servers.nameOptionalPlaceholder"), text: $name)
                .textFieldStyle(.roundedBorder)
            HStack(spacing: 8) {
                TextField(i18n.t("servers.hostPlaceholder"), text: $host)
                    .textFieldStyle(.roundedBorder)
                TextField("3000", text: $port)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 80)
            }
            TextField(i18n.t("servers.keyPlaceholder"), text: $apiKey)
                .textFieldStyle(.roundedBorder)
                .font(.system(size: 12, design: .monospaced))
            Text(i18n.t("servers.addHint")).font(.system(size: 11)).foregroundStyle(DS.fgSubtle)
            if failed {
                Text(i18n.t("servers.addError")).font(.system(size: 12)).foregroundStyle(DS.danger)
            }
            HStack {
                Spacer()
                Button(i18n.t("forms.cancel")) { dismiss() }
                    .buttonStyle(.bordered)
                    .keyboardShortcut(.cancelAction)
                Button(i18n.t("forms.add")) { submit() }
                    .buttonStyle(.borderedProminent)
                    .disabled(busy || !valid)
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(16)
        .frame(width: 380)
        .background(DS.canvas)
    }

    private func submit() {
        guard valid, !busy else { return }
        busy = true
        failed = false
        _Concurrency.Task {
            let ok = await store.addConnection(
                name: name.trimmingCharacters(in: .whitespaces),
                host: host.trimmingCharacters(in: .whitespaces),
                port: Int(port) ?? 3000,
                apiKey: apiKey.trimmingCharacters(in: .whitespaces)
            )
            busy = false
            if ok { dismiss() } else { failed = true }
        }
    }
}

// The data-source switch transition (native answer to the web's three.js
// wormhole, since the app renders in SwiftUI not WebGL): a Canvas "warp jump"
// starfield with the connection status in the centre. On failure the warp fades
// and a "could not reach" card with a Back button remains. Shown over the
// CONTENT area only (DashboardRootView), so both rails stay visible + clickable.
struct ServerSwitchOverlay: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.i18n) private var i18n
    let label: String
    let phase: AppStore.SwitchPhase
    @State private var animate = false
    @State private var start = Date()

    private var failed: Bool { phase == .failed }

    var body: some View {
        ZStack {
            Rectangle().fill(DS.canvas).ignoresSafeArea()
            if !failed {
                WarpField(start: start, color: DS.accent).ignoresSafeArea()
            }
            if failed {
                VStack(spacing: 16) {
                    ZStack {
                        Circle().fill(DS.dangerMuted).frame(width: 48, height: 48)
                        Image(systemName: Glyph.symbol("alert")).font(.system(size: 22)).foregroundStyle(DS.danger)
                    }
                    VStack(spacing: 4) {
                        Text(i18n.t("servers.connectFailed")).font(.system(size: 13, weight: .medium)).foregroundStyle(DS.fg)
                        Text(label).font(.system(size: 12, design: .monospaced)).foregroundStyle(DS.fgSubtle)
                    }
                    Button(i18n.t("common.back")) { store.dismissSwitch() }
                        .buttonStyle(.bordered)
                }
            } else {
                VStack(spacing: 20) {
                    BrandMark(dotColor: DS.accent, size: 48)
                        .scaleEffect(animate ? 1.12 : 1.0)
                        .opacity(animate ? 1.0 : 0.75)
                        .animation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true), value: animate)
                    VStack(spacing: 4) {
                        Text(i18n.t("servers.switching")).font(.system(size: 13, weight: .medium)).foregroundStyle(DS.fg)
                        Text(label).font(.system(size: 12, design: .monospaced)).foregroundStyle(DS.accent)
                    }
                    HStack(spacing: 6) {
                        ForEach(0..<3, id: \.self) { i in
                            Circle().fill(DS.accent).frame(width: 8, height: 8)
                                .offset(y: animate ? -5 : 0)
                                .animation(
                                    .easeInOut(duration: 0.5).repeatForever(autoreverses: true)
                                        .delay(Double(i) * 0.15),
                                    value: animate)
                        }
                    }
                }
            }
        }
        .onAppear { animate = true; start = Date() }
    }
}

// Streaking-starfield warp: particles radiate outward from the centre, faster
// over time - the "oooo WOW" of jumping to another instance. Deterministic per
// index (no Math.random), driven by TimelineView.
// A wireframe TUNNEL drawn in Canvas (the native counterpart to the web's
// three.js wormhole): concentric rings receding to a dark throat with
// perspective, plus radial spokes forming the grid, all flowing toward the
// viewer as we dive in. The throat drifts so the tube appears to bend. Blue,
// from the side navigation.
private struct WarpField: View {
    let start: Date
    let color: Color

    var body: some View {
        TimelineView(.animation) { tl in
            Canvas { ctx, size in
                let t = tl.date.timeIntervalSince(start)
                // The throat drifts to evoke a bending tube.
                let cx = size.width / 2 + sin(t * 0.5) * size.width * 0.07
                let cy = size.height / 2 + cos(t * 0.4) * size.height * 0.07
                let maxR = hypot(size.width, size.height) * 0.62
                let numRings = 28
                let flow = (t * 0.16).truncatingRemainder(dividingBy: 1)

                // Radial spokes (fade toward the far throat).
                let numSpokes = 24
                for s in 0..<numSpokes {
                    let a = Double(s) / Double(numSpokes) * 2 * .pi
                    var p = Path()
                    p.move(to: CGPoint(x: cx + cos(a) * maxR * 0.06,
                                       y: cy + sin(a) * maxR * 0.06))
                    p.addLine(to: CGPoint(x: cx + cos(a) * maxR, y: cy + sin(a) * maxR))
                    ctx.stroke(p, with: .color(color.opacity(0.10)), lineWidth: 1)
                }

                // Concentric rings: perspective bunches them toward the centre
                // (far), so it reads as depth; they flow outward past the viewer.
                for k in 0..<numRings {
                    let d = (Double(k) / Double(numRings) + flow)
                        .truncatingRemainder(dividingBy: 1)
                    let radius = maxR * pow(d, 1.7)
                    if radius < 2 { continue }
                    let alpha = min(1, d * 2.2) * max(0, 1 - d * 0.25)
                    ctx.stroke(
                        Path(ellipseIn: CGRect(x: cx - radius, y: cy - radius,
                                               width: radius * 2, height: radius * 2)),
                        with: .color(color.opacity(alpha * 0.75)), lineWidth: 1.2)
                }
            }
        }
    }
}

/// "local" / remote-name pill next to the brand in the top bar (web parity).
struct ConnectionBadge: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.i18n) private var i18n

    var body: some View {
        if let c = store.activeConnection {
            pill(c.name, bg: DS.accentMuted, fg: DS.accent)
                .help("\(c.host):\(c.port)")
        } else {
            pill(i18n.t("servers.local"), bg: DS.neutralMuted, fg: DS.fgMuted)
        }
    }

    private func pill(_ label: String, bg: Color, fg: Color) -> some View {
        Text(label)
            .font(.system(size: 11, weight: .medium))
            .padding(.horizontal, 8).padding(.vertical, 2)
            .background(bg).foregroundStyle(fg).clipShape(Capsule())
    }
}
