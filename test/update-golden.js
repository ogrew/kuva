// ゴールデン値を更新する（npm run golden）。ENGINE_VERSION を上げてから実行すること
import { writeFileSync } from 'node:fs';
import { ENGINE_VERSION } from '../src/engine/sim.js';
import { GOLDEN_CASES, GOLDEN_GENS, runGolden } from './helpers.js';

const cases = Object.fromEntries(GOLDEN_CASES.map((c) => [c.name, runGolden(c)]));
const out = { engineVersion: ENGINE_VERSION, gens: GOLDEN_GENS, cases };
writeFileSync(new URL('./golden.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(out);
