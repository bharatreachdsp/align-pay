"use client";
import { useCallback, useEffect, useState } from "react";
import type { AppState } from "@/server/state";

/** The app's state from /api/state, refreshed every few seconds. */
export function useAppState(intervalMs = 4000) {
  const [state, setState] = useState<AppState | null>(null);
  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/state", { cache: "no-store" });
      if (r.ok) setState((await r.json()) as AppState);
    } catch {
      // offline for a moment; the next tick retries
    }
  }, []);
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), intervalMs);
    return () => clearInterval(t);
  }, [refresh, intervalMs]);
  return { state, refresh };
}

export const time = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "never";
