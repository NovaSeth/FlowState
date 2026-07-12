import SwiftUI

// Users (identities), translated from the web UsersExplorer: cascading Miller
// columns Actors -> Keys -> Details/Activity. Read-only natively (creating actors
// and minting/revoking keys stays in the web /users page); browsing + live refresh
// match the web.
struct UsersView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.i18n) private var i18n

    private var selectedActor: Actor? { store.actors.first { $0.id == store.selectedActorId } }
    private var selectedKey: ApiKey? { store.apiKeys.first { $0.id == store.selectedKeyId } }
    private func actorKeys(_ id: String) -> [ApiKey] { store.apiKeys.filter { $0.actorId == id } }
    private func keyCount(_ id: String) -> Int { store.apiKeys.filter { $0.actorId == id && $0.revokedAt == nil }.count }

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            actorsColumn
            if let actor = selectedActor {
                actorPane(actor)
                if let key = selectedKey {
                    keyPane(key)
                } else {
                    ColumnPlaceholder(text: i18n.t("users.pickKey"))
                }
            } else {
                ColumnPlaceholder(text: i18n.t("users.pickActor"))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DS.canvas)
        .task { await store.loadUsers() }
    }

    private var actorsColumn: some View {
        MillerColumn(title: i18n.t("users.actors"), count: store.actors.count, collapseId: "users.actors") {
            if store.actors.isEmpty {
                ColumnHint(text: i18n.t("users.noActors"))
            } else {
                ForEach(store.actors) { actor in
                    ActorRow(actor: actor, keyCount: keyCount(actor.id), active: store.selectedActorId == actor.id) {
                        store.selectActor(actor.id)
                    }
                }
            }
        }
    }

    private func actorPane(_ actor: Actor) -> some View {
        let keys = actorKeys(actor.id)
        return VStack(spacing: 0) {
            HStack(spacing: 8) {
                Text(actor.name).font(.system(size: 13, weight: .medium)).foregroundStyle(DS.fg).lineLimit(1)
                CountPill(count: keys.count)
                Spacer()
            }
            .padding(.horizontal, 12).frame(height: 44)
            .overlay(Rectangle().frame(height: 1).foregroundStyle(DS.borderMuted), alignment: .bottom)
            if keys.isEmpty {
                ColumnHint(text: i18n.t("users.noKeysActor"))
                Spacer()
            } else {
                ScrollView {
                    LazyVStack(spacing: 6) {
                        ForEach(keys) { key in
                            KeyRow(apiKey: key,
                                   grantsLine: grantLabels(key).joined(separator: " · "),
                                   active: store.selectedKeyId == key.id) {
                                _Concurrency.Task { await store.selectKey(key.id) }
                            }
                        }
                    }
                    .padding(12)
                }
            }
        }
        .frame(width: 320)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(DS.canvas)
        .overlay(Rectangle().frame(width: 1).foregroundStyle(DS.border), alignment: .trailing)
    }

    private func keyPane(_ key: ApiKey) -> some View {
        KeyPaneView(apiKey: key, grantLabels: grantLabels(key),
                    activity: store.keyActivity, actors: store.actors)
            .frame(width: 384)
            .frame(maxHeight: .infinity, alignment: .top)
            .background(DS.canvas)
            .overlay(Rectangle().frame(width: 1).foregroundStyle(DS.border), alignment: .trailing)
    }

    // Human summary of one grant: target name + rights, e.g. "Zelda: write"
    // (web UsersExplorer grantLabel). Unknown ids fall back to the raw id.
    private func grantLabel(_ grant: KeyGrant) -> String {
        let name: String
        if let projectId = grant.projectId {
            name = store.allProjects.first { $0.id == projectId }?.base.name ?? projectId
        } else if let solutionId = grant.solutionId {
            name = store.solutions.first { $0.id == solutionId }?.base.name ?? solutionId
        } else {
            name = i18n.t("users.grantGlobal")
        }
        return "\(name): \(grant.scope.rawValue)"
    }

    private func grantLabels(_ key: ApiKey) -> [String] { key.grants.map(grantLabel) }
}

private struct ActorRow: View {
    @Environment(\.i18n) private var i18n
    let actor: Actor
    let keyCount: Int
    let active: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(actor.name).font(.system(size: 13)).foregroundStyle(DS.fg).lineLimit(1)
                    Spacer(minLength: 0)
                }
                // The agent/human tag sits UNDER the name (web parity).
                HStack(spacing: 6) {
                    KindBadge(kind: actor.kind)
                    Text(i18n.t("users.keyCount", ["n": "\(keyCount)"]))
                        .font(.system(size: 11, design: .monospaced)).foregroundStyle(DS.fgSubtle)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 10).padding(.vertical, 10)
            .background(active ? DS.accentMuted : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

private struct KeyRow: View {
    @Environment(\.i18n) private var i18n
    let apiKey: ApiKey
    /// Human summary of the key's grants, e.g. "Zelda: write · global: read".
    let grantsLine: String
    let active: Bool
    let action: () -> Void

    private var expired: Bool {
        guard let e = apiKey.expiresAt else { return false }
        return e <= DateUtil.isoFractional.string(from: Date())
    }

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 10) {
                    Text(apiKey.prefix).font(.system(size: 13, design: .monospaced)).foregroundStyle(DS.fg)
                    Text(apiKey.scope.rawValue)
                        .font(.system(size: 10, weight: .medium))
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(DS.neutralMuted).foregroundStyle(DS.fgMuted).clipShape(Capsule())
                    Spacer(minLength: 0)
                    if apiKey.revokedAt != nil {
                        Text(i18n.t("users.revoked")).font(.system(size: 11, weight: .medium)).foregroundStyle(DS.danger)
                    }
                }
                HStack(spacing: 12) {
                    Text(grantsLine).font(.system(size: 11)).foregroundStyle(DS.fgSubtle).lineLimit(1)
                    if let exp = apiKey.expiresAt {
                        Text(expired ? i18n.t("users.expired") : i18n.t("users.expiresAt", ["when": formatTimestamp(exp)]))
                            .font(.system(size: 11)).foregroundStyle(expired ? DS.danger : DS.fgSubtle)
                    }
                    Text(apiKey.lastUsedAt != nil
                         ? i18n.t("users.usedAt", ["when": formatTimestamp(apiKey.lastUsedAt!)])
                         : i18n.t("users.neverUsed"))
                        .font(.system(size: 11)).foregroundStyle(DS.fgSubtle)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(DS.canvas)
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(active ? DS.accent : DS.border, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

private struct KeyPaneView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.i18n) private var i18n
    let apiKey: ApiKey
    /// Human summaries of the key's grants (one entry per grant).
    let grantLabels: [String]
    let activity: [Activity]
    let actors: [Actor]
    @State private var tab = "details"
    // Token reveal: nil = hidden (Show button), .some(nil) = unavailable
    // (legacy key without a stored secret), .some(token) = revealed.
    @State private var revealed: String??

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 16) {
                Text(apiKey.prefix).font(.system(size: 11, design: .monospaced)).foregroundStyle(DS.fgSubtle)
                    .lineLimit(1).frame(maxWidth: 140, alignment: .leading)
                tabButton("details", i18n.t("users.details"))
                tabButton("activity", i18n.t("users.activity"))
                Spacer()
            }
            .padding(.horizontal, 12).frame(height: 44)
            .overlay(Rectangle().frame(height: 1).foregroundStyle(DS.borderMuted), alignment: .bottom)

            if tab == "details" {
                ScrollView { detailRows.padding(12) }
            } else {
                activityFeed
            }
        }
        .onChange(of: apiKey.id) { _ in revealed = nil }
    }

    private func tabButton(_ value: String, _ label: String) -> some View {
        let on = tab == value
        return Button { tab = value } label: {
            Text(label.uppercased())
                .font(.system(size: 11, weight: .semibold)).tracking(0.5)
                .foregroundStyle(on ? DS.fg : DS.fgSubtle)
                .padding(.vertical, 12)
                .overlay(Rectangle().frame(height: 2).foregroundStyle(on ? DS.accent : .clear), alignment: .bottom)
        }
        .buttonStyle(.plain)
    }

    private var detailRows: some View {
        let expired = apiKey.expiresAt.map { $0 <= DateUtil.isoFractional.string(from: Date()) } ?? false
        // The Access row lists every grant on its own line (web KeyDetails:
        // a right-aligned column of grant labels).
        let rows: [(String, String)] = [
            (i18n.t("users.keyPrefix"), apiKey.prefix),
            (i18n.t("users.permissions"), apiKey.scope.rawValue),
            (i18n.t("users.grants"), grantLabels.joined(separator: "\n")),
            (i18n.t("users.keyExpiry"), apiKey.expiresAt.map { expired ? i18n.t("users.expired") : formatTimestamp($0) } ?? i18n.t("users.noExpiry")),
            (i18n.t("users.keyLastUsed"), apiKey.lastUsedAt.map { formatTimestamp($0) } ?? i18n.t("users.neverUsed")),
            (i18n.t("users.keyCreatedAt"), formatTimestamp(apiKey.createdAt)),
            (i18n.t("users.keyRevoked"), apiKey.revokedAt.map { formatTimestamp($0) } ?? "-"),
        ]
        return VStack(spacing: 8) {
            detailRow(rows[0].0, rows[0].1)
            tokenRow
            ForEach(rows.dropFirst(), id: \.0) { label, value in
                detailRow(label, value)
            }
        }
    }

    private func detailRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(.system(size: 13)).foregroundStyle(DS.fgSubtle)
            Spacer(minLength: 12)
            // Multi-line so the grants column can stack; still trailing-aligned.
            Text(value).font(.system(size: 13)).foregroundStyle(DS.fg).multilineTextAlignment(.trailing)
        }
        .padding(.bottom, 8)
        .overlay(Rectangle().frame(height: 1).foregroundStyle(DS.borderMuted), alignment: .bottom)
    }

    // "Show" reveals the full token (web KeyDetails parity); legacy keys
    // created before plaintext-secret storage report as unavailable.
    private var tokenRow: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(i18n.t("users.keyToken")).font(.system(size: 13)).foregroundStyle(DS.fgSubtle)
            Spacer(minLength: 12)
            switch revealed {
            case nil:
                Button(i18n.t("users.showKey")) {
                    _Concurrency.Task { revealed = .some(await store.keyToken(apiKey.id)) }
                }
                .buttonStyle(.link)
            case .some(nil):
                Text(i18n.t("users.keyTokenUnavailable"))
                    .font(.system(size: 12)).foregroundStyle(DS.fgSubtle)
                    .multilineTextAlignment(.trailing)
            case .some(.some(let token)):
                Text(token)
                    .font(.system(size: 11, design: .monospaced)).foregroundStyle(DS.fg)
                    .textSelection(.enabled)
                    .multilineTextAlignment(.trailing)
            }
        }
        .padding(.bottom, 8)
        .overlay(Rectangle().frame(height: 1).foregroundStyle(DS.borderMuted), alignment: .bottom)
    }

    private var activityFeed: some View {
        Group {
            if activity.isEmpty {
                ColumnHint(text: i18n.t("users.noKeyActivity"))
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(activity) { ev in
                            HStack(spacing: 8) {
                                Text(formatTimestamp(ev.at)).font(.system(size: 11, design: .monospaced)).foregroundStyle(DS.fgSubtle)
                                Text(actorName(ev.actorId)).font(.system(size: 11, weight: .medium)).foregroundStyle(DS.fg)
                                Text("\(ev.entityType).\(ev.action)").font(.system(size: 11)).foregroundStyle(DS.fgMuted)
                                if !ev.summary.isEmpty {
                                    Text(ev.summary).font(.system(size: 11)).foregroundStyle(DS.fgMuted).lineLimit(1)
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(.vertical, 4)
                            .overlay(Rectangle().frame(height: 1).foregroundStyle(DS.borderMuted), alignment: .bottom)
                        }
                    }
                    .padding(12)
                }
            }
        }
    }

    private func actorName(_ id: String?) -> String {
        guard let id else { return "-" }
        return actors.first { $0.id == id }?.name ?? id
    }
}

private struct KindBadge: View {
    @Environment(\.i18n) private var i18n
    let kind: ActorKind
    var body: some View {
        Text(kind == .human ? i18n.t("users.kindHuman") : i18n.t("users.kindAgent"))
            .font(.system(size: 10, weight: .medium))
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(kind == .human ? DS.accentMuted : DS.doneMuted)
            .foregroundStyle(kind == .human ? DS.accent : DS.done)
            .clipShape(Capsule())
    }
}
