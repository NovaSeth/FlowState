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
                Card {
                    VStack(spacing: 0) {
                        languageRow
                        Divider().background(DS.borderMuted).padding(.vertical, 10)
                        infoRow(i18n.t("settings.viewMode"), i18n.t("settings.layoutDesktop"))
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
}
