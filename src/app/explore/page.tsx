import { repo } from "@/lib/repo";
import { Explorer } from "@/components/Explorer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function ExplorePage() {
  // Cascading explorer (Miller columns / mobile drill-down). The first column is
  // SSR; deeper levels are fetched via REST after a selection.
  const solutions = repo().listSolutions();
  return <Explorer initialSolutions={solutions} />;
}
