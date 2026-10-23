import { LingxiError } from "./errors.js";

/**
 * Parse a time bound: relative ("7d", "12h", "2w", "30m") or absolute ("2026-10-23", "2026-10-23 15:30", ISO).
 * For date-only values, `endOfDay` selects 23:59:59.999 (useful for `until`).
 */
export function parseTimeBound(input: string | undefined | null, opts: { endOfDay?: boolean; now?: number } = {}): number | undefined {
  const s = input?.trim();
  if (!s) return undefined;
  const now = opts.now ?? Date.now();
  const rel = s.match(/^(\d+)\s*(m|h|d|w)$/i);
  if (rel) {
    const n = Number(rel[1]);
    const unit = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[rel[2]!.toLowerCase() as "m" | "h" | "d" | "w"];
    return now - n * unit;
  }
  const dateOnly = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const [y, m, d] = [Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])];
    return opts.endOfDay ? new Date(y, m, d, 23, 59, 59, 999).getTime() : new Date(y, m, d).getTime();
  }
  const t = Date.parse(s.replace(" ", "T"));
  if (Number.isNaN(t)) throw new LingxiError(`Cannot parse time: ${s} (use e.g. 7d, 12h, 2026-10-23 or 2026-10-23 15:30)`);
  return t;
}

/**
 * Resolve the period of an activity report.
 * `date`: today (default) | yesterday | YYYY-MM-DD; or explicit `since` / `until` (see parseTimeBound).
 */
export function activityRange(date?: string | null, since?: string | null, until?: string | null, now = Date.now()): { since: number; until: number } {
  if (since?.trim()) {
    return { since: parseTimeBound(since, { now })!, until: parseTimeBound(until, { endOfDay: true, now }) ?? now };
  }
  const d = (date ?? "today").trim().toLowerCase();
  const base = new Date(now);
  let day: Date;
  if (d === "today" || d === "") day = base;
  else if (d === "yesterday") day = new Date(base.getFullYear(), base.getMonth(), base.getDate() - 1);
  else {
    const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) throw new LingxiError(`Invalid date: ${date} (use today, yesterday or YYYY-MM-DD)`);
    day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  return { since: start, until: Math.min(start + 86_400_000 - 1, Math.max(now, start)) };
}
