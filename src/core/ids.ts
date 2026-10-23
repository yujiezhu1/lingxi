import { randomBytes } from "node:crypto";

/** e.g. ho_20261023_k3f9a2 — sortable by day, short enough to type. */
export function newId(prefix: string, now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const rand = randomBytes(4).toString("base64url").replace(/[-_]/g, "x").slice(0, 6).toLowerCase();
  return `${prefix}_${y}${m}${d}_${rand}`;
}

export function nowMs(): number {
  return Date.now();
}

/** Local ISO-like timestamp with offset, e.g. 2026-10-23T15:30:00+08:00 */
export function isoLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const oh = pad(Math.floor(Math.abs(off) / 60));
  const om = pad(Math.abs(off) % 60);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${oh}:${om}`
  );
}

export function shortDate(ms: number): string {
  return isoLocal(ms).slice(0, 16).replace("T", " ");
}
