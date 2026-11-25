"use client";

import type { LinkResult } from "@/lib/scan/types";
import { SpiritIcon } from "./icons";
import { SPIRITS } from "./spirits";

/**
 * The plot: every checked link becomes a small marker rising out of the ground,
 * in the order it was checked. It is a visual index; the list below is the
 * accessible, keyboard-first equivalent, so markers are not tab stops.
 */
export function Plot({ results, total, onPick }: { results: LinkResult[]; total: number; onPick: (url: string) => void }) {
  const pending = Math.max(0, total - results.length);
  return (
    <div className="plot">
      <p className="sr-only">Graveyard plot: {results.length} of {total} links placed. The list below has every grave.</p>
      <div className="plot-grid">
        {results.map((r, i) => (
          <button
            key={r.url}
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            className={`marker c-${r.cls}`}
            style={{ ["--i" as string]: i % 24 }}
            title={`${SPIRITS[r.cls].label}: ${r.url}`}
            onClick={() => onPick(r.url)}
          >
            <SpiritIcon cls={r.cls} size={22} />
          </button>
        ))}
        {Array.from({ length: Math.min(pending, 60) }, (_, i) => (
          <span key={`p${i}`} className="marker pending" aria-hidden="true" />
        ))}
      </div>
    </div>
  );
}
