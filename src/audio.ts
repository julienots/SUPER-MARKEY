/** Musique (morceaux enregistrés du jeu) et petits bruitages synthétisés, calmes et discrets. */

const TRACKS = ['muzak', 'lofi', 'pop', 'accordeon', 'disco'];

export class Audio {
  private ctx: AudioContext | null = null;
  private music = new window.Audio();
  private track = '';
  private idx = 0;
  musicVol = 0.5;
  sfxVol = 0.6;
  private last = new Map<string, number>();

  constructor() {
    this.music.loop = false;
    this.music.addEventListener('ended', () => this.next());
    const unlock = () => {
      this.ensure();
      if (this.track && this.music.paused) this.music.play().catch(() => {});
    };
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);
  }

  private ensure() {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  setVolumes(music: number, sfx: number) {
    this.musicVol = music;
    this.sfxVol = sfx;
    this.music.volume = Math.max(0, Math.min(1, music * 0.6));
    if (music <= 0) this.music.pause();
    else if (this.track && this.music.paused) this.music.play().catch(() => {});
  }

  play(id: 'menu' | 'game') {
    const name = id === 'menu' ? 'menu' : TRACKS[this.idx % TRACKS.length];
    if (id === 'menu') this.music.loop = true;
    else this.music.loop = false;
    if (this.track === name) return;
    this.track = name;
    this.music.src = `./music/${name}.ogg`;
    this.music.volume = Math.max(0, Math.min(1, this.musicVol * 0.6));
    if (this.musicVol > 0) this.music.play().catch(() => {});
  }

  next() {
    this.idx++;
    this.track = '';
    this.play('game');
  }

  stopMusic() {
    this.music.pause();
    this.track = '';
  }

  pause(p: boolean) {
    if (p) this.music.pause();
    else if (this.track && this.musicVol > 0) this.music.play().catch(() => {});
  }

  private tone(freq: number, t0: number, dur: number, type: OscillatorType, vol: number, slide = 0) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol * this.sfxVol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  sfx(name: string) {
    if (this.sfxVol <= 0) return;
    const ctx = this.ensure();
    if (!ctx || ctx.state !== 'running') return;
    const now = performance.now();
    if (now - (this.last.get(name) ?? 0) < 90) return;
    this.last.set(name, now);
    const t = ctx.currentTime;
    switch (name) {
      case 'cash':
        this.tone(1318, t, 0.12, 'triangle', 0.18);
        this.tone(1760, t + 0.08, 0.3, 'triangle', 0.16);
        break;
      case 'click':
        this.tone(660, t, 0.05, 'sine', 0.12);
        break;
      case 'open':
        this.tone(520, t, 0.08, 'sine', 0.12, 1.4);
        break;
      case 'build':
        this.tone(220, t, 0.09, 'square', 0.08);
        this.tone(330, t + 0.07, 0.12, 'triangle', 0.12);
        break;
      case 'sell':
        this.tone(440, t, 0.1, 'triangle', 0.12, 0.6);
        break;
      case 'fill':
        this.tone(880, t, 0.06, 'sine', 0.05);
        break;
      case 'door':
        this.tone(988, t, 0.25, 'sine', 0.04);
        this.tone(784, t + 0.2, 0.35, 'sine', 0.04);
        break;
      case 'honk':
        this.tone(392, t, 0.16, 'sawtooth', 0.05);
        this.tone(392, t + 0.22, 0.2, 'sawtooth', 0.05);
        break;
      case 'level':
        [523, 659, 784, 1046].forEach((f, i) => this.tone(f, t + i * 0.11, 0.35, 'triangle', 0.16));
        break;
      case 'nope':
        this.tone(200, t, 0.15, 'square', 0.06, 0.8);
        break;
      case 'join':
        [659, 880].forEach((f, i) => this.tone(f, t + i * 0.12, 0.3, 'sine', 0.15));
        break;
    }
  }
}
