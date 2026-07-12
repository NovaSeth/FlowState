import { headers } from "next/headers";
import { Card, Eyebrow } from "@/components/ui";
import { serverT } from "@/i18n/server";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ServerControl } from "@/components/ServerControl";
import {
  DashboardKeyField,
  RequireKeyToggle,
} from "@/components/SecuritySettings";
import { appSettingsPayload } from "@/lib/connections";
import { UI_VERSION } from "@/lib/version";
import { isPhoneUA } from "@/lib/phone-ua";

export const runtime = "nodejs";

// Phone detection shared with layout.tsx (single source of truth in @/lib/phone-ua),
// so the settings page shows the actual mode used by the SSR.

export default async function SettingsPage() {
  const ua = (await headers()).get("user-agent") ?? "";
  const isPhone = isPhoneUA(ua);
  // Admin key / DB path (Flow State).
  const adminKey = process.env.FS_API_KEY;
  const hasAdmin = !!adminKey && adminKey.trim() !== "";
  // Security: in open mode a LAN visitor must not learn the host's absolute path.
  // When FS_DB_PATH is set we show only the file basename; unset shows the literal
  // default "data/fs.db" (which leaks nothing).
  const rawDbPath = process.env.FS_DB_PATH;
  const dbPath =
    rawDbPath && rawDbPath.trim() !== ""
      ? rawDbPath.split(/[\\/]/).pop() || rawDbPath
      : "data/fs.db";
  // Server component: we translate via serverT (reads the fs_locale cookie).
  const t = await serverT();
  // Data source + versions: `version` = this build, `sourceVersion` = the
  // active source's build (remote when connected). With a remote FS connected
  // there is no server to control from here (someone else's process).
  const s = await appSettingsPayload();
  const active = s.activeConnection;

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <h1 className="text-xl font-semibold tracking-tight text-fg">
        {t("settings.eyebrow")}
      </h1>

      {/* The APPLICATION: this client build and its own preferences. */}
      <section className="space-y-2">
        <Eyebrow>{t("settings.appSection")}</Eyebrow>
        <Card className="divide-y divide-edge-muted">
          <Row label={t("settings.appVersion")}>v{UI_VERSION}</Row>
          <Row label={t("settings.viewMode")}>
            {isPhone ? t("settings.layoutMobile") : t("settings.layoutDesktop")}
          </Row>
          <DashboardKeyField />
          <div className="px-3 py-3">
            <LanguageSwitcher />
          </div>
        </Card>
      </section>

      {/* The SERVER / data source: what this dashboard is reading from. */}
      <section className="space-y-2">
        <Eyebrow>{t("settings.serverSection")}</Eyebrow>
        <Card className="divide-y divide-edge-muted">
          <Row label={t("settings.source")}>
            {active ? `${active.name} (${active.host}:${active.port})` : t("servers.local")}
          </Row>
          <Row label={t("settings.serverVersion")}>
            {s.sourceVersion ? `v${s.sourceVersion}` : "-"}
          </Row>
          <Row label={t("settings.adminKey")}>
            {hasAdmin ? t("settings.adminSet") : t("settings.adminOpen")}
          </Row>
          {!active && <Row label={t("settings.dbPath")}>{dbPath}</Row>}
          <RequireKeyToggle initialRequireKey={s.requireKey} />
          {active ? (
            <Row label={t("settings.server.title")}>
              <span className="text-fg-subtle">{t("settings.remoteNoControl")}</span>
            </Row>
          ) : (
            <ServerControl />
          )}
        </Card>
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 px-3">
      <span className="text-fg-muted">{label}</span>
      <span className="font-mono text-sm text-fg">{children}</span>
    </div>
  );
}
