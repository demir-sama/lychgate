import type { LinkClass } from "../classify/classify";

/**
 * Original, synthesized sound design (no samples, nothing licensed): every voice is built
 * from Web Audio oscillators and filtered noise at runtime. Muted by default; the user turns it on.
 */
export type Cue = LinkClass | "open" | "done" | "resurrect";

/** Pitch/shape table, kept pure so it can be unit-tested. Frequencies in Hz. */
export const VOICES: Record<Cue, { freqs: number[]; type: OscillatorType; dur: number; gain: number; noise?: boolean; glide?: number }> = {
  living: { freqs: [1318.5, 1975.5], type: "sine", dur: 0.35, gain: 0.05 }, // lantern chime
  tombstone: { freqs: [98, 146.8, 196], type: "triangle", dur: 1.6, gain: 0.09 }, // distant bell toll
  ghost: { freqs: [660], type: "sine", dur: 0.9, gain: 0.05, glide: 330 }, // falling wail
  drifted: { freqs: [440, 466.2], type: "sine", dur: 0.6, gain: 0.04 }, // beating, out of tune
  zombie: { freqs: [73.4, 77.8], type: "sawtooth", dur: 0.7, gain: 0.05 }, // low growl
  restless: { freqs: [523.3], type: "triangle", dur: 0.25, gain: 0.03 },
  sealed: { freqs: [220], type: "square", dur: 0.12, gain: 0.02 },
  open: { freqs: [196, 293.7], type: "sine", dur: 1.2, gain: 0.05, noise: true }, // gate creak + wind
  done: { freqs: [130.8, 196, 261.6], type: "triangle", dur: 2.2, gain: 0.07 }, // closing bell
  resurrect: { freqs: [523.3, 659.3, 784, 1046.5], type: "sine", dur: 0.9, gain: 0.05 }, // rising arpeggio
};

/** Throttle so a burst of 300 results never becomes a wall of noise. */
export function shouldPlay(last: number, now: number, minGapMs = 140): boolean {
  return now - last >= minGapMs;
}

let ctx: AudioContext | null = null;
let lastAt = 0;

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return null;
  ctx ??= new C();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function play(cue: Cue, opts: { force?: boolean } = {}): void {
  const now = performance.now();
  if (!opts.force && !shouldPlay(lastAt, now)) return;
  lastAt = now;
  const a = ac();
  if (!a) return;
  const v = VOICES[cue];
  const t0 = a.currentTime + 0.01;
  const master = a.createGain();
  master.gain.setValueAtTime(0, t0);
  master.gain.linearRampToValueAtTime(v.gain, t0 + 0.02);
  master.gain.exponentialRampToValueAtTime(0.0001, t0 + v.dur);
  const lp = a.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = cue === "zombie" ? 600 : 4200;
  master.connect(lp).connect(a.destination);
  const arp = cue === "resurrect";
  v.freqs.forEach((f, i) => {
    const o = a.createOscillator();
    o.type = v.type;
    const start = arp ? t0 + i * 0.09 : t0;
    o.frequency.setValueAtTime(f, start);
    if (v.glide) o.frequency.exponentialRampToValueAtTime(v.glide, start + v.dur);
    o.connect(master);
    o.start(start);
    o.stop(t0 + v.dur + 0.05);
  });
  if (v.noise) {
    const len = Math.floor(a.sampleRate * v.dur);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const n = a.createBufferSource();
    n.buffer = buf;
    const bp = a.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 500;
    bp.Q.value = 0.7;
    n.connect(bp).connect(master);
    n.start(t0);
  }
}
