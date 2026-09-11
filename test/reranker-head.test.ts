import test from 'node:test';
import assert from 'node:assert/strict';
import {createRerankerHead} from '../src/shared/reranker-head.js';

function safetensors(tensors: Record<string, {shape: number[]; values: number[]}>) {
  let size = 0;
  const header = Object.fromEntries(Object.entries(tensors).map(([name, {shape, values}]) => {
    const start = size; size += values.length * 4;
    return [name, {dtype: 'F32', shape, data_offsets: [start, size]}];
  }));
  const json = Buffer.from(JSON.stringify(header)), bytes = Buffer.alloc(8 + json.length + size);
  bytes.writeBigUInt64LE(BigInt(json.length)); json.copy(bytes, 8);
  let at = 8 + json.length;
  for (const {values} of Object.values(tensors)) for (const value of values) {bytes.writeFloatLE(value, at); at += 4;}
  return bytes;
}

test('Ettin scoring layers agree with an independent NumPy/erf reference and reject malformed weights', () => {
  const dense = safetensors({'linear.weight': {shape: [256, 256], values: Array.from({length: 256 * 256}, (_, n) => {
    const i = Math.floor(n / 256), j = n % 256;
    return i === j ? 0.5 + i / 1024 : j === (i + 1) % 256 ? -0.3 : 0;
  })}});
  const norm = safetensors({'norm.weight': {shape: [256], values: Array.from({length: 256}, (_, i) => 1 + i / 512)},
    'norm.bias': {shape: [256], values: Array(256).fill(-0.1)}});
  const output = safetensors({'linear.weight': {shape: [1, 256], values: Array.from({length: 256}, (_, i) => Math.cos(i / 7) / 256)},
    'linear.bias': {shape: [1], values: [-0.25]}});
  const score = createRerankerHead(dense, norm, output);
  const actual = score(Float32Array.from({length: 256}, (_, i) => Math.sin(i / 9)));
  assert.ok(Math.abs(actual - (-0.3685976564884186)) < 1e-6, String(actual));
  assert.throws(() => score(new Float32Array(255)), /Invalid reranker CLS/);
  assert.throws(() => score(new Float32Array(256).fill(NaN)), /Invalid reranker CLS/);
  for (const invalid of [dense.subarray(0, 3), dense.subarray(0, dense.length - 1),
    safetensors({'linear.weight': {shape: [1], values: [1]}}),
    safetensors({'linear.weight': {shape: [256, 256], values: Array(256 * 256).fill(NaN)}})])
    assert.throws(() => createRerankerHead(invalid, norm, output), /reranker scoring/);
});
