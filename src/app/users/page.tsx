import { usersPageData } from "@/lib/data-source";
import { requireKeyEnabled } from "@/lib/connections";
import { UsersExplorer } from "@/components/UsersExplorer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function UsersPage() {
  // Cascading identity explorer (Miller columns / mobile drill-down). The first
  // column is SSR (local repo or the active remote source); deeper levels
  // (activity) are fetched via REST. In require-key mode SSR returns nothing (it
  // must not leak actors/keys) and the client fetches with its key on mount.
  const d = await usersPageData();
  return (
    <UsersExplorer
      initialActors={d.actors}
      initialKeys={d.keys}
      initialSolutions={d.solutions}
      initialProjects={d.projects}
      locked={requireKeyEnabled()}
    />
  );
}
