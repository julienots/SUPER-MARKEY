/**
 * Audio 100 % procédural (Web Audio) : effets spatialisés, ambiances (frigos, foule, rue, pluie),
 * musiques d'ambiance générées selon le style choisi, annonces micro (synthèse vocale).
 * Mixage par catégories : général, musique, ambiance, effets, voix.
 */
import type { Settings } from '../game/settings';

type Cat = 'music' | 'ambience' | 'sfx' | 'voice';

const NOTE = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private bus: Record<Cat, GainNode> = {} as any;
  private noiseBuf: AudioBuffer | null = null;
  private amb: Record<string, { src: AudioScheduledSourceNode[]; gain: GainNode; filter?: BiquadFilterNode }> = {};
  private musicStyle = 'aucune';
  private musicTimer: number | null = null;
  private nextNote = 0;
  private step = 0;
  private musicGain!: GainNode;
  listener = { x: 0, z: 0, yaw: 0 };
  private lastStep = 0;
  muffled = false;

  constructor(private settings: Settings) {}

  /** À appeler après une interaction utilisateur (politique d'autoplay). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC() as AudioContext;
    const c = this.ctx;
    this.master = c.createGain();
    const comp = c.createDynamicsCompressor();
    this.master.connect(comp).connect(c.destination);
    for (const k of ['music', 'ambience', 'sfx', 'voice'] as Cat[]) {
      this.bus[k] = c.createGain();
      this.bus[k].connect(this.master);
    }
    this.musicGain = c.createGain();
    this.musicGain.connect(this.bus.music);
    const len = c.sampleRate * 2;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = this.settings;
    this.master.gain.value = s.volMaster;
    this.bus.music.gain.value = s.volMusic * 0.5;
    this.bus.ambience.gain.value = s.volAmbience * 0.6;
    this.bus.sfx.gain.value = s.volSfx;
    this.bus.voice.gain.value = s.volVoice;
  }

  private noise(dur: number): AudioBufferSourceNode {
    const n = this.ctx!.createBufferSource();
    n.buffer = this.noiseBuf;
    n.loop = dur > 1.9;
    return n;
  }

  /** Atténuation + panoramique selon la position de l'auditeur. */
  private spatial(x?: number, z?: number): { gain: number; pan: number } {
    if (x === undefined || z === undefined) return { gain: 1, pan: 0 };
    const dx = x - this.listener.x;
    const dz = z - this.listener.z;
    const d = Math.hypot(dx, dz);
    const gain = Math.max(0, 1 / (1 + d * 0.12) - 0.02);
    const ang = Math.atan2(dx, dz) - this.listener.yaw;
    return { gain, pan: Math.max(-1, Math.min(1, -Math.sin(ang))) };
  }

  private out(cat: Cat, x?: number, z?: number, vol = 1): AudioNode | null {
    if (!this.ctx) return null;
    const { gain, pan } = this.spatial(x, z);
    if (gain * vol < 0.01) return null;
    const g = this.ctx.createGain();
    g.gain.value = gain * vol * (this.muffled ? 0.4 : 1);
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p).connect(this.bus[cat]);
    return g;
  }

  private tone(dest: AudioNode, type: OscillatorType, f0: number, f1: number, t0: number, dur: number, vol: number, attack = 0.005) {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  private burst(dest: AudioNode, t0: number, dur: number, vol: number, freq: number, q = 1, type: BiquadFilterType = 'bandpass') {
    const c = this.ctx!;
    const n = this.noise(dur);
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    n.connect(f).connect(g).connect(dest);
    n.start(t0, Math.random());
    n.stop(t0 + dur + 0.05);
  }

  sfx(name: string, x?: number, z?: number) {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime;
    const comic = this.settings.comicSounds;
    switch (name) {
      case 'beep': {
        const d = this.out('sfx', x, z, 0.35);
        if (d) this.tone(d, 'sine', 1860, 1860, t, 0.09, 0.5);
        break;
      }
      case 'till': {
        const d = this.out('sfx', x, z, 0.5);
        if (!d) break;
        this.burst(d, t, 0.08, 0.4, 3000, 2);
        this.tone(d, 'triangle', 2093, 2093, t + 0.05, 0.5, 0.25);
        this.tone(d, 'triangle', 2637, 2637, t + 0.12, 0.6, 0.2);
        break;
      }
      case 'error': {
        const d = this.out('sfx', x, z, 0.4);
        if (!d) break;
        this.tone(d, 'square', 420, 420, t, 0.12, 0.15);
        this.tone(d, 'square', 300, 300, t + 0.15, 0.2, 0.15);
        break;
      }
      case 'pick':
      case 'place': {
        const d = this.out('sfx', x, z, 0.25);
        if (d) this.burst(d, t, 0.05, 0.6, name === 'pick' ? 2400 : 1500, 3);
        break;
      }
      case 'thud': {
        const d = this.out('sfx', x, z, 0.6);
        if (!d) break;
        this.burst(d, t, 0.18, 0.9, 180, 1, 'lowpass');
        this.tone(d, 'sine', 90, 50, t, 0.15, 0.5);
        break;
      }
      case 'tumble': {
        const d = this.out('sfx', x, z, 0.6);
        if (!d) break;
        for (let i = 0; i < 6; i++) this.burst(d, t + i * 0.07 + Math.random() * 0.05, 0.12, 0.7, 400 + Math.random() * 800, 2);
        if (comic) this.tone(d, 'triangle', 900, 200, t + 0.1, 0.5, 0.15);
        break;
      }
      case 'crash': {
        const d = this.out('sfx', x, z, 0.7);
        if (!d) break;
        this.burst(d, t, 0.35, 0.9, 5000, 0.8, 'highpass');
        for (let i = 0; i < 4; i++) this.tone(d, 'sine', 3000 + Math.random() * 3000, 2500, t + i * 0.04, 0.25, 0.1);
        break;
      }
      case 'slip': {
        const d = this.out('sfx', x, z, 0.6);
        if (!d) break;
        if (comic) this.tone(d, 'sine', 1400, 180, t, 0.7, 0.3, 0.02);
        this.burst(d, t + 0.6, 0.2, 0.8, 200, 1, 'lowpass');
        break;
      }
      case 'step': {
        if (t - this.lastStep < 0.22) break;
        this.lastStep = t;
        const d = this.out('sfx', undefined, undefined, 0.08);
        if (d) this.burst(d, t, 0.05, 0.5, 700 + Math.random() * 300, 1.5);
        break;
      }
      case 'alarm':
      case 'siren': {
        const d = this.out('sfx', x, z, name === 'alarm' ? 0.5 : 0.35);
        if (!d) break;
        for (let i = 0; i < 6; i++) this.tone(d, name === 'alarm' ? 'square' : 'sawtooth', i % 2 ? 960 : 720, i % 2 ? 960 : 720, t + i * 0.32, 0.3, 0.12);
        break;
      }
      case 'horn': {
        const d = this.out('sfx', x, z, 0.4);
        if (!d) break;
        this.tone(d, 'sawtooth', 392, 392, t, 0.35, 0.15);
        this.tone(d, 'sawtooth', 494, 494, t, 0.35, 0.12);
        break;
      }
      case 'truck': {
        const d = this.out('sfx', x, z, 0.5);
        if (!d) break;
        this.burst(d, t, 1.4, 0.5, 120, 0.7, 'lowpass');
        this.tone(d, 'sawtooth', 55, 48, t, 1.4, 0.12, 0.2);
        break;
      }
      case 'mop': {
        const d = this.out('sfx', x, z, 0.3);
        if (d) this.burst(d, t, 0.3, 0.5, 1200, 0.6);
        break;
      }
      case 'tape': {
        const d = this.out('sfx', x, z, 0.35);
        if (d) this.burst(d, t, 0.35, 0.6, 3500, 1);
        break;
      }
      case 'cart': {
        const d = this.out('sfx', x, z, 0.4);
        if (!d) break;
        for (let i = 0; i < 8; i++) this.burst(d, t + i * 0.05, 0.04, 0.5, 2500 + Math.random() * 1500, 4);
        break;
      }
      case 'boing': {
        const d = this.out('sfx', x, z, 0.4);
        if (d && comic) this.tone(d, 'sine', 180, 520, t, 0.35, 0.4, 0.01);
        break;
      }
      case 'whoosh': {
        const d = this.out('sfx', x, z, 0.35);
        if (d) this.burst(d, t, 0.35, 0.6, 900, 0.5);
        break;
      }
      case 'ui': {
        const d = this.out('sfx', undefined, undefined, 0.18);
        if (d) this.tone(d, 'sine', 880, 1320, t, 0.06, 0.4);
        break;
      }
      case 'uiBack': {
        const d = this.out('sfx', undefined, undefined, 0.18);
        if (d) this.tone(d, 'sine', 990, 660, t, 0.07, 0.4);
        break;
      }
      case 'cash': {
        const d = this.out('sfx', undefined, undefined, 0.3);
        if (!d) break;
        this.tone(d, 'triangle', 1568, 1568, t, 0.12, 0.3);
        this.tone(d, 'triangle', 2093, 2093, t + 0.08, 0.3, 0.3);
        break;
      }
      case 'fanfare': {
        const d = this.out('sfx', undefined, undefined, 0.35);
        if (!d) break;
        [60, 64, 67, 72].forEach((n, i) => this.tone(d, 'square', NOTE(n + 12), NOTE(n + 12), t + i * 0.11, 0.25, 0.12));
        break;
      }
    }
  }

  // ------------------------------------------------------------ ambiances en boucle
  private ensureAmb(key: string, make: (dest: GainNode) => AudioScheduledSourceNode[], filter?: (f: BiquadFilterNode) => void) {
    if (!this.ctx || this.amb[key]) return;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    let dest: AudioNode = g;
    let f: BiquadFilterNode | undefined;
    if (filter) {
      f = this.ctx.createBiquadFilter();
      filter(f);
      f.connect(g);
      dest = f;
    }
    g.connect(this.bus.ambience);
    const src = make(dest as any);
    this.amb[key] = { src, gain: g, filter: f };
  }

  /** Mise à jour des ambiances : intensités selon le contexte. */
  ambience(o: { inStore: boolean; customers: number; fridges: number; rain: boolean; night: boolean; outdoor: number; menu?: boolean }) {
    if (!this.ctx) return;
    const c = this.ctx;
    this.ensureAmb(
      'hum',
      (dest) => {
        const a = c.createOscillator();
        a.frequency.value = 100;
        const b = c.createOscillator();
        b.frequency.value = 150;
        const g2 = c.createGain();
        g2.gain.value = 0.25;
        a.connect(dest);
        b.connect(g2).connect(dest);
        const n = this.noise(2);
        n.connect(dest);
        a.start();
        b.start();
        n.start();
        return [a, b, n];
      },
      (f) => {
        f.type = 'lowpass';
        f.frequency.value = 320;
      },
    );
    this.ensureAmb(
      'crowd',
      (dest) => {
        const n = this.noise(2);
        n.connect(dest);
        n.start();
        return [n];
      },
      (f) => {
        f.type = 'bandpass';
        f.frequency.value = 650;
        f.Q.value = 0.8;
      },
    );
    this.ensureAmb(
      'street',
      (dest) => {
        const n = this.noise(2);
        n.connect(dest);
        n.start();
        return [n];
      },
      (f) => {
        f.type = 'lowpass';
        f.frequency.value = 400;
      },
    );
    this.ensureAmb(
      'rain',
      (dest) => {
        const n = this.noise(2);
        n.connect(dest);
        n.start();
        return [n];
      },
      (f) => {
        f.type = 'highpass';
        f.frequency.value = 1800;
      },
    );
    const t = c.currentTime;
    const set = (k: string, v: number) => this.amb[k]?.gain.gain.setTargetAtTime(v, t, 0.6);
    set('hum', o.menu ? 0 : o.inStore ? 0.012 + Math.min(6, o.fridges) * 0.004 : 0.002);
    set('crowd', o.menu ? 0 : Math.min(0.08, o.customers * (o.inStore ? 0.006 : 0.002)));
    set('street', o.menu ? 0 : (o.inStore ? 0.015 : 0.05) * (o.night ? 0.4 : 1) * o.outdoor);
    set('rain', o.rain && !o.menu ? (o.inStore ? 0.025 : 0.09) : 0);
    // crowd « murmure » : modulation
    const cr = this.amb.crowd?.filter;
    if (cr) cr.frequency.setTargetAtTime(500 + Math.random() * 400, t, 0.3);
  }

  // ------------------------------------------------------------ musique générative
  setMusic(style: string, audible = 1) {
    if (!this.ctx) return;
    this.musicGain.gain.setTargetAtTime(audible, this.ctx.currentTime, 0.4);
    if (style === this.musicStyle) return;
    this.musicStyle = style;
    this.step = 0;
    this.nextNote = this.ctx.currentTime + 0.1;
    if (this.musicTimer === null) this.musicTimer = window.setInterval(() => this.schedule(), 60);
  }

  private schedule() {
    const c = this.ctx;
    if (!c || this.musicStyle === 'aucune') return;
    const st = this.musicStyle;
    const bpm = st === 'disco' ? 118 : st === 'lofi' ? 78 : st === 'accordeon' ? 150 : st === 'menu' ? 132 : 92;
    const spb = 60 / bpm / 2; // croches
    const progs: Record<string, number[][]> = {
      muzak: [[60, 64, 67, 71], [57, 60, 64, 67], [65, 69, 72, 76], [67, 71, 74, 77]],
      lofi: [[62, 65, 69, 72], [67, 71, 74, 77], [60, 64, 67, 71], [57, 60, 64, 67]],
      accordeon: [[57, 60, 64], [52, 56, 59], [57, 60, 64], [52, 56, 59], [50, 53, 57], [57, 60, 64], [52, 56, 59], [57, 60, 64]],
      disco: [[57, 60, 64, 67], [55, 59, 62, 65], [53, 57, 60, 64], [52, 55, 59, 62]],
      menu: [[60, 64, 67], [65, 69, 72], [67, 71, 74], [60, 64, 67], [57, 60, 64], [65, 69, 72], [67, 71, 74], [67, 71, 74]],
    };
    const prog = progs[st] ?? progs.muzak;
    const out = this.musicGain;
    while (this.nextNote < c.currentTime + 0.25) {
      const t = this.nextNote;
      const bar = Math.floor(this.step / 8) % prog.length;
      const beat = this.step % 8;
      const chord = prog[bar];
      if (st === 'accordeon' || st === 'menu') {
        // valse / fanfare bondissante
        if (beat % 2 === 0) this.tone(out, 'triangle', NOTE(chord[0] - 12), NOTE(chord[0] - 12), t, spb * 0.9, 0.18);
        else chord.slice(1).forEach((n) => this.tone(out, 'sawtooth', NOTE(n), NOTE(n), t, spb * 0.6, 0.035));
        if (beat === 0 || beat === 3 || beat === 6) {
          const m = chord[(beat / 3) | 0 % chord.length] + 12 + (Math.random() < 0.3 ? 2 : 0);
          this.tone(out, 'square', NOTE(m), NOTE(m) * 1.003, t, spb * 1.8, 0.05, 0.01);
        }
      } else if (st === 'disco') {
        const root = chord[0] - 24 + (beat % 2 ? 12 : 0);
        this.tone(out, 'sawtooth', NOTE(root), NOTE(root), t, spb * 0.8, 0.09);
        this.burst(out, t, 0.04, beat % 2 ? 0.25 : 0.12, 8000, 1, 'highpass');
        if (beat % 4 === 0) this.tone(out, 'sine', 120, 45, t, 0.25, 0.4);
        if (beat === 2 || beat === 6) chord.forEach((n) => this.tone(out, 'square', NOTE(n), NOTE(n), t, spb * 0.5, 0.02));
      } else if (st === 'lofi') {
        if (beat === 0) chord.forEach((n) => this.tone(out, 'triangle', NOTE(n), NOTE(n), t, spb * 7, 0.04, 0.04));
        if (beat === 0 || beat === 5) this.tone(out, 'sine', 110, 40, t, 0.3, 0.35);
        if (beat === 4) this.burst(out, t, 0.12, 0.25, 1800, 0.8);
        if (beat % 2 === 1) this.burst(out, t + spb * 0.15, 0.03, 0.08, 9000, 1, 'highpass');
        if (Math.random() < 0.3) this.burst(out, t, 0.01, 0.05, 6000, 1, 'highpass');
      } else {
        // muzak : piano électrique arpégé
        if (beat === 0) chord.forEach((n) => this.tone(out, 'sine', NOTE(n), NOTE(n), t, spb * 7.5, 0.045, 0.02));
        const n = chord[beat % chord.length] + 12;
        if (beat % 2 === 0) this.tone(out, 'triangle', NOTE(n), NOTE(n), t, spb * 1.6, 0.04, 0.01);
        if (beat === 0) this.tone(out, 'sine', NOTE(chord[0] - 12), NOTE(chord[0] - 12), t, spb * 4, 0.12);
      }
      this.nextNote += st === 'lofi' && beat % 2 === 0 ? spb * 1.12 : st === 'lofi' ? spb * 0.88 : spb;
      this.step++;
    }
  }

  // ------------------------------------------------------------ annonces
  announce(text: string) {
    if (!this.ctx) return;
    const d = this.out('voice', undefined, undefined, 0.4);
    if (d) {
      const t = this.ctx.currentTime;
      [72, 76, 79].forEach((n, i) => this.tone(d, 'sine', NOTE(n), NOTE(n), t + i * 0.18, 0.5, 0.25));
    }
    const synth = (window as any).speechSynthesis as SpeechSynthesis | undefined;
    if (!synth || this.settings.volVoice <= 0.01) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'fr-FR';
      u.rate = 1.02;
      u.pitch = 1.1;
      u.volume = Math.min(1, this.settings.volVoice * this.settings.volMaster);
      const fr = synth.getVoices().find((v) => v.lang.startsWith('fr'));
      if (fr) u.voice = fr;
      setTimeout(() => synth.speak(u), 650);
    } catch {
      /* synthèse vocale indisponible */
    }
  }
}
