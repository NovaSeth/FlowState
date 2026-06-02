import { getApiPulse, json, route } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lightweight API call counter. The macOS menu-bar app polls it with the
// `x-fs-monitor: 1` header and flashes the icon when the counter increases (i.e.
// when someone else - the dashboard or an agent - calls the API).
export const GET = route(async () => {
  return json({ count: getApiPulse() });
});
