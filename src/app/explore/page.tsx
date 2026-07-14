import { listSolutions } from "@/lib/data-source";
import { requireKeyEnabled } from "@/lib/connections";
import { Explorer } from "@/components/Explorer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ExplorePage() {
  // Cascading explorer (Miller columns / mobile drill-down). The first column is
  // SSR (local repo or the active remote source); deeper levels are fetched via
  // REST after a selection. In require-key mode SSR yields nothing and the client
  // fetches the solutions with its key on mount.
  const solutions = await listSolutions();
  return <Explorer initialSolutions={solutions} locked={requireKeyEnabled()} />;
}
