import { repo } from "@/lib/repo";
import { Overview } from "@/components/Overview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function HomePage() {
  // Overview screen (shared memory: what was done / what's now / what's TODO). The
  // payload is computed on the server for a fast paint; the client refreshes it live via SSE.
  const dashboard = repo().getDashboard();
  return <Overview initial={dashboard} />;
}
