import SwiftUI

// The task inspector, mirroring the web TaskPanel: title, status + priority
// editors, verification badge, block reason, description, artifacts, blockers and
// comments (read + add). Mutations go through AppStore (optimistic + refetch).
struct TaskDetailPanel: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.i18n) private var i18n

    @State private var pendingBlocked = false
    @State private var blockedReason = ""
    @State private var commentDraft = ""

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().background(DS.borderMuted)
            if let detail = store.taskDetail {
                ScrollView { content(detail).padding(14) }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(DS.canvas)
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 2) {
                Eyebrow(text: i18n.t("task.eyebrow"))
                if let msTitle = milestoneTitle {
                    Text(msTitle).font(.system(size: 11, design: .monospaced)).foregroundStyle(DS.fgSubtle).lineLimit(1)
                }
            }
            Spacer()
            Button { store.closeTask() } label: {
                Image(systemName: "xmark").font(.system(size: 12, weight: .semibold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(DS.fgMuted)
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
    }

    private var milestoneTitle: String? {
        guard let mid = store.taskDetail?.base.milestoneId else { return nil }
        return store.milestones.first { $0.base.id == mid }?.base.title
    }

    @ViewBuilder
    private func content(_ detail: TaskDetail) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(detail.base.title).font(.system(size: 16, weight: .semibold)).foregroundStyle(DS.fg)

            // Status + priority editors.
            HStack(spacing: 16) {
                field(i18n.t("task.status")) { statusMenu(detail) }
                field(i18n.t("task.priority")) { priorityMenu(detail) }
                if detail.base.verified {
                    badge(i18n.t("task.verified"), DS.successMuted, DS.success)
                } else if detail.base.status == .done {
                    badge(i18n.t("task.unverified"), DS.attentionMuted, DS.attention)
                }
            }

            if pendingBlocked { blockedReasonField(detail) }

            if let error = store.errorMessage {
                Text(error).font(.system(size: 12)).foregroundStyle(DS.danger)
                    .padding(8).frame(maxWidth: .infinity, alignment: .leading)
                    .background(DS.dangerMuted).clipShape(RoundedRectangle(cornerRadius: 6))
            }

            if detail.base.status == .blocked, let reason = latestBlockReason(detail) {
                section(i18n.t("task.blockReason")) {
                    VStack(alignment: .leading, spacing: 4) {
                        if let bt = detail.base.blockerType {
                            Text(i18n.t(DS.blockerTypeLabelKey(bt)).uppercased())
                                .font(.system(size: 10, weight: .semibold)).foregroundStyle(DS.danger)
                        }
                        Text(reason).font(.system(size: 13)).foregroundStyle(DS.fg)
                    }
                    .padding(8).frame(maxWidth: .infinity, alignment: .leading)
                    .background(DS.dangerMuted).clipShape(RoundedRectangle(cornerRadius: 6))
                }
            }

            if !detail.base.labels.isEmpty {
                section(i18n.t("task.labels")) {
                    TaskMeta(labels: detail.base.labels, childCount: 0, childDoneCount: 0, openBlockerCount: 0)
                }
            }

            if !detail.base.description.isEmpty {
                section(i18n.t("task.description")) {
                    Text(detail.base.description).font(.system(size: 13)).foregroundStyle(DS.fgMuted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }

            if !detail.blockedBy.isEmpty {
                section(i18n.t("task.blockedByHeading")) { refList(detail.blockedBy) }
            }
            if !detail.relatedTo.isEmpty {
                section(i18n.t("task.related")) { refList(detail.relatedTo) }
            }

            if !detail.artifacts.isEmpty {
                section(i18n.t("task.artifacts")) {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(detail.artifacts) { artifactRow($0) }
                    }
                }
            }

            commentsSection(detail)
        }
    }

    // MARK: - Editors

    private func statusMenu(_ detail: TaskDetail) -> some View {
        Menu {
            ForEach(TaskStatus.allCases, id: \.self) { s in
                Button(i18n.t(DS.statusLabelKey(s))) { chooseStatus(s, detail) }
            }
        } label: {
            HStack(spacing: 4) {
                StatusPill(status: detail.base.status)
                Image(systemName: "chevron.down").font(.system(size: 9)).foregroundStyle(DS.fgSubtle)
            }
        }
        .menuStyle(.borderlessButton).fixedSize()
    }

    private func priorityMenu(_ detail: TaskDetail) -> some View {
        Menu {
            ForEach(TaskPriority.allCases, id: \.self) { p in
                Button(i18n.t(DS.priorityLabelKey(p))) {
                    _Concurrency.Task { await store.setPriority(detail.base.id, p) }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text(i18n.t(DS.priorityLabelKey(detail.base.priority)))
                    .font(.system(size: 12, weight: .medium)).foregroundStyle(DS.priorityColor(detail.base.priority))
                Image(systemName: "chevron.down").font(.system(size: 9)).foregroundStyle(DS.fgSubtle)
            }
        }
        .menuStyle(.borderlessButton).fixedSize()
    }

    private func chooseStatus(_ s: TaskStatus, _ detail: TaskDetail) {
        if s == .blocked {
            pendingBlocked = true
        } else {
            pendingBlocked = false
            _Concurrency.Task { await store.setStatus(detail.base.id, s) }
        }
    }

    private func blockedReasonField(_ detail: TaskDetail) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            TextField(i18n.t("task.blockReason"), text: $blockedReason, axis: .vertical)
                .textFieldStyle(.roundedBorder).lineLimit(2...4)
            HStack {
                Button(i18n.t("task.status")) {
                    _Concurrency.Task {
                        await store.setStatus(detail.base.id, .blocked,
                                              reason: blockedReason.isEmpty ? nil : blockedReason)
                    }
                    pendingBlocked = false; blockedReason = ""
                }
                .buttonStyle(.borderedProminent)
                Button(i18n.t("forms.cancel")) { pendingBlocked = false; blockedReason = "" }
                    .buttonStyle(.bordered)
            }
        }
    }

    // MARK: - Comments

    private func commentsSection(_ detail: TaskDetail) -> some View {
        section(i18n.t("task.comments")) {
            VStack(alignment: .leading, spacing: 10) {
                let comments = detail.comments ?? []
                if comments.isEmpty {
                    Text(i18n.t("task.noComments")).font(.system(size: 12)).foregroundStyle(DS.fgSubtle)
                } else {
                    ForEach(comments) { comment in
                        VStack(alignment: .leading, spacing: 2) {
                            HStack {
                                Text(comment.author.isEmpty ? i18n.t("task.anon") : comment.author)
                                    .font(.system(size: 11, weight: .semibold)).foregroundStyle(DS.fgMuted)
                                Spacer()
                                Text(timeAgo(comment.createdAt, i18n)).font(.system(size: 10)).foregroundStyle(DS.fgSubtle)
                            }
                            Text(comment.body).font(.system(size: 13)).foregroundStyle(DS.fg)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .padding(8).background(DS.canvasSubtle).clipShape(RoundedRectangle(cornerRadius: 6))
                    }
                }
                HStack(alignment: .bottom, spacing: 6) {
                    TextField(i18n.t("task.addCommentPlaceholder"), text: $commentDraft, axis: .vertical)
                        .textFieldStyle(.roundedBorder).lineLimit(1...4)
                    Button(i18n.t("task.send")) {
                        let body = commentDraft
                        // Clear the draft only once the post succeeds, so a failed
                        // send (server down / rejected) keeps the user's text.
                        _Concurrency.Task {
                            if await store.addComment(detail.base.id, body) { commentDraft = "" }
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(commentDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }

    // MARK: - Small builders

    private func refList(_ refs: [TaskRef]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(refs) { ref in
                HStack(spacing: 6) {
                    Dot(color: DS.statusDot(ref.status), size: 6)
                    Text(ref.title).font(.system(size: 12)).foregroundStyle(DS.fgMuted).lineLimit(1)
                }
            }
        }
    }

    @ViewBuilder
    private func artifactRow(_ a: TaskArtifact) -> some View {
        let label = a.label.isEmpty ? a.value : a.label
        if a.value.hasPrefix("http"), let url = URL(string: a.value) {
            Link(label, destination: url).font(.system(size: 12)).foregroundStyle(DS.accent).lineLimit(1)
        } else {
            Text(label).font(.system(size: 12, design: .monospaced)).foregroundStyle(DS.fgMuted).lineLimit(1)
        }
    }

    private func field<V: View>(_ label: String, @ViewBuilder _ value: () -> V) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Eyebrow(text: label)
            value()
        }
    }

    private func section<V: View>(_ title: String, @ViewBuilder _ content: () -> V) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Eyebrow(text: title)
            content()
        }
    }

    private func badge(_ text: String, _ bg: Color, _ fg: Color) -> some View {
        Text(text).font(.system(size: 10, weight: .medium))
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(bg).foregroundStyle(fg).clipShape(Capsule())
    }

    /// Mirror the web: the block reason is the most recent comment created at or
    /// before the task's updatedAt - NOT simply the newest comment, since a later
    /// unrelated comment on a still-blocked task would be misattributed.
    private func latestBlockReason(_ detail: TaskDetail) -> String? {
        guard let comments = detail.comments else { return nil }
        let cutoff = DateUtil.parse(detail.base.updatedAt) ?? .distantFuture
        return comments
            .filter { (DateUtil.parse($0.createdAt) ?? .distantPast) <= cutoff }
            .max { (DateUtil.parse($0.createdAt) ?? .distantPast) < (DateUtil.parse($1.createdAt) ?? .distantPast) }?
            .body
    }
}
