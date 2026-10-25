/**
 * Fusion des maillages statiques par matériau (réduit massivement les appels de rendu :
 * des centaines de boîtes deviennent quelques maillages). Les objets animés sont exclus.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const sig = (g: THREE.BufferGeometry) => Object.keys(g.attributes).sort().join(',');

export function mergeStatic(root: THREE.Object3D, skip: Set<THREE.Object3D> = new Set()): number {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; meshes: THREE.Mesh[]; cast: boolean; receive: boolean }>();
  const visit = (o: THREE.Object3D) => {
    if (skip.has(o) || o.userData.dynamic) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && !(m as any).isInstancedMesh && !(m as any).isSkinnedMesh && !Array.isArray(m.material) && m.visible && m.geometry.attributes.position) {
      const mat = m.material as THREE.Material;
      if (!(mat as any).transparent || mat.opacity > 0.99) {
        let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
        for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        if (!g.attributes.normal) g.computeVertexNormals();
        g.clearGroups();
        const key = `${mat.uuid}|${sig(g)}|${m.castShadow}|${m.receiveShadow}`;
        let b = buckets.get(key);
        if (!b) buckets.set(key, (b = { mat, geos: [], meshes: [], cast: m.castShadow, receive: m.receiveShadow }));
        b.geos.push(g);
        b.meshes.push(m);
      }
    }
    for (const c of [...o.children]) visit(c);
  };
  visit(root);
  let removed = 0;
  for (const b of buckets.values()) {
    if (b.meshes.length < 2) continue;
    const merged = mergeGeometries(b.geos, false);
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, b.mat);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.receive;
    mesh.name = 'merged';
    root.add(mesh);
    for (const m of b.meshes) {
      m.parent?.remove(m);
      removed++;
    }
  }
  return removed;
}
