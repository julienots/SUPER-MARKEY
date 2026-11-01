/**
 * Point d'entrée — BAZAR BAZAR en 2.5D : scène 3D (modèles Blender) vue par une caméra isométrique fixe,
 * murs coupés côté caméra, commandes au doigt et à la souris. Menu principal par-dessus le magasin vivant,
 * HUD de commerçant (ouvrir/fermer, grossiste, gestion, aménagement), patron piloté d'un appui,
 * sauvegardes automatiques et API de débogage (window.BAZAR) pour les tests de bout en bout.
 */
import '@fontsource/luckiest-guy/400.css';
import '@fontsource/nunito/400.css';
import '@fontsource/nunito/700.css';
import '@fontsource/nunito/800.css';
import './ui/styles.css';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { Game, MIN_PER_SEC } from './game/game';
import { loadSettings, saveSettings } from './game/settings';
import { initPhysics } from './physics/physics';
import { loadModels } from './models/kit';
import { AudioEngine } from './audio/audio';
import { Menus, showSplash, dayReportDialog, bankruptDialog } from './ui/menus';
import { Hud } from './ui/hud';
import { Tablet } from './ui/tablet';
import { BuildMode } from './build/buildMode';
import { h, modal } from './ui/dom';
import { isTouchDevice } from './ui/touch';
import { Gallery } from './ui/gallery';
import { downloadSave, loadFromSlot, saveToSlot, deserialize, SLOTS, slotMeta, lastSlot } from './save/save';
import { createNewGame } from './sim/newgame';
import { minuteOfDay, hourOf } from './sim/state';
import { cleanupPromos } from './sim/marketing';
import { money0 } from './core/math';
import { EQUIPMENT_BY_ID } from './data/equipment';
import { MUSIC_STYLES } from './data/styles';
import { equipCenter } from './sim/layout';
import { IsoCamera } from './iso/isoCamera';
import { IsoControls } from './iso/controls';
import { Manager } from './iso/manager';
import { pick } from './iso/picking';
import { SelectionPanel } from './iso/panels';
import { OrderScreen, BuildScreen, TeamScreen, levelUpScreen, levelBadge } from './iso/screens';
import { uiIcon } from './iso/art';
import { equipThumb } from './iso/thumbs';
import { checkLevelUp } from './sim/progress';

const settings = loadSettings();
const params = new URLSearchParams(location.search);
const lowGfx = params.has('lowgfx');
const touchMode = isTouchDevice();
let firstRun = false;
try {
  firstRun = !localStorage.getItem('bazarbazar.settings');
} catch {
  /* stockage indisponible */
}
if (touchMode && firstRun) {
  settings.quality = 'moyenne';
  settings.maxCustomers = 24;
  settings.uiScale = 0.9;
}
if (lowGfx) {
  settings.quality = 'basse';
  settings.shadows = false;
}
document.body.classList.toggle('touch', touchMode);
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
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = !lowGfx && settings.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
let resScale = 1;
let resT = 0;
const pixelRatio = () => {
  if (lowGfx) return 0.75;
  const cap = settings.quality === 'basse' ? 1.25 : settings.quality === 'moyenne' ? 1.75 : 2;
  return Math.max(0.75, Math.min(devicePixelRatio || 1, cap) * resScale);
};

const audio = new AudioEngine(settings);
const iso = new IsoCamera();
let game: Game;
let controls: IsoControls;
let manager: Manager;
let panel: SelectionPanel | null = null;
let orderScr: OrderScreen | null = null;
let buildScr: BuildScreen | null = null;
let teamScr: TeamScreen | null = null;
let lvBadge: { el: HTMLElement; update: () => void } | null = null;
let lvT = 0;
let deliveryChip: HTMLElement | null = null;
let hud: Hud | null = null;
let tablet: Tablet | null = null;
let build: BuildMode | null = null;
let mode: 'boot' | 'menu' | 'play' = 'boot';
let paused = false;
let lastAutosave = 0;
let fps = 60;
let sides = '';
let scanT = 0;
let tapFx: THREE.Mesh | null = null;
let tapFxT = 0;
let wasClosed = false;

function resize() {
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(innerWidth, innerHeight, false);
  iso.w = innerWidth;
  iso.h = innerHeight;
  iso.update();
}
addEventListener('resize', resize);

/** Recadre la vue sur le magasin. */
function frameStore() {
  const r = game.storeRect();
  iso.fit(r.x0 - 1, r.z0 - 4, r.x1 + 1, r.z1 + 1);
  // écran vertical : on cadre plus serré (le magasin occupe la largeur)
  if (iso.h > iso.w) {
    iso.zoom = Math.min(iso.maxZoom, iso.zoom * 1.45);
    iso.update();
  }
  updateCutaway(true);
}

function updateCutaway(force = false) {
  const s = iso.nearSides().join(',');
  if (s !== sides || force) {
    sides = s;
    game.storeBuilding.setCutaway(iso.nearSides());
  }
}

// ------------------------------------------------------------ menus
const menus = new Menus(settings, audio, {
  newGame: (o) => startGame(() => game.newGame({ storeName: o.name, difficulty: o.difficulty, style: o.style, emptyStart: true })),
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

/** Magasin de démonstration derrière le menu principal : rayons pleins, clients, rotation lente. */
function demoStore() {
  const st = createNewGame({ seed: 4242, residents: 400 });
  st.time = 10 * 60 + 15;
  game.load(st);
  game.paused = false;
  game.st.speed = 1;
  game.simulate(25);
  iso.azimuth = Math.PI / 4;
  frameStore();
  iso.zoom *= 1.15;
  iso.update();
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
    manager.cancel();
    mode = 'play';
    paused = false;
    game.paused = false;
    lastAutosave = game.st.time;
    wasClosed = !!game.st.flags.manualClosed;
    if (!hud) setupHud();
    hud!.setVisible(true);
    loading.remove();
    iso.azimuth = Math.PI / 4;
    resize();
    frameStore();
    controls.enabled = true;
    const st = game.st;
    game.bus.emit('notify', { text: st.flags.emptyStart && !st.stats.ordersPlaced ? `Bienvenue chez ${st.store.name} ! Remplissez votre rayon avec ce qu’il y a en réserve, puis ouvrez.` : `Bon retour chez ${st.store.name} !`, kind: 'event' });
  }, 60);
}

function setupHud() {
  tablet = new Tablet(game, audio);
  (game as any).ui = { tablet };
  build = new BuildMode(game, audio, canvas);
  build.iso = { cam: () => iso.cam };
  build.onExit = () => updateCutaway(true);
  orderScr = new OrderScreen(game, audio);
  buildScr = new BuildScreen(game, audio, { place: (def) => openBuild(def), arrange: () => openBuild() });
  teamScr = new TeamScreen(game, audio);
  lvBadge = levelBadge(game);
  deliveryChip = h('div', { class: 'm-delivchip' });
  deliveryChip.style.display = 'none';
  panel = new SelectionPanel(game, manager, audio, {
    openShop: (pids) => openShop(pids),
    openTeam: () => openTeam(),
    rotate: (uid) => {
      if (!build) return;
      build.rotateInPlace(uid);
    },
    move: (uid) => {
      const e = game.st.equipment.find((x) => x.uid === uid);
      if (!e || !build) return;
      panel?.close();
      closeScreens();
      build.quickPlace(e.def, { x: 0, z: 0 }, uid);
    },
    sell: (uid) => {
      build?.sellUid(uid);
    },
    openTablet: (t) => toggleTablet(t),
    openBuild: () => {
      const s = panel?.sel;
      openBuild();
      if (s?.kind === 'equip') build!.selectUid(s.e.uid);
    },
  });
  hud = new Hud(
    game,
    audio,
    { openTablet: (t) => toggleTablet(t), toggleBuild: () => toggleBuild(), openCameras: () => {}, pause: () => openPause() },
    {
      camera: () => iso.cam,
      focus: () => iso.target,
      status: () => (manager.status ? `👑 ${manager.status}` : ''),
      extraTop: [lvBadge.el],
      tools: [
        { ico: uiIcon('cart'), label: 'Commander', fn: () => openShop() },
        { ico: uiIcon('build'), label: 'Construire', fn: () => openBuildScreen() },
        { ico: uiIcon('team'), label: 'Équipe', fn: () => openTeam() },
        { ico: uiIcon('menu'), label: 'Menu', fn: () => openPause(), badge: true },
      ],
    },
  );
  // zoom à l'écran (en plus du pincement et de la molette)
  const zoomBy = (f: number) => {
    iso.zoomAt(f, iso.w / 2, iso.h / 2);
    audio.sfx('ui');
  };
  hud.root.append(
    h(
      'div',
      { id: 'zoom-btns', class: 'panel' },
      h('button', { 'aria-label': 'Zoomer', title: 'Zoomer (+)', onclick: () => zoomBy(1.3) }, '＋'),
      h('button', { 'aria-label': 'Dézoomer', title: 'Dézoomer (−)', onclick: () => zoomBy(1 / 1.3) }, '－'),
      h('button', { 'aria-label': 'Voir tout le magasin', title: 'Voir tout le magasin', onclick: () => { frameStore(); audio.sfx('ui'); } }, '⤢'),
      h('button', { 'aria-label': 'Tourner la vue', title: 'Tourner la vue (R)', onclick: () => { iso.rotate(1); updateCutaway(); audio.sfx('ui'); } }, '⟳'),
    ),
  );
  // la puce « livraison » se range dans la barre du haut (rien ne flotte au-dessus du magasin)
  hud.root.querySelector('.hud-top')?.append(deliveryChip);
}

function closeScreens() {
  orderScr?.open && orderScr.close();
  buildScr?.open && buildScr.close();
  teamScr?.open && teamScr.close();
}

function closeOverlays() {
  tablet?.open && tablet.close();
  build?.active && build.exit();
  closeScreens();
  panel?.close();
  document.querySelectorAll('.modal-back').forEach((m) => m.remove());
}

function toggleTablet(tab?: string) {
  if (!tablet) return;
  if (build?.active) build.exit();
  closeScreens();
  tablet.toggle(tab);
  if (tablet.open) {
    game.st.flags.tabletOpened = true;
    if (settings.pauseOnTablet) game.paused = true;
    tablet.onClose = () => (game.paused = paused);
  }
}

function openShop(pids?: string[]) {
  if (!orderScr) return;
  tablet?.open && tablet.close();
  if (build?.active) build.exit();
  closeScreens();
  orderScr.show(pids);
}

function openBuildScreen() {
  if (!buildScr) return;
  tablet?.open && tablet.close();
  if (build?.active) build.exit();
  closeScreens();
  buildScr.show();
}

function openTeam() {
  if (!teamScr) return;
  tablet?.open && tablet.close();
  if (build?.active) build.exit();
  closeScreens();
  teamScr.show();
}

function openBuild(def?: string) {
  if (!build) return;
  tablet?.open && tablet.close();
  closeScreens();
  panel?.close();
  manager.cancel();
  if (game.player.mode === 'cashier') game.player.interaction.leaveCashier();
  if (def) {
    // pose rapide près du centre de l'écran (dans le magasin)
    const c = iso.ground(iso.w / 2, iso.h / 2) ?? { x: 0, z: 6 };
    const r = game.storeRect();
    build.quickPlace(def, { x: Math.max(r.x0 + 1, Math.min(r.x1 - 1, c.x)), z: Math.max(1, Math.min(r.backZ - 1, c.z)) });
  }
  else if (!build.active) build.enter();
}

function toggleBuild() {
  if (!build) return;
  if (build.active) build.exit();
  else openBuild();
}

function openPause() {
  if (mode !== 'play') return;
  closeScreens();
  paused = true;
  game.paused = true;
  const big = (icon: string, label: string, fn: () => void, cls = '') => h('button', { class: `m-btn menu ${cls}`, onclick: fn }, h('img', { src: uiIcon(icon), alt: '', width: 34, height: 34 }), label);
  const close = modal(
    'Menu',
    h(
      'div',
      { class: 'm-menu' },
      h('div', { class: 'small muted' }, `${game.st.store.name} · jour ${Math.floor(game.st.time / 1440) + 1} · ${money0(game.st.cash)}`),
      big('play', 'Reprendre', () => close(), 'green'),
      big('save', 'Sauvegarder', () => {
        const r = saveToSlot('slot1', game.exportState());
        game.bus.emit('notify', { text: r.ok ? '💾 Partie sauvegardée.' : `Échec de sauvegarde : ${r.error}`, kind: r.ok ? 'good' : 'bad' });
        audio.sfx(r.ok ? 'cash' : 'error');
      }),
      (() => {
        // musique du magasin : un appui = morceau suivant
        const name = () => MUSIC_STYLES.find((m) => m.id === game.st.store.music)?.name ?? 'Silence';
        const b = big('speaker', `Musique : ${name()}`, () => {
          const i = MUSIC_STYLES.findIndex((m) => m.id === game.st.store.music);
          game.st.store.music = MUSIC_STYLES[(i + 1) % MUSIC_STYLES.length].id;
          b.lastChild!.textContent = `Musique : ${name()}`;
          audio.setMusic(game.st.store.music, 1);
        });
        return b;
      })(),
      big('chart', 'Gestion avancée', () => { close(); toggleTablet(); }),
      big('gear', 'Options', () => menus.optionsDialog('graphismes', () => { applyUiSettings(); resize(); })),
      big('door', 'Quitter vers le menu', () => { close(); saveToSlot('auto', game.exportState()); toMenu(); }, 'red'),
    ),
    [],
    { onClose: () => { paused = false; game.paused = false; }, width: 'min(420px, 94vw)' },
  );
}

function toMenu() {
  closeOverlays();
  hud?.setVisible(false);
  manager.cancel();
  showMenu();
}

function showMenu() {
  mode = 'menu';
  controls.enabled = false;
  demoStore();
  resize();
  menus.showMainMenu();
}

// ------------------------------------------------------------ appuis dans la scène
function onTap(sx: number, sy: number, mouse: boolean) {
  audio.unlock();
  if (mode !== 'play' || document.querySelector('.modal-back')) return;
  if (build?.active) {
    const r = canvas.getBoundingClientRect();
    build.tap(sx + r.left, sy + r.top, mouse);
    return;
  }
  const hit = pick(game, iso.rayAt(sx, sy).ray);
  if (!hit) return;
  if (hit.kind === 'ground') {
    panel?.close();
    showTapFx(hit.x, hit.z);
    return;
  }
  panel?.select(hit);
}

function showTapFx(x: number, z: number) {
  if (!tapFx) {
    const g = new THREE.RingGeometry(0.15, 0.3, 32);
    g.rotateX(-Math.PI / 2);
    tapFx = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }));
    tapFx.renderOrder = 6;
    game.scene.add(tapFx);
  }
  tapFx.position.set(x, 0.05, z);
  tapFx.visible = true;
  tapFxT = 0.6;
}

// ------------------------------------------------------------ raccourcis
addEventListener('keydown', (e) => {
  if (mode !== 'play') return;
  const t = e.target as HTMLElement;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
  const k = settings.keys;
  if (e.code === k.pause) {
    const modals = document.querySelectorAll('.modal-back');
    if (modals.length) return void modals[modals.length - 1].remove();
    if (build?.active) return;
    if (orderScr?.open || buildScr?.open || teamScr?.open) return closeScreens();
    if (tablet?.open) return tablet.close();
    if (panel?.sel) return panel.close();
    return openPause();
  }
  if (document.querySelector('.modal-back')) return;
  if (e.code === k.tablette) {
    e.preventDefault();
    toggleTablet();
  } else if (e.code === k.construction && !build?.active) (buildScr?.open ? buildScr.close() : openBuildScreen());
  else if (e.code === 'KeyG') (orderScr?.open ? orderScr.close() : openShop());
  else if (e.code === 'KeyE') (teamScr?.open ? teamScr.close() : openTeam());
  else if (e.code === 'KeyR' && !build?.active) {
    iso.rotate(e.shiftKey ? -1 : 1);
    updateCutaway();
  } else if (e.code === k.vitesse) {
    const seq = [1, 2, 4, 8, 0];
    game.st.speed = seq[(seq.indexOf(game.st.speed) + 1) % seq.length];
    audio.sfx('ui');
  }
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
  resT += dt;
  if (!lowGfx && resT > 1.5 && mode === 'play') {
    resT = 0;
    const prev = resScale;
    if (fps < 38 && resScale > 0.6) resScale = Math.max(0.6, resScale - 0.1);
    else if (fps > 56 && resScale < 1) resScale = Math.min(1, resScale + 0.05);
    if (resScale !== prev) renderer.setPixelRatio(pixelRatio());
  }
  if (mode === 'boot') return;
  if (mode === 'menu') {
    iso.azimuth += dt * 0.06 * (settings.reduceMotion ? 0 : 1);
    iso.update();
    updateCutaway();
  } else {
    controls.update(dt);
    // la vue reste autour du magasin
    const r = game.storeRect();
    iso.target.x = Math.max(r.x0 - 14, Math.min(r.x1 + 14, iso.target.x));
    iso.target.z = Math.max(r.z0 - 16, Math.min(r.z1 + 10, iso.target.z));
    iso.update();
  }
  game.camera.position.set(iso.target.x, 1.6, iso.target.z);
  manager.update(game.paused ? 0 : dt * game.st.speed);
  game.update(dt);
  (game.scene as any).environmentIntensity = 0.1 + 0.3 * (1 - (game.sky?.night ?? 0));
  if (tapFx && tapFxT > 0) {
    tapFxT -= dt;
    tapFx.scale.setScalar(1 + (0.6 - tapFxT) * 2.5);
    (tapFx.material as THREE.MeshBasicMaterial).opacity = Math.max(0, tapFxT / 0.6);
    tapFx.visible = tapFxT > 0;
  }
  // le patron (non pilotable) se tient à la caisse qu'il tient ; caché s'il n'en tient aucune
  const bl = game.checkouts.bossLane();
  game.player.visibleIso = !!bl;
  if (bl) {
    const c = bl.pts.cashier;
    if (Math.hypot(game.player.pos.x - c.x, game.player.pos.z - c.z) > 0.05) game.player.teleport(c.x, c.z, Math.atan2(bl.pts.pay.x - c.x, bl.pts.pay.z - c.z));
  }
  if (mode === 'play') {
    build?.update(dt);
    document.body.classList.toggle('building', !!build?.active);
    document.body.classList.toggle('has-panel', !!panel?.sel);
    hud?.update(dt);
    tablet?.update(dt);
    panel?.update(dt);
    // niveau (badge, passage de niveau) et livraisons en cours
    lvT -= dt;
    if (lvT <= 0) {
      lvT = 0.5;
      lvBadge?.update();
      const lv = checkLevelUp(game.st);
      if (lv) {
        game.paused = true;
        levelUpScreen(lv, audio, () => (game.paused = paused), (d) => equipThumb(d, game.equipView.style(game.st)));
      }
      if (deliveryChip) {
        const o = game.st.orders.filter((x) => x.status === 'en_cours' || x.status === 'livraison').sort((a, b) => a.eta - b.eta)[0];
        deliveryChip.style.display = o ? '' : 'none';
        if (o) deliveryChip.textContent = o.status === 'livraison' ? '🚚 Le livreur arrive !' : `🚚 Livraison dans ${Math.max(1, Math.ceil(o.eta - game.st.time))} min`;
      }
    }
  }
  // audio
  audio.listener = { x: iso.target.x, z: iso.target.z, yaw: iso.azimuth };
  ambT -= dt;
  if (ambT <= 0) {
    ambT = 0.4;
    const fridges = game.st.equipment.filter((e) => EQUIPMENT_BY_ID[e.def].alwaysOn && EQUIPMENT_BY_ID[e.def].shelf).length;
    const night = hourOf(game.st.time) < 7 || hourOf(game.st.time) > 21;
    if (mode === 'menu') {
      audio.setMusic(settings.volMusic > 0 ? 'menu' : 'aucune');
      audio.ambience({ inStore: false, customers: 0, fridges: 0, rain: false, night: false, outdoor: 0, menu: true });
    } else {
      audio.ambience({ inStore: true, customers: game.agents.count('customer'), fridges: game.powerOut ? 0 : fridges, rain: game.st.weather.kind === 'pluie' || game.st.weather.kind === 'orage', night, outdoor: 0.5 });
      audio.setMusic(game.powerOut ? 'aucune' : game.st.store.music, game.isOpen() ? 1 : 0.4);
      if (settings.autosaveMinutes > 0 && game.st.time - lastAutosave >= settings.autosaveMinutes && !game.skipping) {
        lastAutosave = game.st.time;
        const r = saveToSlot('auto', game.exportState());
        if (!r.ok) game.bus.emit('notify', { text: `Sauvegarde auto impossible : ${r.error}`, kind: 'bad' });
      }
    }
  }
  renderer.render(game.scene, iso.cam);
}

// ------------------------------------------------------------ démarrage
async function bootGallery() {
  await loadModels();
  resize();
  const gal = new Gallery(Number(params.get('gallery')) || 1, Number(params.get('n')) || 8, { close: params.has('close'), actions: params.has('actions'), hair: params.has('hair') });
  let t0 = performance.now();
  const f = (now: number) => {
    requestAnimationFrame(f);
    gal.update(Math.min(0.1, (now - t0) / 1000));
    t0 = now;
    gal.camera.aspect = innerWidth / innerHeight;
    gal.camera.updateProjectionMatrix();
    renderer.render(gal.scene, gal.camera);
  };
  requestAnimationFrame(f);
  (window as any).BAZAR = { gallery: gal };
}

async function boot() {
  if (params.has('gallery')) return bootGallery();
  const loading = h('div', { class: 'loading' }, h('span', null, h('span', { class: 'spin' }, '🛒'), ' Chargement du quartier…'));
  uiRoot.append(loading);
  await initPhysics();
  await loadModels();
  await document.fonts?.ready;
  game = new Game(false, settings);
  await game.init();
  game.storeBuilding.isoMode = true;
  game.player.isoMode = true;
  game.player.input.enabled = false;
  game.viewFocus = iso.target;
  game.autoBoss = true;
  if (game.sky) game.sky.fogShift = 105;
  manager = new Manager(game);
  manager.onMessage = (text, kind) => game.bus.emit('notify', { text, kind: (kind as any) ?? 'info' });
  if (!lowGfx) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    game.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  }
  game.bus.on('sfx', (s) => audio.sfx(s.name, s.x, s.z));
  game.bus.on('dayReport', (r) => {
    if (mode !== 'play') return;
    cleanupPromos(game.st);
    if (game.skipping) {
      game.bus.emit('notify', { text: `🌙 Bilan J${r.day + 1} : ${r.customers} clients, CA ${money0(r.revenue)}, résultat ${money0(r.profit)}.`, kind: r.profit >= 0 ? 'good' : 'bad' });
      return;
    }
    game.paused = true;
    dayReportDialog(r, () => (game.paused = paused));
  });
  game.bus.on('bankrupt', () => {
    if (mode !== 'play') return;
    game.paused = true;
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
  controls = new IsoControls(canvas, iso, { tap: onTap, panned: () => {} });
  loading.remove();
  resize();
  showMenu();
  requestAnimationFrame(frame);
  if (!params.has('nosplash')) showSplash(() => audio.unlock());
  (window as any).BAZAR = debugApi();
  if (Capacitor.isNativePlatform()) {
    void CapApp.addListener('backButton', () => {
      if (mode === 'play') {
        if (build?.active) return build.exit();
        return void dispatchEvent(new KeyboardEvent('keydown', { code: settings.keys.pause }));
      }
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
    iso,
    audio,
    get manager() {
      return manager;
    },
    get orderScr() {
      return orderScr;
    },
    get buildScr() {
      return buildScr;
    },
    get teamScr() {
      return teamScr;
    },
    get panel() {
      return panel;
    },
    newGame: (o: any = {}) =>
      new Promise<void>((res) => {
        startGame(() => game.newGame({ seed: 1234, emptyStart: true, ...o }));
        const iv = setInterval(() => {
          if (mode === 'play') {
            clearInterval(iv);
            res();
          }
        }, 50);
      }),
    simulate: (seconds: number) => game.simulate(seconds),
    /** Simule en faisant aussi agir le patron (ordres en cours). */
    simulateBoss: (seconds: number, step = 0.1) => {
      for (let t = 0; t < seconds; t += step) {
        manager.update(step * game.st.speed);
        game.update(step);
      }
    },
    project: (x: number, y: number, z: number) => iso.project(x, y, z),
    /** Centre au sol d'un meuble (uid). */
    center: (uid: number) => {
      const e = game.st.equipment.find((x) => x.uid === uid);
      return e ? equipCenter(e) : null;
    },
    tap: (sx: number, sy: number) => onTap(sx, sy, true),
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
    openShop,
    openBuildScreen,
    openTeam,
    settings,
    saveSettings: () => saveSettings(settings),
  };
}

boot().catch((e) => {
  console.error(e);
  uiRoot.append(h('div', { class: 'loading' }, `Erreur au démarrage : ${e.message}`));
});
