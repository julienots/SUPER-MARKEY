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
import { IsoCamera } from './iso/isoCamera';
import { IsoControls } from './iso/controls';
import { Manager } from './iso/manager';
import { pick } from './iso/picking';
import { SelectionPanel } from './iso/panels';
import { Shop } from './iso/shop';

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
let shop: Shop | null = null;
let hud: Hud | null = null;
let tablet: Tablet | null = null;
let build: BuildMode | null = null;
let mode: 'boot' | 'menu' | 'play' = 'boot';
let paused = false;
let lastAutosave = 0;
let fps = 60;
let sides = '';
let scanBtn: HTMLElement | null = null;
let scanT = 0;
let tapFx: THREE.Mesh | null = null;
let tapFxT = 0;

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
    if (!hud) setupHud();
    hud!.setVisible(true);
    loading.remove();
    iso.azimuth = Math.PI / 4;
    resize();
    frameStore();
    controls.enabled = true;
    const st = game.st;
    game.bus.emit('notify', { text: st.flags.emptyStart && !st.stats.ordersPlaced ? `Bienvenue chez ${st.store.name} ! Les rayons sont vides : direction le 🛒 Grossiste.` : `Bon retour chez ${st.store.name} !`, kind: 'event' });
  }, 60);
}

function setupHud() {
  tablet = new Tablet(game, audio);
  (game as any).ui = { tablet };
  build = new BuildMode(game, audio, canvas);
  build.iso = { cam: () => iso.cam };
  build.onExit = () => updateCutaway(true);
  shop = new Shop(game, audio, { place: (def) => openBuild(def) });
  panel = new SelectionPanel(game, manager, audio, {
    openShop: (pids) => openShop(pids),
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
      tools: [
        { ico: '🛒', label: 'Grossiste', fn: () => openShop() },
        { ico: '📱', label: 'Gestion', fn: () => toggleTablet(), badge: true },
        { ico: '🏗️', label: 'Aménager', fn: () => toggleBuild() },
        { ico: '👑', label: 'Patron', fn: () => { const p = game.player.pos; iso.target.set(p.x, 0, p.z); iso.update(); panel?.select({ kind: 'player' }); } },
        { ico: '⟳', label: 'Tourner', fn: () => { iso.rotate(1); updateCutaway(); audio.sfx('ui'); } },
        { ico: '⏸', label: 'Menu', fn: () => openPause() },
      ],
    },
  );
  scanBtn = h('button', { id: 'scan-btn', class: 'btn primary', onclick: () => scan(true) }, h('span', { class: 'big' }, '📟'), h('span', null, 'SCANNER'));
  scanBtn.style.display = 'none';
  uiRoot.append(scanBtn);
}

function scan(manual: boolean) {
  const l = game.player.lane;
  if (!l || game.player.mode !== 'cashier') return;
  scanT = 0;
  const err = game.checkouts.playerScan(l);
  if (err && manual) game.bus.emit('notify', { text: err, kind: 'info', key: 'scan-err' });
}

function closeOverlays() {
  tablet?.open && tablet.close();
  build?.active && build.exit();
  shop?.open && shop.close();
  panel?.close();
  document.querySelectorAll('.modal-back').forEach((m) => m.remove());
}

function toggleTablet(tab?: string) {
  if (!tablet) return;
  if (build?.active) build.exit();
  shop?.open && shop.close();
  tablet.toggle(tab);
  if (tablet.open) {
    game.st.flags.tabletOpened = true;
    if (settings.pauseOnTablet) game.paused = true;
    tablet.onClose = () => (game.paused = paused);
  }
}

function openShop(pids?: string[]) {
  if (!shop) return;
  tablet?.open && tablet.close();
  if (build?.active) build.exit();
  shop.show('marchandises', pids);
}

function openBuild(def?: string) {
  if (!build) return;
  tablet?.open && tablet.close();
  shop?.open && shop.close();
  panel?.close();
  manager.cancel();
  if (game.player.mode === 'cashier') game.player.interaction.leaveCashier();
  if (def) build.startPlacing(def);
  else if (!build.active) build.enter();
}

function toggleBuild() {
  if (!build) return;
  if (build.active) build.exit();
  else openBuild();
}

function openPause() {
  if (mode !== 'play') return;
  paused = true;
  game.paused = true;
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
      h('button', { class: 'btn', onclick: () => menus.optionsDialog('graphismes', () => { applyUiSettings(); resize(); }) }, '⚙️ Options'),
      h('button', { class: 'btn danger', onclick: () => { close(); saveToSlot('auto', game.exportState()); toMenu(); } }, '🚪 Sauvegarder et quitter vers le menu'),
    ),
    [],
    { onClose: () => { paused = false; game.paused = false; } },
  );
}

function toMenu() {
  closeOverlays();
  hud?.setVisible(false);
  if (scanBtn) scanBtn.style.display = 'none';
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
  if (shop?.open) shop.close();
  const hit = pick(game, iso.rayAt(sx, sy).ray);
  if (!hit) return;
  if (hit.kind === 'ground') {
    panel?.close();
    if (game.player.mode === 'cashier') game.player.interaction.leaveCashier();
    if (!game.nav.walkableAt(hit.x, hit.z, { staff: true, keys: true })) return;
    manager.goTo(hit.x, hit.z);
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
    if (shop?.open) return shop.close();
    if (tablet?.open) return tablet.close();
    if (panel?.sel) return panel.close();
    return openPause();
  }
  if (document.querySelector('.modal-back')) return;
  if (e.code === k.tablette) {
    e.preventDefault();
    toggleTablet();
  } else if (e.code === k.construction && !build?.active) toggleBuild();
  else if (e.code === 'KeyG') (shop?.open ? shop.close() : openShop());
  else if (e.code === 'KeyR' && !build?.active) {
    iso.rotate(e.shiftKey ? -1 : 1);
    updateCutaway();
  } else if (e.code === 'Space' && game.player.mode === 'cashier') {
    e.preventDefault();
    scan(true);
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
  if (mode === 'play') {
    build?.update(dt);
    hud?.update(dt);
    tablet?.update(dt);
    panel?.update(dt);
    shop?.update();
    // caisse tenue par le patron : bouton SCANNER (+ scan automatique lent si on ne tape pas)
    const cashier = game.player.mode === 'cashier' && !!game.player.lane;
    if (scanBtn) scanBtn.style.display = cashier ? '' : 'none';
    if (cashier && !game.paused) {
      const s = game.player.lane!.scan;
      scanBtn?.classList.toggle('idle', !(s && s.phase === 'scan'));
      scanT += dt * game.st.speed;
      if (scanT > 1.8) scan(false);
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
    get manager() {
      return manager;
    },
    get shop() {
      return shop;
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
    settings,
    saveSettings: () => saveSettings(settings),
  };
}

boot().catch((e) => {
  console.error(e);
  uiRoot.append(h('div', { class: 'loading' }, `Erreur au démarrage : ${e.message}`));
});
