import Foundation

// Small shared helpers: ISO date parsing, relative "time ago" mirroring the web
// timeAgo, and the sort ranks the explorer uses for list/kanban ordering.

enum DateUtil {
    // nonisolated(unsafe): configured once and only ever used for `.date(from:)`
    // (read-only parsing), so the shared instances are safe to reuse - the checker
    // just cannot prove it for a non-Sendable Foundation formatter.
    nonisolated(unsafe) static let isoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    nonisolated(unsafe) static let isoPlain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
    static func parse(_ s: String) -> Date? {
        isoFractional.date(from: s) ?? isoPlain.date(from: s)
    }
}

/// Localized relative time, mirroring the web buckets (just now / min / h / days / mo).
func timeAgo(_ iso: String, _ i18n: Localization, now: Date = Date()) -> String {
    guard let date = DateUtil.parse(iso) else { return "" }
    let secs = max(0, now.timeIntervalSince(date))
    if secs < 60 { return i18n.t("time.justNow") }
    let mins = Int(secs / 60)
    if mins < 60 { return i18n.t("time.minsAgo", ["n": "\(mins)"]) }
    let hours = Int(secs / 3600)
    if hours < 24 { return i18n.t("time.hoursAgo", ["n": "\(hours)"]) }
    let days = Int(secs / 86400)
    if days < 30 { return i18n.t("time.daysAgo", ["n": "\(days)"]) }
    return i18n.t("time.monthsAgo", ["n": "\(days / 30)"])
}

/// Compact absolute timestamp for key details / activity (mirrors the web's formatTimestamp).
func formatTimestamp(_ iso: String) -> String {
    guard let date = DateUtil.parse(iso) else { return iso }
    let f = DateFormatter()
    // Pin a fixed Gregorian/POSIX calendar so the `yyyy` token renders a stable
    // ISO-style year regardless of the system region (a non-Gregorian default
    // calendar - Japanese era, Buddhist - would otherwise print a wrong year).
    // Timezone stays the device's local zone, matching the web's local timestamp.
    f.locale = Locale(identifier: "en_US_POSIX")
    f.calendar = Calendar(identifier: .gregorian)
    f.dateFormat = "yyyy-MM-dd HH:mm"
    return f.string(from: date)
}

extension TaskStatus {
    /// List-view ordering: active work first, then resolved (mirrors the web).
    var listRank: Int {
        switch self {
        case .inProgress: return 0
        case .blocked: return 1
        case .todo: return 2
        case .done: return 3
        case .closed: return 4
        }
    }
}

extension TaskPriority {
    var rank: Int {
        switch self {
        case .urgent: return 0
        case .high: return 1
        case .medium: return 2
        case .low: return 3
        case .none: return 4
        }
    }
}
