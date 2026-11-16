import type { LinkClass } from "@/lib/classify/classify";

export type Spirit = { label: string; plural: string; blurb: string; verb: string };

/** Display metadata for each link class. Order matters: worst first. */
export const SPIRITS: Record<LinkClass, Spirit> = {
  zombie: { label: "Zombie", plural: "Zombies", verb: "taken over", blurb: "The domain is parked or was re-registered after you cited it. A security risk: someone else controls it now." },
  tombstone: { label: "Tombstone", plural: "Tombstones", verb: "dead", blurb: "Gone for good: 404, 410, or the domain no longer exists." },
  ghost: { label: "Ghost", plural: "Ghosts", verb: "a soft-404", blurb: "Answers 200, but the page you linked is gone (soft-404 or redirect to home)." },
  drifted: { label: "Drifted", plural: "Drifted", verb: "drifted", blurb: "Still alive, but it no longer says what it said when you cited it." },
  restless: { label: "Restless", plural: "Restless", verb: "unconfirmed", blurb: "Couldn't confirm: bot-blocked, timed out, or a server error. Not called dead." },
  sealed: { label: "Sealed", plural: "Sealed", verb: "refused", blurb: "Refused on purpose: a private, internal or metadata address." },
  living: { label: "Living", plural: "Living", verb: "healthy", blurb: "Healthy. The lantern is lit." },
};

export const ORDER: LinkClass[] = ["zombie", "tombstone", "ghost", "drifted", "restless", "sealed", "living"];
/** Classes pre-selected for resurrection when a snapshot exists. */
export const DEFAULT_RESURRECT = new Set<LinkClass>(["tombstone", "ghost", "zombie"]);
/** Classes that may be resurrected at all. */
export const RESURRECTABLE = new Set<LinkClass>(["tombstone", "ghost", "zombie", "drifted"]);

export function fmtTs(ts: string) {
  return /^\d{8}/.test(ts) ? `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}` : ts;
}
export function fmtDate(iso?: string) {
  return iso ? iso.slice(0, 10) : "unknown";
}
