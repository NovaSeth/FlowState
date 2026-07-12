import { listSolutions } from "@/lib/data-source";
import { Explorer } from "@/components/Explorer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ExplorePage() {
  // Cascading explorer (Miller columns / mobile drill-down). The first column is
  // SSR (local repo or the active remote source); deeper levels are fetched via
  // REST after a selection.
  const solutions = await listSolutions();
  return <Explorer initialSolutions={solutions} />;
}
