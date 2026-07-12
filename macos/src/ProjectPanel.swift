import SwiftUI

// The project dashboard as a trailing inspector (the Explorer kebab's "Open
// dashboard"), mirroring the web ProjectPanel drawer 1:1: eyebrow header with
// the solution name, project title + status pill + progress, description, and
// stacked milestone cards. Replaces the old full-width ProjectDashboardView and
// the Dashboard | Columns toggle.
struct ProjectPanel: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.i18n) private var i18n
    let project: ProjectRollup

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().background(DS.borderMuted)
            ScrollView { content.padding(14) }
            footer
        }
        .background(DS.canvas)
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 2) {
                Eyebrow(text: i18n.t("project.eyebrow"))
                if let solution = store.solutions.first(where: { $0.id == project.base.solutionId }) {
                    Text(solution.base.name)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(DS.fgSubtle).lineLimit(1)
                }
            }
            Spacer()
            Button { store.closeProjectDashboard() } label: {
                Image(systemName: "xmark").font(.system(size: 12, weight: .semibold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(DS.fgMuted)
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Text(project.base.name)
                        .font(.system(size: 16, weight: .semibold)).foregroundStyle(DS.fg)
                        .lineLimit(2)
                    let pill = DS.projectStatusPill(project.base.status)
                    MetaPill(labelKey: DS.projectStatusLabelKey(project.base.status), bg: pill.bg, fg: pill.fg)
                }
                Text("\(project.progress.done)/\(project.progress.total) \(i18n.t("project.tasks").lowercased()) - \(project.progress.percent)%")
                    .font(.system(size: 11, design: .monospaced)).foregroundStyle(DS.fgSubtle)
                ProgressMeter(progress: project.progress, counts: project.statusCounts)
            }

            // KPI row: the project's own headline figures (mini stat tiles).
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                panelStat("\(project.milestoneCount)", i18n.t("project.milestones"))
                panelStat("\(project.progress.total)", i18n.t("project.tasks"))
                panelStat("\(project.progress.percent)%", i18n.t("overview.completed"), color: DS.accent)
                panelStat("\(project.statusCounts.inProgress)", i18n.t(DS.statusLabelKey(.inProgress)))
                panelStat("\(project.statusCounts.blocked)", i18n.t(DS.statusLabelKey(.blocked)),
                          color: project.statusCounts.blocked > 0 ? DS.danger : DS.fg)
                panelStat("\(project.statusCounts.done)", i18n.t(DS.statusLabelKey(.done)))
            }

            if !project.base.description.isEmpty {
                section(i18n.t("entity.description")) {
                    Text(project.base.description)
                        .font(.system(size: 13)).foregroundStyle(DS.fgMuted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }

            section(milestonesTitle) {
                VStack(spacing: 8) {
                    if store.dashboardMilestones.isEmpty {
                        Text(i18n.t("explorer.noMilestones"))
                            .font(.system(size: 12)).foregroundStyle(DS.fgSubtle)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    } else {
                        ForEach(store.dashboardMilestones) { milestoneCard($0) }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var milestonesTitle: String {
        let n = store.dashboardMilestones.count
        return n > 0 ? "\(i18n.t("project.milestones")) (\(n))" : i18n.t("project.milestones")
    }

    private func milestoneCard(_ m: MilestoneRollup) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 8) {
                Text(m.base.title)
                    .font(.system(size: 13, weight: .medium)).foregroundStyle(DS.fg)
                    .lineLimit(2)
                Spacer(minLength: 8)
                HStack(spacing: 6) {
                    if let outcome = m.base.outcome {
                        let pill = DS.outcomePill(outcome)
                        MetaPill(labelKey: DS.outcomeLabelKey(outcome), bg: pill.bg, fg: pill.fg)
                    }
                    Text("\(m.progress.done)/\(m.progress.total)")
                        .font(.system(size: 11, design: .monospaced)).foregroundStyle(DS.fgSubtle)
                }
            }
            ProgressMeter(progress: m.progress, counts: m.statusCounts)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DS.canvasSubtle)
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(DS.borderMuted, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .opacity(m.base.status == .archived ? 0.6 : 1)
    }

    // Web drawer footer: the project id (there is no separate full page to link
    // to in the native app - the panel IS the dashboard).
    private var footer: some View {
        HStack {
            Text(project.id)
                .font(.system(size: 11, design: .monospaced)).foregroundStyle(DS.fgSubtle)
                .lineLimit(1)
            Spacer()
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .overlay(Rectangle().frame(height: 1).foregroundStyle(DS.borderMuted), alignment: .top)
    }

    private func section<V: View>(_ title: String, @ViewBuilder _ content: () -> V) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Eyebrow(text: title)
            content()
        }
    }

    /// Compact stat tile for the KPI row (a small Overview StatTile).
    private func panelStat(_ value: String, _ label: String, color: Color = DS.fg) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(.system(size: 18, weight: .semibold, design: .monospaced))
                .foregroundStyle(color)
            Text(label).font(.system(size: 11)).foregroundStyle(DS.fgMuted).lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 10).padding(.vertical, 8)
        .background(DS.canvasSubtle)
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(DS.borderMuted, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}
