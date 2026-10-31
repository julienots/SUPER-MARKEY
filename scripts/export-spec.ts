/** Exporte les dimensions du mobilier (données du jeu) pour les scripts Blender : blender/spec.json */
import fs from 'node:fs';
import { CELL, EQUIPMENT } from '../src/data/equipment';

const spec = EQUIPMENT.map((d) => ({ id: d.id, name: d.name, category: d.category, w: d.w * CELL, d: d.d * CELL, h: d.h, mount: d.mount, shelf: d.shelf ?? null, cartons: d.cartons ?? null }));
fs.writeFileSync(new URL('../blender/spec.json', import.meta.url), JSON.stringify({ cell: CELL, equipment: spec }, null, 1));
console.log(`${spec.length} équipements exportés`);
