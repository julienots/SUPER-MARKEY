/**
 * Jeu à deux, chacun sur son écran : connexion directe entre les deux appareils (WebRTC via PeerJS).
 * L'hôte fait tourner le magasin et envoie l'état ~10 fois par seconde ; l'invité envoie ses actions.
 * La partie se rejoint avec un code de 4 lettres.
 */
import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
import type { Action, AgentView, Fx, World } from '../sim/types';

export const PROTO = 2;
const PREFIX = 'bazarbazar-v2-';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';

export type HostMsg =
  | { t: 'welcome'; pid: string; world: World }
  | { t: 'snap'; min: number; clock: number; speed: number; a: unknown[]; w?: World }
  | { t: 'fx'; fx: Fx[] }
  | { t: 'bye'; reason: string };
export type GuestMsg = { t: 'hello'; name: string; v: number } | { t: 'act'; a: Action } | { t: 'ping' };

/** Options PeerJS : serveur public par défaut, ou serveur local (?peer=hôte:port) pour les tests. */
function peerOptions(): PeerOptions {
  const opt: PeerOptions = { debug: 0 };
  try {
    const p = new URLSearchParams(location.search).get('peer');
    if (p) {
      const [host, port] = p.split(':');
      Object.assign(opt, { host, port: Number(port) || 9000, path: '/', secure: false });
    }
  } catch {
    /* pas de navigateur */
  }
  return opt;
}

export const randomCode = () => Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
export const cleanCode = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);

// ------------------------------------------------------------- personnages compactés pour le réseau
const KINDS = ['customer', 'staff', 'player', 'van'] as const;
const ANIMS = ['idle', 'walk', 'interact', 'wave', 'drive'] as const;
export function packAgents(list: AgentView[]): unknown[] {
  return list.map((a) => [a.id, KINDS.indexOf(a.kind), a.model, a.x, a.z, a.rot, ANIMS.indexOf(a.anim), a.carry, a.bubble, a.tag, a.color, a.pid]);
}
export function unpackAgents(list: unknown[]): AgentView[] {
  return (list as any[]).map((r) => ({ id: r[0], kind: KINDS[r[1]], model: r[2], x: r[3], z: r[4], rot: r[5], anim: ANIMS[r[6]], carry: r[7], bubble: r[8], tag: r[9], color: r[10], pid: r[11] }));
}

const errText = (e: any) => {
  const t = e?.type ?? '';
  if (t === 'peer-unavailable') return 'Aucune partie avec ce code. Vérifiez les 4 lettres.';
  if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return 'Pas de connexion Internet (ou serveur injoignable).';
  if (t === 'browser-incompatible') return 'Ce navigateur ne permet pas de jouer à deux.';
  return 'Connexion impossible (' + (t || e?.message || 'erreur') + ').';
};

// ------------------------------------------------------------- hôte
export class HostNet {
  peer!: Peer;
  code = '';
  conns = new Map<string, { conn: DataConnection; name: string; ready: boolean }>();
  onJoin: (pid: string, name: string) => World = () => null as any;
  onLeave: (pid: string) => void = () => {};
  onAction: (pid: string, a: Action) => void = () => {};
  onStatus: (text: string) => void = () => {};

  static create(): Promise<HostNet> {
    const h = new HostNet();
    return h.open(0).then(() => h);
  }

  private open(tries: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.code = randomCode();
      const peer = new Peer(PREFIX + this.code, peerOptions());
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        peer.destroy();
        reject(new Error('Le serveur de connexion ne répond pas. Vérifiez votre connexion Internet.'));
      }, 15000);
      peer.on('open', () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.peer = peer;
        peer.on('connection', (c) => this.accept(c));
        peer.on('disconnected', () => {
          // perte du serveur de rendez-vous : les joueurs déjà connectés restent connectés
          this.onStatus('reconnexion…');
          setTimeout(() => !peer.destroyed && peer.reconnect(), 1500);
        });
        resolve();
      });
      peer.on('error', (e: any) => {
        if (done) {
          if (e?.type !== 'peer-unavailable') this.onStatus(errText(e));
          return;
        }
        done = true;
        clearTimeout(timer);
        peer.destroy();
        if (e?.type === 'unavailable-id' && tries < 5) this.open(tries + 1).then(resolve, reject);
        else reject(new Error(errText(e)));
      });
    });
  }

  private accept(conn: DataConnection) {
    const pid = conn.peer;
    conn.on('data', (raw) => {
      const m = raw as GuestMsg;
      if (!m || typeof m !== 'object') return;
      if (m.t === 'hello') {
        if (m.v !== PROTO) {
          conn.send({ t: 'bye', reason: 'Versions du jeu différentes : mettez le jeu à jour sur les deux appareils.' } satisfies HostMsg);
          setTimeout(() => conn.close(), 500);
          return;
        }
        if (this.conns.size >= 3 && !this.conns.has(pid)) {
          conn.send({ t: 'bye', reason: 'La partie est complète.' } satisfies HostMsg);
          setTimeout(() => conn.close(), 500);
          return;
        }
        const name = String(m.name || 'Joueur 2').slice(0, 14);
        this.conns.set(pid, { conn, name, ready: true });
        const world = this.onJoin(pid, name);
        conn.send({ t: 'welcome', pid, world } satisfies HostMsg);
      } else if (m.t === 'act' && this.conns.get(pid)?.ready) this.onAction(pid, m.a);
    });
    const gone = () => {
      if (!this.conns.has(pid)) return;
      this.conns.delete(pid);
      this.onLeave(pid);
    };
    conn.on('close', gone);
    conn.on('error', gone);
    // ICE coupé (réseau perdu) : PeerJS ne prévient pas toujours
    const pc = (conn as any).peerConnection as RTCPeerConnection | undefined;
    pc?.addEventListener?.('iceconnectionstatechange', () => {
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') gone();
    });
  }

  get count() {
    return this.conns.size;
  }

  broadcast(m: HostMsg) {
    for (const c of this.conns.values()) if (c.ready && c.conn.open) c.conn.send(m);
  }

  close() {
    this.broadcast({ t: 'bye', reason: 'L’hôte a quitté la partie.' });
    const p = this.peer;
    setTimeout(() => p?.destroy(), 300);
    this.conns.clear();
  }
}

// ------------------------------------------------------------- invité
export class GuestNet {
  peer!: Peer;
  conn!: DataConnection;
  pid = '';
  onMsg: (m: HostMsg) => void = () => {};
  onClose: (reason: string) => void = () => {};
  private closed = false;
  private lastMsg = 0;
  private watchdog = 0;

  static join(code: string, name: string): Promise<{ net: GuestNet; world: World }> {
    const g = new GuestNet();
    return new Promise((resolve, reject) => {
      const peer = new Peer(peerOptions());
      g.peer = peer;
      let done = false;
      const fail = (msg: string) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        peer.destroy();
        reject(new Error(msg));
      };
      const timer = setTimeout(() => fail('Pas de réponse. Vérifiez le code et que votre ami a bien lancé la partie.'), 20000);
      peer.on('error', (e) => {
        if (done) g.close(errText(e));
        else fail(errText(e));
      });
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + cleanCode(code), { reliable: true, serialization: 'json' });
        g.conn = conn;
        conn.on('open', () => conn.send({ t: 'hello', name, v: PROTO } satisfies GuestMsg));
        conn.on('data', (raw) => {
          const m = raw as HostMsg;
          g.lastMsg = performance.now();
          if (!done) {
            if (m.t === 'welcome') {
              done = true;
              clearTimeout(timer);
              g.pid = m.pid;
              g.startWatchdog();
              resolve({ net: g, world: m.world });
            } else if (m.t === 'bye') fail(m.reason);
            return;
          }
          if (m.t === 'bye') g.close(m.reason);
          else g.onMsg(m);
        });
        conn.on('close', () => (done ? g.close('La connexion avec votre ami est coupée.') : fail('Connexion refusée.')));
        conn.on('error', () => (done ? g.close('La connexion avec votre ami est coupée.') : fail('Connexion impossible.')));
      });
    });
  }

  private startWatchdog() {
    this.lastMsg = performance.now();
    this.watchdog = window.setInterval(() => {
      if (performance.now() - this.lastMsg > 10000) this.close('Plus de nouvelles de l’hôte : connexion perdue.');
    }, 1000);
  }

  send(m: GuestMsg) {
    if (this.conn?.open) this.conn.send(m);
  }

  close(reason = '') {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.watchdog);
    try {
      this.conn?.close();
      this.peer?.destroy();
    } catch {
      /* déjà fermé */
    }
    this.onClose(reason);
  }

  /** Quitter volontairement (sans message d'erreur). */
  leave() {
    this.closed = true;
    clearInterval(this.watchdog);
    try {
      this.conn?.close();
      this.peer?.destroy();
    } catch {
      /* déjà fermé */
    }
  }
}
