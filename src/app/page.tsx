import { getDashboard } from "@/lib/data-source";
import { Overview } from "@/components/Overview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Overview screen (shared memory: what was done / what's now / what's TODO). The
  // payload is computed on the server for a fast paint (local repo or the active
  // remote source); the client refreshes it live via SSE.
  const dashboard = await getDashboard();
  return <Overview initial={dashboard} />;
}
