/**
 * Point d'entrée — BAZAR BAZAR en 2.5D : scène 3D (modèles Blender) vue par une caméra isométrique fixe,
 * murs coupés côté caméra, commandes au doigt et à la souris.
 */
import '@fontsource/luckiest-guy/400.css';
import '@fontsource/nunito/400.css';
import '@fontsource/nunito/700.css';
import '@fontsource/nunito/800.css';
import './ui/styles.css';
import * as THREE from 'three';
import { Game } from './game/game';
import { loadSettings } from './game/settings';
import { initPhysics } from './physics/physics';
import { loadModels } from './models/kit';
import { IsoCamera } from './iso/isoCamera';
import { IsoControls } from './iso/controls';
import { Gallery } from './ui/gallery';

const settings = loadSettings();
const params = new URLSearchParams(location.search);
const lowGfx = params.has('lowgfx');
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowGfx, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = !lowGfx && settings.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const pixelRatio = () => (lowGfx ? 0.75 : Math.min(devicePixelRatio || 1, settings.quality === 'basse' ? 1.25 : 2));

let game: Game;
const iso = new IsoCamera();
let controls: IsoControls;

function resize() {
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(innerWidth, innerHeight, false);
  iso.w = innerWidth;
  iso.h = innerHeight;
  iso.update();
}
addEventListener('resize', resize);

async function bootGallery() {
  await loadModels();
  resize();
  const gal = new Gallery(Number(params.get('gallery')) || 1, Number(params.get('n')) || 8, { close: params.has('close'), actions: params.has('actions'), hair: params.has('hair') });
  let last = performance.now();
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    gal.update(Math.min(0.1, (now - last) / 1000));
    last = now;
    gal.camera.aspect = innerWidth / innerHeight;
    gal.camera.updateProjectionMatrix();
    renderer.render(gal.scene, gal.camera);
  };
  requestAnimationFrame(frame);
  (window as any).BAZAR = { gallery: gal };
}

async function boot() {
  if (params.has('gallery')) return bootGallery();
  await initPhysics();
  await loadModels();
  game = new Game(false, settings);
  await game.init();
  game.storeBuilding.isoMode = true;
  game.player.isoMode = true;
  game.player.input.enabled = false;
  game.newGame({ seed: 1234 });
  resize();
  const r = game.storeRect();
  iso.fit(r.x0 - 1, r.z0 - 3, r.x1 + 1, r.z1);
  game.storeBuilding.setCutaway(iso.nearSides());
  controls = new IsoControls(canvas, iso, { tap: () => {} });
  let last = performance.now();
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    game.update(dt);
    controls.update(dt);
    renderer.render(game.scene, iso.cam);
  };
  requestAnimationFrame(frame);
  (window as any).BAZAR = { game, iso, simulate: (s: number) => game.simulate(s) };
}
boot();
