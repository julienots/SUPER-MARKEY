/**
 * Compose les musiques du jeu (MIDI écrit par programme), les joue avec la banque de sons GeneralUser GS
 * (instruments réels échantillonnés, licence libre y compris commerciale) via spessasynth_core, puis encode
 * des boucles parfaites en Opus (public/music/<id>.ogg) + un manifeste (durée exacte de chaque boucle).
 *
 * Usage : node scripts/compose-music.mjs   (nécessite ffmpeg)
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { SpessaSynthProcessor, SpessaSynthSequencer, SoundBankLoader, BasicMIDI, audioToWav } from 'spessasynth_core';

const require = createRequire(import.meta.url);
const { Midi } = require('@tonejs/midi');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(root, 'public/music');
const TMP = '/tmp/bazar-music';
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

// ------------------------------------------------------------------ outils musicaux
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const NOTE = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const QUAL = {
  '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], 9: [0, 4, 7, 10, 14], m9: [0, 3, 7, 10, 14], maj9: [0, 4, 7, 11, 14], 6: [0, 4, 7, 9], m6: [0, 3, 7, 9], sus4: [0, 5, 7], dim: [0, 3, 6], '7b9': [0, 4, 7, 10, 13], add9: [0, 4, 7, 14],
};
function chord(sym) {
  const m = sym.match(/^([A-G][#b]?)(.*)$/);
  const q = QUAL[m[2]];
  if (!q) throw new Error(`accord inconnu ${sym}`);
  return { root: NOTE[m[1]], tones: q, sym };
}
/** Voicing proche du précédent (conduite des voix) autour de `center`. */
function voice(c, prev, center = 62, n = 4) {
  const pcs = c.tones.slice(1, n + 1).map((t) => (c.root + t) % 12);
  if (pcs.length < n) pcs.unshift(c.root);
  let best = null;
  let bd = Infinity;
  for (let base = center - 8; base <= center + 4; base++) {
    const v = pcs.map((pc) => {
      let x = base + ((pc - base + 120) % 12);
      return x;
    }).sort((a, b) => a - b);
    const d = prev ? v.reduce((a, x, i) => a + Math.abs(x - (prev[i] ?? prev[prev.length - 1])), 0) : Math.abs(v[0] - center + 4);
    if (d < bd) {
      bd = d;
      best = v;
    }
  }
  return best;
}
/** Gamme (majeure ou mineure naturelle) en classes de hauteur. */
const scale = (tonic, minor) => (minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11]).map((x) => (x + tonic) % 12);
const nearestIn = (pitch, pcs, dir = 0) => {
  for (let d = 0; d < 12; d++) for (const s of dir >= 0 ? [d, -d] : [-d, d]) if (pcs.includes((((pitch + s) % 12) + 12) % 12)) return pitch + s;
  return pitch;
};

// ------------------------------------------------------------------ morceau
class Song {
  constructor({ id, title, bpm, beats = 4, tonic, minor = false, swing = 0 }) {
    Object.assign(this, { id, title, bpm, beats, tonic, minor, swing });
    this.midi = new Midi();
    this.midi.header.setTempo(bpm);
    this.midi.header.timeSignatures.push({ ticks: 0, timeSignature: [beats, 4] });
    this.tracks = {};
    this.bars = 0;
    this.spb = 60 / bpm;
  }
  track(name, program, channel, { vol = 100, pan = 64, rev = 40, cho = 0 } = {}) {
    const t = this.midi.addTrack();
    t.name = name;
    t.channel = channel;
    if (channel !== 9) t.instrument.number = program;
    t.addCC({ number: 7, value: vol, time: 0 });
    t.addCC({ number: 10, value: pan, time: 0 });
    t.addCC({ number: 91, value: rev, time: 0 });
    t.addCC({ number: 93, value: cho, time: 0 });
    this.tracks[name] = t;
    return t;
  }
  /** Temps (s) d'un temps `beat` (en noires) de la mesure `bar`, avec swing des croches. */
  at(bar, beat) {
    let b = beat;
    const frac = b % 1;
    if (this.swing && Math.abs(frac - 0.5) < 1e-6) b += this.swing * 0.5;
    return (bar * this.beats + b) * this.spb;
  }
  note(tr, midi, bar, beat, lenBeats, vel = 0.8) {
    if (midi < 0 || midi > 127) return;
    const v = Math.max(0.05, Math.min(1, vel * (0.92 + rnd() * 0.12)));
    this.tracks[tr].addNote({ midi, time: Math.max(0, this.at(bar, beat) + (rnd() - 0.5) * 0.006), duration: Math.max(0.03, lenBeats * this.spb * 0.98), velocity: v });
  }
  get length() {
    return this.bars * this.beats * this.spb;
  }
}

// ------------------------------------------------------------------ batterie (canal 10)
const K = 36, SN = 38, RIM = 37, CL = 39, HH = 42, OH = 46, RIDE = 51, SH = 70, TAMB = 54, CRASH = 49, BRUSH = 40, CONGA_H = 62, CONGA_L = 64, CLAVE = 75;
function drums(s, bar, style, fill = false) {
  const d = (n, b, v = 0.8, l = 0.25) => s.note('drums', n, bar, b, l, v);
  if (style === 'bossa') {
    for (const b of [0, 1.5, 2, 3.5]) d(K, b, 0.55);
    for (let b = 0; b < 4; b += 0.5) d(SH, b, b % 1 ? 0.35 : 0.5);
    for (const b of (bar % 2 ? [0.5, 2, 3] : [0, 1.5, 3])) d(RIM, b, 0.55);
    if (fill) for (const b of [3, 3.5]) d(CONGA_H, b, 0.6);
  } else if (style === 'disco') {
    for (let b = 0; b < 4; b++) d(K, b, 0.9);
    d(CL, 1, 0.75);
    d(SN, 3, 0.8);
    for (let b = 0; b < 4; b += 0.5) d(b % 1 ? OH : HH, b, b % 1 ? 0.5 : 0.4);
    for (let b = 0; b < 4; b += 0.25) if (b % 0.5) d(TAMB, b, 0.25);
    if (fill) for (const b of [3, 3.25, 3.5, 3.75]) d(SN, b, 0.55 + b * 0.08);
  } else if (style === 'pop') {
    d(K, 0, 0.9);
    d(K, 1.5, 0.6);
    d(K, 2, 0.85);
    d(K, 3.5, 0.5);
    d(SN, 1, 0.85);
    d(SN, 3, 0.85);
    for (let b = 0; b < 4; b += 0.5) d(HH, b, b % 1 ? 0.35 : 0.55);
    if (fill) for (const b of [2.5, 3, 3.25, 3.5, 3.75]) d(SN, b, 0.7);
  } else if (style === 'lofi') {
    d(K, 0, 0.7);
    d(K, 1.75, 0.45);
    d(K, 2.5, 0.6);
    d(RIM, 1, 0.55);
    d(RIM, 3, 0.6);
    for (let b = 0; b < 4; b += 0.5) d(HH, b, b % 1 ? 0.22 : 0.35);
    if (fill) d(SH, 3.5, 0.4);
  } else if (style === 'menu') {
    d(K, 0, 0.95);
    d(K, 2, 0.9);
    d(K, 2.5, 0.6);
    d(SN, 1, 0.9);
    d(SN, 3, 0.9);
    d(CL, 3, 0.5);
    for (let b = 0; b < 4; b += 0.5) d(HH, b, b % 1 ? 0.4 : 0.6);
    if (fill) for (const b of [3, 3.25, 3.5, 3.75]) d(SN, b, 0.75);
  }
}

// ------------------------------------------------------------------ mélodie à motifs (AABA)
const RHYTHMS = {
  bossa: [[[0, 1], [1.5, 0.5], [2, 1.5]], [[0.5, 0.5], [1, 0.5], [1.5, 1], [3, 1]], [[0, 0.5], [0.5, 1], [2, 0.5], [2.5, 1.5]]],
  disco: [[[0, 0.5], [0.5, 0.5], [1, 1], [2.5, 0.5], [3, 1]], [[0, 1.5], [2, 0.5], [2.5, 0.5], [3, 0.75]], [[0.5, 0.5], [1, 0.5], [1.5, 0.5], [2, 1.5]]],
  pop: [[[0, 0.5], [0.5, 0.5], [1, 0.5], [1.5, 1], [3, 1]], [[0, 1], [1, 0.5], [1.5, 0.5], [2, 2]], [[0.5, 0.5], [1, 1], [2, 0.5], [2.5, 0.5], [3, 1]]],
  lofi: [[[0.5, 1], [2, 0.5], [2.5, 1.5]], [[0, 1.5], [2.5, 0.5], [3, 1]], [[1, 0.5], [1.5, 1.5], [3.5, 0.5]]],
  menu: [[[0, 0.5], [0.5, 0.5], [1, 0.5], [1.5, 0.5], [2, 1], [3, 1]], [[0, 0.75], [0.75, 0.75], [1.5, 0.5], [2, 2]], [[0, 0.5], [0.5, 0.5], [1, 1], [2, 0.5], [2.5, 0.5], [3, 1]]],
  valse: [[[0, 1], [1, 0.5], [1.5, 0.5], [2, 1]], [[0, 2], [2, 1]], [[0, 0.5], [0.5, 0.5], [1, 0.5], [1.5, 0.5], [2, 1]]],
};
/**
 * Mélodie d'une phrase de 8 mesures sur `chords` (un accord par mesure) : motif de 2 mesures répété,
 * transposé sur l'harmonie, varié, puis cadence.
 */
function melody(s, tr, startBar, chords, style, octave = 72, vel = 0.8) {
  const pcs = scale(s.tonic, s.minor);
  const rhythmA = pick(RHYTHMS[style]);
  const rhythmB = pick(RHYTHMS[style]);
  // contour du motif en degrés (relatifs à la note de départ)
  const contour = rhythmA.map((_, i) => (i === 0 ? 0 : pick([-2, -1, 1, 2, 1, -1, 3, -3])));
  const contourB = rhythmB.map((_, i) => (i === 0 ? 0 : pick([-1, 1, 2, -2, 1])));
  let last = octave;
  for (let b = 0; b < chords.length; b++) {
    const c = chords[b];
    const ct = c.tones.slice(0, 4).map((t) => (c.root + t) % 12);
    const cadence = b % 8 === 7;
    const useB = b % 4 === 2 || b % 4 === 3;
    const rh = cadence ? [[0, s.beats === 3 ? 3 : 3]] : useB ? rhythmB : rhythmA;
    const ctr = useB ? contourB : contour;
    // note de départ : note de l'accord la plus proche de la précédente (registre stable)
    let p = nearestIn(last, ct);
    if (p > octave + 9) p -= 12;
    if (p < octave - 5) p += 12;
    if (cadence) p = nearestIn(octave, [c.root % 12, (c.root + c.tones[1]) % 12]);
    rh.forEach(([beat, len], i) => {
      if (beat >= s.beats) return;
      let q = p;
      if (i > 0) {
        const steps = ctr[i % ctr.length];
        q = p;
        for (let k = 0; k < Math.abs(steps); k++) q = nearestIn(q + Math.sign(steps), pcs, steps);
        // les temps forts retombent sur une note de l'accord
        if (beat % 1 === 0) q = nearestIn(q, ct);
        p = q;
      }
      s.note(tr, q, startBar + b, beat, Math.min(len, s.beats - beat), vel * (beat % 1 === 0 ? 1 : 0.85));
      last = q;
    });
  }
}

// ------------------------------------------------------------------ morceaux
const progressions = (list) => list.map(chord);

function songBossa() {
  seed = 11;
  const s = new Song({ id: 'muzak', title: 'Supérette Bossa', bpm: 108, tonic: 5 });
  s.track('drums', 0, 9, { vol: 92, rev: 30 });
  s.track('bass', 32, 0, { vol: 105, rev: 20 });
  s.track('guitar', 24, 1, { vol: 92, pan: 44, rev: 45 });
  s.track('ep', 4, 2, { vol: 84, pan: 84, rev: 55, cho: 40 });
  s.track('lead', 11, 3, { vol: 100, pan: 70, rev: 60 });
  s.track('flute', 73, 4, { vol: 86, pan: 58, rev: 65 });
  const A = progressions(['Fmaj7', 'Dm7', 'Gm7', 'C7', 'Fmaj7', 'Dm7', 'Gm7', 'C7']);
  const B = progressions(['Bbmaj7', 'Bbm6', 'Am7', 'D7', 'Gm7', 'C7', 'Fmaj7', 'C7']);
  const form = [A, A, B, A, B, A];
  let bar = 0;
  let prev = null;
  form.forEach((sec, si) => {
    melody(s, si % 2 ? 'flute' : 'lead', bar, sec, 'bossa', si % 2 ? 77 : 72, 0.78);
    sec.forEach((c, i) => {
      const r = 36 + ((c.root + 12 - 5) % 12) + 5 - 0;
      const rt = 33 + ((c.root - 9 + 24) % 12);
      // basse : fondamentale / quinte (bossa)
      s.note('bass', rt, bar, 0, 1.4, 0.85);
      s.note('bass', rt + 7, bar, 1.5, 0.45, 0.65);
      s.note('bass', rt + 7, bar, 2, 1.4, 0.75);
      s.note('bass', rt, bar, 3.5, 0.45, 0.6);
      // guitare : accords syncopés
      const v = voice(c, prev, 60, 4);
      prev = v;
      for (const [b, l] of [[0, 0.4], [1, 0.4], [1.5, 0.4], [2.5, 0.4], [3, 0.4]]) for (const n of v) s.note('guitar', n, bar, b, l, 0.5);
      // piano électrique : nappe douce
      for (const n of voice(c, null, 67, 3)) s.note('ep', n, bar, 0, 3.8, 0.38);
      drums(s, bar, 'bossa', i === 7);
      void r;
      bar++;
    });
  });
  s.bars = bar;
  return s;
}

function songDisco() {
  seed = 23;
  const s = new Song({ id: 'disco', title: 'Promo Disco', bpm: 116, tonic: 9, minor: true });
  s.track('drums', 0, 9, { vol: 100, rev: 25 });
  s.track('bass', 36, 0, { vol: 108, rev: 15 });
  s.track('clav', 7, 1, { vol: 78, pan: 40, rev: 30 });
  s.track('strings', 48, 2, { vol: 74, pan: 84, rev: 70 });
  s.track('brass', 61, 3, { vol: 88, pan: 64, rev: 50 });
  s.track('lead', 65, 4, { vol: 96, pan: 70, rev: 55 });
  s.track('gtr', 27, 5, { vol: 72, pan: 30, rev: 30 });
  const A = progressions(['Am7', 'D9', 'Am7', 'D9', 'Fmaj7', 'E7', 'Am7', 'E7']);
  const B = progressions(['Dm7', 'G7', 'Cmaj7', 'Fmaj7', 'Bm7'.replace('Bm7', 'Dm7'), 'E7', 'Am7', 'E7']);
  const form = [A, A, B, A, B, A];
  let bar = 0;
  form.forEach((sec, si) => {
    if (si > 0) melody(s, 'lead', bar, sec, 'disco', 72, 0.8);
    sec.forEach((c, i) => {
      const rt = 33 + ((c.root - 9 + 24) % 12);
      // basse « octaves » disco
      for (let b = 0; b < 4; b += 0.5) s.note('bass', rt + (b % 1 ? 12 : 0), bar, b, 0.4, b % 1 ? 0.7 : 0.9);
      const v = voice(c, null, 66, 4);
      for (const b of [0.5, 1.5, 2.5, 3.5]) for (const n of v) s.note('clav', n, bar, b, 0.2, 0.55);
      for (const n of voice(c, null, 72, 3)) s.note('strings', n, bar, 0, 4, 0.42);
      if (i % 2 === 0) for (const n of voice(c, null, 67, 3)) s.note('brass', n, bar, 0, 0.3, 0.75);
      for (let b = 0; b < 4; b += 0.25) if (b % 1 === 0.25 || b % 1 === 0.75) s.note('gtr', 64 + ((c.root + 3) % 12), bar, b, 0.12, 0.45);
      drums(s, bar, 'disco', i === 7);
      bar++;
    });
  });
  s.bars = bar;
  return s;
}

function songPop() {
  seed = 37;
  const s = new Song({ id: 'pop', title: 'Bonne Humeur', bpm: 122, tonic: 2 });
  s.track('drums', 0, 9, { vol: 98, rev: 30 });
  s.track('bass', 33, 0, { vol: 104, rev: 15 });
  s.track('piano', 0, 1, { vol: 86, pan: 54, rev: 45 });
  s.track('marimba', 12, 2, { vol: 100, pan: 76, rev: 50 });
  s.track('glock', 9, 3, { vol: 70, pan: 90, rev: 60 });
  s.track('strings', 48, 4, { vol: 66, pan: 40, rev: 70 });
  const A = progressions(['D', 'A', 'Bm', 'G', 'D', 'A', 'G', 'A']);
  const B = progressions(['Em7', 'A', 'F#m', 'Bm', 'G', 'D', 'Em7', 'A']);
  const form = [A, A, B, A, B, A];
  let bar = 0;
  let prev = null;
  form.forEach((sec, si) => {
    melody(s, 'marimba', bar, sec, 'pop', 74, 0.85);
    if (si >= 2) melody(s, 'glock', bar, sec, 'pop', 86, 0.6);
    sec.forEach((c, i) => {
      const rt = 38 + ((c.root - 2 + 24) % 12) - (c.root > 7 ? 12 : 0);
      for (const [b, l] of [[0, 0.9], [1, 0.4], [1.5, 0.4], [2, 0.9], [3, 0.4], [3.5, 0.4]]) s.note('bass', rt + (b === 3.5 ? 7 : 0), bar, b, l, 0.85);
      const v = voice(c, prev, 62, 3);
      prev = v;
      for (const b of [0, 1, 2, 2.5, 3.5]) for (const n of v) s.note('piano', n, bar, b, 0.45, 0.5);
      if (si >= 2) for (const n of voice(c, null, 70, 3)) s.note('strings', n, bar, 0, 4, 0.35);
      drums(s, bar, 'pop', i === 7);
      bar++;
    });
  });
  s.bars = bar;
  return s;
}

function songLofi() {
  seed = 51;
  const s = new Song({ id: 'lofi', title: 'Fin de Journée', bpm: 80, tonic: 3, swing: 0.32 });
  s.track('drums', 0, 9, { vol: 88, rev: 35 });
  s.track('bass', 32, 0, { vol: 100, rev: 25 });
  s.track('ep', 4, 1, { vol: 94, pan: 54, rev: 60, cho: 60 });
  s.track('gtr', 28, 2, { vol: 70, pan: 84, rev: 50 });
  s.track('lead', 11, 3, { vol: 84, pan: 70, rev: 75 });
  const A = progressions(['Ebmaj7', 'Cm7', 'Fm7', 'Bb7', 'Ebmaj7', 'Cm7', 'Abmaj7', 'Bb7']);
  const B = progressions(['Abmaj7', 'Gm7', 'Fm7', 'Bb7', 'Gm7', 'Cm7', 'Fm7', 'Bb7']);
  const form = [A, B, A, B];
  let bar = 0;
  form.forEach((sec, si) => {
    if (si > 0) melody(s, 'lead', bar, sec, 'lofi', 75, 0.7);
    sec.forEach((c, i) => {
      const rt = 36 + ((c.root - 0 + 24) % 12) - (c.root > 6 ? 12 : 0);
      s.note('bass', rt, bar, 0, 1.6, 0.85);
      s.note('bass', rt + 7, bar, 2.5, 0.9, 0.6);
      s.note('bass', rt + 10 - 12, bar, 3.5, 0.45, 0.5);
      const v = voice(c, null, 63, 4);
      for (const n of v) s.note('ep', n, bar, 0, 1.8, 0.48);
      for (const n of v) s.note('ep', n, bar, 2.5, 1.3, 0.38);
      for (const b of [1, 3]) s.note('gtr', v[v.length - 1] + 12, bar, b, 0.25, 0.4);
      drums(s, bar, 'lofi', i === 7);
      bar++;
    });
  });
  s.bars = bar;
  return s;
}

function songValse() {
  seed = 67;
  const s = new Song({ id: 'accordeon', title: 'Valse du Rayon Frais', bpm: 168, beats: 3, tonic: 7 });
  s.track('bass', 32, 0, { vol: 100, rev: 25 });
  s.track('pizz', 45, 1, { vol: 84, pan: 80, rev: 45 });
  s.track('accordion', 21, 2, { vol: 104, pan: 58, rev: 50 });
  s.track('chords', 21, 3, { vol: 66, pan: 40, rev: 40 });
  s.track('glock', 9, 4, { vol: 62, pan: 90, rev: 60 });
  const A = progressions(['G', 'G', 'D7', 'D7', 'D7', 'D7', 'G', 'G', 'G', 'G7', 'C', 'C', 'G', 'D7', 'G', 'D7']);
  const B = progressions(['Em', 'Em', 'B7', 'B7', 'Em', 'Em', 'A7', 'D7', 'C', 'C', 'G', 'G', 'A7', 'D7', 'G', 'D7']);
  const form = [A, B, A, B];
  let bar = 0;
  form.forEach((sec, si) => {
    melody(s, 'accordion', bar, sec, 'valse', 74, 0.85);
    if (si % 2) melody(s, 'glock', bar, sec, 'valse', 86, 0.5);
    sec.forEach((c) => {
      const rt = 31 + ((c.root - 7 + 24) % 12);
      s.note('bass', rt + (bar % 2 ? 7 : 0), bar, 0, 0.9, 0.85);
      const v = voice(c, null, 62, 3);
      for (const b of [1, 2]) for (const n of v) {
        s.note('chords', n, bar, b, 0.45, 0.45);
        s.note('pizz', n + 12, bar, b, 0.3, 0.45);
      }
      bar++;
    });
  });
  s.bars = bar;
  return s;
}

function songMenu() {
  seed = 79;
  const s = new Song({ id: 'menu', title: 'BAZAR BAZAR — Thème', bpm: 132, tonic: 0 });
  s.track('drums', 0, 9, { vol: 100, rev: 30 });
  s.track('bass', 38, 0, { vol: 98, rev: 15 });
  s.track('brass', 61, 1, { vol: 92, pan: 60, rev: 50 });
  s.track('piano', 0, 2, { vol: 82, pan: 44, rev: 40 });
  s.track('glock', 9, 3, { vol: 78, pan: 84, rev: 60 });
  s.track('strings', 48, 4, { vol: 70, pan: 30, rev: 70 });
  s.track('lead', 56, 5, { vol: 96, pan: 70, rev: 55 });
  const A = progressions(['C', 'G', 'Am', 'F', 'C', 'G', 'F', 'G']);
  const B = progressions(['F', 'G', 'Em7', 'Am', 'Dm7', 'G', 'C', 'G']);
  const form = [A, A, B, A];
  let bar = 0;
  let prev = null;
  form.forEach((sec, si) => {
    melody(s, si % 2 ? 'lead' : 'glock', bar, sec, 'menu', si % 2 ? 72 : 84, 0.85);
    sec.forEach((c, i) => {
      const rt = 36 + ((c.root + 24) % 12) - (c.root > 7 ? 12 : 0);
      for (let b = 0; b < 4; b += 0.5) s.note('bass', rt + (b === 1.5 || b === 3.5 ? 12 : 0), bar, b, 0.4, b % 1 ? 0.65 : 0.85);
      const v = voice(c, prev, 64, 3);
      prev = v;
      for (const b of [0, 0.5, 1.5, 2.5, 3]) for (const n of v) s.note('piano', n, bar, b, 0.35, 0.5);
      if (i % 2 === 0) for (const n of voice(c, null, 67, 3)) s.note('brass', n, bar, 0, 0.4, 0.8);
      if (i % 2 === 1) for (const n of voice(c, null, 67, 3)) s.note('brass', n, bar, 2.5, 1.2, 0.7);
      for (const n of voice(c, null, 74, 3)) s.note('strings', n, bar, 0, 4, 0.33);
      drums(s, bar, 'menu', i === 7);
      bar++;
    });
  });
  s.bars = bar;
  return s;
}

// ------------------------------------------------------------------ rendu
const sr = 44100;
const sfBuf = fs.readFileSync(require.resolve('generaluser/GeneralUser.sf2'));
const bank = SoundBankLoader.fromArrayBuffer(sfBuf.buffer.slice(sfBuf.byteOffset, sfBuf.byteOffset + sfBuf.byteLength));

async function render(song) {
  // le morceau est joué deux fois : on garde la 2e passe, qui commence avec la réverbération de la fin
  // de la 1re → boucle sans couture
  const len = song.length;
  const once = song.midi.toArray();
  const m1 = new Midi(once);
  const doubled = new Midi();
  doubled.header = m1.header;
  for (const t of m1.tracks) {
    const t2 = doubled.addTrack();
    t2.name = t.name;
    t2.channel = t.channel;
    t2.instrument.number = t.instrument.number;
    for (const [num, list] of Object.entries(t.controlChanges)) for (const cc of list) t2.addCC({ number: Number(num), value: Math.round(cc.value * 127), time: cc.time });
    for (const n of t.notes) {
      t2.addNote({ midi: n.midi, time: n.time, duration: n.duration, velocity: n.velocity });
      t2.addNote({ midi: n.midi, time: n.time + len, duration: n.duration, velocity: n.velocity });
    }
  }
  const bytes = doubled.toArray();
  fs.writeFileSync(path.join(TMP, `${song.id}.mid`), bytes);
  const midi = BasicMIDI.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const synth = new SpessaSynthProcessor(sr, { enableEffects: true });
  synth.soundBankManager.addSoundBank(bank, 'main');
  await synth.processorInitialized;
  const seq = new SpessaSynthSequencer(synth);
  seq.loadNewSongList([midi]);
  seq.play();
  const total = Math.ceil(len * 2 * sr);
  const L = new Float32Array(total);
  const R = new Float32Array(total);
  for (let i = 0; i < total; i += 128) {
    seq.processTick();
    synth.process(L, R, i, Math.min(128, total - i));
  }
  const a = Math.round(len * sr);
  const b = a + Math.round(len * sr);
  const l2 = L.slice(a, b);
  const r2 = R.slice(a, b);
  // normalisation douce (crête à -1 dBFS)
  let peak = 0;
  for (let i = 0; i < l2.length; i++) peak = Math.max(peak, Math.abs(l2[i]), Math.abs(r2[i]));
  const g = peak > 0 ? 0.89 / peak : 1;
  for (let i = 0; i < l2.length; i++) {
    l2[i] *= g;
    r2[i] *= g;
  }
  const wav = path.join(TMP, `${song.id}.wav`);
  fs.writeFileSync(wav, Buffer.from(audioToWav([l2, r2], sr)));
  const ogg = path.join(OUT, `${song.id}.ogg`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-c:a', 'libopus', '-b:a', '80k', '-vbr', 'on', ogg]);
  return { id: song.id, title: song.title, bpm: song.bpm, loop: Math.round(len * 1000) / 1000, bytes: fs.statSync(ogg).size };
}

const songs = [songMenu(), songBossa(), songPop(), songDisco(), songValse(), songLofi()];
const manifest = [];
for (const s of songs) {
  const t0 = Date.now();
  const r = await render(s);
  manifest.push(r);
  console.log(`${r.id.padEnd(10)} ${r.title.padEnd(24)} ${r.loop.toFixed(1)} s  ${(r.bytes / 1024).toFixed(0)} Ko  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
fs.writeFileSync(path.join(OUT, 'music.json'), JSON.stringify(manifest, null, 2));
fs.writeFileSync(
  path.join(OUT, 'CREDITS.txt'),
  'Musiques composées pour BAZAR BAZAR (scripts/compose-music.mjs), jouées avec la banque de sons GeneralUser GS v1.471 (S. Christian Collins, licence libre y compris commerciale) via spessasynth_core (Apache-2.0).\n',
);
