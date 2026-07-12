import Foundation

// Codable mirrors of src/lib/types.ts. The enriched types (rollups, task detail,
// list item, task-with-context) embed a `base` entity that is decoded from the
// SAME flat JSON container, so we match the server's flat payloads without
// repeating every field. Fixture-decode tests guard against drift from types.ts.

// MARK: - Enums

public enum TaskStatus: String, Codable, CaseIterable, Sendable {
    case todo, inProgress = "in_progress", blocked, done, closed
}

public enum TaskPriority: String, Codable, CaseIterable, Sendable {
    case none, low, medium, high, urgent
}

public enum BlockerType: String, Codable, Sendable {
    case dependency, external, decision
}

public enum ArtifactKind: String, Codable, Sendable {
    case commit, pr, file, url
}

public enum MilestoneOutcome: String, Codable, CaseIterable, Sendable {
    case shipped, infeasible, descoped
}

public enum ProjectStatus: String, Codable, CaseIterable, Sendable {
    case active, paused, done, archived
}

public typealias MilestoneStatus = ProjectStatus

public enum SolutionStatus: String, Codable, CaseIterable, Sendable {
    case active, archived
}

public enum ActorKind: String, Codable, Sendable {
    case human, agent
}

public enum KeyScope: String, Codable, Sendable {
    case read, write
}

// MARK: - Progress / status counts

public struct Progress: Codable, Sendable {
    public let total: Int
    public let done: Int
    public let percent: Int
}

/// Record<TaskStatus, number>. Missing keys decode as 0 (defensive).
public struct StatusCounts: Codable, Sendable {
    public var todo = 0
    public var inProgress = 0
    public var blocked = 0
    public var done = 0
    public var closed = 0

    enum CodingKeys: String, CodingKey {
        case todo
        case inProgress = "in_progress"
        case blocked, done, closed
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        todo = try c.decodeIfPresent(Int.self, forKey: .todo) ?? 0
        inProgress = try c.decodeIfPresent(Int.self, forKey: .inProgress) ?? 0
        blocked = try c.decodeIfPresent(Int.self, forKey: .blocked) ?? 0
        done = try c.decodeIfPresent(Int.self, forKey: .done) ?? 0
        closed = try c.decodeIfPresent(Int.self, forKey: .closed) ?? 0
    }
}

// MARK: - Entities

public struct Solution: Codable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let description: String
    public let color: String
    public let status: SolutionStatus
    public let createdAt: String
    public let updatedAt: String
}

public struct Project: Codable, Identifiable, Sendable {
    public let id: String
    public let solutionId: String
    public let name: String
    public let description: String
    public let status: ProjectStatus
    public let createdAt: String
    public let updatedAt: String
}

public struct Milestone: Codable, Identifiable, Sendable {
    public let id: String
    public let projectId: String
    public let title: String
    public let description: String
    public let status: MilestoneStatus
    public let position: Int
    public let outcome: MilestoneOutcome?
    public let createdAt: String
    public let updatedAt: String
}

public struct Task: Codable, Identifiable, Sendable {
    public let id: String
    public let milestoneId: String
    public let title: String
    public let description: String
    public let status: TaskStatus
    public let priority: TaskPriority
    public let position: Int
    public let clientRequestId: String?
    public let ownerActorId: String?
    public let parentTaskId: String?
    public let verified: Bool
    public let blockerType: BlockerType?
    public let labels: [String]
    public let completedAt: String?
    public let createdAt: String
    public let updatedAt: String
}

public struct TaskArtifact: Codable, Identifiable, Sendable {
    public let id: String
    public let taskId: String
    public let kind: ArtifactKind
    public let value: String
    public let label: String
    public let createdAt: String
}

public struct TaskRef: Codable, Identifiable, Sendable {
    public let id: String
    public let title: String
    public let status: TaskStatus
}

public struct Comment: Codable, Identifiable, Sendable {
    public let id: String
    public let taskId: String
    public let author: String
    public let body: String
    public let createdAt: String
}

public struct Actor: Codable, Identifiable, Sendable {
    public let id: String
    public let kind: ActorKind
    public let name: String
    public let createdByKeyId: String?
    public let archivedAt: String?
    public let createdAt: String
}

/// One access grant on an API key: a target plus the rights on it. Target:
/// `projectId` = one project; `solutionId` = a whole solution; neither = global.
/// Never both on one grant. Absent target keys may be omitted or null in JSON.
public struct KeyGrant: Codable, Sendable {
    public let solutionId: String?
    public let projectId: String?
    public let scope: KeyScope

    public init(solutionId: String? = nil, projectId: String? = nil, scope: KeyScope) {
        self.solutionId = solutionId
        self.projectId = projectId
        self.scope = scope
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        solutionId = try c.decodeIfPresent(String.self, forKey: .solutionId)
        projectId = try c.decodeIfPresent(String.self, forKey: .projectId)
        scope = try c.decode(KeyScope.self, forKey: .scope)
    }
}

/// API key without the secret (the secret is only returned on creation).
public struct ApiKey: Codable, Identifiable, Sendable {
    public let id: String
    public let actorId: String
    /// Legacy single-solution target, derived from `grants` on the server (the
    /// single solution target when there is exactly one, else null).
    public let solutionId: String?
    public let name: String
    public let prefix: String
    /// Legacy aggregate scope: "write" when any grant can write, else "read".
    public let scope: KeyScope
    /// The key's access grants - the source of truth. Always present in fresh
    /// server payloads; a missing/empty list (legacy payloads or old fixtures)
    /// falls back to one grant derived from solutionId+scope, like the server.
    public let grants: [KeyGrant]
    public let expiresAt: String?
    public let createdByKeyId: String?
    public let lastUsedAt: String?
    public let revokedAt: String?
    public let createdAt: String

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        actorId = try c.decode(String.self, forKey: .actorId)
        solutionId = try c.decodeIfPresent(String.self, forKey: .solutionId)
        name = try c.decode(String.self, forKey: .name)
        prefix = try c.decode(String.self, forKey: .prefix)
        scope = try c.decode(KeyScope.self, forKey: .scope)
        expiresAt = try c.decodeIfPresent(String.self, forKey: .expiresAt)
        createdByKeyId = try c.decodeIfPresent(String.self, forKey: .createdByKeyId)
        lastUsedAt = try c.decodeIfPresent(String.self, forKey: .lastUsedAt)
        revokedAt = try c.decodeIfPresent(String.self, forKey: .revokedAt)
        createdAt = try c.decode(String.self, forKey: .createdAt)
        let decoded = try c.decodeIfPresent([KeyGrant].self, forKey: .grants)
        if let decoded, !decoded.isEmpty {
            grants = decoded
        } else {
            grants = [KeyGrant(solutionId: solutionId, scope: scope)]
        }
    }
}

public struct Activity: Codable, Identifiable, Sendable {
    public let id: String
    public let actorId: String?
    public let entityType: String
    public let entityId: String
    public let action: String
    public let summary: String
    public let solutionId: String?
    public let at: String
}

// MARK: - Enriched task shapes (base Task + extra fields, same flat container)

public struct TaskListItem: Decodable, Identifiable, Sendable {
    public let base: Task
    public let childCount: Int
    public let childDoneCount: Int
    public let openBlockerCount: Int

    public var id: String { base.id }

    enum CodingKeys: String, CodingKey {
        case childCount, childDoneCount, openBlockerCount
    }

    public init(from decoder: Decoder) throws {
        base = try Task(from: decoder)
        let c = try decoder.container(keyedBy: CodingKeys.self)
        childCount = try c.decode(Int.self, forKey: .childCount)
        childDoneCount = try c.decode(Int.self, forKey: .childDoneCount)
        openBlockerCount = try c.decode(Int.self, forKey: .openBlockerCount)
    }
}

public struct TaskDetail: Decodable, Identifiable, Sendable {
    public let base: Task
    public let blockedBy: [TaskRef]
    public let relatedTo: [TaskRef]
    public let children: [TaskRef]
    public let childCount: Int
    public let childStatusCounts: StatusCounts
    public let childProgress: Progress
    public let artifacts: [TaskArtifact]
    /// Present only when fetched with ?expand=comments.
    public let comments: [Comment]?

    public var id: String { base.id }

    enum CodingKeys: String, CodingKey {
        case blockedBy, relatedTo, children, childCount, childStatusCounts,
             childProgress, artifacts, comments
    }

    public init(from decoder: Decoder) throws {
        base = try Task(from: decoder)
        let c = try decoder.container(keyedBy: CodingKeys.self)
        blockedBy = try c.decode([TaskRef].self, forKey: .blockedBy)
        relatedTo = try c.decode([TaskRef].self, forKey: .relatedTo)
        children = try c.decode([TaskRef].self, forKey: .children)
        childCount = try c.decode(Int.self, forKey: .childCount)
        childStatusCounts = try c.decode(StatusCounts.self, forKey: .childStatusCounts)
        childProgress = try c.decode(Progress.self, forKey: .childProgress)
        artifacts = try c.decode([TaskArtifact].self, forKey: .artifacts)
        comments = try c.decodeIfPresent([Comment].self, forKey: .comments)
    }
}

public struct TaskContext: Codable, Sendable {
    public let solutionId: String
    public let solutionName: String
    public let projectId: String
    public let projectName: String
    public let milestoneId: String
    public let milestoneTitle: String
}

public struct TaskWithContext: Decodable, Identifiable, Sendable {
    public let base: Task
    public let context: TaskContext
    /// Latest comment for blocked tasks in the attention feed (optional).
    public let note: String?

    public var id: String { base.id }

    enum CodingKeys: String, CodingKey { case context, note }

    public init(from decoder: Decoder) throws {
        base = try Task(from: decoder)
        let c = try decoder.container(keyedBy: CodingKeys.self)
        context = try c.decode(TaskContext.self, forKey: .context)
        note = try c.decodeIfPresent(String.self, forKey: .note)
    }
}

// MARK: - Rollups (base entity + progress/statusCounts/count)

public struct MilestoneRollup: Decodable, Identifiable, Sendable {
    public let base: Milestone
    public let progress: Progress
    public let statusCounts: StatusCounts

    public var id: String { base.id }

    enum CodingKeys: String, CodingKey { case progress, statusCounts }

    public init(from decoder: Decoder) throws {
        base = try Milestone(from: decoder)
        let c = try decoder.container(keyedBy: CodingKeys.self)
        progress = try c.decode(Progress.self, forKey: .progress)
        statusCounts = try c.decode(StatusCounts.self, forKey: .statusCounts)
    }
}

public struct ProjectRollup: Decodable, Identifiable, Sendable {
    public let base: Project
    public let progress: Progress
    public let statusCounts: StatusCounts
    public let milestoneCount: Int

    public var id: String { base.id }

    enum CodingKeys: String, CodingKey { case progress, statusCounts, milestoneCount }

    public init(from decoder: Decoder) throws {
        base = try Project(from: decoder)
        let c = try decoder.container(keyedBy: CodingKeys.self)
        progress = try c.decode(Progress.self, forKey: .progress)
        statusCounts = try c.decode(StatusCounts.self, forKey: .statusCounts)
        milestoneCount = try c.decode(Int.self, forKey: .milestoneCount)
    }
}

public struct SolutionRollup: Decodable, Identifiable, Sendable {
    public let base: Solution
    public let progress: Progress
    public let statusCounts: StatusCounts
    public let projectCount: Int

    public var id: String { base.id }

    enum CodingKeys: String, CodingKey { case progress, statusCounts, projectCount }

    public init(from decoder: Decoder) throws {
        base = try Solution(from: decoder)
        let c = try decoder.container(keyedBy: CodingKeys.self)
        progress = try c.decode(Progress.self, forKey: .progress)
        statusCounts = try c.decode(StatusCounts.self, forKey: .statusCounts)
        projectCount = try c.decode(Int.self, forKey: .projectCount)
    }
}

// MARK: - Dashboard payload

public struct DashboardSolution: Decodable, Identifiable, Sendable {
    public let base: SolutionRollup
    public let projects: [ProjectRollup]
    public let recentTasks: [TaskWithContext]

    public var id: String { base.id }

    enum CodingKeys: String, CodingKey { case projects, recentTasks }

    public init(from decoder: Decoder) throws {
        base = try SolutionRollup(from: decoder)
        let c = try decoder.container(keyedBy: CodingKeys.self)
        projects = try c.decode([ProjectRollup].self, forKey: .projects)
        recentTasks = try c.decode([TaskWithContext].self, forKey: .recentTasks)
    }
}

public struct DailyByStatus: Codable, Sendable {
    public let days: [String]
    public let statuses: [TaskStatus]
    public let counts: [[Int]]
}

/// A saved remote Flow State instance (the stored API key never leaves the server).
public struct FSConnection: Codable, Sendable, Identifiable {
    public let id: String
    public let name: String
    public let host: String
    public let port: Int
    public let createdAt: String
}

public struct ConnectionsPayload: Decodable, Sendable {
    public let connections: [FSConnection]
    /// Active data source; nil = the local database.
    public let activeId: String?
}

public struct AppSettingsPayload: Decodable, Sendable {
    public struct ActiveConnection: Decodable, Sendable {
        public let id: String
        public let name: String
        public let host: String
        public let port: Int
    }
    public let requireKey: Bool
    /// This server's build version (optional: older servers omit it).
    public let version: String?
    /// The ACTIVE data source's build version (nil: remote doesn't expose it).
    public let sourceVersion: String?
    public let activeConnection: ActiveConnection?
}

public struct DashboardPayload: Decodable, Sendable {
    public struct Totals: Codable, Sendable {
        public let solutions: Int
        public let projects: Int
        public let milestones: Int
        public let tasks: Int
    }
    /// Yesterday's closing figures (plus the done-%) - drives the day-over-day
    /// trend arrows on the stat tiles. Optional: older servers omit it.
    public struct TotalsPrev: Codable, Sendable {
        public let solutions: Int
        public let projects: Int
        public let milestones: Int
        public let tasks: Int
        public let percent: Int
    }
    public struct Completed: Codable, Sendable {
        public let tasksDone: Int
        public let milestonesDone: Int
        public let projectsDone: Int
        public let solutionsDone: Int
    }
    public struct CompletedIds: Codable, Sendable {
        public let milestones: [String]
        public let projects: [String]
        public let solutions: [String]
    }
    public struct CompletedToday: Codable, Sendable {
        public let tasks: Int
        public let milestones: Int
        public let projects: Int
    }

    public let totals: Totals
    public let totalsPrev: TotalsPrev?
    public let statusCounts: StatusCounts
    public let progress: Progress
    public let completed: Completed
    public let completedIds: CompletedIds
    public let completedToday: CompletedToday
    public let solutions: [DashboardSolution]
    public let attention: [TaskWithContext]
    public let recent: [TaskWithContext]
    public let dailyByStatus: DailyByStatus
}
