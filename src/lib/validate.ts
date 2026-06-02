import { unprocessable } from "./errors";

/** Required non-empty string (after trim). Throws 422 when missing. */
export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw unprocessable(`Field "${field}" is required (non-empty text)`);
  }
  return value.trim();
}

/** Optional string; undefined/null -> undefined. */
export function optionalString(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw unprocessable(`Field "${field}" must be text`);
  }
  return value;
}

/** Optional finite number; undefined/null -> undefined. Throws 422 when a
 *  value is given that is not a finite number (e.g. a string that breaks ORDER BY). */
export function optionalNumber(
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw unprocessable(`Field "${field}" must be a number`);
  }
  return value;
}

/** Value belonging to an allowed set (enum). Throws 422 when not. */
export function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw unprocessable(
      `Field "${field}" must be one of: ${allowed.join(", ")}`,
    );
  }
  return value as T;
}
