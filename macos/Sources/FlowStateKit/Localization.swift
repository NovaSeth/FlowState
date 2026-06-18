import Foundation

/// Nested-key localization mirroring src/i18n. Tables are the parsed en.json /
/// pl.json (nested objects). `t("users.keyCount", ["n": "3"])` walks the dotted
/// path and interpolates `{var}` placeholders. Lookup falls back: requested
/// locale -> "en" -> the key itself.
public struct Localization {
    public let locale: String
    private let tables: [String: NestedTable]

    /// A parsed JSON object table (nested string-keyed dictionaries of strings).
    public typealias NestedTable = [String: Any]

    public init(locale: String, tables: [String: NestedTable]) {
        self.locale = locale
        self.tables = tables
    }

    /// Parse a localization JSON file (en.json / pl.json) into a nested table.
    public static func parse(_ data: Data) -> NestedTable {
        (try? JSONSerialization.jsonObject(with: data)) as? NestedTable ?? [:]
    }

    /// Load en/pl tables from a bundle. Looks for `<code>.json` at the bundle
    /// root first, then under a `fixtures/` subdirectory (the test layout).
    public static func load(
        locale: String,
        bundle: Bundle,
        codes: [String] = ["en", "pl"]
    ) -> Localization {
        var tables: [String: NestedTable] = [:]
        for code in codes {
            let url =
                bundle.url(forResource: code, withExtension: "json")
                ?? bundle.url(forResource: code, withExtension: "json", subdirectory: "fixtures")
            if let url, let data = try? Data(contentsOf: url) {
                tables[code] = parse(data)
            }
        }
        return Localization(locale: locale, tables: tables)
    }

    public func t(_ key: String, _ vars: [String: String] = [:]) -> String {
        let raw = lookup(locale, key) ?? lookup("en", key) ?? key
        return interpolate(raw, vars)
    }

    private func lookup(_ loc: String, _ key: String) -> String? {
        guard var node: Any = tables[loc] else { return nil }
        for part in key.split(separator: ".") {
            guard let dict = node as? NestedTable, let next = dict[String(part)] else {
                return nil
            }
            node = next
        }
        return node as? String
    }

    private func interpolate(_ template: String, _ vars: [String: String]) -> String {
        guard !vars.isEmpty else { return template }
        var out = template
        for (name, value) in vars {
            out = out.replacingOccurrences(of: "{\(name)}", with: value)
        }
        return out
    }
}
