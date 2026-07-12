import SwiftUI

// Settings, mirroring the web Settings page. The language switcher is the live
// control (changes Localization.locale, persisted to UserDefaults); the rest are
// read-only environment facts shown for parity.
struct SettingsView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.i18n) private var i18n

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Eyebrow(text: i18n.t("settings.eyebrow"))

                // The APPLICATION: this client build and its own preferences.
                Eyebrow(text: i18n.t("settings.appSection"))
                Card {
                    VStack(spacing: 0) {
                        infoRow(i18n.t("settings.appVersion"), "v\(appVersion)")
                        Divider().background(DS.borderMuted).padding(.vertical, 10)
                        infoRow(i18n.t("settings.viewMode"), i18n.t("settings.layoutDesktop"))
                        Divider().background(DS.borderMuted).padding(.vertical, 10)
                        languageRow
                    }
                }

                // The SERVER / data source: what this app is reading from.
                Eyebrow(text: i18n.t("settings.serverSection"))
                Card {
                    VStack(spacing: 0) {
                        infoRow(
                            i18n.t("settings.source"),
                            store.activeConnection.map { "\($0.name) (\($0.host):\($0.port))" }
                                ?? i18n.t("servers.local")
                        )
                        Divider().background(DS.borderMuted).padding(.vertical, 10)
                        infoRow(i18n.t("settings.serverVersion"),
                                store.sourceVersion.map { "v\($0)" } ?? "-")
                        Divider().background(DS.borderMuted).padding(.vertical, 10)
                        requireKeyRow
                        if store.activeConnectionId != nil {
                            Divider().background(DS.borderMuted).padding(.vertical, 10)
                            // A remote source is someone else's process - there is
                            // nothing to start/stop from here (web parity).
                            infoRow(i18n.t("settings.server.title"), i18n.t("settings.remoteNoControl"))
                        }
                    }
                }
            }
            .padding(20)
            .frame(maxWidth: 640, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DS.canvasSubtle)
    }

    private var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
    }

    private var languageRow: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(i18n.t("settings.language")).font(.system(size: 13)).foregroundStyle(DS.fg)
                Spacer()
                Picker("", selection: Binding(get: { store.localeCode }, set: { store.setLocale($0) })) {
                    Text(i18n.t("language.en")).tag("en")
                    Text(i18n.t("language.pl")).tag("pl")
                }
                .labelsHidden().fixedSize()
            }
            Text(i18n.t("settings.languageHint")).font(.system(size: 11)).foregroundStyle(DS.fgSubtle)
        }
    }

    private func infoRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).font(.system(size: 13)).foregroundStyle(DS.fg)
            Spacer()
            Text(value).font(.system(size: 12, design: .monospaced)).foregroundStyle(DS.fgMuted)
        }
    }

    // Require-key mode: server-side switch (web SecuritySettings parity).
    private var requireKeyRow: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(i18n.t("settings.requireKey")).font(.system(size: 13)).foregroundStyle(DS.fg)
                Spacer()
                Toggle("", isOn: Binding(
                    get: { store.requireKey },
                    set: { on in _Concurrency.Task { await store.setRequireKey(on) } }
                ))
                .labelsHidden()
                .toggleStyle(.switch)
            }
            Text(i18n.t("settings.requireKeyHint")).font(.system(size: 11)).foregroundStyle(DS.fgSubtle)
        }
    }
}
