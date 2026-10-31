/**
 * Sécurité en jeu : décision de vol selon les observateurs (vigiles, employés, joueur, caméras),
 * portiques antivol, poursuites, interpellations, preuves vidéo, cambriolages nocturnes.
 */
import { PRODUCT_BY_ID } from '../data/products';
import { money } from '../core/math';
import { slotInfo, equipCenter } from '../sim/layout';
import { takeFromSlot, addToSlot, slotsForProduct, freeSpace } from '../sim/inventory';
import { CameraIndex, deterrence, liveDetectionChance, burglaryRisk, detectorsCover } from '../sim/security';
import { insuranceClaim, spend } from '../sim/economy';
import { allocUid, dayOf, minuteOfDay, type Incident, type PlacedEquip } from '../sim/state';
import { G_STATIC, groups } from '../physics/physics';
import type { Customer } from '../entities/customer';
import type { Game } from './game';

export class SecurityRuntime {
  cams: CameraIndex | null = null;
  private camSig = '';

  constructor(private game: Game) {}

  refreshCameras() {
    const sig = this.game.st.equipment.filter((e) => e.def === 'camera' || EQUIPMENT_HEIGHT.has(e.def)).map((e) => `${e.uid}:${e.gx}:${e.gz}:${e.rot}:${e.broken}`).join(',') + this.game.st.store.stage;
    if (sig !== this.camSig || !this.cams) {
      this.camSig = sig;
      this.cams = new CameraIndex(this.game.st);
    }
    return this.cams;
  }

  guards() {
    return this.game.staff.present('securite').filter((a) => a.state !== 'monitor' && a.state !== 'break');
  }

  monitorAgent() {
    return this.game.staff.present('securite').find((a) => a.state === 'monitor') ?? null;
  }

  deterrence(): number {
    return deterrence(this.game.st, this.guards().length, this.refreshCameras().count);
  }

  /** Ligne de vue entre deux points à hauteur d'yeux (murs et meubles hauts bloquent). */
  lineOfSight(ax: number, az: number, bx: number, bz: number, ay = 1.6, by = 1.2): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.5) return true;
    const hit = this.game.physics.raycast({ x: ax, y: ay, z: az }, { x: dx / d, y: dy / d, z: dz / d }, d - 0.3, groups(0xffff, G_STATIC));
    return !hit;
  }

  /**
   * Le client malhonnête évalue le risque puis dissimule (ou renonce).
   * Renvoie true si un article a été volé (ou une tentative a eu lieu).
   */
  attemptTheft(c: Customer, e: PlacedEquip, idx: number): boolean {
    const g = this.game;
    const st = g.st;
    const x = c.pos.x;
    const z = c.pos.z;
    // perception du risque par le voleur
    let watchers = 0;
    for (const gd of this.guards()) if (gd.distTo(x, z) < 9 && this.lineOfSight(gd.pos.x, gd.pos.z, x, z)) watchers += 1.5;
    for (const em of g.staff.present()) if (em.emp.role !== 'securite' && em.distTo(x, z) < 4.5) watchers += 0.7;
    const p = g.player;
    if (p.inStore && Math.hypot(p.pos.x - x, p.pos.z - z) < 6) watchers += 1;
    const cams = this.refreshCameras();
    const onCam = cams.sees(x, z);
    if (onCam) watchers += 0.35;
    if (watchers > 1.2 && Math.random() < 0.8) {
      c.say('😇', undefined, 1.5);
      return false; // trop risqué : il se comporte normalement
    }
    const it = takeFromSlot(e, idx);
    if (!it) return false;
    c.stolen.push({ pid: it.pid, exp: it.exp, concealed: true });
    c.play('conceal');
    g.equipView.markDirty();
    const pd = PRODUCT_BY_ID[it.pid];
    // détection
    for (const gd of this.guards()) {
      if (gd.distTo(x, z) < 11 && this.lineOfSight(gd.pos.x, gd.pos.z, x, z) && Math.random() < gd.vigilance) {
        c.suspect = true;
        gd.chase(c);
        g.bus.emit('notify', { text: `🛡️ ${gd.emp.name} a repéré un vol (${pd.name}) et intervient !`, kind: 'event' });
        return true;
      }
    }
    if (g.player.canSee(x, 1.2, z, 14)) {
      c.suspect = true;
      c.say('❗', undefined, 6);
      g.bus.emit('notify', { text: `👀 Vous avez vu quelqu’un glisser « ${pd.name} » dans sa veste ! Interpellez-le (E) avant la sortie.`, kind: 'event' });
      return true;
    }
    const mon = this.monitorAgent();
    if (onCam && Math.random() < liveDetectionChance(true, { monitorStaffed: !!mon, monitorVigilance: mon?.vigilance ?? 0 })) {
      c.suspect = true;
      c.say('❗', undefined, 6);
      const gd = this.guards()[0];
      if (gd) gd.chase(c);
      g.bus.emit('notify', { text: `📹 Vol repéré sur les caméras par ${mon!.emp.name} !${gd ? ' Un agent intervient.' : ' Interpellez le suspect (E).'}`, kind: 'event' });
      return true;
    }
    c.onCameraTheft = c.onCameraTheft || onCam;
    return true;
  }

  /** Passage des portiques à la sortie. */
  exitCheck(c: Customer) {
    const g = this.game;
    const st = g.st;
    const gates = st.equipment.filter((e) => e.def === 'portique' && !e.broken);
    const door = g.storeDoor();
    const nearGate = gates.some((e) => {
      const gc = equipCenter(e);
      return Math.hypot(gc.x - door.x, gc.z) < 7;
    });
    const tagged = st.store.upgrades['antivol_tags'] && c.stolen.some((s) => (PRODUCT_BY_ID[s.pid].theftAppeal ?? 0) >= 0.4 || PRODUCT_BY_ID[s.pid].price >= 4);
    if (nearGate && tagged) {
      g.bus.emit('sfx', { name: 'alarm', x: c.pos.x, z: c.pos.z });
      g.bus.emit('notify', { text: '🚨 BIP BIP BIP ! Le portique antivol sonne ! Le client prend la fuite…', kind: 'bad' });
      c.suspect = true;
      c.flee();
      const gd = this.guards().sort((a, b) => a.distTo(c.pos.x, c.pos.z) - b.distTo(c.pos.x, c.pos.z))[0];
      if (gd) gd.chase(c);
      else for (const em of g.staff.present()) if (em.distTo(c.pos.x, c.pos.z) < 8 && em.emp.traits.includes('zele')) em.chase(c);
    }
  }

  theftSucceeded(c: Customer) {
    const g = this.game;
    const st = g.st;
    if (!c.stolen.length) return;
    const loss = c.stolen.reduce((a, s) => a + PRODUCT_BY_ID[s.pid].cost, 0);
    st.today.theftLoss += loss;
    this.log({ kind: 'vol', text: `Vol à l’étalage : ${c.stolen.map((s) => PRODUCT_BY_ID[s.pid].name).join(', ')} (${money(loss)})${c.onCameraTheft ? ' — filmé' : ''}`, loss, onCamera: !!c.onCameraTheft, x: c.pos.x, z: c.pos.z, suspect: c.resident?.id });
    if (c.suspect) g.bus.emit('notify', { text: `💨 Le voleur s’est échappé avec ${money(loss)} de marchandise.`, kind: 'bad' });
    c.stolen = [];
  }

  recoverStolen(c: Customer, by: string) {
    const g = this.game;
    const st = g.st;
    const items = [...c.stolen, ...c.basket.filter((b) => b.concealed)];
    let value = 0;
    for (const s of items) {
      value += PRODUCT_BY_ID[s.pid].price;
      const slot = slotsForProduct(st, s.pid).find((r) => freeSpace(r.e, r.idx) > 0);
      if (slot) addToSlot(slot.e, slot.idx, s.pid, 1, s.exp);
      else g.items.spawnLoose(s.pid, s.exp, { x: c.pos.x, y: 0.6, z: c.pos.z });
    }
    c.stolen = [];
    c.basket = c.basket.filter((b) => !b.concealed);
    g.equipView.markDirty();
    st.stats.thievesCaught++;
    st.reputation.securite = Math.min(100, st.reputation.securite + 2);
    this.log({ kind: 'vol_evite', text: `Voleur interpellé par ${by} (${items.length} article(s) récupéré(s), ${money(value)})`, loss: 0, onCamera: false, x: c.pos.x, z: c.pos.z });
    g.bus.emit('notify', { text: `✅ Voleur interpellé par ${by} ! ${items.length} article(s) récupéré(s). Il est interdit de magasin.`, kind: 'good' });
  }

  log(i: Omit<Incident, 'id' | 'day' | 'minute' | 'resolved'> & { suspect?: number }) {
    const st = this.game.st;
    st.incidents.push({ id: allocUid(st), day: dayOf(st.time), minute: minuteOfDay(st.time), resolved: false, ...i } as Incident);
    if (st.incidents.length > 200) st.incidents.splice(0, st.incidents.length - 200);
  }

  /** Porter plainte avec preuve vidéo : chance de récupérer une partie de la perte et d'identifier le voleur. */
  fileComplaint(id: number): string {
    const st = this.game.st;
    const inc = st.incidents.find((i) => i.id === id);
    if (!inc || inc.resolved) return 'Incident introuvable.';
    inc.resolved = true;
    if (!inc.onCamera) return 'Sans images, la plainte est classée sans suite.';
    if (Math.random() < 0.55) {
      const back = Math.round(inc.loss * 0.8);
      st.cash += back;
      st.today.incomes.divers += back;
      const r = st.residents.find((x) => x.id === (inc as any).suspect);
      if (r) r.memory.banned = true;
      return `Le voleur a été identifié grâce à la vidéo ! ${money(back)} remboursés, il est interdit de magasin.`;
    }
    return 'La police a pris la plainte… et l’a rangée sous une pile d’autres plaintes.';
  }

  /** Effraction nocturne (résolution abstraite quand le joueur n'est pas sur place). */
  resolveBurglaryAbstract(): string | null {
    const g = this.game;
    const st = g.st;
    const nightGuard = st.employees.some((e) => e.role === 'securite' && (e.shiftEnd >= 24 || e.shiftStart <= 3));
    const risk = burglaryRisk(st, nightGuard);
    if (Math.random() >= risk) {
      if (st.flags.tagTonight) {
        st.flags.tagTonight = false;
        g.items.addMess('tag', g.storeDoor().x + 3, -0.3, 1);
        return '🎨 Un tag est apparu sur votre façade pendant la nuit.';
      }
      return null;
    }
    st.stats.burglaries++;
    const r = g.storeRect();
    const alarm = !!st.store.upgrades['alarme'] && st.store.alarmArmed && detectorsCover(st, r.dockDoorX, r.z1 - 1);
    const reinforced = !!st.store.upgrades['portes_renforcees'];
    if (nightGuard && Math.random() < 0.75) {
      this.log({ kind: 'intrusion', text: 'Tentative d’effraction repoussée par l’agent de nuit.', loss: 0, onCamera: true });
      return '🌙 Tentative d’effraction cette nuit : votre agent de sécurité a fait fuir les intrus !';
    }
    if (reinforced && Math.random() < 0.55) {
      this.log({ kind: 'intrusion', text: 'Tentative d’effraction : les portes renforcées ont tenu.', loss: 0, onCamera: false });
      return '🔒 Des cambrioleurs ont essayé de forcer la porte de quai cette nuit… sans succès.';
    }
    let loss = 0;
    const tillCash = st.equipment.reduce((a, e) => a + (e.till ?? 0), 0);
    const safe = st.equipment.some((e) => e.def === 'coffre');
    const minutesInside = alarm ? (st.store.upgrades['telesurveillance'] ? 3 : 6) : 25;
    if (!safe) {
      const stolenCash = Math.round(tillCash * Math.min(1, minutesInside / 10));
      loss += stolenCash;
      st.cash -= stolenCash;
      for (const e of st.equipment) if (e.till) e.till = 0;
    }
    // cartons de valeur emportés
    const racks = st.equipment.filter((e) => e.cartons?.length);
    let cartons = Math.min(8, Math.round(minutesInside / 3));
    const taken: string[] = [];
    for (const rk of racks) {
      rk.cartons!.sort((a, b) => (PRODUCT_BY_ID[b.pid].theftAppeal ?? 0) - (PRODUCT_BY_ID[a.pid].theftAppeal ?? 0));
      while (cartons > 0 && rk.cartons!.length) {
        const c = rk.cartons!.shift()!;
        loss += PRODUCT_BY_ID[c.pid].cost * c.q;
        taken.push(PRODUCT_BY_ID[c.pid].name);
        cartons--;
      }
    }
    const damage = reinforced ? 250 : 650;
    spend(st, 'entretien', damage);
    loss += damage;
    const paid = insuranceClaim(st, loss);
    st.reputation.securite = Math.max(0, st.reputation.securite - 6);
    g.equipView.markDirty();
    this.log({ kind: 'cambriolage', text: `Cambriolage : ${safe ? 'coffre intact' : 'caisses vidées'}, ${taken.length} carton(s) volé(s), porte de quai fracturée.${alarm ? ' L’alarme a écourté l’intrusion.' : ''}`, loss, onCamera: this.refreshCameras().count > 0 });
    return `🚨 CAMBRIOLAGE cette nuit ! Pertes : ${money(loss)}${paid ? ` (assurance : +${money(paid)})` : ' (non assuré)'}.${alarm ? ' L’alarme a fait fuir les voleurs rapidement.' : ''}`;
  }
}

const EQUIPMENT_HEIGHT = new Set(['gondole_simple', 'gondole_double', 'frigo_vitre', 'frigo_mural', 'rack_reserve', 'chambre_froide', 'toilettes', 'casiers', 'bac_pain', 'vitrine_secu']);

export const _slotInfo = slotInfo;
