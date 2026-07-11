import { AsyncLocalStorage } from "node:async_hooks";
import type { KeyGrant } from "./types";

/**
 * Request-scoped identity context. route() resolves the actor from the x-api-key
 * header and runs the handler within this context; the repo reads currentActorId()
 * when writing attribution (activity, ownerActorId) WITHOUT threading it through the
 * signatures of every method. Singleton on globalThis - survives Next's hot-reload in dev.
 */
export type RequestContext = {
  actorId?: string;
  keyId?: string;
  /** Grants of the authenticated key; undefined = unrestricted (admin key,
   *  trusted keyless local client, or internal callers). */
  keyGrants?: KeyGrant[];
  /** true when authenticated with the admin key (FS_API_KEY). */
  admin?: boolean;
};

const g = globalThis as unknown as {
  __fsCtx?: AsyncLocalStorage<RequestContext>;
};

function store(): AsyncLocalStorage<RequestContext> {
  if (!g.__fsCtx) g.__fsCtx = new AsyncLocalStorage<RequestContext>();
  return g.__fsCtx;
}

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return store().run(ctx, fn);
}

export function currentContext(): RequestContext {
  return store().getStore() ?? {};
}

export function currentActorId(): string | undefined {
  return currentContext().actorId;
}
