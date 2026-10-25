/**
 * Personnages et situations spéciales : inspecteurs, influenceur, client furieux, rôdeurs devant l'entrée,
 * police, chat mascotte. Tous agissent physiquement dans le monde.
 */
import * as THREE from 'three';
import { LOITER_SPOTS } from '../data/world';
import { BARKS } from '../data/lines';
import { Rng } from '../core/rng';
import { clamp01 } from '../core/math';
import { slotInfo, storeRect } from '../sim/layout';
import { randomAppearance } from './character';
import { Agent } from './agent';
import { Customer } from './customer';
import { box, mat } from '../world/materials';
import type { Game } from '../game/game';

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

/** Inspecteur : visite plusieurs rayons en prenant des notes, puis repart. */
export class Inspector extends Agent {
  readonly kind = 'special' as const;
  private stops = 0;
  private t = 0;
  private phase: 'in' | 'inspect' | 'out' = 'in';
  constructor(game: Game, x: number, z: number, public role: 'sanitaire' | 'securite') {
    super(game, game.headless ? null : randomAppearance(new Rng(Math.floor(Math.random() * 1e9)), { female: Math.random() < 0.5, age: 45 }), x, z);
    if (this.rig) {
      this.rig.app.top = 0x2d3436;
      const board = new THREE.Group();
      box(board, 0.22, 0.3, 0.02, 0, -0.15, 0, mat(0x8d6e63));
      box(board, 0.18, 0.24, 0.005, 0, -0.12, 0.012, mat(0xffffff));
      this.attachHand(board);
    }
    this.name = role === 'sanitaire' ? 'Inspecteur sanitaire' : 'Inspectrice sécurité';
    this.navOpts = { staff: true, keys: true };
    this.walkSpeed = 1.1;
    this.next();
  }
  private next(): void {
    const st = this.game.st;
    if (this.stops >= 5) {
      this.phase = 'out';
      const d = this.game.storeDoor();
      this.setGoal(d.x, d.outsideZ - 6);
      return;
    }
    const shelves = st.equipment.filter((e) => e.slots);
    const e = shelves[Math.floor(Math.random() * shelves.length)];
    if (!e) {
      this.stops = 5;
      return this.next();
    }
    const inf = slotInfo(e, 0);
    this.setGoal(inf.access.x, inf.access.z);
    this.phase = 'inspect';
  }
  update(dt: number) {
    const r = this.moveAlong(dt);
    if (r === 'moving') return;
    if (this.phase === 'out') {
      this.dead = true;
      return;
    }
    this.t += dt;
    this.anim?.play('write');
    if (this.t > 3.5) {
      this.t = 0;
      this.stops++;
      if (Math.random() < 0.3) this.say('📋', pick(['Hmm. Intéressant.', 'Je note.', 'C’est quoi, cette tache ?', 'Température conforme… pour l’instant.']), 2);
      this.anim?.stop();
      this.next();
    }
  }
}

/** Groupe qui traîne devant l'entrée. */
export class Loiterer extends Agent {
  readonly kind = 'special' as const;
  leaving = false;
  private t = Math.random() * 5;
  constructor(game: Game, x: number, z: number, public spot: { x: number; z: number }) {
    super(game, game.headless ? null : randomAppearance(new Rng(Math.floor(Math.random() * 1e9)), { female: Math.random() < 0.25, age: 17 + Math.floor(Math.random() * 6) }), x, z);
    this.name = 'Jeune du quartier';
    this.setGoal(spot.x + (Math.random() - 0.5) * 2, spot.z + (Math.random() - 0.5) * 2);
  }
  update(dt: number) {
    const r = this.moveAlong(dt);
    if (this.leaving) {
      if (r !== 'moving') this.dead = true;
      return;
    }
    if (r === 'moving') return;
    this.t += dt;
    this.faceTowards(this.spot.x, this.spot.z, dt, 2);
    if (this.t > 5) {
      this.t = 0;
      this.anim?.play(pick(['talk', 'idle', 'dance', 'phone', 'shrug']));
      if (Math.random() < 0.25) this.say(pick(['🎵', '😂', '🗣️', '🛴']), undefined, 2);
    }
  }
  leave() {
    this.leaving = true;
    this.anim?.stop();
    this.setGoal(-40, -30);
  }
}

/** Chat mascotte (modèle simple, se promène et dort sur les cartons). */
export class Cat extends Agent {
  readonly kind = 'special' as const;
  private mesh: THREE.Group | null = null;
  private t = 0;
  constructor(game: Game, x: number, z: number) {
    super(game, null, x, z);
    this.name = game.st.flags.cat?.name ?? 'Chat';
    this.navOpts = { staff: true, keys: true };
    this.walkSpeed = 0.7;
    if (!game.headless) {
      const g = new THREE.Group();
      const fur = mat(0xe67e22, { rough: 1 });
      box(g, 0.18, 0.18, 0.42, 0, 0.12, 0, fur);
      box(g, 0.17, 0.16, 0.16, 0, 0.26, 0.26, fur);
      for (const s of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.07, 4), fur);
        ear.position.set(s * 0.05, 0.45, 0.26);
        g.add(ear);
        for (const zz of [-0.15, 0.15]) box(g, 0.04, 0.12, 0.04, s * 0.06, 0, zz, fur);
      }
      const tail = box(g, 0.03, 0.03, 0.3, 0, 0.25, -0.32, fur);
      tail.rotation.x = 0.6;
      this.mesh = g;
      game.scene.add(g);
    }
  }
  update(dt: number) {
    this.t -= dt;
    if (this.moveAlong(dt) !== 'moving' && this.t <= 0) {
      this.t = 6 + Math.random() * 15;
      const r = storeRect(this.game.st.store.stage);
      const x = r.x0 + 1 + Math.random() * (r.x1 - r.x0 - 2);
      const z = 1 + Math.random() * (r.z1 - 2);
      this.setGoal(x, z);
      if (Math.random() < 0.2) this.say('🐾', Math.random() < 0.5 ? 'Miaou.' : 'Mrrrrp ?', 2);
    }
  }
  override syncView(dt: number) {
    super.syncView(dt, null);
    if (this.mesh) {
      this.mesh.position.set(this.pos.x, 0, this.pos.z);
      this.mesh.rotation.y = this.yaw;
    }
  }
  override dispose() {
    if (this.mesh) this.game.scene.remove(this.mesh);
    super.dispose();
  }
}

export class SpecialsManager {
  angry: Customer[] = [];
  loiterers: Loiterer[] = [];
  cat: Cat | null = null;

  constructor(private game: Game) {}

  spawn(kind: string) {
    const g = this.game;
    const d = g.storeDoor();
    switch (kind) {
      case 'inspecteur_sanitaire':
      case 'inspecteur_securite':
        g.agents.add(new Inspector(g, d.x + 6, -14, kind === 'inspecteur_sanitaire' ? 'sanitaire' : 'securite'));
        break;
      case 'influenceur': {
        const c = g.spawnCustomer(null, { archetype: 'actif', from: { x: d.x - 10, z: -14.5 } });
        if (c) {
          c.special = 'influenceur';
          c.name = 'Kévin_ShoppingFou';
          c.budget = 80;
          c.say('🤳', 'Salut la team ! Aujourd’hui on teste une supérette…', 4);
        }
        break;
      }
      case 'client_furieux': {
        const c = g.spawnCustomer(null, { archetype: 'actif', from: { x: d.x + 8, z: -14.5 } });
        if (c) {
          c.special = 'furieux';
          c.name = 'Client furieux';
          this.angry.push(c);
        }
        break;
      }
      case 'rodeurs': {
        const spot = { x: LOITER_SPOTS[0][0], z: LOITER_SPOTS[0][1] };
        for (let i = 0; i < 3; i++) this.loiterers.push(g.agents.add(new Loiterer(g, -35 + i, -14.5, spot)));
        break;
      }
      case 'police':
        g.vehicles.spawnPolice();
        for (const l of this.loiterers) l.leave();
        this.loiterers = [];
        break;
      case 'chat': {
        const r = g.storeRect();
        this.cat = g.agents.add(new Cat(g, r.staffDoorX + 1, r.backZ + 1.5));
        break;
      }
    }
  }

  angryCustomers() {
    this.angry = this.angry.filter((c) => !c.dead && !c.calmed);
    return this.angry;
  }

  /** Comportement du client furieux : il se plante près des caisses et râle (fort). */
  rant(c: Customer, dt: number) {
    const g = this.game;
    const anyC = c as any;
    anyC._rantT = (anyC._rantT ?? 0) + dt;
    if (!anyC._rantSpot) {
      const w = g.checkoutWaitPoint();
      anyC._rantSpot = w;
      c.setGoal(w.x, w.z);
    }
    if (c.moveAlong(dt) === 'moving') return;
    c.anim?.play(Math.sin(anyC._rantT) > 0 ? 'angry' : 'talk');
    if (Math.floor(anyC._rantT / 5) !== Math.floor((anyC._rantT - dt) / 5)) c.say('🤬', pick(['JE VEUX VOIR LE RESPONSABLE !', 'C’est un SCANDALE !', 'Votre promo était affichée hier !', 'Je filme tout, hein !', 'Je connais mes droits !']), 3.5);
    if (!g.events.isActive('client_furieux')) {
      g.st.reputation.service = Math.max(0, g.st.reputation.service - 5);
      g.bus.emit('notify', { text: '📱 Le client furieux est parti… et sa vidéo tourne déjà dans le quartier (réputation service −5).', kind: 'bad' });
      for (const r of g.st.residents) if (Math.random() < 0.15) r.loyalty.player = clamp01(r.loyalty.player - 0.05);
      c.goLeave(false);
    }
  }

  calm(c: Customer, by: string) {
    if (c.calmed) return;
    c.calmed = true;
    c.special = null;
    c.anim?.stop();
    c.say('😌', 'Bon… d’accord. Merci de m’avoir écouté.', 3);
    this.game.st.reputation.service = Math.min(100, this.game.st.reputation.service + 3);
    this.game.bus.emit('notify', { text: `🕊️ ${by} a calmé le client furieux. Il reprend ses courses (et range son téléphone).`, kind: 'good' });
    const ev = this.game.st.activeEvents.find((e) => e.id === 'client_furieux');
    if (ev) ev.end = this.game.st.time;
    c.state = 'deciding';
  }

  influencerVerdict(c: Customer, s: number) {
    const st = this.game.st;
    if (s > 0.62) {
      for (const r of st.residents) r.awareness = clamp01(r.awareness + 0.25);
      st.reputation.ambiance = Math.min(100, st.reputation.ambiance + 6);
      this.game.bus.emit('notify', { text: '🌟 Vidéo de Kévin_ShoppingFou : « Meilleure supérette du 9-3, je valide ! » Le quartier afflue !', kind: 'good' });
    } else if (s < 0.45) {
      st.reputation.overall = Math.max(0, st.reputation.overall - 6);
      st.reputation.ambiance = Math.max(0, st.reputation.ambiance - 8);
      this.game.bus.emit('notify', { text: '💀 Vidéo de Kévin_ShoppingFou : « J’ai survécu à la supérette de l’enfer… » 180 000 vues. Aïe.', kind: 'bad' });
    } else this.game.bus.emit('notify', { text: '🤷 Kévin_ShoppingFou trouve votre magasin « sympa sans plus ». Vidéo tiède.', kind: 'info' });
  }

  /** Le joueur discute avec les rôdeurs. */
  talkToLoiterers(): string {
    const st = this.game.st;
    for (const l of this.loiterers) l.leave();
    this.loiterers = [];
    const ev = st.activeEvents.find((e) => e.id === 'rodeurs');
    if (ev) ev.end = st.time;
    for (const r of st.residents) if (r.quartier === 'tilleuls' && Math.random() < 0.3) r.loyalty.player = clamp01(r.loyalty.player + 0.03);
    if (Math.random() < 0.35) {
      st.jobPostings.push({ role: 'rayon', until: Math.floor(st.time / 1440) + 2, wage: 12.2 });
      return 'Vous discutez. L’un d’eux demande s’il y a du boulot : une candidature va arriver ! Les autres s’en vont tranquillement.';
    }
    return pick(['Vous parlez foot dix minutes. Ils partent en vous saluant.', 'Ils vous trouvent « cool pour un patron ». Ils s’éloignent.', 'Vous offrez des canettes. Paix sociale achetée pour 3,16 €.']);
  }

  update() {
    this.loiterers = this.loiterers.filter((l) => !l.dead);
    if (!this.game.events.isActive('rodeurs') && this.loiterers.length) {
      for (const l of this.loiterers) l.leave();
      this.loiterers = [];
    }
    if (this.game.st.flags.cat && (!this.cat || this.cat.dead)) this.spawn('chat');
  }

  /** Malus de sécurité perçue tant que des rôdeurs sont devant l'entrée. */
  get loitering() {
    return this.loiterers.length > 0;
  }
}

export const _barks = BARKS;
