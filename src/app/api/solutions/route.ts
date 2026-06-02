import { repo } from "@/lib/repo";
import { json, readJson, route } from "@/lib/http";
import type { CreateSolutionInput } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  return json(repo().listSolutions());
});

export const POST = route(async (req) => {
  const body = (await readJson(req)) as CreateSolutionInput;
  return json(repo().createSolution(body), 201);
});
