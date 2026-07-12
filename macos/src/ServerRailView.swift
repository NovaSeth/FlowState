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
                label: i18n.t("servers.local"), text: "local",
                active: store.activeConnectionId == nil,
                onTap: { switchTo(nil) }
            )

            if !store.connections.isEmpty {
                RoundedRectangle(cornerRadius: 1)
                    .fill(.white.opacity(0.2)).frame(width: 40, height: 1)
            }

            ForEach(store.connections) { c in
                entry(
                    label: "\(c.name) - \(c.host):\(c.port)", text: c.host,
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
        label: String, text: String, active: Bool,
        onTap: @escaping () -> Void,
        onRemove: (() -> Void)? = nil
    ) -> some View {
        RailChip(text: text, active: active, brand: DS.brand, onTap: onTap)
            .help(label)
            .contextMenu {
                if let onRemove {
                    Button(i18n.t("servers.remove"), role: .destructive) { onRemove() }
                }
            }
    }
}

// A single rail chip with its own hover state for the left indicator pill.
private struct RailChip: View {
    let text: String
    let active: Bool
    let brand: Color
    let onTap: () -> Void
    @State private var hovering = false

    var body: some View {
        // Active = solid white chip (its own indicator); inactive = translucent
        // chip that brightens on hover. No detached edge pill - on a narrow
        // centered chip it reads as a stray element.
        Button(action: onTap) {
            Text(text)
                .font(.system(size: 10, design: .monospaced))
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 6).padding(.vertical, 8)
                .frame(width: 64)
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

    private var valid: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty
            && !host.trimmingCharacters(in: .whitespaces).isEmpty
            && Int(port) != nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(i18n.t("servers.add")).font(.system(size: 14, weight: .semibold)).foregroundStyle(DS.fg)
            TextField(i18n.t("servers.namePlaceholder"), text: $name)
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

// Full-screen transition while the data source switches: a "warp jump" starfield
// (SwiftUI Canvas - the native answer to the web's three.js hyperspace, since the
// app renders natively, not in WebGL), a breathing brand mark, the target name
// and three bouncing dots.
struct ServerSwitchOverlay: View {
    @Environment(\.i18n) private var i18n
    let label: String
    @State private var animate = false
    @State private var start = Date()

    var body: some View {
        ZStack {
            Rectangle().fill(DS.canvas.opacity(0.85)).ignoresSafeArea()
            WarpField(start: start, color: DS.accent).ignoresSafeArea()
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
        .onAppear { animate = true; start = Date() }
    }
}

// Streaking-starfield warp: particles radiate outward from the centre, faster
// over time - the "oooo WOW" of jumping to another instance. Deterministic per
// index (no Math.random), driven by TimelineView.
private struct WarpField: View {
    let start: Date
    let color: Color

    var body: some View {
        TimelineView(.animation) { tl in
            Canvas { ctx, size in
                let t = tl.date.timeIntervalSince(start)
                let boost = 1 + min(t / 0.5, 1) * 3
                let cx = size.width / 2, cy = size.height / 2
                let maxR = max(cx, cy)
                let n = 220
                for i in 0..<n {
                    let angle = Double((i &* 2654435761) % 1000) / 1000 * 2 * .pi
                    let seed = Double((i &* 40503) % 997) / 997
                    let speed = (70 + seed * 260) * boost
                    let period = maxR + 120
                    let r = (t * speed + seed * period).truncatingRemainder(dividingBy: period)
                    let tail = 10 + seed * 26
                    let pr = max(0, r - tail)
                    let x = cx + cos(angle) * r, y = cy + sin(angle) * r
                    let px = cx + cos(angle) * pr, py = cy + sin(angle) * pr
                    let alpha = min(1, r / 60) * max(0, 1 - r / (maxR + 40))
                    var path = Path()
                    path.move(to: CGPoint(x: px, y: py))
                    path.addLine(to: CGPoint(x: x, y: y))
                    ctx.stroke(path, with: .color(color.opacity(alpha)), lineWidth: 1.4)
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
