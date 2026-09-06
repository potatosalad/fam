import type {Variables} from '../src/myheritage/catalog.js';
const valid: Variables<'graphql.individual.search_individuals'> = {treeId: 'tree-1-1', query: 'Smith', limit: 20n, lang: 'EN'};
// @ts-expect-error Required query variable is missing.
const missing: Variables<'graphql.individual.search_individuals'> = {treeId: 'tree-1-1', limit: 20, lang: 'EN'};
// @ts-expect-error A boolean GraphQL variable is not a string.
const wrong: Variables<'graphql.embedded.GetPhotosPortraits'> = {mediaItemID: 'photo-1', withTags: 'yes'};
void [valid, missing, wrong];
