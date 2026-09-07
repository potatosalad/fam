import { contracts } from './generated/contracts.js';
export const operations = contracts.operations;
export const routes = contracts.routes;
export function operation(name: string) {
  const result = operations.find(o => o.name === name);
  if (!result) throw new Error('Unknown Geneanet operation. Run fam geneanet ops.');
  return {...result, write: false};
}

export type SearchKind = 'search' | 'photos' | 'library';
export type SearchInput = Record<string, string | number | boolean | undefined>;
const fields = new Set(['go','nom','prenom','nom_conjoint','prenom_conjoint','nom_pere','prenom_pere','nom_mere','prenom_mere',
  'prenom_operateur','prenom_conjoint_operateur','prenom_pere_operateur','prenom_mere_operateur','profession','profession_operateur',
  'ignore_each_patronyme','ignore_each_prenom','ignore_each_profession','ignore_each_patronyme_conjoint','ignore_each_prenom_conjoint',
  'ignore_each_patronyme_pere','ignore_each_prenom_pere','ignore_each_patronyme_mere','ignore_each_prenom_mere','ignore_each_place',
  'with_variantes_nom','with_variantes_prenom','with_variantes_nom_conjoint','with_variantes_prenom_conjoint',
  'with_variantes_nom_pere','with_variantes_prenom_pere','with_variantes_nom_mere','with_variantes_prenom_mere',
  'with_variantes_profession','with_variantes_place','all_variantes','sexe','voisinage','with_parents','restrict_images',
  'periode_mode','type_periode','from','to','exact_month','exact_day','exact_year','size','page','q','filtre_niveaux_1',
  'restriction','source','sourcename','ignore_sourcename','id_filter_block','sort','order']);
export function integer(value: unknown, fallback: number, min = 1, max = 10000): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) throw new Error(`Expected an integer between ${min} and ${max}.`);
  return Number(value);
}
export function searchUrl(kind: SearchKind, input: SearchInput): URL {
  const path = kind === 'photos' ? '/old-photos/search/' : kind === 'library' ? '/fonds/bibliotheque/' : '/fonds/individus/';
  const url = new URL(path, 'https://en.geneanet.org');
  for (const [key, value] of Object.entries({go: 1, size: 10, page: 1, ...input})) {
    if (value === undefined) continue;
    if (!fields.has(key) && !/^(?:place|zonegeo|country|region|subregion)__[0-4]__$/.test(key) &&
        !/^categories_[1-3]\[[\w#-]+\]$/.test(key) && !/^niveaux_1___\d+__$/.test(key) && !/^sort\[[0-4]\]$/.test(key)) throw new Error('Unknown Geneanet search field. See the provider search documentation.');
    if (!['string','number','boolean'].includes(typeof value) || typeof value === 'number' && !Number.isFinite(value)) throw new Error('Geneanet search fields must be scalar values.');
    url.searchParams.set(key, typeof value === 'boolean' ? value ? '1' : '0' : String(value));
  }
  if (![input.nom,input.prenom,input.q,input.place__0__,input.zonegeo__0__,input.sourcename].some(v => typeof v === 'string' && v.trim())) throw new Error('Provide a name, place, keyword, or tree owner for the search.');
  const size = integer(input.size, 10, 10, 100);
  if (![10,20,30,40,50,100].includes(size)) throw new Error('Geneanet page size must be 10, 20, 30, 40, 50, or 100.');
  integer(input.page, 1);
  for (const field of ['from','to','exact_year']) if (input[field] !== undefined) integer(input[field], 1, 1, 9999);
  if (input.from !== undefined && input.to !== undefined && Number(input.from) > Number(input.to)) throw new Error('The start year must not exceed the end year.');
  if (input.periode_mode !== undefined && !['all','birth','wedding','death'].includes(String(input.periode_mode))) throw new Error('Unsupported event type.');
  return url;
}
