/** Read the pinned Ettin scoring layers; safetensors contains data, never executable code. */
function tensor(bytes: Uint8Array, name: string, shape: number[]): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 8) throw new Error('Invalid reranker scoring-layer file.');
  const headerLength = Number(view.getBigUint64(0, true)), start = 8 + headerLength;
  if (!Number.isSafeInteger(headerLength) || headerLength < 2 || start > bytes.length) throw new Error('Invalid reranker scoring-layer header.');
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, start)));
  const entry = header[name], count = shape.reduce((a, b) => a * b, 1);
  const offsets = entry?.data_offsets;
  if (entry?.dtype !== 'F32' || !Array.isArray(entry.shape) || entry.shape.join(',') !== shape.join(',')
      || !Array.isArray(offsets) || offsets.length !== 2 || !offsets.every(Number.isSafeInteger)
      || offsets[0] < 0 || offsets[1] - offsets[0] !== count * 4 || start + offsets[1] > bytes.length)
    throw new Error(`Invalid reranker scoring tensor ${name}.`);
  const values = Float32Array.from({length: count}, (_, i) => view.getFloat32(start + offsets[0] + i * 4, true));
  if (values.some(value => !Number.isFinite(value))) throw new Error(`Nonfinite reranker scoring tensor ${name}.`);
  return values;
}

// Erf approximation (maximum absolute error 1.5e-7), for PyTorch's default GELU.
function gelu(x: number): number {
  const a = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * a);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-a * a);
  return 0.5 * x * (1 + Math.sign(x) * erf);
}

/** The published ONNX file exports only ModernBERT; apply CLS → Dense/GELU → LayerNorm → Dense. */
export function createRerankerHead(dense: Uint8Array, normalization: Uint8Array, output: Uint8Array) {
  const size = 256, weights = tensor(dense, 'linear.weight', [size, size]);
  const scale = tensor(normalization, 'norm.weight', [size]), shift = tensor(normalization, 'norm.bias', [size]);
  const finalWeights = tensor(output, 'linear.weight', [1, size]), bias = tensor(output, 'linear.bias', [1])[0];
  return (cls: Float32Array): number => {
    if (cls.length !== size || cls.some(value => !Number.isFinite(value))) throw new Error('Invalid reranker CLS embedding.');
    const hidden = Float32Array.from({length: size}, (_, i) => {
      let sum = 0;
      for (let j = 0; j < size; j++) sum += cls[j] * weights[i * size + j];
      return gelu(sum);
    });
    const mean = hidden.reduce((sum, value) => sum + value, 0) / size;
    const variance = hidden.reduce((sum, value) => sum + (value - mean) ** 2, 0) / size;
    const denominator = Math.sqrt(variance + 1e-5); // torch.nn.LayerNorm's default epsilon.
    return hidden.reduce((sum, value, i) => sum + ((value - mean) / denominator * scale[i] + shift[i]) * finalWeights[i], bias);
  };
}
