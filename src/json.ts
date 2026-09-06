/** Node 22.16+ supplies JSON source access and raw JSON numbers. Preserve Java longs. */
export function parseJson(text: string): unknown {
  return JSON.parse(text, (_key: string, value: unknown, context?: { source?: string }) => {
    if (typeof value === 'number' && !Number.isSafeInteger(value) && !context?.source) throw new Error('Lossless JSON parsing requires Node 22.16 or later.');
    if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value) && context?.source && /^-?\d+$/.test(context.source)) return BigInt(context.source);
    return value;
  });
}
export function stringifyJson(value: unknown, space?: number): string {
  const rawJSON = (JSON as unknown as { rawJSON: (text: string) => unknown }).rawJSON;
  if (!rawJSON) throw new Error('Lossless JSON serialization requires Node 22.16 or later.');
  return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? rawJSON(item.toString()) : item, space);
}
