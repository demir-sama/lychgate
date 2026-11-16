/** Hosts that only ever serve domain-sale / parking pages. */
export const PARKING_HOSTS = [
  "sedo.com",
  "sedoparking.com",
  "dan.com",
  "afternic.com",
  "hugedomains.com",
  "parkingcrew.net",
  "bodis.com",
  "above.com",
  "undeveloped.com",
  "domainmarket.com",
  "buydomains.com",
  "parklogic.com",
  "dsultra.com",
  "atom.com",
  "squadhelp.com",
  "brandbucket.com",
  "namecheap-parking.com",
  "porkbun.com/parked",
];

/** Text/markup signatures of parked or for-sale pages. Kept specific to avoid false positives. */
export const PARKED_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: "for-sale-banner", re: /\bthis domain (name )?(is|may be) for sale\b/i },
  { id: "buy-this-domain", re: /\bbuy this domain\b/i },
  { id: "domain-for-sale", re: /\bthe domain [a-z0-9.-]+\.[a-z]{2,} (is|may be) for sale\b/i },
  { id: "inquire-domain", re: /\binquire about this domain\b/i },
  { id: "parked-free", re: /\bparked free,? courtesy of\b/i },
  { id: "parked-domain", re: /\bthis (web ?page|domain) is parked\b/i },
  { id: "godaddy-parked", re: /\bdomain (is )?parked (with|at|by) godaddy\b/i },
  { id: "sedo-parking", re: /sedoparking\.com|sedo\.com\/search\/details/i },
  { id: "parkingcrew", re: /parkingcrew\.net/i },
  { id: "bodis", re: /bodis\.com|\bbodis\b.*parking/i },
  { id: "dan-com", re: /\bdan\.com\b.*\b(buy|lander|for sale)\b/i },
  { id: "afternic", re: /\bafternic\b/i },
  { id: "hugedomains", re: /\bhugedomains\b/i },
  { id: "related-searches-lander", re: /\brelated searches\b[\s\S]{0,400}\bsponsored listings\b/i },
  { id: "registrar-placeholder", re: /\bthis domain (has been|was) (recently )?registered (at|with|by)\b/i },
];

export function detectParked(input: { html?: string; finalUrl?: string; redirectUrls?: string[] }): { signature: string } | null {
  const urls = [input.finalUrl, ...(input.redirectUrls ?? [])].filter(Boolean) as string[];
  for (const u of urls) {
    let host = "";
    let path = "";
    try {
      const p = new URL(u);
      host = p.hostname.toLowerCase();
      path = p.pathname;
    } catch {
      continue;
    }
    for (const ph of PARKING_HOSTS) {
      const [phHost, phPath] = ph.split(/(?=\/)/);
      if ((host === phHost || host.endsWith("." + phHost)) && (!phPath || path.startsWith(phPath))) {
        return { signature: `redirects to parking host ${phHost}` };
      }
    }
  }
  const html = input.html ?? "";
  if (!html) return null;
  const sample = html.length > 200_000 ? html.slice(0, 200_000) : html;
  for (const p of PARKED_PATTERNS) if (p.re.test(sample)) return { signature: p.id };
  return null;
}

const NOT_FOUND_TITLE =
  /(^|\b)(404|410)(\b|$)|\bnot found\b|\bpage (cannot|can't|could not|couldn't) be found\b|\bpage (does not|doesn't) exist\b|\bno longer (available|exists)\b|\bpage unavailable\b|\bnothing (was )?found\b|\bpage (is )?missing\b|\boops\b/i;

/** Does the page *say* it is a not-found page? (title, or the very start of the visible text) */
export function looksLikeNotFound(title: string, text: string): boolean {
  if (NOT_FOUND_TITLE.test(title)) return true;
  const head = text.slice(0, 160);
  return /\b(404|page not found|page (does not|doesn't) exist|this page (is|has been) (removed|deleted))\b/i.test(head);
}

/** True when a deep link was redirected to the site root (classic soft-404 behaviour). */
export function redirectedToRoot(original: string, finalUrl: string | undefined): boolean {
  if (!finalUrl) return false;
  try {
    const a = new URL(original);
    const b = new URL(finalUrl);
    const deep = a.pathname.replace(/\/+$/, "").length > 0 || a.search.length > 1;
    const root = (b.pathname === "/" || b.pathname === "") && b.search === "";
    const sameSite = a.hostname.replace(/^www\./, "") === b.hostname.replace(/^www\./, "");
    return deep && root && sameSite;
  } catch {
    return false;
  }
}
