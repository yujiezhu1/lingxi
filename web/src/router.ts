import { useSyncExternalStore } from "react";

/** Minimal hash router: #/topics/tp_x?tab=timeline */
export interface Route {
  path: string[];
  query: URLSearchParams;
}

function parse(): Route {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [p, q] = raw.split("?");
  return { path: (p ?? "/").split("/").filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q ?? "") };
}

let current = parse();
const listeners = new Set<() => void>();
window.addEventListener("hashchange", () => {
  current = parse();
  listeners.forEach((l) => l());
  document.querySelector("main")?.scrollTo({ top: 0 });
});

export function useRoute(): Route {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

export function href(path: string, query?: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const qs = q.toString();
  return `#${path}${qs ? `?${qs}` : ""}`;
}

export function navigate(path: string, query?: Record<string, string | number | undefined | null>) {
  location.hash = href(path, query).slice(1);
}
