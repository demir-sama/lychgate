import Link from "next/link";

export default function NotFound() {
  return (
    <main className="shell lost" id="main">
      <p className="eyebrow">404 · tombstone</p>
      <h1>This page has passed on.</h1>
      <p>Shared reports rest for 30 days, then they are gone for good. Nothing to resurrect here.</p>
      <Link className="btn btn-primary" href="/">
        <span className="btn-lantern" aria-hidden="true" />
        Back to the gate
      </Link>
    </main>
  );
}
