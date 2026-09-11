/** BM25 and weighted score fusion, independent of the embedding runtime. */
const stop = new Set('a an the i me my we our you their to of for from in on with and or is are can could want wants need how do does please using user'.split(' '));
export function searchTokens(text: string): string[] {
  return (text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(word => !stop.has(word));
}

export function bm25Index(documents: string[]) {
  const frequencies = new Map<string, number>();
  const entries = documents.map(text => {
    const words = searchTokens(text), counts = new Map<string, number>();
    for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
    for (const word of counts.keys()) frequencies.set(word, (frequencies.get(word) ?? 0) + 1);
    return {length: words.length, counts};
  });
  const average = entries.reduce((sum, entry) => sum + entry.length, 0) / (entries.length || 1) || 1;
  return (query: string): number[] => {
    const words = [...new Set(searchTokens(query))];
    return entries.map(entry => words.reduce((score, word) => {
      const tf = entry.counts.get(word) ?? 0, df = frequencies.get(word) ?? 0;
      const idf = Math.log(1 + (entries.length - df + 0.5) / (df + 0.5));
      return score + idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * entry.length / average));
    }, 0));
  };
}

/** Keep guide context near matching terms so command reranking stays inexpensive. */
export function searchExcerpt(text: string, query: string): string {
  const words = text.split(/\s+/), width = 64;
  if (words.length <= width) return text;
  const windows: string[] = [];
  for (let start = 0; start < words.length; start += width / 2) {
    windows.push(words.slice(Math.min(start, words.length - width), Math.min(start, words.length - width) + width).join(' '));
    if (start + width >= words.length) break;
  }
  const scores = bm25Index(windows)(query);
  return windows[scores.indexOf(Math.max(...scores))];
}

export const searchWeights = {lexical: 0.20, semantic: 0.80} as const;
/** Max-normalized BM25 and nonnegative cosine similarity both live in [0, 1]. */
export function fuseScores(lexical: number[], semantic?: number[]) {
  if (semantic && semantic.length !== lexical.length) throw new Error('Search score dimensions do not match.');
  const maximum = Math.max(0, ...lexical);
  return lexical.map((raw, i) => {
    const bm25 = maximum ? raw / maximum : 0;
    const cosine = semantic ? Math.max(0, Math.min(1, semantic[i])) : null;
    return {lexicalScore: bm25, semanticScore: cosine,
      score: cosine === null ? bm25 : searchWeights.lexical * bm25 + searchWeights.semantic * cosine};
  });
}
