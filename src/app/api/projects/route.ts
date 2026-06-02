import { repo } from "@/lib/repo";
import { json, readJson, route } from "@/lib/http";
import type { CreateProjectInput } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const solutionId = new URL(req.url).searchParams.get("solutionId") ?? undefined;
  return json(repo().listProjects(solutionId));
});

export const POST = route(async (req) => {
  const body = (await readJson(req)) as CreateProjectInput;
  return json(repo().createProject(body), 201);
});
