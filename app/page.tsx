import Scanner from "@/components/Scanner";

export default function Home() {
  return (
    <main className="shell">
      <header className="hero">
        <p className="eyebrow">Kiroween 2026 · a link checker in costume</p>
        <h1>
          <span aria-hidden="true">⛩︎ </span>Lychgate
        </h1>
        <p className="lede">Find every dead link, see how it died, and bring it back from the Wayback Machine.</p>
      </header>
      <Scanner />
      <footer className="foot">
        <p>
          Built by Demir (<a href="https://github.com/demir-sama/lychgate">demir-sama/lychgate</a>, MIT). Snapshots come from the{" "}
          <a href="https://web.archive.org/">Internet Archive Wayback Machine</a>; domain data from public RDAP.
        </p>
      </footer>
    </main>
  );
}
