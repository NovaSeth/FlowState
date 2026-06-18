import SwiftUI

// Shown when the SSE liveness flips offline (mirrors the web OfflineOverlay). With
// a native client there is no page to reload, so liveness is purely EventStream-driven.
struct OfflineOverlay: View {
    @Environment(\.i18n) private var i18n

    var body: some View {
        ZStack {
            DS.canvas.opacity(0.94).ignoresSafeArea()
            VStack(spacing: 14) {
                BrandMark(dotColor: DS.danger, size: 40)
                Text(i18n.t("conn.offlineTitle"))
                    .font(.system(size: 18, weight: .semibold)).foregroundStyle(DS.fg)
                Text(i18n.t("conn.offlineHint"))
                    .font(.system(size: 13)).foregroundStyle(DS.fgMuted)
                    .multilineTextAlignment(.center).frame(maxWidth: 380)
                ProgressView().controlSize(.small)
            }
            .padding(28)
        }
    }
}
