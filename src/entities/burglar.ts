/**
 * Cambrioleurs nocturnes incarnés : ils arrivent par la cour de livraison, forcent la porte de quai
 * (plus longtemps si elle est renforcée), déclenchent l'alarme s'il y a des détecteurs, pillent caisses
 * et réserve, puis s'enfuient. Le joueur, un agent de nuit ou la police peuvent les interrompre.
 */
import { PRODUCT_BY_ID } from '../data/products';
import { BARKS } from '../data/lines';
import { Rng } from '../core/rng';
import { money } from '../core/math';
import { equipCenter } from '../sim/layout';
import { detectorsCover } from '../sim/security';
import { insuranceClaim, spend } from '../sim/economy';
import { randomAppearance } from './character';
import { Agent } from './agent';
import { cartonObject } from './items';
import type { Carton } from '../sim/state';
import type { Game } from '../game/game';

type BState = 'approach' | 'forcing' | 'inside' | 'loot' | 'escape' | 'fled' | 'caught';

export class Burglar extends Agent {
  readonly kind = 'special' as const;
  state: BState = 'approach';
  private t = 0;
  loot: Carton[] = [];
  cash = 0;
  private target: { x: number; z: number; kind: 'till' | 'rack'; uid: number } | null = null;

  constructor(game: Game, x: number, z: number, private crew: BurglaryRun) {
    super(game, !game.needsLook ? null : randomAppearance(new Rng(Math.floor(Math.random() * 1e9)), { female: false, age: 25 }), x, z);
    if (this.app) {
      this.app.top = 0x111111;
      this.app.bottom = 0x111111;
      this.app.hat = 'bonnet';
      this.app.hatColor = 0x1a1a1a;
    }
    this.name = 'Individu cagoulé';
    this.navOpts = { staff: true, keys: true };
    this.walkSpeed = 1.6;
    this.running = false;
  }

  update(dt: number) {
    this.t += dt;
    const g = this.game;
    const r = g.storeRect();
    // fuite si le joueur ou un agent approche
    if (this.state !== 'escape' && this.state !== 'caught' && this.state !== 'fled' && this.state !== 'approach') {
      const pp = g.player.pos;
      const guard = g.staff.present('securite')[0];
      if (Math.hypot(pp.x - this.pos.x, pp.z - this.pos.z) < 6 || (guard && guard.distTo(this.pos.x, this.pos.z) < 7)) this.escape('Repéré !');
    }
    switch (this.state) {
      case 'approach':
        if (!this.path) this.setGoal(r.dockDoorX + (Math.random() - 0.5), r.z1 + 1.2);
        if (this.moveAlong(dt) !== 'moving') {
          this.state = 'forcing';
          this.t = 0;
          this.play('crouch');
        }
        return;
      case 'forcing': {
        this.faceTowards(r.dockDoorX, r.z1, dt);
        if (Math.random() < dt * 0.8) g.bus.emit('sfx', { name: 'thud', x: this.pos.x, z: this.pos.z });
        const needed = g.st.store.upgrades['portes_renforcees'] ? 75 : 25;
        if (this.t > needed) {
          this.crew.breakIn();
          this.stopAct();
          this.state = 'inside';
        }
        return;
      }
      case 'inside': {
        this.target = this.crew.nextTarget(this);
        if (!this.target) return this.escape();
        this.setGoal(this.target.x, this.target.z);
        this.state = 'loot';
        this.t = 0;
        return;
      }
      case 'loot': {
        if (this.moveAlong(dt) === 'moving') return;
        this.play('reach');
        if (this.t < 4) return;
        const tg = this.target!;
        const e = g.st.equipment.find((x) => x.uid === tg.uid);
        if (e && tg.kind === 'till' && e.till) {
          this.cash += e.till;
          g.st.cash -= e.till;
          e.till = 0;
        } else if (e && tg.kind === 'rack' && e.cartons?.length) {
          e.cartons.sort((a, b) => (PRODUCT_BY_ID[b.pid].theftAppeal ?? 0) - (PRODUCT_BY_ID[a.pid].theftAppeal ?? 0));
          this.loot.push(e.cartons.shift()!);
          g.equipView.markDirty();
          if (!g.headless) this.attachCarry(cartonObject(this.loot[0].pid, false));
        }
        this.state = this.loot.length >= 2 || this.cash > 0 ? 'escape' : 'inside';
        if (this.state === 'escape') this.escape();
        return;
      }
      case 'escape':
        if (this.moveAlong(dt) !== 'moving') {
          this.state = 'fled';
          this.crew.fled(this);
          this.dead = true;
        }
        return;
      default:
        return;
    }
  }

  escape(why?: string) {
    if (this.state === 'escape') return;
    this.state = 'escape';
    this.running = true;
    if (why) this.say('🏃', why, 2);
    this.stopAct();
    this.setGoal(-40, 46);
  }

  /** Interpellé (joueur ou agent) : butin récupéré. */
  getCaught(by: string) {
    if (this.state === 'caught') return;
    this.state = 'caught';
    this.stopMoving();
    this.play('shrug');
    this.say('😰', BARKS.theftCaught[0], 3);
    this.crew.caught(this, by);
    setTimeout(() => (this.dead = true), 4000);
  }
}

/** Orchestration d'un cambriolage (équipe, alarme, police, bilan). */
export class BurglaryRun {
  members: Burglar[] = [];
  alarm = false;
  private policeT = -1;
  done = false;
  private recovered = 0;
  private stolen = 0;
  private claimed = new Set<number>();

  constructor(private game: Game) {}

  start() {
    const g = this.game;
    const r = g.storeRect();
    const n = 2;
    for (let i = 0; i < n; i++) this.members.push(g.agents.add(new Burglar(g, -10 + i, 40 + i * 0.5, this)));
    g.bus.emit('notify', { text: '🌙 Des silhouettes rôdent dans la cour de livraison…', kind: 'event' });
    void r;
  }

  breakIn() {
    const g = this.game;
    const st = g.st;
    if (this.alarm) return;
    const r = g.storeRect();
    spend(st, 'entretien', st.store.upgrades['portes_renforcees'] ? 250 : 650);
    const armed = !!st.store.upgrades['alarme'] && st.store.alarmArmed && detectorsCover(st, r.dockDoorX, r.z1 - 1);
    if (armed) {
      this.alarm = true;
      g.bus.emit('sfx', { name: 'alarm', x: r.dockDoorX, z: r.z1 });
      g.bus.emit('notify', { text: '🚨 ALARME ! Effraction par la porte de quai !', kind: 'bad' });
      this.policeT = st.store.upgrades['telesurveillance'] ? 60 : 140;
      for (const b of this.members) if (Math.random() < 0.5) b.escape('L’alarme ! On se tire !');
    } else g.bus.emit('notify', { text: '🔓 La porte de quai a été fracturée !', kind: 'bad' });
    st.stats.burglaries++;
  }

  nextTarget(b: Burglar): { x: number; z: number; kind: 'till' | 'rack'; uid: number } | null {
    const st = this.game.st;
    const tills = st.equipment.filter((e) => (e.till ?? 0) > 0 && !this.claimed.has(e.uid));
    const racks = st.equipment.filter((e) => e.cartons?.length && !this.claimed.has(e.uid));
    const e = tills[0] ?? racks.sort((a, c) => (c.cartons!.length - a.cartons!.length))[0];
    if (!e) return null;
    this.claimed.add(e.uid);
    const c = equipCenter(e);
    const p = this.game.nav.nearestWalkable(c.x, c.z + (e.def === 'caisse' ? 1.2 : -1.1), b.navOpts) ?? c;
    return { x: p.x, z: p.z, kind: (e.till ?? 0) > 0 ? 'till' : 'rack', uid: e.uid };
  }

  fled(b: Burglar) {
    for (const c of b.loot) this.stolen += PRODUCT_BY_ID[c.pid].cost * c.q;
    this.stolen += b.cash;
    this.check();
  }

  caught(b: Burglar, by: string) {
    const st = this.game.st;
    for (const c of b.loot) {
      const rack = st.equipment.find((e) => e.cartons && e.cartons.length < 24);
      if (rack) rack.cartons!.push(c);
      this.recovered += PRODUCT_BY_ID[c.pid].cost * c.q;
    }
    if (b.cash) {
      st.cash += b.cash;
      this.recovered += b.cash;
    }
    b.loot = [];
    b.cash = 0;
    b.attachCarry(null);
    st.stats.thievesCaught++;
    this.game.equipView.markDirty();
    this.game.bus.emit('notify', { text: `✅ Cambrioleur maîtrisé par ${by} ! Butin récupéré.`, kind: 'good' });
    this.check();
  }

  private check() {
    if (this.done || this.members.some((m) => !m.dead && m.state !== 'fled' && m.state !== 'caught')) return;
    this.done = true;
    const g = this.game;
    const loss = this.stolen + (g.st.store.upgrades['portes_renforcees'] ? 250 : 650);
    const paid = this.stolen > 0 ? insuranceClaim(g.st, loss) : 0;
    g.security.log({ kind: 'cambriolage', text: `Cambriolage nocturne : ${money(this.stolen)} emportés, ${money(this.recovered)} récupérés.${this.alarm ? ' Alarme déclenchée.' : ''}`, loss, onCamera: g.security.refreshCameras().count > 0 });
    g.st.reputation.securite = Math.max(0, g.st.reputation.securite - (this.stolen > 0 ? 6 : 1));
    g.bus.emit('notify', { text: this.stolen > 0 ? `🚨 Bilan du cambriolage : ${money(this.stolen)} volés${paid ? ` (assurance +${money(paid)})` : ''}.` : '🛡️ Cambriolage déjoué : rien n’a été emporté.', kind: this.stolen > 0 ? 'bad' : 'good' });
  }

  update(dt: number) {
    if (this.policeT > 0) {
      this.policeT -= dt;
      if (this.policeT <= 0) {
        this.game.vehicles.spawnPolice();
        for (const b of this.members) if (!b.dead && b.state !== 'escape' && b.state !== 'caught') b.escape('Les flics !');
        // la police rattrape parfois les retardataires
        for (const b of this.members) if (!b.dead && b.state === 'escape' && Math.random() < 0.4) b.getCaught('la police');
      }
    }
    // un agent de nuit poursuit
    for (const gd of this.game.staff.present('securite'))
      for (const b of this.members)
        if (!b.dead && b.state !== 'caught' && gd.distTo(b.pos.x, b.pos.z) < 1.4 && Math.random() < 0.6) b.getCaught(`l’agent ${gd.emp.name}`);
  }
}
