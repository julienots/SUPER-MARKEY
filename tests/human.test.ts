import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import { loadHumanKit, buildHuman, humanKitReady } from '../src/entities/human';
import { randomAppearance, buildCharacter } from '../src/entities/character';
import { Rng } from '../src/core/rng';

beforeAll(async () => {
  // le kit est servi par Vite dans le navigateur ; en test on le lit sur le disque
  (globalThis as any).fetch = async (u: string) => {
    const b = fs.readFileSync('public/humans/' + u.split('/').pop());
    return { ok: true, json: async () => JSON.parse(b.toString()), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
  };
  expect(await loadHumanKit('./humans/')).toBe(true);
});

describe('personnages réalistes (kit MakeHuman)', () => {
  it('le kit est chargé et cohérent', () => {
    expect(humanKitReady()).toBe(true);
  });

  it('la taille demandée est respectée et le squelette est plausible', () => {
    for (let i = 0; i < 12; i++) {
      const a = randomAppearance(new Rng(100 + i), { female: i % 2 === 0, age: 18 + i * 5 });
      const hb = buildHuman(a, true)!;
      const p = hb.geo.attributes.position.array as Float32Array;
      let minY = 9;
      let maxY = -9;
      for (let k = 1; k < p.length; k += 3) {
        minY = Math.min(minY, p[k]);
        maxY = Math.max(maxY, p[k]);
      }
      // pieds au sol, sommet du crâne à la taille voulue (à quelques cm près : épaisseur des cheveux/semelles)
      expect(minY).toBeGreaterThan(-0.03);
      expect(Math.abs(maxY - a.height)).toBeLessThan(0.04);
      const hipsY = hb.rest.hips.y;
      expect(hipsY / a.height).toBeGreaterThan(0.44);
      expect(hipsY / a.height).toBeLessThan(0.6);
      // bras le long du corps : la main est sous l'épaule
      expect(hb.rest.elbowL.y).toBeLessThan(-0.1);
      expect(hb.rest.handL.y).toBeLessThan(-0.1);
      expect(hb.expressions).toEqual(['smile', 'sad', 'angry', 'surprised', 'open', 'blink']);
    }
  });

  it('deux habitants différents ont des morphologies différentes', () => {
    const a = randomAppearance(new Rng(1), { female: false, age: 30 });
    const b = randomAppearance(new Rng(2), { female: false, age: 30 });
    b.height = a.height;
    const pa = buildHuman(a, false)!.geo.attributes.position.array as Float32Array;
    const pb = buildHuman(b, false)!.geo.attributes.position.array as Float32Array;
    let diff = 0;
    for (let k = 0; k < pa.length; k++) diff = Math.max(diff, Math.abs(pa[k] - pb[k]));
    expect(diff).toBeGreaterThan(0.01);
  });

  it('les origines sont variées sur une population', () => {
    const tally = { afr: 0, asi: 0, cau: 0 };
    for (let i = 0; i < 400; i++) {
      const b = randomAppearance(new Rng(1000 + i), { female: i % 2 === 0, age: 35 }).body!;
      const m = Math.max(b.african, b.asian, b.caucasian);
      if (m === b.african) tally.afr++;
      else if (m === b.asian) tally.asi++;
      else tally.cau++;
    }
    expect(tally.afr).toBeGreaterThan(60);
    expect(tally.asi).toBeGreaterThan(20);
    expect(tally.cau).toBeGreaterThan(120);
  });

  it('un personnage complet se construit (accessoires, os, expressions)', () => {
    const a = randomAppearance(new Rng(7), { female: true, age: 40 });
    a.hat = 'bonnet';
    a.glasses = true;
    const rig = buildCharacter(a);
    expect(rig.rest).toBeTruthy();
    expect(rig.face).toBeTypeOf('function');
    rig.face!('happy', 1, true);
    expect(rig.mesh.morphTargetInfluences![0]).toBeGreaterThan(0.5);
    expect(rig.mesh.skeleton.bones.length).toBe(21);
    rig.dispose();
  });
});
