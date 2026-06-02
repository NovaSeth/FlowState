import { headers } from "next/headers";
import { Card } from "@/components/ui";
import { serverT } from "@/i18n/server";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ServerControl } from "@/components/ServerControl";
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

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="mb-4 text-xl font-semibold tracking-tight text-fg">
        {t("settings.eyebrow")}
      </h1>
      <Card className="divide-y divide-edge-muted">
        <Row label={t("settings.viewMode")}>
          {isPhone ? t("settings.layoutMobile") : t("settings.layoutDesktop")}
        </Row>
        <Row label={t("settings.adminKey")}>
          {hasAdmin ? t("settings.adminSet") : t("settings.adminOpen")}
        </Row>
        <Row label={t("settings.dbPath")}>{dbPath}</Row>
        <ServerControl />
        <div className="px-3 py-3">
          <LanguageSwitcher />
        </div>
      </Card>
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
