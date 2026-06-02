import { randomBytes } from "node:crypto";

/**
 * A short, URL-safe identifier with a type prefix (e.g. "ta_Xy3...").
 * The prefix eases debugging - you can immediately tell the resource type in agent logs.
 */
export function genId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString("base64url")}`;
}

export const ID_PREFIX = {
  solution: "so",
  project: "pr",
  milestone: "ms",
  task: "ta",
  comment: "co",
  artifact: "art",
  actor: "ac",
  apiKey: "key",
  activity: "ev",
} as const;
