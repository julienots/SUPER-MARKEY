/**
 * BAZAR BAZAR — point d'entrée : chargement des modèles, menu principal, partie seul ou à deux.
 */
import '@fontsource/luckiest-guy/400.css';
import '@fontsource/nunito/400.css';
import '@fontsource/nunito/700.css';
import '@fontsource/nunito/800.css';
import './ui/styles.css';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { loadAssets } from './render/assets';
import { makeThumbs } from './render/thumbs';
import { View } from './render/view';
import { Controls } from './render/controls';
import { Audio } from './audio';
import { Hud } from './ui/hud';
import { h, euro, uiIcon } from './ui/dom';
import { Session } from './session';
import { createWorld, levelCap, Sim } from './sim/sim';
import { FURN_BY_ID } from './data/furniture';
import { loadLocal, hasSave, deleteSave } from './sim/save';
import { cleanCode } from './net/net';
import { loadSettings, saveSettings } from './settings';

const settings = loadSettings();
const ui = document.getElementById('ui')!;
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const overlay = h('div', { class: 'overlay' });
document.body.insertBefore(overlay, ui);
document.body.classList.toggle('touch', matchMedia('(pointer: coarse)').matches);

const audio = new Audio();
audio.setVolumes(settings.music, settings.sfx);

let view: View;
let controls: Controls;
let session: Session | null = null;
let hud: Hud | null = null;
let demo: Sim | null = null;
let menuEl: HTMLElement | null = null;
let modalEl: HTMLElement | null = null;

// ------------------------------------------------------------------ petites fenêtres
function modal(title: string, content: (HTMLElement | string)[], buttons: { label: string; cls?: string; fn?: () => void }[] = [{ label: 'OK' }]) {
  closeModal();
  const back = h('div', { class: 'cardwrap modal' });
  const box = h('div', { class: 'bigcard' }, h('h2', null, title), ...content.map((c) => (typeof c === 'string' ? h('p', null, c) : c)));
  const row = h('div', { class: 'btnrow' });
  for (const b of buttons)
    row.append(
      h(
        'button',
        {
          class: b.cls ?? 'cta',
          onclick: () => {
            audio.sfx('click');
            closeModal();
            b.fn?.();
          },
        },
        b.label,
      ),
    );
  box.append(row);
  back.append(box);
  ui.append(back);
  modalEl = back;
  return back;
}
function closeModal() {
  modalEl?.remove();
  modalEl = null;
}

function busy(text: string) {
  closeModal();
  const back = h('div', { class: 'cardwrap modal' }, h('div', { class: 'bigcard' }, h('div', { class: 'spinner' }), h('p', null, text)));
  ui.append(back);
  modalEl = back;
}

// ------------------------------------------------------------------ menu principal
function mainMenu() {
  menuEl?.remove();
  audio.play('menu');
  startDemo();
  const save = loadLocal();
  const play = h(
    'button',
    { class: 'cta xl', onclick: () => (audio.sfx('click'), save ? startSolo(save) : newGame()) },
    uiIcon('play'),
    h('span', { class: 'col' }, h('span', null, save ? 'CONTINUER' : 'JOUER'), save ? h('small', null, `${save.name} · jour ${save.day} · ${euro(save.money)}`) : null),
  );
  const duo = h('button', { class: 'cta alt xl', onclick: () => (audio.sfx('click'), duoMenu()) }, uiIcon('team'), h('span', null, 'JOUER À DEUX'));
  const small = h(
    'div',
    { class: 'btnrow' },
    save ? h('button', { class: 'ghost', onclick: () => confirmNew() }, uiIcon('sparkles'), ' Nouvelle partie') : null,
    h('button', { class: 'ghost', onclick: () => optionsMenu() }, uiIcon('gear'), ' Options'),
  );
  menuEl = h('div', { class: 'menu' }, h('img', { class: 'logo', src: './brand/bazar-bazar-logo-officiel-640.jpg', alt: 'BAZAR BAZAR' }), h('div', { class: 'menu-btns' }, play, duo, small), h('div', { class: 'credits' }, 'SuperEssence Studio · modèles 3D Quaternius & KayKit (CC0)'));
  ui.append(menuEl);
}

function confirmNew() {
  modal('Nouvelle partie ?', ['La partie en cours sera remplacée.'], [
    { label: 'Annuler', cls: 'ghost' },
    { label: 'Nouvelle partie', fn: () => newGame() },
  ]);
}

function newGame() {
  deleteSave();
  startSolo(createWorld(settings.name ? `Chez ${settings.name}` : 'BAZAR BAZAR'));
}

function askName(then: () => void) {
  const input = h('input', { class: 'name-input', maxLength: 14, placeholder: 'Ton prénom', value: settings.name });
  modal('Comment tu t’appelles ?', [input], [
    {
      label: 'C’est parti',
      fn: () => {
        settings.name = input.value.trim().slice(0, 14) || 'Joueur';
        saveSettings(settings);
        then();
      },
    },
  ]);
  setTimeout(() => input.focus(), 50);
}

function duoMenu() {
  if (!settings.name) return askName(duoMenu);
  const letters = h('input', { class: 'code-input', maxLength: 4, placeholder: 'CODE', autocapitalize: 'characters', autocomplete: 'off', spellcheck: false });
  letters.addEventListener('input', () => (letters.value = cleanCode(letters.value)));
  const join = () => {
    const code = cleanCode(letters.value);
    if (code.length !== 4) {
      letters.classList.add('shake');
      setTimeout(() => letters.classList.remove('shake'), 400);
      return;
    }
    joinGame(code);
  };
  letters.addEventListener('keydown', (e) => e.key === 'Enter' && join());
  const back = modal(
    'Jouer à deux',
    [
      h('p', { class: 'muted' }, `Chacun sur son téléphone, dans le même magasin. Tu joues en tant que ${settings.name} `, h('button', { class: 'link', onclick: () => askName(duoMenu) }, '(changer)')),
      h(
        'div',
        { class: 'duo' },
        h(
          'div',
          { class: 'duo-card' },
          uiIcon('home', 'cimg'),
          h('b', null, 'Créer la partie'),
          h('small', null, 'Ton magasin, ton ami te rejoint avec un code.'),
          h('button', { class: 'cta', onclick: () => (closeModal(), hostGame()) }, 'Créer'),
        ),
        h('div', { class: 'duo-card' }, uiIcon('handshake', 'cimg'), h('b', null, 'Rejoindre'), h('small', null, 'Tape le code affiché chez ton ami.'), letters, h('button', { class: 'cta alt', onclick: join }, 'Rejoindre')),
      ),
    ],
    [{ label: 'Retour', cls: 'ghost' }],
  );
  void back;
}

function optionsMenu(inGame = false) {
  const slider = (label: string, v: number, set: (x: number) => void) =>
    h(
      'label',
      { class: 'slider' },
      h('span', null, label),
      h('input', {
        type: 'range',
        min: 0,
        max: 1,
        step: 0.05,
        value: v,
        oninput: (e: Event) => set(Number((e.target as HTMLInputElement).value)),
      }),
    );
  const q = h('div', { class: 'seg' });
  for (const [id, label] of [
    ['basse', 'Fluide'],
    ['normale', 'Normale'],
    ['haute', 'Belle'],
  ] as const)
    q.append(
      h(
        'button',
        {
          class: settings.quality === id ? 'on' : '',
          onclick: (e: Event) => {
            settings.quality = id;
            saveSettings(settings);
            view.setQuality(id);
            for (const b of q.children) b.classList.remove('on');
            (e.currentTarget as HTMLElement).classList.add('on');
          },
        },
        label,
      ),
    );
  modal(
    'Options',
    [
      slider('🎵 Musique', settings.music, (x) => {
        settings.music = x;
        audio.setVolumes(settings.music, settings.sfx);
        saveSettings(settings);
      }),
      slider('🔔 Sons', settings.sfx, (x) => {
        settings.sfx = x;
        audio.setVolumes(settings.music, settings.sfx);
        saveSettings(settings);
      }),
      h('div', { class: 'opt' }, h('span', null, '✨ Graphismes'), q),
      h('div', { class: 'opt' }, h('span', null, '👤 Prénom'), h('button', { class: 'ghost', onclick: () => askName(() => optionsMenu(inGame)) }, settings.name || 'choisir')),
    ],
    [{ label: 'OK', fn: inGame ? () => gameMenu() : undefined }],
  );
}

// ------------------------------------------------------------------ démarrer une partie
function startDemo() {
  view.reset();
  const w = createWorld('Démo');
  w.min = 11 * 60;
  w.money = 99999;
  w.level = 4;
  demo = new Sim(w, 42);
  demo.addPlayer('host', 'Patron');
  for (const [def, x, z, rot] of [
    ['frigo_vitre', 8, -8, 0],
    ['etal_fruits', 5, -5, 1],
    ['plante', 9, -1, 0],
    ['gondole_double', 2, -3, 1],
  ] as const)
    demo.apply('host', { t: 'build', def, x, z, rot });
  for (const f of w.furn)
    f.prod.forEach((p, i) => {
      if (!p) return;
      f.stock[i] = levelCap(FURN_BY_ID[f.def]);
      w.reserve[p] = 200;
    });
  for (let i = 0; i < 600; i++) demo.step(0.1);
  demo.drainFx();
  view.cam = { x: 5, z: -5, size: 17, az: 0 };
}

function enterGame(s: Session) {
  menuEl?.remove();
  menuEl = null;
  closeModal();
  demo = null;
  view.reset();
  session = s;
  hud?.destroy();
  hud = new Hud(ui, s, view, controls, audio, settings.tutorial && s.mode === 'solo');
  if (settings.tutorial && s.mode === 'solo') {
    settings.tutorial = false;
    saveSettings(settings);
  }
  hud.onMenu = () => gameMenu();
  hud.recenter();
  s.onFx = (f) => {
    if (f.k === 'sfx') audio.sfx(f.n);
    else if (f.k === 'float') view.floatText(f.text, f.x, f.z, f.color);
    else hud?.fx(f);
  };
  s.onPartner = (text, joined) => {
    audio.sfx(joined ? 'join' : 'nope');
    hud?.toast(text, joined ? 'good' : 'info', 'team');
    if (joined) {
      s.forceWorld();
      if (modalEl?.classList.contains('code-modal')) closeModal();
    }
  };
  s.onEnd = (reason) => {
    leaveGame();
    modal('Partie terminée', [reason || 'La connexion est coupée.']);
  };
  audio.play('game');
}

function startSolo(world: ReturnType<typeof createWorld>) {
  if (!settings.name) return askName(() => startSolo(world));
  enterGame(Session.local(world, settings.name));
}

async function hostGame() {
  if (!settings.name) return askName(hostGame);
  if (!session) {
    const save = loadLocal();
    startSolo(save ?? createWorld(`Chez ${settings.name}`));
  }
  const s = session!;
  if (s.mode === 'guest') return;
  if (s.host) return showCode(s.host.code);
  busy('Ouverture de la partie…');
  try {
    const code = await s.openToFriends();
    s.host!.onStatus = (t) => hud?.toast(t, 'info', 'warn');
    showCode(code);
  } catch (e: any) {
    modal('Impossible de créer la partie', [String(e?.message ?? e), 'Vous pouvez continuer à jouer seul.']);
  }
}

function showCode(code: string) {
  const m = modal(
    'Ta partie est ouverte !',
    [
      h('p', null, 'Donne ce code à ton ami :'),
      h('div', { class: 'code-big' }, ...code.split('').map((c) => h('span', null, c))),
      h('p', { class: 'muted' }, 'Sur son téléphone : « Jouer à deux » → « Rejoindre » → ce code. Tu peux déjà jouer en attendant.'),
    ],
    [{ label: 'Jouer' }],
  );
  m.classList.add('code-modal');
}

async function joinGame(code: string) {
  busy(`Connexion à la partie ${code}…`);
  try {
    const s = await Session.join(code, settings.name || 'Joueur 2');
    enterGame(s);
    hud?.toast(`Bienvenue dans le magasin de ${s.world.players.find((p) => p.id === 'host')?.name ?? 'ton ami'} !`, 'good', 'handshake');
  } catch (e: any) {
    modal('Connexion impossible', [String(e?.message ?? e)], [{ label: 'Réessayer', fn: () => duoMenu() }, { label: 'Retour', cls: 'ghost' }]);
  }
}

function leaveGame() {
  session?.close();
  session = null;
  hud?.destroy();
  hud = null;
  mainMenu();
}

function gameMenu() {
  if (!session) return;
  const s = session;
  const duoBtn =
    s.mode === 'guest'
      ? null
      : { label: s.host ? `Code de la partie : ${s.host.code}` : '👥 Inviter un ami', cls: 'cta alt', fn: () => hostGame() };
  const buttons = [
    { label: '▶ Reprendre' },
    ...(duoBtn ? [duoBtn] : []),
    { label: '⚙ Options', cls: 'ghost', fn: () => optionsMenu(true) },
    { label: '🎵 Musique suivante', cls: 'ghost', fn: () => audio.next() },
    {
      label: s.mode === 'guest' ? '🚪 Quitter la partie' : '🏠 Menu principal',
      cls: 'ghost',
      fn: () => (s.mode === 'host' && s.partners.length ? modal('Quitter ?', ['Votre ami sera déconnecté. La partie est sauvegardée.'], [{ label: 'Rester', cls: 'ghost' }, { label: 'Quitter', fn: leaveGame }]) : leaveGame()),
    },
  ];
  const m = modal(s.world.name, [h('p', { class: 'muted' }, s.mode === 'guest' ? 'Vous jouez dans le magasin de votre ami.' : 'La partie est sauvegardée automatiquement.')], buttons);
  m.querySelector('.btnrow')!.classList.add('vertical');
}

// ------------------------------------------------------------------ boucle
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  controls.update(dt);
  try {
    if (session) {
      session.update(dt);
      hud?.update(dt);
      view.update(session.world, session.agents, dt);
    } else if (demo) {
      demo.update(dt);
      demo.drainFx();
      view.cam.x = 5 + Math.sin(now / 9000) * 1.5;
      view.update(demo.w, demo.views(), dt);
    }
  } catch (e) {
    console.error(e);
  }
  requestAnimationFrame(frame);
}

function resize() {
  view.resize(innerWidth, innerHeight);
}

// ------------------------------------------------------------------ démarrage
async function boot() {
  const bar = h('i');
  const loading = h('div', { class: 'loading' }, h('img', { class: 'logo', src: './brand/bazar-bazar-logo-officiel-640.jpg', alt: '' }), h('div', { class: 'progress' }, bar), h('p', null, 'Ouverture du rideau…'));
  ui.append(loading);
  try {
    view = new View(canvas, overlay, settings.quality);
  } catch {
    loading.remove();
    ui.append(h('div', { class: 'loading' }, h('p', null, 'Ce navigateur ne peut pas afficher le jeu (WebGL indisponible).')));
    return;
  }
  controls = new Controls(canvas, view);
  addEventListener('resize', resize);
  resize();
  try {
    await loadAssets((k) => (bar.style.width = `${Math.round(k * 100)}%`));
  } catch (e) {
    console.error(e);
    loading.querySelector('p')!.textContent = 'Chargement impossible. Vérifiez la connexion puis relancez.';
    return;
  }
  makeThumbs();
  loading.remove();
  mainMenu();
  requestAnimationFrame(frame);
  const params = new URLSearchParams(location.search);
  if (params.get('join')) {
    settings.name ||= 'Joueur 2';
    joinGame(cleanCode(params.get('join')!));
  }
}

addEventListener('keydown', (e) => {
  if (e.key === 'Escape') onBack();
  if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
  if (e.key === ' ' && session) session.act({ t: 'speed', v: session.world.speed ? 0 : 1 });
  if (e.key.toLowerCase() === 'r' && !e.ctrlKey) controls?.rotate(1);
  if ((e.key.toLowerCase() === 'e' || e.key === 'Enter') && hud) hud.doAction();
});

function onBack() {
  if (modalEl) return closeModal();
  if (hud?.back()) return;
  if (session) gameMenu();
}

addEventListener('visibilitychange', () => {
  if (document.hidden) {
    session?.save();
    audio.pause(true);
  } else audio.pause(false);
});
addEventListener('pagehide', () => session?.save());

if (Capacitor.isNativePlatform()) {
  CapApp.addListener('backButton', () => onBack());
  CapApp.addListener('pause', () => session?.save());
}

// API de test (e2e)
(window as any).BAZAR = {
  get session() {
    return session;
  },
  get view() {
    return view;
  },
  get hud() {
    return hud;
  },
  hasSave,
  /** Position à l'écran d'un point du magasin (tests). */
  screenOf: (x: number, y: number, z: number) => (view as any).project(x, y, z),
  ready: () => !!view && !!(menuEl || session),
};

boot();
