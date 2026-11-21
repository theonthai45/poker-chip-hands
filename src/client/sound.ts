/**
 * All game sounds, synthesized with Web Audio (no audio files, nothing to license).
 */
class Sfx {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private lastClack = 0;
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem('muted') === '1';
    } catch {
      /* private mode */
    }
  }

  /** Browsers only allow audio after a touch; call this from a pointer event. */
  unlock = () => {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.out = this.ctx.createGain();
      this.out.gain.value = this.muted ? 0 : 0.9;
      this.out.connect(this.ctx.destination);
      const n = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, n, n);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
  };

  setMuted(m: boolean) {
    this.muted = m;
    try {
      localStorage.setItem('muted', m ? '1' : '0');
    } catch {
      /* private mode */
    }
    if (this.out && this.ctx) this.out.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.02);
  }

  private get ready() {
    return !!this.ctx && !!this.out && this.ctx.state === 'running' && !this.muted;
  }

  /** A burst of filtered noise with a fast attack and exponential decay. */
  private noise(o: { at?: number; dur: number; freq: number; q?: number; gain: number; type?: BiquadFilterType; sweepTo?: number; attack?: number }) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (o.at ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.loopStart = Math.random() * 0.5;
    const f = ctx.createBiquadFilter();
    f.type = o.type ?? 'bandpass';
    f.frequency.setValueAtTime(o.freq, t);
    if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(o.sweepTo, t + o.dur);
    f.Q.value = o.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain, t + (o.attack ?? 0.003));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f).connect(g).connect(this.out!);
    src.start(t, src.loopStart);
    src.stop(t + o.dur + 0.02);
  }

  /** A decaying sine/triangle partial. */
  private tone(o: { at?: number; dur: number; freq: number; gain: number; type?: OscillatorType; slideTo?: number; attack?: number }) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (o.at ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t + o.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain, t + (o.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    osc.connect(g).connect(this.out!);
    osc.start(t);
    osc.stop(t + o.dur + 0.02);
  }

  /** One clay chip landing on the felt or on other chips. */
  clack(vol = 1, at = 0) {
    if (!this.ready) return;
    const now = performance.now() + at * 1000;
    if (now - this.lastClack < 22) return;
    this.lastClack = now;
    const pitch = 0.88 + Math.random() * 0.3;
    this.noise({ at, dur: 0.035, freq: 4300 * pitch, q: 1.4, gain: 0.5 * vol });
    this.tone({ at, dur: 0.07, freq: 3050 * pitch, gain: 0.16 * vol, type: 'triangle' });
    this.tone({ at, dur: 0.045, freq: 5200 * pitch, gain: 0.07 * vol });
    this.tone({ at, dur: 0.05, freq: 420 * pitch, gain: 0.12 * vol });
  }

  /** Picking a chip up off a stack. */
  pick() {
    if (!this.ready) return;
    const p = 0.95 + Math.random() * 0.15;
    this.noise({ dur: 0.02, freq: 5200 * p, q: 2, gain: 0.22 });
    this.tone({ dur: 0.04, freq: 3600 * p, gain: 0.07, type: 'triangle' });
  }

  /** Chips leaving the hand. */
  whoosh(power = 0.5) {
    if (!this.ready) return;
    this.noise({ dur: 0.22 - power * 0.06, freq: 500, sweepTo: 2600 + power * 1500, q: 0.8, gain: 0.16 + power * 0.1, attack: 0.05 });
  }

  /** Check: knuckles on the table. */
  knock() {
    if (!this.ready) return;
    for (const at of [0, 0.13]) {
      this.tone({ at, dur: 0.11, freq: 165, slideTo: 82, gain: 0.55 });
      this.noise({ at, dur: 0.03, freq: 900, q: 0.7, gain: 0.22 });
    }
  }

  /** Fold: cards sliding into the muck. */
  fold() {
    if (!this.ready) return;
    this.noise({ dur: 0.26, freq: 3200, sweepTo: 1100, q: 0.6, gain: 0.2, attack: 0.03, type: 'highpass' });
  }

  /** A card turning over: new street or showdown. */
  flip() {
    if (!this.ready) return;
    this.noise({ dur: 0.07, freq: 2600, q: 0.7, gain: 0.26, attack: 0.012 });
    this.noise({ at: 0.07, dur: 0.035, freq: 1500, q: 1, gain: 0.3 });
  }

  /** New hand: a short riffle. */
  deal() {
    if (!this.ready) return;
    for (let i = 0; i < 9; i++) this.noise({ at: i * 0.032 + Math.random() * 0.006, dur: 0.028, freq: 2400 + i * 180, q: 1.2, gain: 0.16 });
    this.noise({ at: 0.32, dur: 0.09, freq: 1400, q: 0.6, gain: 0.2 });
  }

  /** It is your turn. */
  turn() {
    if (!this.ready) return;
    this.tone({ dur: 0.35, freq: 880, gain: 0.16, type: 'triangle' });
    this.tone({ at: 0.12, dur: 0.5, freq: 1318.5, gain: 0.16, type: 'triangle' });
  }

  /** Someone goes all-in. */
  allIn() {
    if (!this.ready) return;
    this.tone({ dur: 0.5, freq: 110, slideTo: 55, gain: 0.5 });
    this.tone({ dur: 0.4, freq: 220, slideTo: 330, gain: 0.12, type: 'sawtooth', attack: 0.15 });
  }

  /** A pot is won. `mine` plays the bigger version. */
  win(mine: boolean) {
    if (!this.ready) return;
    const notes = mine ? [523.25, 659.25, 783.99, 1046.5] : [659.25, 783.99];
    notes.forEach((freq, i) => {
      this.tone({ at: i * 0.09, dur: 0.5, freq, gain: mine ? 0.17 : 0.1, type: 'triangle' });
      this.tone({ at: i * 0.09, dur: 0.3, freq: freq * 2, gain: mine ? 0.05 : 0.03 });
    });
  }

  /** A player joined or bought chips. */
  join() {
    if (!this.ready) return;
    this.tone({ dur: 0.25, freq: 660, gain: 0.1, type: 'triangle' });
    for (let i = 0; i < 4; i++) this.clack(0.5, 0.1 + i * 0.05);
  }

  error() {
    if (!this.ready) return;
    this.tone({ dur: 0.16, freq: 196, gain: 0.2, type: 'square' });
    this.tone({ at: 0.14, dur: 0.22, freq: 147, gain: 0.2, type: 'square' });
  }
}

export const sfx = new Sfx();
