import SwiftUI

// Root of the native dashboard, mirroring the web Shell: a narrow left icon rail
// (full height) + a [header + content] column. Injects the current localization
// into the environment, shows the offline overlay when SSE is down, and bootstraps
// the store once.
struct DashboardRootView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        HStack(spacing: 0) {
            NavRail()
            VStack(spacing: 0) {
                TopBar()
                contentArea
            }
        }
        .frame(minWidth: 960, minHeight: 600)
        .overlay { if !store.isOnline { OfflineOverlay() } }
        .overlay { if let win = store.winBanner { WinOverlay(kind: win) } }
        .task { await store.bootstrap() }
        // Inject localization as the OUTERMOST modifier so the overlays above
        // (offline / win) inherit it too - otherwise they showed raw i18n keys.
        .environment(\.i18n, store.i18n)
    }

    @ViewBuilder
    private var contentArea: some View {
        switch store.section {
        case .overview: OverviewView()
        case .explore: ExplorerView()
        case .users: UsersView()
        case .settings: SettingsView()
        }
    }
}

// MARK: - Left navigation rail (web: w-14 icon rail, bg-brand, white active pill)

struct NavRail: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.i18n) private var i18n

    private let items: [(AppStore.Section, String, String)] = [
        (.overview, "home", "nav.overview"),
        (.explore, "columns", "nav.explorer"),
        (.users, "users", "nav.users"),
        (.settings, "settings", "nav.settings"),
    ]

    var body: some View {
        VStack(spacing: 4) {
            ForEach(items, id: \.0) { section, icon, key in
                navButton(section, icon, i18n.t(key))
            }
            Spacer()
            Text("v\(uiVersion)")
                .font(.system(size: 9, design: .monospaced))
                .foregroundStyle(.white.opacity(0.7))
                .padding(.top, 8)
        }
        .padding(.top, 7).padding(.bottom, 12)
        .frame(width: 56)
        .frame(maxHeight: .infinity)
        .background(DS.brand)
        .overlay(Rectangle().frame(width: 1).foregroundStyle(.black.opacity(0.1)), alignment: .trailing)
    }

    private func navButton(_ section: AppStore.Section, _ icon: String, _ label: String) -> some View {
        let on = store.section == section
        return Button { store.section = section } label: {
            Image(systemName: Glyph.symbol(icon))
                .font(.system(size: 18))
                .frame(width: 40, height: 40)
                .background(on ? Color.white : Color.clear)
                .foregroundStyle(on ? DS.brand : .white.opacity(0.7))
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(label)
    }

    private var uiVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.2.0"
    }
}

// MARK: - Top bar (web: header h-13 px-5, brand + scoreboard)

struct TopBar: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.i18n) private var i18n

    var body: some View {
        HStack(spacing: 8) {
            BrandMark(dotColor: store.isOnline ? DS.success : DS.danger, size: 18)
            (Text(i18n.t("app.brandLead")).font(.system(size: 16, weight: .semibold))
                + Text(i18n.t("app.brandRest")).font(.system(size: 16)))
                .foregroundStyle(DS.fg)
            Spacer()
            ScoreboardView()
        }
        .padding(.horizontal, 20)
        .frame(height: 52)
        .background(DS.canvas)
        .overlay(Rectangle().frame(height: 1).foregroundStyle(DS.border), alignment: .bottom)
    }
}

// MARK: - Scoreboard (web order: project / milestone / task; amber / purple / green)

struct ScoreboardView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.i18n) private var i18n

    private let amber = Color(hex: "#fbbf24") ?? .yellow
    @State private var popScale: CGFloat = 1.0

    var body: some View {
        let c = store.dashboard?.completedToday
        HStack(spacing: 6) {
            Text(i18n.t("scoreboard.today").uppercased())
                .font(.system(size: 10, weight: .semibold)).tracking(0.5)
                .foregroundStyle(DS.fgSubtle)
            HStack(spacing: 6) {
                counter("project", c?.projects ?? 0, amber, i18n.t("scoreboard.projectsTip"))
                counter("milestone", c?.milestones ?? 0, DS.done, i18n.t("scoreboard.milestonesTip"))
                counter("check", c?.tasks ?? 0, DS.success, i18n.t("scoreboard.tasksTip"))
            }
            .scaleEffect(popScale)
            .onChange(of: store.scorePop) { _ in
                popScale = 1.25
                withAnimation(.spring(response: 0.35, dampingFraction: 0.45)) { popScale = 1.0 }
            }
        }
    }

    private func counter(_ icon: String, _ n: Int, _ color: Color, _ tip: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: Glyph.symbol(icon)).font(.system(size: 11)).foregroundStyle(color)
            Text("\(n)").font(.system(size: 13, weight: .bold, design: .monospaced)).foregroundStyle(DS.fg)
        }
        .padding(.horizontal, 8).padding(.vertical, 2)
        .background(DS.canvas)
        .overlay(Capsule().stroke(DS.border, lineWidth: 1))
        .clipShape(Capsule())
        .opacity(n == 0 ? 0.4 : 1)
        .help(tip)
    }
}
