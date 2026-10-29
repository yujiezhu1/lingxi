import { useSyncExternalStore } from "react";

/** Two visual themes: 青瓷 (light, calm) and 夜幕 (dark, luminous). Persisted per browser. */
export type Theme = "celadon" | "night";

const KEY = "lingxi-theme";
const listeners = new Set<() => void>();
let current: Theme = (localStorage.getItem(KEY) as Theme | null) ?? "night";

function apply(t: Theme) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", t === "night" ? "dark" : "light");
}
apply(current);

export function setTheme(t: Theme) {
  current = t;
  localStorage.setItem(KEY, t);
  apply(t);
  listeners.forEach((l) => l());
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

export const prefersReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
