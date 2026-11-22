/**
 * Une partie en cours, vue depuis cet écran : seul, hôte d'une partie à deux, ou invité.
 * Toutes les actions passent par `act()` : appliquées localement (seul/hôte) ou envoyées à l'hôte (invité).
 */
import { Sim } from './sim/sim';
import { saveLocal } from './sim/save';
import type { Action, AgentView, Fx, World } from './sim/types';
import { GuestNet, HostNet, packAgents, unpackAgents, type HostMsg } from './net/net';

export type Mode = 'solo' | 'host' | 'guest';

/** Identifiant de cet appareil (gardé) : on retrouve son perso en se reconnectant. */
export function deviceId(): string {
  try {
    let id = localStorage.getItem('bazarbazar2.cid');
    if (!id) {
      id = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
      localStorage.setItem('bazarbazar2.cid', id);
    }
    return id;
  } catch {
    return Math.random().toString(36).slice(2, 12);
  }
}

export class Session {
  mode: Mode;
  sim: Sim | null = null;
  world: World;
  agents: AgentView[] = [];
  me: string;
  host: HostNet | null = null;
  guest: GuestNet | null = null;
  onFx: (fx: Fx) => void = () => {};
  onPartner: (text: string, joined: boolean) => void = () => {};
  onEnd: (reason: string) => void = () => {};
  private sendT = 0;
  private sentRev = -1;
  private worldT = 0;
  private saveT = 0;
  /** Événements reçus depuis la dernière image (pour l'invité). */
  private pendingFx: Fx[] = [];

  private constructor(mode: Mode, world: World, me: string) {
    this.mode = mode;
    this.world = world;
    this.me = me;
  }

  static local(world: World, name: string): Session {
    const s = new Session('solo', world, 'host');
    s.sim = new Sim(world);
    s.sim.addPlayer('host', name);
    s.agents = s.sim.views();
    return s;
  }

  /** Ouvre la partie aux autres joueurs (code à 4 lettres). */
  async openToFriends(): Promise<string> {
    if (this.host) return this.host.code;
    const net = await HostNet.create(this.world.code);
    this.host = net;
    this.world.code = net.code;
    this.mode = 'host';
    net.onJoin = (pid, name) => {
      this.sim!.addPlayer(pid, name);
      this.onPartner(`${name} a rejoint la partie !`, true);
      return this.world;
    };
    net.onLeave = (pid) => {
      const p = this.world.players.find((q) => q.id === pid);
      this.sim!.removePlayer(pid);
      this.onPartner(`${p?.name ?? 'Votre ami'} a quitté la partie.`, false);
    };
    net.onAction = (pid, a) => {
      if (a && typeof a === 'object' && typeof (a as Action).t === 'string') this.sim!.apply(pid, a);
    };
    return net.code;
  }

  static async join(code: string, name: string): Promise<Session> {
    const { net, world } = await GuestNet.join(code, name, deviceId());
    const s = new Session('guest', world, net.pid);
    s.guest = net;
    net.onMsg = (m) => s.receive(m);
    net.onClose = (reason) => s.onEnd(reason);
    return s;
  }

  private receive(m: HostMsg) {
    if (m.t === 'snap') {
      if (m.w) this.world = m.w;
      this.world.min = m.min;
      this.world.clock = m.clock;
      this.world.speed = m.speed;
      this.agents = unpackAgents(m.a);
    } else if (m.t === 'fx') this.pendingFx.push(...m.fx);
  }

  act(a: Action) {
    if (this.guest) this.guest.send({ t: 'act', a });
    else this.sim?.apply(this.me, a);
  }

  get partners() {
    return this.world.players.filter((p) => p.id !== this.me);
  }

  update(dt: number) {
    if (this.sim) {
      this.sim.update(dt);
      this.world = this.sim.w;
      this.agents = this.sim.views();
      const fx = this.sim.drainFx();
      for (const f of fx) this.onFx(f);
      if (this.host && this.host.count) {
        // événements tout de suite, état ~10 fois par seconde, plan du magasin quand il change (≤ 5/s)
        const shared = fx.filter((f) => !(f.k === 'toast' && f.to === this.me));
        if (shared.length) this.host.broadcast({ t: 'fx', fx: shared });
        this.sendT -= dt;
        this.worldT -= dt;
        if (this.sendT <= 0) {
          this.sendT = 0.1;
          const msg: HostMsg = { t: 'snap', min: this.world.min, clock: this.world.clock, speed: this.world.speed, a: packAgents(this.agents) };
          if (this.world.rev !== this.sentRev && this.worldT <= 0) {
            msg.w = this.world;
            this.sentRev = this.world.rev;
            this.worldT = 0.2;
          }
          this.host.broadcast(msg);
        }
      }
      this.saveT -= dt;
      if (this.saveT <= 0) {
        this.saveT = 20;
        this.save();
      }
    } else {
      const fx = this.pendingFx;
      this.pendingFx = [];
      for (const f of fx) this.onFx(f);
    }
  }

  /** Nouveau joueur sur la partie de l'hôte : il reçoit tout le plan tout de suite. */
  forceWorld() {
    this.sentRev = -1;
    this.worldT = 0;
  }

  save() {
    if (this.sim) saveLocal(this.sim.w);
  }

  close() {
    if (this.sim) this.save();
    this.host?.close();
    this.guest?.leave();
    this.host = null;
    this.guest = null;
  }
}
