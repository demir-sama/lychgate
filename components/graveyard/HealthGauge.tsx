/** Ring gauge for the health score; the same number also drives the fog density. */
export function HealthGauge({ health, settled }: { health: number; settled: boolean }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const tone = health >= 85 ? "good" : health >= 60 ? "fair" : "poor";
  return (
    <div className={`gauge g-${tone}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={health} aria-label="Link health">
      <svg viewBox="0 0 80 80" width="88" height="88" aria-hidden="true">
        <circle cx="40" cy="40" r={r} className="gauge-track" />
        <circle cx="40" cy="40" r={r} className="gauge-fill" strokeDasharray={c} strokeDashoffset={c * (1 - health / 100)} />
      </svg>
      <div className="gauge-num">
        <strong>{health}</strong>
        <span>{settled ? "health" : "so far"}</span>
      </div>
    </div>
  );
}
