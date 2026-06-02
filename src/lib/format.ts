/**
 * Locale-agnostic relative time. Returns a structured result that the caller
 * renders through its translate fn (t / useT), e.g. t(res.key, res.vars). This
 * keeps format.ts free of any locale text. An empty key means "no value"
 * (invalid date) - the caller renders nothing.
 */
export interface TimeAgo {
  key: string;
  vars?: Record<string, number>;
}

export function timeAgo(iso: string): TimeAgo {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return { key: "" };
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 60) return { key: "time.justNow" };
  const min = Math.round(diffSec / 60);
  if (min < 60) return { key: "time.minsAgo", vars: { n: min } };
  const h = Math.round(min / 60);
  if (h < 24) return { key: "time.hoursAgo", vars: { n: h } };
  const d = Math.round(h / 24);
  if (d < 30) return { key: "time.daysAgo", vars: { n: d } };
  const mo = Math.round(d / 30);
  return { key: "time.monthsAgo", vars: { n: mo } };
}

/**
 * Convenience: render relative time directly with a translate fn (t / useT).
 * Returns "" for an invalid date (empty key never reaches t()).
 */
export function timeAgoText(
  iso: string,
  translate: (key: string, vars?: Record<string, number>) => string,
): string {
  const r = timeAgo(iso);
  return r.key ? translate(r.key, r.vars) : "";
}

/**
 * Absolute timestamp, stable and with no locale dependency: YYYY-MM-DD HH:MM.
 */
export function formatTimestamp(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
}

/**
 * Pulls a human-readable message out of an unknown thrown value, falling back to
 * the given text when it is not an Error. Used at catch sites that surface a
 * failure reason (e.g. an API error body) to the user.
 */
export function errMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

/**
 * Returns a safe href ONLY for http(s):// (after trimming whitespace),
 * otherwise null. Guards against XSS via `javascript:`/`data:`/`vbscript:` in an
 * artifact value that could end up in an <a href>. A value that is not a link
 * (commit hash, file path) should be rendered as text.
 */
export function safeHref(value: string): string | null {
  const v = value.trim();
  return /^https?:\/\//i.test(v) ? v : null;
}
