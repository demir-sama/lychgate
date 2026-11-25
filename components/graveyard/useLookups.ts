"use client";

import { useCallback, useRef, useState } from "react";
import type { Lookup } from "@/lib/patch/choice";

/**
 * On-demand replacement lookups (resurrection-engine R5.1, R5.2): one POST per press, answers kept per URL,
 * a finished or running lookup is never sent twice. Only an error can be retried.
 */
export function useLookups() {
  const [lookups, setLookups] = useState<Record<string, Lookup>>({});
  const seen = useRef(new Map<string, Lookup["state"]>());

  const reset = useCallback(() => {
    seen.current.clear();
    setLookups({});
  }, []);

  const lookup = useCallback(async (url: string) => {
    const st = seen.current.get(url);
    if (st === "loading" || st === "done") return;
    seen.current.set(url, "loading");
    setLookups((l) => ({ ...l, [url]: { state: "loading" } }));
    let next: Lookup;
    try {
      const res = await fetch("/api/replacement", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof j.error === "string" ? j.error : `HTTP ${res.status}`);
      next = { state: "done", replacement: j.replacement ?? null, timedOut: !!j.timedOut };
    } catch (err) {
      next = { state: "error", message: (err as Error).message || "Couldn't look for a replacement. Try again." };
    }
    seen.current.set(url, next.state);
    setLookups((l) => ({ ...l, [url]: next }));
  }, []);

  return { lookups, lookup, reset };
}
