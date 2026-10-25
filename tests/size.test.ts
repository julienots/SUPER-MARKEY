import { it, expect } from 'vitest';
import { createNewGame } from '../src/sim/newgame';
import LZString from 'lz-string';
import { serialize, deserialize } from '../src/save/save';
it('sauvegarde compressée compacte et réversible', () => {
  const st = createNewGame({ seed: 1 });
  const json = JSON.stringify(serialize(st));
  const lz = 'LZ1:' + LZString.compressToUTF16(json);
  console.log('json', (json.length / 1024).toFixed(0), 'Ko → compressé', (lz.length / 1024).toFixed(0), 'K caractères');
  expect(lz.length).toBeLessThan(json.length / 2.5);
  expect(deserialize(lz).residents.length).toBe(st.residents.length);
});
