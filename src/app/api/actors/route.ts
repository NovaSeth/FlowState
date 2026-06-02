import { repo } from "@/lib/repo";
import { json, readJson, route } from "@/lib/http";
import type { CreateActorInput } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  return json(repo().listActors());
});

export const POST = route(async (req) => {
  const body = (await readJson(req)) as CreateActorInput;
  return json(repo().createActor(body), 201);
});
