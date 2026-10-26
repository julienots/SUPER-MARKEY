/**
 * Point d'entrée : rendu WebGL, écran studio, menu principal animé, boucle de jeu, raccourcis,
 * sauvegardes automatiques et API de débogage (window.BAZAR) utilisée par les tests de bout en bout.
 */
import '@fontsource/luckiest-guy/400.css';
import '@fontsource/nunito/400.css';
import '@fontsource/nunito/700.css';
import '@fontsource/nunito/800.css';
import './ui/styles.css';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Game, MIN_PER_SEC } from './game/game';
import { loadSettings, saveSettings } from './game/settings';
import { initPhysics } from './physics/physics';
import { AudioEngine } from './audio/audio';
import { MenuScene } from './ui/menuScene';
import { Menus, showSplash, dayReportDialog, priceDialog, assignDialog, competitorDialog, bankruptDialog } from './ui/menus';
import { Hud } from './ui/hud';
import { Tablet } from './ui/tablet';
import { CameraFeeds } from './ui/cameras';
import { BuildMode } from './build/buildMode';
import { h, modal } from './ui/dom';
import { downloadSave, loadFromSlot, saveToSlot, deserialize, SLOTS, slotMeta, lastSlot } from './save/save';
import { minuteOfDay, hourOf } from './sim/state';
import { cleanupPromos } from './sim/marketing';
import { money0 } from './core/math';
import { EQUIPMENT_BY_ID } from './data/equipment';
import { TouchControls, isTouchDevice } from './ui/touch';
import { loadHumanKit } from './entities/human';
import { Gallery } from './ui/gallery';
import { humanOptions } from './entities/character';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';

const settings = loadSettings();
const params = new URLSearchParams(location.search);
/** ?lowgfx : rendu allégé (tests automatisés, machines sans GPU). */
const lowGfx = params.has('lowgfx');
/** Téléphone / tablette / appli Android : contrôles tactiles et réglages graphiques allégés au premier lancement. */
const touchMode = isTouchDevice();
let firstRun = false;
try {
  firstRun = !localStorage.getItem('bazarbazar.settings');
} catch {
  /* stockage indisponible */
}
if (touchMode && firstRun) {
  settings.quality = 'moyenne';
  settings.shadows = false;
  settings.maxCustomers = 20;
  settings.uiScale = 0.85;
}
if (lowGfx) {
  settings.quality = 'basse';
  settings.shadows = false;
}
const uiRoot = document.getElementById('ui')!;
const applyUiSettings = () => {
  document.documentElement.style.setProperty('--ui-scale', String(settings.uiScale));
  document.body.classList.toggle('reduce-motion', settings.reduceMotion);
};
applyUiSettings();

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowGfx, powerPreference: 'high-performance' });
} catch (e) {
  uiRoot.append(h('div', { class: 'loading' }, 'WebGL est indisponible sur ce navigateur. BAZAR BAZAR a besoin d’une carte graphique (ou d’un navigateur récent).'));
  throw e;
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = settings.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
/**
 * Résolution de rendu : calée sur l'écran réel (devicePixelRatio), plafonnée selon la qualité, puis ajustée
 * automatiquement (resScale) pour garder une image fluide sans tomber dans le flou ou la pixellisation.
 */
let resScale = 1;
let resT = 0;
const pixelRatio = () => {
  if (lowGfx) return 0.7;
  const cap = settings.quality === 'basse' ? 1.25 : settings.quality === 'moyenne' ? 1.75 : 2;
  return Math.max(0.75, Math.min(devicePixelRatio || 1, cap) * resScale);
};
renderer.setPixelRatio(pixelRatio());

const audio = new AudioEngine(settings);
let game: Game;
let menuScene: MenuScene | null = null;
let hud: Hud | null = null;
let tablet: Tablet | null = null;
let feeds: CameraFeeds | null = null;
let build: BuildMode | null = null;
let mode: 'boot' | 'menu' | 'play' = 'boot';
let paused = false;
let lastAutosave = 0;
let fps = 60;
let touch: TouchControls | null = null;
let gallery: Gallery | null = null;

function resize() {
  const w = innerWidth;
  const hh = innerHeight;
  renderer.setSize(w, hh, false);
  if (game) {
    game.camera.aspect = w / hh;
    game.camera.updateProjectionMatrix();
  }
  if (menuScene) {
    menuScene.camera.aspect = w / hh;
    menuScene.camera.updateProjectionMatrix();
  }
}
addEventListener('resize', resize);

const menus = new Menus(settings, audio, {
  newGame: (o) => startGame(() => game.newGame({ storeName: o.name, difficulty: o.difficulty, style: o.style })),
  continueGame: () => {
    const s = lastSlot();
    if (s) loadSlot(s);
  },
  load: (slot) => loadSlot(slot),
  importFile: (json) => {
    try {
      const st = deserialize(json);
      startGame(() => game.load(st));
    } catch (e: any) {
      modal('Fichier invalide', h('div', null, String(e.message ?? e)));
    }
  },
});

function loadSlot(slot: string) {
  const r = loadFromSlot(slot);
  if (!r.st) {
    modal('Chargement impossible', h('div', null, r.error ?? 'Erreur inconnue'));
    return;
  }
  startGame(() => game.load(r.st!));
  if (r.error) setTimeout(() => game.bus.emit('notify', { text: r.error!, kind: 'bad' }), 500);
}

function startGame(init: () => void) {
  menus.hideMainMenu();
  closeOverlays();
  const loading = h('div', { class: 'loading' }, h('span', null, h('span', { class: 'spin' }, '🛒'), ' Ouverture du rideau métallique…'));
  uiRoot.append(loading);
  setTimeout(() => {
    try {
      init();
    } catch (e) {
      console.error(e);
      loading.remove();
      modal('Erreur', h('div', null, `Impossible de lancer la partie : ${(e as Error).message}`));
      showMenu();
      return;
    }
    menuScene?.dispose();
    menuScene = null;
    mode = 'play';
    paused = false;
    game.paused = false;
    lastAutosave = game.st.time;
    if (!hud) setupHud();
    hud!.setVisible(true);
    loading.remove();
    resize();
    game.bus.emit('notify', { text: `Bienvenue chez ${game.st.store.name} ! Cliquez dans la fenêtre pour prendre les commandes.`, kind: 'event' });
  }, 60);
}

function setupHud() {
  tablet = new Tablet(game, audio);
  (game as any).ui = { tablet };
  feeds = new CameraFeeds(game);
  build = new BuildMode(game, audio, canvas);
  hud = new Hud(game, audio, {
    openTablet: (t) => toggleTablet(t),
    toggleBuild: () => toggleBuild(),
    openCameras: () => toggleCams(),
    pause: () => openPause(),
  });
  const it = game.player.interaction;
  it.onEditPrice = (pid) => {
    game.player.input.exitLock();
    priceDialog(game, pid);
  };
  it.onAssignSlot = (e, idx) => {
    game.player.input.exitLock();
    assignDialog(game, e, idx);
  };
  it.onOpenTablet = (t) => toggleTablet(t);
  it.onOpenCameras = () => toggleCams();
  it.onEmployee = () => toggleTablet('personnel');
  it.onCompetitor = (id) => {
    game.player.input.exitLock();
    competitorDialog(game, id);
  };
}

function closeOverlays() {
  tablet?.open && tablet.close();
  feeds?.open && feeds.close();
  build?.active && build.exit();
  document.querySelectorAll('.modal-back').forEach((m) => m.remove());
}

function toggleTablet(tab?: string) {
  if (!tablet) return;
  if (build?.active) build.exit();
  tablet.toggle(tab);
  if (tablet.open) {
    game.player.input.exitLock();
    game.player.setMode('ui');
    if (settings.pauseOnTablet) game.paused = true;
    tablet.onClose = () => {
      game.player.setMode('walk');
      game.paused = paused;
    };
  }
}

function toggleBuild() {
  if (!build) return;
  if (tablet?.open) tablet.close();
  if (feeds?.open) feeds.close();
  if (game.player.mode === 'cashier') game.player.interaction.leaveCashier();
  if (game.player.held) game.player.dropHeld(false);
  build.toggle();
}

function toggleCams() {
  if (!feeds) return;
  feeds.toggle();
  if (feeds.open) {
    game.player.setMode('ui');
    feeds.onClose = () => game.player.setMode('walk');
  }
}

function openPause() {
  if (mode !== 'play') return;
  paused = true;
  game.paused = true;
  game.player.input.exitLock();
  const close = modal(
    '⏸ Pause',
    h(
      'div',
      { class: 'col' },
      h('div', { class: 'small muted' }, `${game.st.store.name} · jour ${Math.floor(game.st.time / 1440) + 1} · ${money0(game.st.cash)}`),
      h('button', { class: 'btn primary', onclick: () => close() }, '▶️ Reprendre'),
      h('div', { class: 'row wrap' }, ...SLOTS.filter((s) => s !== 'auto').map((s) => h('button', { class: 'btn small', onclick: () => { const r = saveToSlot(s, game.exportState()); game.bus.emit('notify', { text: r.ok ? `💾 Partie sauvegardée (emplacement ${s.slice(-1)}).` : `Échec de sauvegarde : ${r.error}`, kind: r.ok ? 'good' : 'bad' }); } }, `💾 Sauver ${s.slice(-1)}${slotMeta(s) ? ' (écraser)' : ''}`))),
      h('button', { class: 'btn', onclick: () => { close(); menus.loadDialog(); } }, '📂 Charger'),
      h('button', { class: 'btn', onclick: () => downloadSave(game.exportState()) }, '📤 Exporter la sauvegarde (.json)'),
      h('button', { class: 'btn', onclick: () => menus.optionsDialog('graphismes', () => { applyUiSettings(); renderer.setPixelRatio(pixelRatio()); resize(); }) }, '⚙️ Options'),
      h('button', { class: 'btn', onclick: () => menus.controlsDialog() }, '🎮 Commandes'),
      h('button', { class: 'btn danger', onclick: () => { close(); saveToSlot('auto', game.exportState()); toMenu(); } }, '🚪 Sauvegarder et quitter vers le menu'),
    ),
    [],
    { onClose: () => { paused = false; game.paused = false; } },
  );
}

function toMenu() {
  closeOverlays();
  hud?.setVisible(false);
  game.agents.clear();
  showMenu();
}

function showMenu() {
  mode = 'menu';
  if (!menuScene) {
    menuScene = new MenuScene();
    menuScene.reduced = settings.reduceMotion || !settings.menuAnimations;
  }
  resize();
  menus.showMainMenu();
}

// ------------------------------------------------------------ raccourcis globaux
addEventListener('keydown', (e) => {
  if (mode !== 'play') return;
  const t = e.target as HTMLElement;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
  const k = settings.keys;
  if (e.code === k.pause) {
    const modals = document.querySelectorAll('.modal-back');
    if (modals.length) return void modals[modals.length - 1].remove();
    if (build?.active) return;
    if (tablet?.open) return tablet.close();
    if (feeds?.open) return feeds.close();
    if (game.player.mode === 'cashier') return game.player.interaction.leaveCashier();
    return openPause();
  }
  if (document.querySelector('.modal-back')) return;
  if (e.code === k.tablette) {
    e.preventDefault();
    toggleTablet();
  } else if (e.code === k.construction && !build?.active) toggleBuild();
  else if (e.code === k.surveillance) toggleCams();
  else if (e.code === k.vitesse) {
    const seq = [1, 2, 4, 8, 0];
    game.st.speed = seq[(seq.indexOf(game.st.speed) + 1) % seq.length];
    audio.sfx('ui');
  }
});

canvas.addEventListener('click', () => {
  audio.unlock();
  if (mode === 'play' && (game.player.mode === 'walk' || game.player.mode === 'cashier') && !document.querySelector('.modal-back') && !tablet?.open && !feeds?.open) game.player.input.requestLock();
});
addEventListener('pointerdown', () => audio.unlock(), { once: true });

// ------------------------------------------------------------ boucle
let last = performance.now();
let ambT = 0;
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  fps = fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
  // résolution dynamique : on baisse un peu la définition si l'image saccade, on la remonte dès que possible
  resT += dt;
  if (!lowGfx && resT > 1.5 && mode === 'play') {
    resT = 0;
    const prev = resScale;
    if (fps < 38 && resScale > 0.6) resScale = Math.max(0.6, resScale - 0.1);
    else if (fps > 56 && resScale < 1) resScale = Math.min(1, resScale + 0.05);
    if (resScale !== prev) renderer.setPixelRatio(pixelRatio());
  }
  touch?.update();
  if (gallery) {
    gallery.update(dt);
    gallery.camera.aspect = innerWidth / innerHeight;
    gallery.camera.updateProjectionMatrix();
    renderer.render(gallery.scene, gallery.camera);
    return;
  }
  if (mode === 'menu' && menuScene) {
    menuScene.update(dt);
    renderer.render(menuScene.scene, menuScene.camera);
    ambT -= dt;
    if (ambT <= 0) {
      ambT = 0.5;
      audio.setMusic(settings.volMusic > 0 ? 'menu' : 'aucune');
      audio.ambience({ inStore: false, customers: 0, fridges: 0, rain: false, night: false, outdoor: 0, menu: true });
    }
    return;
  }
  if (mode !== 'play') return;
  game.update(dt);
  (game.scene as any).environmentIntensity = 0.08 + 0.32 * (1 - (game.sky?.night ?? 0)) + (game.player.inStore && !game.powerOut ? 0.15 : 0);
  build?.update(dt);
  hud?.update(dt);
  tablet?.update(dt);
  // audio : position de l'auditeur, ambiances, musique du magasin
  const p = game.player;
  audio.listener = { x: game.camera.position.x, z: game.camera.position.z, yaw: p.yaw };
  ambT -= dt;
  if (ambT <= 0) {
    ambT = 0.4;
    const inStore = p.inStore;
    const fridges = game.st.equipment.filter((e) => EQUIPMENT_BY_ID[e.def].alwaysOn && EQUIPMENT_BY_ID[e.def].shelf).length;
    const night = hourOf(game.st.time) < 7 || hourOf(game.st.time) > 21;
    audio.ambience({ inStore, customers: game.agents.count('customer'), fridges: game.powerOut ? 0 : fridges, rain: game.st.weather.kind === 'pluie' || game.st.weather.kind === 'orage', night, outdoor: 1 });
    const music = game.st.store.music;
    audio.setMusic(game.powerOut ? 'aucune' : music, inStore && game.isOpen() ? 1 : inStore ? 0.35 : 0.12);
    // sauvegarde automatique
    if (settings.autosaveMinutes > 0 && game.st.time - lastAutosave >= settings.autosaveMinutes && !game.skipping) {
      lastAutosave = game.st.time;
      const r = saveToSlot('auto', game.exportState());
      if (!r.ok) game.bus.emit('notify', { text: `Sauvegarde auto impossible : ${r.error}`, kind: 'bad' });
    }
  }
  renderer.render(game.scene, game.camera);
  feeds?.render(renderer);
}

// ------------------------------------------------------------ démarrage
async function boot() {
  const loading = h('div', { class: 'loading' }, h('span', null, h('span', { class: 'spin' }, '🛒'), ' Chargement du quartier…'));
  uiRoot.append(loading);
  await initPhysics();
  // personnages réalistes (kit MakeHuman) : en cas d'échec, les personnages procéduraux simples sont utilisés
  humanOptions.expressions = settings.quality !== 'basse';
  await loadHumanKit();
  await document.fonts?.ready;
  game = new Game(false, settings);
  await game.init();
  game.player.input.touch = touchMode;
  if (touchMode) touch = new TouchControls(canvas, { game: () => game ?? null, build: () => build, playing: () => mode === 'play' });
  // carte d'environnement (reflets crédibles sur le métal, le verre, les canettes)
  if (!lowGfx) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    game.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    (game.scene as any).environmentIntensity = 0.4;
  }
  game.bus.on('sfx', (s) => audio.sfx(s.name, s.x, s.z));
  game.bus.on('dayReport', (r) => {
    cleanupPromos(game.st);
    if (game.skipping) {
      game.bus.emit('notify', { text: `🌙 Bilan J${r.day + 1} : ${r.customers} clients, CA ${money0(r.revenue)}, résultat ${money0(r.profit)}.`, kind: r.profit >= 0 ? 'good' : 'bad' });
      for (const n of r.notes) game.bus.emit('notify', { text: n, kind: 'info' });
      return;
    }
    game.paused = true;
    game.player.input.exitLock();
    dayReportDialog(r, () => (game.paused = paused));
  });
  game.bus.on('bankrupt', () => {
    game.paused = true;
    game.player.input.exitLock();
    bankruptDialog(
      () => menus.newGameDialog(),
      () => menus.loadDialog(),
      () => {
        game.st.bankrupt = false;
        game.st.debtDays = 0;
        game.st.cash = 1500;
        game.st.reputation.overall *= 0.5;
        game.paused = false;
      },
    );
  });
  game.player.onModeChange = (m) => {
    if (m === 'walk' && !document.querySelector('.modal-back')) setTimeout(() => game.player.input.requestLock(), 50);
  };
  loading.remove();
  resize();
  requestAnimationFrame(frame);
  if (params.has('gallery')) {
    // galerie de personnages (contrôle visuel) : ?gallery=<graine>&n=<nombre>&close&actions
    gallery = new Gallery(Number(params.get('gallery')) || 1, Number(params.get('n')) || 10, { close: params.has('close'), actions: params.has('actions'), hair: params.has('hair') });
    (window as any).BAZAR = debugApi();
    (window as any).BAZAR.gallery = gallery;
    return;
  }
  // menu derrière l'écran studio
  showMenu();
  if (!params.has('nosplash')) showSplash(() => audio.unlock());
  (window as any).BAZAR = debugApi();
  // appli Android : bouton retour = Échap (pause, fermer un panneau), sauvegarde quand l'appli passe en arrière-plan
  if (Capacitor.isNativePlatform()) {
    void CapApp.addListener('backButton', () => {
      if (mode === 'play') return void dispatchEvent(new KeyboardEvent('keydown', { code: settings.keys.pause }));
      const m = document.querySelectorAll('.modal-back');
      if (m.length) m[m.length - 1].remove();
    });
    void CapApp.addListener('pause', () => {
      if (mode === 'play' && !game.skipping) saveToSlot('auto', game.exportState());
    });
  }
}

/** API de débogage/tests (utilisée par scripts/e2e.mjs). */
function debugApi() {
  return {
    get game() {
      return game;
    },
    get mode() {
      return mode;
    },
    get fps() {
      return fps;
    },
    newGame: (o: any = {}) => new Promise<void>((res) => {
      startGame(() => game.newGame({ seed: 1234, ...o }));
      const iv = setInterval(() => {
        if (mode === 'play') {
          clearInterval(iv);
          res();
        }
      }, 50);
    }),
    simulate: (seconds: number) => game.simulate(seconds),
    stats: () => ({
      time: game.st.time,
      minute: minuteOfDay(game.st.time),
      cash: game.st.cash,
      customers: game.agents.count('customer'),
      served: game.st.stats.customersServed,
      revenue: game.st.today.revenue,
      employees: game.st.employees.length,
      units: game.equipView.visibleUnits,
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      fps,
      minPerSec: MIN_PER_SEC,
    }),
    save: (slot = 'slot1') => saveToSlot(slot, game.exportState()),
    load: (slot = 'slot1') => loadSlot(slot),
    toggleBuild,
    toggleTablet,
    toggleCams,
    settings,
    saveSettings: () => saveSettings(settings),
  };
}

boot().catch((e) => {
  console.error(e);
  uiRoot.append(h('div', { class: 'loading' }, `Erreur au démarrage : ${e.message}`));
});
