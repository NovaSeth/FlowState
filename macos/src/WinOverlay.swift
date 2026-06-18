import SwiftUI

// "YOU WIN" celebration banner, shown when a project or solution completes
// (mirrors the web WinOverlay). The 3D confetti shower is intentionally descoped
// for native (per the design spec); the gold banner + pop-in carry the feel.
// Auto-dismisses via AppStore; tap anywhere or the button to dismiss now.
struct WinOverlay: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.i18n) private var i18n
    let kind: AppStore.WinKind
    @State private var appeared = false

    private let gold = Color(hex: "#fbbf24") ?? .yellow
    private let amber = Color(hex: "#f59e0b") ?? .orange

    private var kicker: String { kind == .project ? i18n.t("win.projectKicker") : i18n.t("win.solutionKicker") }
    private var title: String { kind == .project ? i18n.t("win.projectTitle") : i18n.t("win.solutionTitle") }

    var body: some View {
        ZStack {
            Color.black.opacity(0.55).ignoresSafeArea()
            RadialGradient(colors: [DS.done.opacity(0.35), .clear], center: .center, startRadius: 8, endRadius: 380)
                .ignoresSafeArea()
            VStack(spacing: 12) {
                Text(kicker.uppercased())
                    .font(.system(size: 12, weight: .semibold)).tracking(2)
                    .foregroundStyle(gold)
                Text(title)
                    .font(.system(size: 52, weight: .black))
                    .foregroundStyle(LinearGradient(colors: [gold, amber], startPoint: .top, endPoint: .bottom))
                Text(i18n.t("win.subtitle"))
                    .font(.system(size: 14)).foregroundStyle(.white.opacity(0.85))
                Button { store.dismissWin() } label: {
                    Text(i18n.t("win.button"))
                        .font(.system(size: 14, weight: .semibold)).foregroundStyle(.white)
                        .padding(.horizontal, 22).padding(.vertical, 8)
                        .background(LinearGradient(colors: [DS.done, DS.done.opacity(0.7)], startPoint: .top, endPoint: .bottom))
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
                .padding(.top, 4)
            }
            .scaleEffect(appeared ? 1 : 0.7)
            .opacity(appeared ? 1 : 0)
        }
        .contentShape(Rectangle())
        .onTapGesture { store.dismissWin() }
        .onAppear { withAnimation(.spring(response: 0.4, dampingFraction: 0.6)) { appeared = true } }
    }
}
