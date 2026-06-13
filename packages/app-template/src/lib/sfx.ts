// Synthesized sound effects — ZERO audio assets (generated apps may not load
// external files). WebAudio created lazily on first call; every call is safe to
// make from a click handler. All failures are swallowed (audio blocked in some
// sandboxes — the game must work silently).
let ctx: AudioContext | null = null;

function ac(): AudioContext {
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(
  freq: number,
  dur = 0.12,
  type: OscillatorType = "sine",
  vol = 0.2,
  slideTo?: number,
) {
  try {
    const a = ac();
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, a.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, a.currentTime + dur);
    g.gain.setValueAtTime(vol, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    o.connect(g).connect(a.destination);
    o.start();
    o.stop(a.currentTime + dur);
  } catch {
    // audio unavailable — stay silent
  }
}

export const sfx = {
  /** small UI tick — buttons, selections */
  click: () => tone(600, 0.05, "square", 0.08),
  /** collect / hit / success beep */
  pop: () => tone(440, 0.09, "triangle", 0.25, 880),
  /** ascending win arpeggio — high score, payment success */
  win: () => {
    tone(523, 0.12, "sine", 0.2);
    setTimeout(() => tone(659, 0.12, "sine", 0.2), 110);
    setTimeout(() => tone(784, 0.2, "sine", 0.25), 220);
  },
  /** descending fail — wrong answer, game over */
  lose: () => tone(220, 0.35, "sawtooth", 0.15, 110),
  /** low impact — explosions, collisions */
  boom: () => tone(120, 0.3, "square", 0.3, 40),
};
