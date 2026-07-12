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
        VStack(spacing: 4) {
            entry(
                label: i18n.t("servers.local"), text: "local",
                active: store.activeConnectionId == nil,
                onTap: { switchTo(nil) }
            )

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
                    .font(.system(size: 14, design: .monospaced))
                    .frame(width: 56, height: 24)
                    .foregroundStyle(.white.opacity(0.7))
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(i18n.t("servers.add"))

            Spacer()
        }
        .padding(.top, 8).padding(.bottom, 12)
        .frame(width: 64)
        .frame(maxHeight: .infinity)
        // Blue like the nav rail; a white divider line separates the two rails.
        .background(DS.brand)
        .overlay(Rectangle().frame(width: 2).foregroundStyle(.white), alignment: .trailing)
        .sheet(isPresented: $adding) { AddConnectionSheet() }
    }

    private func switchTo(_ id: String?) {
        _Concurrency.Task { await store.switchConnection(id) }
    }

    // Nav-rail palette: active = white pill + brand text, inactive = white/80.
    private func entry(
        label: String, text: String, active: Bool,
        onTap: @escaping () -> Void,
        onRemove: (() -> Void)? = nil
    ) -> some View {
        Button(action: onTap) {
            Text(text)
                .font(.system(size: 9, design: .monospaced))
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 4).padding(.vertical, 6)
                .frame(width: 56)
                .background(active ? Color.white : Color.clear)
                .foregroundStyle(active ? DS.brand : .white.opacity(0.8))
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(label)
        .contextMenu {
            if let onRemove {
                Button(i18n.t("servers.remove"), role: .destructive) { onRemove() }
            }
        }
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
