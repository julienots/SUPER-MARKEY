/**
 * Prépare les vrais modèles 3D du jeu (tous sous licence CC0) à partir des packs d'origine :
 *  - personnages humains animés « Ultimate Modular Men/Women » de Quaternius ;
 *  - ville, voitures, mobilier, caisses de légumes : packs KayKit de Kay Lousberg.
 *
 * Usage : node scripts/build-assets.mjs <dossier des sources>
 * Le dossier contient les dépôts clonés :
 *   KayKit-City-Builder-Bits-1.0, KayKit-Restaurant-Bits-1.0, KayKit-Furniture-Bits-1.0
 *   (https://github.com/KayKit-Game-Assets) et un dossier quaternius/{Male,Female}/*.glb.
 * Sortie : public/models/city.glb, public/models/props.glb, public/models/people/*.glb
 */
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, mergeDocuments, unpartition, resample, weld, quantize } from '@gltf-transform/functions';

const src = process.argv[2];
if (!src) {
  console.error('usage : node scripts/build-assets.mjs <dossier des sources>');
  process.exit(1);
}
const out = 'public/models';
fs.mkdirSync(path.join(out, 'people'), { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const kk = (pack, name) => path.join(src, pack, 'addons', `kaykit_${pack.replace(/^KayKit-|-1\.0$/g, '').toLowerCase().replace(/-/g, '_')}`, 'Assets', 'gltf', `${name}.gltf`);

/** Fusionne plusieurs modèles en un seul GLB ; chaque modèle devient un nœud racine nommé. */
async function pack(list, file) {
  const doc = await io.read(list[0][1]);
  const root = doc.getRoot();
  const scene = root.listScenes()[0];
  const wrap = (sc, name) => {
    const n = doc.createNode(name);
    for (const c of sc.listChildren()) {
      sc.removeChild(c);
      n.addChild(c);
    }
    return n;
  };
  const first = wrap(scene, list[0][0]);
  scene.addChild(first);
  for (const [name, p] of list.slice(1)) {
    const other = await io.read(p);
    const map = mergeDocuments(doc, other);
    const sc = map.get(other.getRoot().listScenes()[0]);
    const n = wrap(sc, name);
    scene.addChild(n);
    sc.dispose();
  }
  for (const s of root.listScenes()) if (s !== scene) s.dispose();
  await doc.transform(unpartition(), dedup(), prune(), weld(), quantize());
  await io.write(path.join(out, file), doc);
  console.log(file, (fs.statSync(path.join(out, file)).size / 1024).toFixed(0), 'Ko');
}

const CITY = 'KayKit-City-Builder-Bits-1.0';
const REST = 'KayKit-Restaurant-Bits-1.0';
const FURN = 'KayKit-Furniture-Bits-1.0';

await pack(
  [
    ...['building_A', 'building_B', 'building_C', 'building_D', 'building_E', 'building_F', 'building_G', 'building_H'].map((n) => [n, kk(CITY, n)]),
    ...['road_straight', 'road_straight_crossing', 'road_junction', 'road_tsplit', 'road_corner', 'base'].map((n) => [n, kk(CITY, n)]),
    ...['car_hatchback', 'car_sedan', 'car_stationwagon', 'car_taxi', 'car_police'].map((n) => [n, kk(CITY, n)]),
    ...['streetlight', 'bush', 'bench', 'firehydrant', 'trash_A', 'dumpster', 'box_A', 'box_B'].map((n) => [n, kk(CITY, n)]),
  ],
  'city.glb',
);

await pack(
  [
    ...['crate', 'crate_carrots', 'crate_tomatoes', 'crate_lettuce', 'crate_onions', 'crate_potatoes', 'crate_cheese', 'crate_buns', 'crate_ham', 'crate_steak'].map((n) => [n, kk(REST, n)]),
    ...['fridge_A', 'jar_A_large', 'jar_B_medium', 'ketchup', 'mustard', 'papertowel', 'shelf_papertowel_decorated', 'pillar_A'].map((n) => [n, kk(REST, n)]),
    ...['couch_pillows', 'armchair', 'table_low', 'lamp_standing', 'cactus_medium_A', 'cactus_small_B', 'pictureframe_large_A', 'pictureframe_medium', 'rug_rectangle_stripes_A', 'rug_oval_A', 'book_set', 'cabinet_medium_decorated', 'shelf_B_large_decorated', 'chair_A', 'table_medium'].map((n) => [n, kk(FURN, n)]),
  ],
  'props.glb',
);

// ---------------------------------------------------------------- personnages
const PEOPLE = [
  ['Female', 'Casual'],
  ['Female', 'Formal'],
  ['Female', 'Punk'],
  ['Female', 'Suit'],
  ['Female', 'Worker'],
  ['Female', 'Adventurer'],
  ['Male', 'Casual_2'],
  ['Male', 'Casual_Hoodie'],
  ['Male', 'Beach'],
  ['Male', 'Farmer'],
  ['Male', 'Punk'],
  ['Male', 'Suit'],
  ['Male', 'Worker'],
];
const KEEP = new Set(['Idle', 'Walk', 'Run', 'Wave', 'Interact']);
/** Tous les personnages partagent le même squelette : les animations ne sont gardées que dans un fichier par sexe. */
const ANIM_SRC = new Set(['f_casual', 'm_casual_2']);
const list = [];
for (const [g, n] of PEOPLE) {
  const f = path.join(src, 'quaternius', g, `${n}.glb`);
  if (!fs.existsSync(f)) {
    console.warn('absent :', f);
    continue;
  }
  const doc = await io.read(f);
  const name = `${g === 'Female' ? 'f' : 'm'}_${n.toLowerCase()}`;
  for (const a of doc.getRoot().listAnimations()) if (!ANIM_SRC.has(name) || !KEEP.has(a.getName())) {
    for (const c of a.listChannels()) c.dispose();
    for (const sm of a.listSamplers()) sm.dispose();
    a.dispose();
  }
  // accessoires orphelins (anciennes animations) : supprimés explicitement
  for (const acc of doc.getRoot().listAccessors()) if (acc.listParents().length <= 1) acc.dispose();
  await doc.transform(resample(), dedup(), prune(), weld(), quantize());
  await io.write(path.join(out, 'people', `${name}.glb`), doc);
  list.push(name);
  console.log(name, (fs.statSync(path.join(out, 'people', `${name}.glb`)).size / 1024).toFixed(0), 'Ko');
}
fs.writeFileSync(path.join(out, 'people', 'list.json'), JSON.stringify(list));
