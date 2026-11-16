import { runScan } from "../lib/scan/engine";
const arg = process.argv[2] ?? "md";
const input =
  arg === "md"
    ? { kind: "markdown" as const, citeDate: "2015-06-01", text: `# test
- [example](https://example.com/)
- [dead](https://httpbin.org/status/404)
- [gone](https://httpbin.org/status/410)
- [nxdomain](https://this-domain-should-not-exist-lychgate-test.com/page)
- [local](http://127.0.0.1/admin)
- [meta](http://169.254.169.254/latest/meta-data/)
- https://www.w3.org/TR/html4/
- [redir](https://httpbin.org/redirect-to?url=http://127.0.0.1/)
- [soft](https://www.microsoft.com/en-us/this-page-really-does-not-exist-lychgate)
` }
    : arg.startsWith("gh:") ? { kind: "github" as const, repo: arg.slice(3) } : { kind: "site" as const, url: arg };
(async () => {
  for await (const ev of runScan(input, { budgetMs: 200_000 })) {
    if (ev.type === "meta") console.log("META", ev.source, ev.total, ev.found, ev.warnings, ev.docs.map((d) => d.path));
    else if (ev.type === "result") {
      const r = ev.result;
      console.log(r.cls.padEnd(9), r.confidence, r.status ?? "-", r.url, "|", r.reasons.join(" / ").slice(0, 160), "| cite", r.citeDate?.slice(0, 10) ?? "-", "| snap", r.snapshot?.timestamp ?? "-", r.snapshot?.beforeCite ?? "", "| drift", r.drift?.toFixed(2) ?? "-", r.ms + "ms");
    } else console.log(ev.type.toUpperCase(), JSON.stringify(ev).slice(0, 300));
  }
})();
