import { useEffect, useState, useSyncExternalStore } from "react";

// ── token: passed once in the URL (?token=…), then kept for this tab only ──
const params = new URLSearchParams(location.search);
const urlToken = params.get("token");
/** ?nolive=1 disables the event stream (used for headless screenshots). */
const noLive = params.get("nolive") === "1";
if (urlToken) {
  sessionStorage.setItem("lingxi-token", urlToken);
  history.replaceState(null, "", location.pathname + location.hash); // keep the token out of history / screenshots
}
export const token = sessionStorage.getItem("lingxi-token") ?? "";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method: init?.method ?? "GET",
    headers: { "x-lingxi-token": token, ...(init?.body !== undefined ? { "content-type": "application/json" } : {}) },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? res.statusText);
  return data as T;
}

// ── live refresh: the server pushes "change" events; pages refetch when the version bumps ──
let version = 0;
let connected = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function connect() {
  if (!token || noLive) return;
  const es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  es.addEventListener("hello", () => {
    connected = true;
    emit();
  });
  es.addEventListener("change", () => {
    version += 1;
    emit();
  });
  es.onerror = () => {
    connected = false;
    emit();
  };
}
connect();

export function useLive(): { version: number; connected: boolean } {
  const v = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
  );
  const c = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => connected,
  );
  return { version: v, connected: c };
}

export function bumpVersion() {
  version += 1;
  emit();
}

/** Fetch JSON; refetches when `path` changes or the server reports a change. */
export function useApi<T>(path: string | null, opts: { live?: boolean } = {}): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const { version: v } = useLive();
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [nonce, setNonce] = useState(0);
  const liveKey = opts.live === false ? 0 : v;
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    api<T>(path)
      .then((data) => !cancelled && setState({ data, error: null, loading: false }))
      .catch((e: Error) => !cancelled && setState((s) => ({ data: s.data, error: e.message, loading: false })));
    return () => {
      cancelled = true;
    };
  }, [path, liveKey, nonce]);
  return { ...state, reload: () => setNonce((n) => n + 1) };
}
