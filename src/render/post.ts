/**
 * Rendu « réaliste » par shaders (post-traitement), selon la qualité choisie :
 *  - Normale : anticrénelage multi-échantillons, halo des lumières (bloom), étalonnage des couleurs, vignette ;
 *  - Belle : en plus, occlusion ambiante (GTAO) — les coins, le pied des rayons et des personnages s'assombrissent.
 *  - Fluide : rendu direct, sans post-traitement.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/** Étalonnage : contraste, saturation, teinte chaude/froide selon l'heure, vignette, léger grain. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uContrast: { value: 1.1 },
    uSaturation: { value: 1.1 },
    uTint: { value: new THREE.Vector3(1.02, 1.0, 0.97) },
    uVignette: { value: 0.32 },
    uTime: { value: 0 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uContrast;
    uniform float uSaturation;
    uniform vec3 uTint;
    uniform float uVignette;
    uniform float uTime;
    uniform float uAspect;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb * uTint;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      col = (col - 0.5) * uContrast + 0.5;
      // vignette douce (ovale suivant l'écran)
      vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0);
      float v = smoothstep(0.95, 0.25, length(d) * 1.05);
      col *= mix(1.0 - uVignette, 1.0, v);
      // grain très léger : casse les aplats numériques
      col += (hash(vUv * 1000.0 + uTime) - 0.5) * 0.012;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

export class Post {
  composer: EffectComposer;
  private gtao: GTAOPass | null = null;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
  private t = 0;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    public quality: 'normale' | 'haute',
  ) {
    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    const target = new THREE.WebGLRenderTarget(Math.max(1, size.x * pr), Math.max(1, size.y * pr), { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    if (quality === 'haute') {
      this.gtao = new GTAOPass(scene, camera, size.x, size.y);
      this.gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.6, thickness: 1.4, scale: 1.1, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      this.gtao.blendIntensity = 0.85;
      this.composer.addPass(this.gtao);
    }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.1, 0.3, 1.4);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }

  setSize(w: number, h: number, pr: number) {
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.grade.uniforms.uAspect.value = w / Math.max(1, h);
  }

  /** `day` : 0 = nuit, 1 = plein jour ; `dusk` : lumière orangée du soir. */
  render(dt: number, day: number, dusk: number) {
    this.t += dt;
    const u = this.grade.uniforms;
    u.uTime.value = this.t % 100;
    // plus de halo la nuit (lampadaires, vitrines), étalonnage chaud au crépuscule, froid la nuit
    // valeurs HDR (avant compression des tons) : seuls les vrais points lumineux brillent
    this.bloom.strength = 0.08 + (1 - day) * 0.32;
    this.bloom.threshold = 1.6 - (1 - day) * 0.5;
    this.bloom.radius = 0.3;
    u.uTint.value.set(1.02 + dusk * 0.06 - (1 - day) * 0.04, 1.0, 0.97 - dusk * 0.06 + (1 - day) * 0.08);
    u.uVignette.value = 0.28 + (1 - day) * 0.15;
    this.composer.render(dt);
  }

  dispose() {
    this.composer.dispose();
    this.gtao?.dispose();
    this.bloom.dispose();
  }
}
