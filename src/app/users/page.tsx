import { repo } from "@/lib/repo";
import { UsersExplorer } from "@/components/UsersExplorer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function UsersPage() {
  // Cascading identity explorer (Miller columns / mobile drill-down). The first
  // column is SSR; deeper levels (activity) are fetched via REST.
  const r = repo();
  return (
    <UsersExplorer
      initialActors={r.listActors()}
      initialKeys={r.listApiKeys()}
      initialSolutions={r.listSolutions()}
    />
  );
}
