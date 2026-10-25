/**
 * Interface en jeu volontairement discrète : petite pastille (heure, argent, vitesse), réticule,
 * actions contextuelles, notifications, bulles des personnages, choix d'événements, barre d'outils.
 */
import * as THREE from 'three';
import { h, keyLabel, clear } from './dom';
import { money, money0 } from '../core/math';
import { fmtClock, fmtDay } from '../core/time';
import { OBJECTIVES } from '../data/objectives';
import { statValue } from '../sim/objectives';
import { dayOf, hourOf } from '../sim/state';
import type { Game } from '../game/game';
import type { AudioEngine } from '../audio/audio';

const WEATHER_ICON: Record<string, string> = { soleil: '☀️', nuageux: '⛅', pluie: '🌧️', orage: '⛈️', canicule: '🥵', neige: '❄️' };

export interface HudCallbacks {
  openTablet: (tab?: string) => void;
  toggleBuild: () => void;
  openCameras: () => void;
  pause: () => void;
}

export class Hud {
  root = h('div', { id: 'hud' });
  private pill = h('div', { class: 'hud-pill' });
  private clockEl = h('span', { class: 'clock' });
  private dayEl = h('span', { class: 'day' });
  private cashEl = h('span', { class: 'cash' });
  private weatherEl = h('span');
  private openEl = h('span', { class: 'tag' });
  private speedBtns: HTMLButtonElement[] = [];
  private crosshair = h('div', { id: 'crosshair' });
  private prompt = h('div', { id: 'prompt', class: 'panel' });
  private toasts = h('div', { id: 'toasts' });
  private flashEl = h('div', { id: 'flash' });
  private objective = h('div', { id: 'objective', class: 'panel' });
  private announceEl = h('div', { id: 'announce', class: 'panel' });
  private choiceEl: HTMLElement | null = null;
  private choiceUid = -1;
  private hint = h('div', { class: 'click-hint panel' }, '🖱️ Cliquez pour jouer');
  private barks = new Map<number, { el: HTMLElement; until: number; x: number; y: number; z: number }>();
  private toastKeys = new Map<string, number>();
  private flashT = 0;
  private shownCash = 0;
  private tools: HTMLElement;
  private skipBtn: HTMLButtonElement;
  private choiceBadge = h('span', { class: 'badge' });
  private promptSig = '';
  visible = true;

  constructor(private game: Game, private audio: AudioEngine, private cb: HudCallbacks) {
    const speeds = [0, 1, 2, 4, 8];
    const sb = h(
      'div',
      { class: 'speed-btns', title: 'Vitesse du temps (T)' },
      speeds.map((s) => {
        const b = h('button', { onclick: () => this.setSpeed(s), 'aria-label': s ? `Vitesse x${s}` : 'Pause' }, s ? `×${s}` : '⏸');
        this.speedBtns.push(b);
        return b;
      }),
    );
    this.pill.append(h('div', { class: 'col', style: { gap: '0' } }, this.clockEl, this.dayEl), this.weatherEl, this.cashEl, this.openEl, sb);
    this.skipBtn = h('button', { class: 'btn small', onclick: () => this.skipNight(), title: 'Avancer jusqu’au matin' }, '🌙 Passer la nuit');
    this.skipBtn.style.display = 'none';
    const top = h('div', { class: 'hud-top' }, this.pill, this.skipBtn);
    const tool = (ico: string, label: string, key: string, fn: () => void, badge?: HTMLElement) =>
      h('button', { class: 'tool', title: `${label} (${keyLabel(game.settings.keys[key])})`, onclick: fn, 'aria-label': label }, ico, h('kbd', null, keyLabel(game.settings.keys[key])), badge ?? null);
    this.tools = h(
      'div',
      { class: 'hud-tools panel' },
      tool('📱', 'Tablette de gestion', 'tablette', () => cb.openTablet(), this.choiceBadge),
      tool('🏗️', 'Mode construction', 'construction', () => cb.toggleBuild()),
      tool('📹', 'Caméras de surveillance', 'surveillance', () => cb.openCameras()),
      tool('🎥', 'Vue 1ʳᵉ/3ᵉ personne', 'camera', () => (game.player.thirdPerson = !game.player.thirdPerson)),
      tool('⏯️', 'Menu pause', 'pause', () => cb.pause()),
    );
    this.choiceBadge.style.display = 'none';
    this.prompt.style.display = 'none';
    this.announceEl.style.display = 'none';
    this.hint.style.display = 'none';
    this.root.append(top, this.objective, this.crosshair, this.prompt, this.toasts, this.flashEl, this.announceEl, this.hint, this.tools);
    document.getElementById('ui')!.append(this.root);

    game.bus.on('notify', (n) => this.toast(n.text, n.kind ?? 'info', n.key));
    game.bus.on('bark', (b) => this.bark(b.id, b.text, b.x, b.y, b.z));
    game.bus.on('announce', (a) => this.announce(a.text));
    game.bus.on('objective', (o) => {
      this.toast(`🏆 Objectif accompli : « ${o.name} » (+${money0(o.reward)})`, 'good');
      this.audio.sfx('fanfare');
    });
    game.bus.on('sale', (s) => {
      if (Math.hypot(s.x - game.player.pos.x, s.z - game.player.pos.z) < 14) this.moneyPop(s.amount, s.x, s.z);
    });
    game.player.interaction.flash = (t) => this.flash(t);
    this.shownCash = game.st.cash;
  }

  setSpeed(s: number) {
    this.game.st.speed = s;
    this.audio.sfx('ui');
  }

  private skipNight() {
    if (this.game.skipNight()) {
      this.toast('🌅 La nuit passe… Bonjour !', 'info');
      this.audio.sfx('whoosh');
    } else this.toast('Impossible : des clients sont encore dans le magasin.', 'bad');
  }

  toast(text: string, kind: string, key?: string) {
    if (key) {
      const last = this.toastKeys.get(key) ?? 0;
      if (performance.now() - last < 30000) return;
      this.toastKeys.set(key, performance.now());
    }
    const el = h('div', { class: `toast ${kind}` }, text);
    this.toasts.prepend(el);
    while (this.toasts.children.length > 5) this.toasts.lastElementChild!.remove();
    setTimeout(() => el.classList.add('out'), 6500);
    setTimeout(() => el.remove(), 7000);
    if (kind === 'bad') this.audio.sfx('error');
    this.game.st.log.push({ t: this.game.st.time, text, kind });
    if (this.game.st.log.length > 300) this.game.st.log.splice(0, 100);
  }

  flash(t: string) {
    this.flashEl.textContent = t;
    this.flashEl.style.opacity = '1';
    this.flashT = 2.2;
  }

  private announce(text: string) {
    this.announceEl.textContent = `📢 « ${text} »`;
    this.announceEl.style.display = 'block';
    this.audio.announce(text);
    setTimeout(() => (this.announceEl.style.display = 'none'), 9000);
  }

  private bark(id: number, text: string, x: number, y: number, z: number) {
    if (!this.game.settings.barks) return;
    if (Math.hypot(x - this.game.player.pos.x, z - this.game.player.pos.z) > 16) return;
    const old = this.barks.get(id);
    if (old) old.el.remove();
    const el = h('div', { class: 'bark' }, text);
    this.root.append(el);
    this.barks.set(id, { el, until: performance.now() + 3200, x, y, z });
  }

  private moneyPop(amount: number, x: number, z: number) {
    const p = new THREE.Vector3(x, 1.6, z).project(this.game.camera);
    if (p.z > 1) return;
    const el = h('div', { class: 'money-pop', style: { left: `${(p.x * 0.5 + 0.5) * innerWidth}px`, top: `${(-p.y * 0.5 + 0.5) * innerHeight}px` } }, `+${money(amount)}`);
    this.root.append(el);
    setTimeout(() => el.remove(), 1400);
  }

  private renderChoice() {
    const st = this.game.st;
    const ch = st.pendingChoices[0];
    this.choiceBadge.style.display = st.pendingChoices.length ? '' : 'none';
    this.choiceBadge.textContent = String(st.pendingChoices.length);
    if (!ch) {
      this.choiceEl?.remove();
      this.choiceEl = null;
      this.choiceUid = -1;
      return;
    }
    if (ch.uid === this.choiceUid) return;
    this.choiceEl?.remove();
    this.choiceUid = ch.uid;
    this.audio.sfx('boing');
    this.choiceEl = h(
      'div',
      { id: 'choice', class: 'panel' },
      h('h3', null, ch.title),
      h('p', null, ch.text),
      h(
        'div',
        { class: 'opts' },
        ch.options.map((o) =>
          h('button', { class: 'btn', onclick: () => { this.game.chooseOption(ch, o.id); this.audio.sfx('ui'); this.renderChoice(); } }, h('span', null, o.label), o.hint ? h('small', null, o.hint) : null),
        ),
      ),
      h('div', { class: 'small muted', style: { marginTop: '6px' } }, 'Sans réponse, la dernière option sera choisie.'),
    );
    this.root.append(this.choiceEl);
  }

  private renderObjective() {
    const st = this.game.st;
    const tut = this.tutorialText();
    if (tut) {
      this.objective.innerHTML = '';
      this.objective.append(h('b', null, '💡 '), tut);
      this.objective.style.display = '';
      return;
    }
    const next = OBJECTIVES.find((o) => !st.objectivesDone.includes(o.id));
    if (!next) {
      this.objective.style.display = 'none';
      return;
    }
    const v = statValue(st, next.stat);
    clear(this.objective);
    this.objective.append(h('div', null, h('b', null, '🎯 '), next.name, ' ', h('span', { class: 'muted' }, `${Math.floor(Math.min(v, next.target)).toLocaleString('fr-FR')}/${next.target.toLocaleString('fr-FR')}`)), h('div', { class: 'small muted' }, next.desc));
    this.objective.style.display = '';
  }

  /** Tutoriel léger, guidé par les actions réelles du joueur. */
  private tutorialText(): string | null {
    const g = this.game;
    const st = g.st;
    const k = (a: string) => keyLabel(g.settings.keys[a]);
    switch (st.tutorialStep) {
      case 0:
        if (g.player.inStore) st.tutorialStep = 1;
        return `Bienvenue, patron·ne ! Déplacez-vous avec ${k('avancer')}${k('gauche')}${k('reculer')}${k('droite')} (ZQSD en AZERTY) et la souris. Entrez dans votre supérette.`;
      case 1:
        if (g.player.held?.kind === 'cartons') st.tutorialStep = 2;
        return `Passez la porte « PRIVÉ » au fond : c’est la réserve. Visez un carton sur un rack et appuyez sur ${k('interagir')}.`;
      case 2:
        if (st.stats.unitsShelvedByPlayer >= 3) st.tutorialStep = 3;
        return `Visez un rayon du même produit (ou un facing vide) et MAINTENEZ ${k('interagir')} pour le remplir. ${k('lacher')} pour lâcher le carton.`;
      case 3:
        if (g.player.mode === 'cashier' || st.stats.customersServed >= 3) st.tutorialStep = 4;
        return `Des clients arrivent ! Allez derrière la caisse, visez-la et appuyez sur ${k('interagir')} pour encaisser (${k('interagir')} = scanner).`;
      case 4:
        if (st.flags.tabletOpened) st.tutorialStep = 5;
        return `Ouvrez la tablette (${k('tablette')}) : commandes, prix, embauches, marketing… Tout se pilote d’ici.`;
      default:
        return null;
    }
  }

  update(dt: number) {
    const g = this.game;
    const st = g.st;
    if (!this.visible) return;
    // pastille
    this.clockEl.textContent = fmtClock(st.time % 1440);
    this.dayEl.textContent = `${fmtDay(dayOf(st.time))} · J${dayOf(st.time) + 1}`;
    this.weatherEl.textContent = WEATHER_ICON[st.weather.kind] ?? '';
    this.weatherEl.title = st.weather.kind;
    this.shownCash += (st.cash - this.shownCash) * Math.min(1, dt * 6);
    this.cashEl.textContent = money0(this.shownCash);
    this.cashEl.classList.toggle('neg', st.cash < 0);
    const open = g.isOpen();
    this.openEl.textContent = st.store.construction ? '🏗️ Travaux' : open ? 'OUVERT' : 'FERMÉ';
    this.openEl.className = `tag ${open ? 'g' : 'r'}`;
    const speeds = [0, 1, 2, 4, 8];
    this.speedBtns.forEach((b, i) => b.classList.toggle('on', speeds[i] === st.speed));
    const h2 = hourOf(st.time);
    this.skipBtn.style.display = !open && g.agents.count('customer') === 0 && (h2 >= st.store.closeHour || h2 < st.store.openHour - 1) ? '' : 'none';
    // invite à cliquer
    const p = g.player;
    this.hint.style.display = (p.mode === 'walk' || p.mode === 'cashier') && !p.input.locked && !document.querySelector('.modal-back, #tablet, #cams') ? '' : 'none';
    // action contextuelle
    const pr = p.mode === 'walk' || p.mode === 'cashier' ? p.interaction.prompt : null;
    this.crosshair.classList.toggle('on', !!pr && pr.actions.length > 0);
    this.crosshair.style.display = p.mode === 'build' ? 'none' : '';
    if (pr) {
      const sig = JSON.stringify([pr.title, pr.subtitle, pr.info, pr.actions.map((a) => a.label + a.action)]);
      if (sig !== this.promptSig) {
        this.promptSig = sig;
        clear(this.prompt);
        this.prompt.append(h('div', { class: 't' }, pr.title));
        if (pr.subtitle) this.prompt.append(h('div', { class: 's' }, pr.subtitle));
        for (const i of pr.info ?? []) this.prompt.append(h('div', { class: 'i' }, i));
        if (pr.actions.length)
          this.prompt.append(h('div', { class: 'a' }, pr.actions.map((a) => h('span', null, h('kbd', { class: 'key' }, keyLabel(g.settings.keys[a.action] ?? a.action)), a.hold ? `${a.label} (maintenir)` : a.label))));
      }
      this.prompt.style.display = '';
    } else {
      this.prompt.style.display = 'none';
      this.promptSig = '';
    }
    if (p.held && !pr) {
      const held = p.held;
      const txt = held.kind === 'cartons' ? `📦 ${held.list.length} carton(s) — ${keyLabel(g.settings.keys.lacher)} lâcher · clic droit lancer` : held.kind === 'item' ? `🛒 Article en main — ${keyLabel(g.settings.keys.lacher)} lâcher · clic lancer` : `🛒 Chariot — ${keyLabel(g.settings.keys.lacher)} lâcher · clic pousser`;
      if (this.flashT <= 0) {
        this.flashEl.textContent = txt;
        this.flashEl.style.opacity = '0.75';
      }
    } else if (this.flashT <= 0) this.flashEl.style.opacity = '0';
    this.flashT -= dt;
    // bulles
    const now = performance.now();
    for (const [id, b] of this.barks) {
      const a = g.agents.list.find((x) => x.id === id);
      if (a) {
        b.x = a.pos.x;
        b.z = a.pos.z;
      }
      const v = new THREE.Vector3(b.x, b.y, b.z).project(g.camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      b.el.style.display = visible ? '' : 'none';
      b.el.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
      b.el.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
      if (now > b.until) {
        b.el.remove();
        this.barks.delete(id);
      }
    }
    this.renderChoice();
    this.renderObjective();
  }

  setVisible(v: boolean) {
    this.visible = v;
    this.root.style.display = v ? '' : 'none';
  }
}
