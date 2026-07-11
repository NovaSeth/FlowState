import SwiftUI

// Native mirror of the web EntityMenu.tsx: per-row actions for the explorer
// containers (solution / project / milestone) - edit details (name, description,
// color), switch lifecycle status / outcome, delete. The same items back both a
// hover-revealed kebab button in the row's top-right corner (like the web) and
// the row's right-click context menu (idiomatic on macOS).

/// Localized choice for the status / outcome pickers: raw API value + i18n key.
struct EntityOption: Identifiable {
    let value: String
    let labelKey: String
    var id: String { value }
}

/// Everything a row needs to describe its entity to the menu + edit sheet.
/// The async closures wrap the AppStore mutations (which PATCH/DELETE and then
/// refetch); they throw so the menu/sheet can surface errors inline.
struct EntityMenuModel {
    /// Localized sheet heading, e.g. "Edit project" (entity.editProject).
    let editTitle: String
    let name: String
    let description: String
    /// Present only for solutions - shows the color field in the edit sheet.
    let color: String?
    /// Current status raw value + the entity's full status option list.
    let status: String
    let statusOptions: [EntityOption]
    /// Present only for milestones - shows the outcome section (nil = none).
    let outcome: String?
    let outcomeOptions: [EntityOption]?
    /// PATCH name/description(/color). Milestones map name -> title inside.
    let saveDetails: (_ name: String, _ description: String, _ color: String?) async throws -> Void
    let setStatus: (_ status: String) async throws -> Void
    /// Milestones only; nil value clears the outcome (JSON null).
    let setOutcome: ((_ outcome: String?) async throws -> Void)?
    let delete: () async throws -> Void
}

// MARK: - Row chrome (kebab overlay + context menu + edit sheet + delete confirm)

extension View {
    /// Attach the entity actions to a row: an ellipsis button revealed when
    /// `revealed` (the row's hover state) plus the same items as a context menu.
    func entityMenu(_ model: EntityMenuModel?, revealed: Bool) -> some View {
        modifier(EntityMenuChrome(model: model, revealed: revealed))
    }
}

private struct EntityMenuChrome: ViewModifier {
    let model: EntityMenuModel?
    let revealed: Bool

    @Environment(\.i18n) private var i18n
    @State private var showEdit = false
    @State private var confirmDelete = false
    @State private var busy = false
    // Failure of a menu action (status / outcome / delete): shown as an alert,
    // the native stand-in for the web dropdown's inline error line.
    @State private var actionError: String?

    @ViewBuilder
    func body(content: Content) -> some View {
        if let model {
            content
                .overlay(alignment: .topTrailing) {
                    kebab(model)
                        // Web hover-reveal (opacity-0 group-hover:opacity-100);
                        // kept in the tree so an open menu never self-destructs,
                        // but not clickable while invisible.
                        .opacity(revealed ? 1 : 0)
                        .allowsHitTesting(revealed)
                }
                .contextMenu { items(model) }
                .sheet(isPresented: $showEdit) { EntityEditSheet(model: model) }
                .confirmationDialog(
                    i18n.t("common.confirm"), isPresented: $confirmDelete, titleVisibility: .visible
                ) {
                    Button(i18n.t("delete.default"), role: .destructive) {
                        run { try await model.delete() }
                    }
                    Button(i18n.t("forms.cancel"), role: .cancel) {}
                }
                .alert(
                    i18n.t("common.saveError"),
                    isPresented: Binding(get: { actionError != nil }, set: { if !$0 { actionError = nil } })
                ) {
                    Button(i18n.t("common.close"), role: .cancel) { actionError = nil }
                } message: {
                    Text(actionError ?? "")
                }
        } else {
            content
        }
    }

    // Web trigger: h-6 w-6 rounded bg-canvas text-fg-subtle (kebab icon).
    private func kebab(_ model: EntityMenuModel) -> some View {
        Menu { items(model) } label: {
            Image(systemName: Glyph.symbol("kebab"))
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(DS.fgSubtle)
                .frame(width: 24, height: 24)
                .background(DS.canvas)
                .clipShape(RoundedRectangle(cornerRadius: 5))
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
        .padding(.top, 6).padding(.trailing, 4)
        .help(i18n.t("entity.actions"))
    }

    // Shared item list (kebab dropdown + right-click context menu). Toggles render
    // the native check mark on the current status/outcome, mirroring the web radio.
    @ViewBuilder
    private func items(_ model: EntityMenuModel) -> some View {
        Button(i18n.t("entity.edit")) { showEdit = true }
        Section(i18n.t("entity.status")) {
            ForEach(model.statusOptions) { option in
                pick(i18n.t(option.labelKey), on: model.status == option.value) {
                    try await model.setStatus(option.value)
                }
            }
        }
        if let outcomeOptions = model.outcomeOptions, let setOutcome = model.setOutcome {
            Section(i18n.t("entity.outcome")) {
                pick(i18n.t("entity.noOutcome"), on: model.outcome == nil) {
                    try await setOutcome(nil)
                }
                ForEach(outcomeOptions) { option in
                    pick(i18n.t(option.labelKey), on: model.outcome == option.value) {
                        try await setOutcome(option.value)
                    }
                }
            }
        }
        Divider()
        Button(role: .destructive) { confirmDelete = true } label: {
            Label(i18n.t("delete.default"), systemImage: Glyph.symbol("trash"))
        }
    }

    /// A check-markable menu item: Toggle renders the native check on macOS.
    /// Selecting (even re-selecting the current value, like the web) re-PATCHes.
    private func pick(_ label: String, on: Bool, _ apply: @escaping () async throws -> Void) -> some View {
        Toggle(label, isOn: Binding(get: { on }, set: { _ in run(apply) }))
            .disabled(busy)
    }

    private func run(_ operation: @escaping () async throws -> Void) {
        guard !busy else { return }
        busy = true
        _Concurrency.Task {
            do { try await operation() } catch { actionError = String(describing: error) }
            busy = false
        }
    }
}

// MARK: - Edit sheet (web EditEntityDialog: name, description, color for solutions)

struct EntityEditSheet: View {
    @Environment(\.i18n) private var i18n
    @Environment(\.dismiss) private var dismiss
    let model: EntityMenuModel

    @State private var draftName: String
    @State private var draftDescription: String
    @State private var draftColor: String
    @State private var busy = false
    @State private var error: String?

    init(model: EntityMenuModel) {
        self.model = model
        _draftName = State(initialValue: model.name)
        _draftDescription = State(initialValue: model.description)
        _draftColor = State(initialValue: model.color ?? "#0969da")
    }

    private var trimmedName: String { draftName.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(model.editTitle)
                .font(.system(size: 14, weight: .semibold)).foregroundStyle(DS.fg)

            field(i18n.t("entity.name")) {
                TextField("", text: $draftName)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { save() }
            }

            field(i18n.t("entity.description")) {
                ZStack(alignment: .topLeading) {
                    TextEditor(text: $draftDescription)
                        .font(.system(size: 13))
                        .foregroundStyle(DS.fg)
                        .scrollContentBackground(.hidden)
                        .padding(6)
                    if draftDescription.isEmpty {
                        // TextEditor has no placeholder - overlay one (web rows=5 +
                        // entity.descriptionPlaceholder).
                        Text(i18n.t("entity.descriptionPlaceholder"))
                            .font(.system(size: 13)).foregroundStyle(DS.fgSubtle)
                            .padding(.horizontal, 10).padding(.vertical, 6)
                            .allowsHitTesting(false)
                    }
                }
                .frame(height: 96)
                .background(DS.canvas)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(DS.border, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }

            if model.color != nil {
                field(i18n.t("entity.color")) {
                    HStack(spacing: 8) {
                        // Live swatch preview of the hex value (web <input type=color>).
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Color(hex: draftColor) ?? .clear)
                            .frame(width: 28, height: 20)
                            .overlay(RoundedRectangle(cornerRadius: 4).stroke(DS.border, lineWidth: 1))
                        TextField("#0969da", text: $draftColor)
                            .textFieldStyle(.roundedBorder)
                            .font(.system(size: 12, design: .monospaced))
                            .frame(width: 110)
                    }
                }
            }

            if let error {
                Text(error).font(.system(size: 12)).foregroundStyle(DS.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            HStack(spacing: 8) {
                Spacer()
                Button(i18n.t("forms.cancel")) { dismiss() }
                    .buttonStyle(.bordered)
                    .disabled(busy)
                    .keyboardShortcut(.cancelAction)
                Button(i18n.t("entity.save")) { save() }
                    .buttonStyle(.borderedProminent)
                    .disabled(busy || trimmedName.isEmpty)
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(16)
        .frame(width: 420)
        .background(DS.canvas)
    }

    /// PATCH only the typed fields (name/description, + color for solutions); on
    /// success close, on failure keep the sheet open with the error inline.
    private func save() {
        guard !busy, !trimmedName.isEmpty else { return }
        busy = true
        error = nil
        _Concurrency.Task {
            do {
                try await model.saveDetails(
                    trimmedName, draftDescription, model.color != nil ? draftColor : nil)
                dismiss()
            } catch {
                self.error = String(describing: error)
            }
            busy = false
        }
    }

    private func field<V: View>(_ label: String, @ViewBuilder _ content: () -> V) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Eyebrow(text: label)
            content()
        }
    }
}
