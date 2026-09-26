// ゴールデン：固定の合成画像・固定パラメータ（再生中の操作を含む）で、500世代後の状態が変わっていないこと
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ENGINE_VERSION } from '../src/engine/sim.js';
import { GOLDEN_CASES, GOLDEN_GENS, runGolden } from './helpers.js';

const golden = JSON.parse(readFileSync(new URL('./golden.json', import.meta.url)));

test('ゴールデンの ENGINE_VERSION が一致している', () => {
  assert.equal(golden.engineVersion, ENGINE_VERSION,
    'ENGINE_VERSION を上げたら npm run golden で更新する');
  assert.equal(golden.gens, GOLDEN_GENS);
});

for (const c of GOLDEN_CASES) {
  test(`ゴールデン：${c.name}`, () => {
    assert.equal(runGolden(c), golden.cases[c.name],
      '生成結果が変わった。意図した変更なら ENGINE_VERSION を上げてから npm run golden');
  });
}
