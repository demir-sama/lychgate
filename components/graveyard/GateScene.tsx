/**
 * The lychgate at night: an original, hand-built SVG illustration.
 * - `open` swings the gate doors open while a scan runs.
 * - fog density comes from the CSS variable --fog set by the parent (health score).
 * Decorative only (aria-hidden); every state it shows is also stated in text.
 */

// Deterministic pseudo-random positions so server and client render the same markup.
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const rnd = lcg(1031);
const STARS = Array.from({ length: 46 }, () => ({ x: Math.round(rnd() * 1200), y: Math.round(rnd() * 210), r: +(0.5 + rnd() * 1.3).toFixed(2), d: +(rnd() * 6).toFixed(2) }));
const FLIES = Array.from({ length: 11 }, () => ({ x: Math.round(80 + rnd() * 1040), y: Math.round(300 + rnd() * 110), d: +(rnd() * 7).toFixed(2) }));
const FENCE_L = Array.from({ length: 15 }, (_, i) => 120 + i * 24);
const FENCE_R = Array.from({ length: 15 }, (_, i) => 744 + i * 24);

export function GateScene({ open }: { open: boolean }) {
  return (
    <div className="scene" data-open={open ? "true" : "false"} aria-hidden="true">
      <svg className="scene-svg" viewBox="0 0 1200 440" preserveAspectRatio="xMidYMax slice" focusable="false">
        <defs>
          <linearGradient id="lg-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--sky-top)" />
            <stop offset=".62" stopColor="var(--sky-mid)" />
            <stop offset="1" stopColor="var(--sky-low)" />
          </linearGradient>
          <radialGradient id="lg-moon-glow">
            <stop offset="0" stopColor="var(--moon)" stopOpacity=".35" />
            <stop offset="1" stopColor="var(--moon)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="lg-lantern-glow">
            <stop offset="0" stopColor="var(--lantern)" stopOpacity=".55" />
            <stop offset=".45" stopColor="var(--lantern)" stopOpacity=".16" />
            <stop offset="1" stopColor="var(--lantern)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="lg-beyond" cx=".5" cy="1" r=".9">
            <stop offset="0" stopColor="var(--lantern)" stopOpacity=".55" />
            <stop offset="1" stopColor="var(--lantern)" stopOpacity="0" />
          </radialGradient>
          <pattern id="lg-slats" width="12" height="132" patternUnits="userSpaceOnUse">
            <rect width="12" height="132" fill="var(--wood)" />
            <path d="M11.5 0v132" stroke="var(--wood-line)" strokeWidth="1" />
          </pattern>
        </defs>

        <rect width="1200" height="440" fill="url(#lg-sky)" />
        <g className="stars">
          {STARS.map((s, i) => (
            <circle key={i} cx={s.x} cy={s.y} r={s.r} style={{ animationDelay: `${s.d}s` }} />
          ))}
        </g>
        <circle cx="960" cy="92" r="140" fill="url(#lg-moon-glow)" />
        <g className="moon">
          <circle cx="960" cy="92" r="38" fill="var(--moon)" />
          <circle cx="948" cy="83" r="6" fill="var(--moon-shade)" opacity=".5" />
          <circle cx="970" cy="104" r="9" fill="var(--moon-shade)" opacity=".4" />
          <circle cx="969" cy="78" r="3.5" fill="var(--moon-shade)" opacity=".45" />
        </g>
        <path className="bat" d="M0 0c4-5 8-5 10-2 2-3 4-4 6-1 2-3 4-2 6 1 2-3 6-3 10 2-5-2-8 0-10 3-2-2-4-2-6 0-2-2-4-2-6 0-2-3-5-5-10-3z" fill="var(--silhouette)" />

        <path d="M0 300 C140 250 260 268 380 282 S620 236 760 262 1010 240 1200 270 V440 H0Z" fill="var(--hill-far)" />
        <path d="M0 352 C180 318 330 340 470 344 S760 320 900 334 1100 322 1200 336 V440 H0Z" fill="var(--hill-near)" />

        {/* bare tree */}
        <g stroke="var(--silhouette)" strokeLinecap="round" fill="none">
          <path d="M150 360 C152 320 146 290 156 250" strokeWidth="9" />
          <path d="M155 285 C130 270 116 250 104 226" strokeWidth="5" />
          <path d="M152 262 C176 244 190 224 196 196" strokeWidth="5" />
          <path d="M110 238 l-18 -10 M118 250 l-6 -22 M190 210 l16 -12 M184 226 l22 2 M156 252 c4-20 0-34 -6-48" strokeWidth="3" />
        </g>

        {/* the gate sits right of centre (x≈800) so the headline owns the left */}
        <g transform="translate(200 0)">
        {/* light spilling from beyond the gate */}
        <ellipse className="beyond" cx="600" cy="400" rx="140" ry="150" fill="url(#lg-beyond)" />

        {/* fence */}
        <g fill="var(--iron)">
          <rect x="112" y="356" width="378" height="4" />
          <rect x="112" y="384" width="378" height="4" />
          <rect x="710" y="356" width="378" height="4" />
          <rect x="710" y="384" width="378" height="4" />
          {[...FENCE_L, ...FENCE_R].map((x) => (
            <path key={x} d={`M${x} 404 V346 l3 -7 3 7 V404z`} />
          ))}
        </g>

        {/* the lychgate */}
        <g className="gate-house">
          <rect x="500" y="250" width="16" height="154" fill="var(--wood-dark)" />
          <rect x="684" y="250" width="16" height="154" fill="var(--wood-dark)" />
          <g className="door door-l">
            <rect x="516" y="272" width="84" height="132" fill="url(#lg-slats)" />
            <path d="M516 296h84M516 380h84" stroke="var(--wood-line)" strokeWidth="3" />
            <path d="M518 380 L598 296" stroke="var(--wood-line)" strokeWidth="3" />
          </g>
          <g className="door door-r">
            <rect x="600" y="272" width="84" height="132" fill="url(#lg-slats)" />
            <path d="M600 296h84M600 380h84" stroke="var(--wood-line)" strokeWidth="3" />
            <path d="M602 296 L682 380" stroke="var(--wood-line)" strokeWidth="3" />
          </g>
          <rect x="482" y="236" width="236" height="14" rx="2" fill="var(--wood-dark)" />
          <path d="M430 244 Q520 232 600 156 Q680 232 770 244 L758 256 Q684 246 600 176 Q516 246 442 256Z" fill="var(--roof)" stroke="var(--rim)" strokeWidth="1.5" />
          <path d="M470 240 Q540 222 600 168 M730 240 Q660 222 600 168 M505 236 Q556 214 600 176 M695 236 Q644 214 600 176" stroke="var(--rim)" strokeWidth="1" fill="none" opacity=".55" />
          <path d="M596 150 h8 l-4 -10z" fill="var(--roof)" stroke="var(--rim)" />
          <circle className="lantern-glow" cx="600" cy="276" r="110" fill="url(#lg-lantern-glow)" />
          <g className="lantern">
            <path d="M600 178 V256" stroke="var(--iron)" strokeWidth="1.5" />
            <path d="M590 256h20l3 6h-26z" fill="var(--iron)" />
            <rect className="lantern-body" x="589" y="262" width="22" height="26" rx="4" fill="var(--lantern)" />
            <path d="M589 270h22M589 280h22M596 262v26M604 262v26" stroke="var(--iron)" strokeWidth="1" opacity=".7" />
            <path d="M587 288h26l-3 5h-20z" fill="var(--iron)" />
          </g>
        </g>

        </g>

        {/* headstones */}
        <g fill="var(--stone)" stroke="var(--rim)" strokeWidth="1">
          <path d="M268 404 V372 a16 16 0 0 1 32 0 V404z" />
          <path d="M330 404 V382 h22 V404z" />
          <path d="M384 404 V368 h4 v-10 h4 v10 h4 v36z" />
          <path d="M1046 404 V376 a13 13 0 0 1 26 0 V404z" />
          <path d="M1104 404 V364 a18 18 0 0 1 36 0 V404z" />
          <path d="M1160 404 V384 h18 V404z" />
        </g>
        <rect y="402" width="1200" height="38" fill="var(--ground)" />
        <g className="flies">
          {FLIES.map((f, i) => (
            <circle key={i} cx={f.x} cy={f.y} r="2" style={{ animationDelay: `${f.d}s` }} />
          ))}
        </g>
      </svg>
      <div className="fog fog-a" />
      <div className="fog fog-b" />
      <div className="fog fog-c" />
    </div>
  );
}
