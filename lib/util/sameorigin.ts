/**
 * True when a browser made this request from our own origin. A present `Origin` must match the
 * request URL's origin (`"null"` and other origins fail). Without `Origin` (some same-origin
 * requests omit it) the browser's `Sec-Fetch-Site: same-origin` must say so. Scripts and curl that
 * send neither are refused: these endpoints are for the page, not a public API.
 */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).origin === new URL(req.url).origin;
    } catch {
      return false;
    }
  }
  return req.headers.get("sec-fetch-site") === "same-origin";
}
