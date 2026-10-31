/** Point d'entrée 2.5D (prototype de rendu, remplacé ensuite par l'interface complète). */
import '@fontsource/luckiest-guy/400.css';
import '@fontsource/nunito/400.css';
import '@fontsource/nunito/700.css';
import '@fontsource/nunito/800.css';
import './ui/styles.css';
import { Game } from './game/game';
import { initPhysics } from './physics/physics';
import { IsoRenderer } from './iso/renderer';
import { IsoControls } from './iso/controls';
import * as THREE from 'three';
import { Gallery } from './ui/gallery';
import { loadModels } from './models/kit';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
let game: Game;
let ren: IsoRenderer;
let ctl: IsoControls;

async function bootGallery() {
  await loadModels();
  const r = new THREE.WebGLRenderer({ canvas, antialias: true });
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.setPixelRatio(Math.min(2, devicePixelRatio));
  r.setSize(innerWidth, innerHeight, false);
  r.shadowMap.enabled = true;
  const q = new URLSearchParams(location.search);
  const gal = new Gallery(Number(q.get('gallery')) || 1, Number(q.get('n')) || 8, { close: q.has('close'), actions: q.has('actions'), hair: q.has('hair') });
  let last = performance.now();
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    gal.update(Math.min(0.1, (now - last) / 1000));
    last = now;
    gal.camera.aspect = innerWidth / innerHeight;
    gal.camera.updateProjectionMatrix();
    r.render(gal.scene, gal.camera);
  };
  requestAnimationFrame(frame);
  (window as any).BAZAR = { gallery: gal };
}

async function boot() {
  if (new URLSearchParams(location.search).has('gallery')) return bootGallery();
  await initPhysics();
  game = new Game(true);
  game.render2d = true;
  await game.init();
  game.newGame({ seed: 1234 });
  game.player.input.enabled = false;
  ren = new IsoRenderer(canvas, game);
  const resize = () => ren.resize(innerWidth, innerHeight, Math.min(2.5, devicePixelRatio || 1));
  resize();
  addEventListener('resize', resize);
  ren.frameStore();
  ctl = new IsoControls(canvas, ren.view, { tap: (x, y) => (ren.selection = ren.pick(x, y)) });
  let last = performance.now();
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    game.update(dt);
    ctl.update(dt);
    ren.draw(dt);
  };
  requestAnimationFrame(frame);
  (window as any).BAZAR = { game, ren };
}
boot();
