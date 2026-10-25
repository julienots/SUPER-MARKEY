/** Cycle jour/nuit, ciel dégradé, soleil avec ombres, brouillard, pluie/neige/orage. */
import * as THREE from 'three';
import { clamp01, lerp, smoothstep } from '../core/math';

const SKY_VS = `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const SKY_FS = `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunDir; uniform float sunVis; uniform float stars;
varying vec3 vDir;
float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164)))*43758.5453); }
void main(){
  float h = vDir.y;
  vec3 c = h > 0.0 ? mix(horizon, top, pow(clamp(h,0.0,1.0), 0.55)) : mix(horizon, bottom, clamp(-h*4.0,0.0,1.0));
  float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
  c += vec3(1.0,0.85,0.6) * pow(s, 400.0) * 6.0 * sunVis;
  c += vec3(1.0,0.6,0.3) * pow(s, 8.0) * 0.25 * sunVis;
  if (stars > 0.0 && h > 0.05) { vec3 q = floor(vDir*380.0); float st = step(0.9975, hash(q)); c += vec3(st) * stars * 0.9; }
  gl_FragColor = vec4(c, 1.0);
}`;

export class Sky {
  sun = new THREE.DirectionalLight(0xffffff, 2.5);
  hemi = new THREE.HemisphereLight(0xcfe8ff, 0x5a5040, 0.7);
  private dome: THREE.Mesh;
  private uni: Record<string, THREE.IUniform>;
  private rain: THREE.LineSegments | null = null;
  private rainPos: Float32Array | null = null;
  private snow: THREE.Points | null = null;
  private flash = 0;
  night = 0;
  sunElevation = 1;

  constructor(private scene: THREE.Scene, shadows: boolean) {
    this.uni = {
      top: { value: new THREE.Color(0x3d8bfd) },
      horizon: { value: new THREE.Color(0xcfe6ff) },
      bottom: { value: new THREE.Color(0x6b7b6b) },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunVis: { value: 1 },
      stars: { value: 0 },
    };
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 16), new THREE.ShaderMaterial({ uniforms: this.uni, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, fog: false }));
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    scene.add(this.dome);
    scene.add(this.hemi);
    this.sun.castShadow = shadows;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -45;
    sc.right = 45;
    sc.top = 45;
    sc.bottom = -45;
    sc.near = 1;
    sc.far = 220;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun);
    scene.add(this.sun.target);
    scene.fog = new THREE.Fog(0xcfe6ff, 90, 330);
  }

  /** @param hour heure décimale ; weather type météo ; focus position caméra */
  update(dt: number, hour: number, weather: string, focus: THREE.Vector3, camera: THREE.Camera) {
    const dayT = (hour - 6.5) / 14;
    const elev = Math.sin(Math.PI * dayT);
    this.sunElevation = elev;
    const az = Math.PI * (dayT - 0.5) * 1.1;
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(Math.max(0.05, elev) * 1.2), Math.max(0.08, elev), -Math.cos(az) * 0.6).normalize();
    const day = smoothstep(-0.12, 0.25, elev);
    const dusk = clamp01(1 - Math.abs(elev - 0.08) / 0.22) * (dayT > -0.1 && dayT < 1.1 ? 1 : 0);
    this.night = 1 - day;
    const overcast = weather === 'pluie' || weather === 'orage' ? 0.75 : weather === 'nuageux' || weather === 'neige' ? 0.45 : 0;
    const top = new THREE.Color(0x3d8bfd).lerp(new THREE.Color(0x8a9aa8), overcast).lerp(new THREE.Color(0x050a1a), 1 - day);
    const hor = new THREE.Color(0xcfe6ff).lerp(new THREE.Color(0xb7c0c8), overcast).lerp(new THREE.Color(0xff9a5a), dusk * 0.7 * (1 - overcast)).lerp(new THREE.Color(0x10162a), 1 - day);
    (this.uni.top.value as THREE.Color).copy(top);
    (this.uni.horizon.value as THREE.Color).copy(hor);
    (this.uni.bottom.value as THREE.Color).copy(hor).multiplyScalar(0.5);
    (this.uni.sunDir.value as THREE.Vector3).copy(dir);
    this.uni.sunVis.value = day * (1 - overcast);
    this.uni.stars.value = (1 - day) * (1 - overcast);
    this.dome.position.copy(camera.position);

    this.sun.intensity = lerp(0, 2.6, day) * (1 - overcast * 0.6) + this.flash * 4;
    this.sun.color.setHSL(0.1, 0.4 + dusk * 0.5, 0.75 + day * 0.2);
    this.sun.position.copy(focus).addScaledVector(dir, 90);
    this.sun.target.position.copy(focus);
    this.hemi.intensity = lerp(0.07, 0.75, day) * (1 - overcast * 0.25) + this.flash * 2;
    this.hemi.color.copy(new THREE.Color(0xcfe8ff).lerp(new THREE.Color(0x3a4a7a), 1 - day));
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(hor);
    fog.near = weather === 'pluie' || weather === 'orage' ? 40 : weather === 'neige' ? 30 : 90;
    fog.far = weather === 'pluie' || weather === 'orage' ? 180 : 330;

    // précipitations
    const raining = weather === 'pluie' || weather === 'orage';
    if (raining) this.ensureRain();
    if (this.rain) {
      this.rain.visible = raining;
      if (raining) this.animateRain(dt, camera.position);
    }
    const snowing = weather === 'neige';
    if (snowing) this.ensureSnow();
    if (this.snow) {
      this.snow.visible = snowing;
      if (snowing) {
        this.snow.position.set(camera.position.x, 0, camera.position.z);
        const p = this.snow.geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < p.count; i++) {
          let y = p.getY(i) - dt * 1.2;
          if (y < 0) y += 25;
          p.setY(i, y);
          p.setX(i, p.getX(i) + Math.sin(y + i) * dt * 0.3);
        }
        p.needsUpdate = true;
      }
    }
    if (weather === 'orage' && Math.random() < dt * 0.08) this.flash = 1;
    this.flash = Math.max(0, this.flash - dt * 3);
  }

  get lightning() {
    return this.flash > 0.5;
  }

  private ensureRain() {
    if (this.rain) return;
    const N = 3000;
    const pos = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) {
      const x = (Math.random() - 0.5) * 60;
      const y = Math.random() * 25;
      const z = (Math.random() - 0.5) * 60;
      pos.set([x, y, z, x + 0.03, y - 0.5, z], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rainPos = pos;
    this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x9fb4c8, transparent: true, opacity: 0.45 }));
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);
  }

  private animateRain(dt: number, c: THREE.Vector3) {
    const p = this.rainPos!;
    const N = p.length / 6;
    for (let i = 0; i < N; i++) {
      let y = p[i * 6 + 1] - dt * 18;
      if (y < 0) y += 25;
      p[i * 6 + 1] = y;
      p[i * 6 + 4] = y - 0.5;
    }
    this.rain!.geometry.attributes.position.needsUpdate = true;
    this.rain!.position.set(c.x, 0, c.z);
  }

  private ensureSnow() {
    if (this.snow) return;
    const N = 2000;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) pos.set([(Math.random() - 0.5) * 60, Math.random() * 25, (Math.random() - 0.5) * 60], i * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.snow = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0.85 }));
    this.snow.frustumCulled = false;
    this.scene.add(this.snow);
  }
}
