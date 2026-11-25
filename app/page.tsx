import Scanner from "@/components/Scanner";

export default function Home() {
  return (
    <>
      <a className="skip" href="#main">
        Skip to the scanner
      </a>
      <div className="fogfield" aria-hidden="true">
        <span />
        <span />
      </div>
      <Scanner />
      <footer className="foot">
        <p>
          Built by Demir for Kiroween 2026 · <a href="https://github.com/demir-sama/lychgate">source on GitHub</a> (MIT).
        </p>
        <p>
          Snapshots from the <a href="https://web.archive.org/">Internet Archive Wayback Machine</a>; domain dates from public RDAP. Lychgate never fetches private or internal
          addresses.
        </p>
      </footer>
    </>
  );
}
