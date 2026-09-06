export interface RecordSearchOptions {
  given?: string; surname?: string; birthYear?: number; birthPlace?: string;
  deathYear?: number; deathPlace?: string; limit?: number; page?: number; pagingToken?: string;
  /** Native filter expressions; see APK SearchRequestBody. */
  filters?: string[];
}
/** Wire names and polymorphic discriminators come from the APK's Moshi adapters. */
export function recordSearchBody(options: RecordSearchOptions, userId: string) {
  const limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Search limit must be 1–100.');
  const page = options.page ?? 1;
  if (!Number.isInteger(page) || page < 1) throw new Error('Search page must be a positive integer.');
  const terms: Record<string, unknown>[] = [];
  if (options.given) terms.push({type: 'GivenNameQueryTerm', GivenName: options.given, Relationship: 'Self', Required: false});
  if (options.surname) terms.push({type: 'SurnameQueryTerm', Surname: options.surname, Relationship: 'Self', Required: false});
  for (const [event, year, place] of [['Birth', options.birthYear, options.birthPlace], ['Death', options.deathYear, options.deathPlace]] as const) {
    if (year !== undefined && (!Number.isInteger(year) || year < 1 || year > 9999)) throw new Error('Search year must be 1–9999.');
    if (year !== undefined || place) terms.push({type: 'EventQueryTerm', EventName: event, Relationship: 'Self',
      ...(year === undefined ? {} : {Date: {Year: year}}), ...(place ? {Place: {Place: place}} : {})});
  }
  if (!terms.length) throw new Error('Supply at least a name or birth/death detail for record search.');
  return {QueryTerms: terms, FilterCriteria: options.filters ?? ['1|Category|SET=HistoricalRecords', '1|Category|SET=StoriesPublications', '1|Category|SET=PhotosMaps'], MinimumScore: -1, SearchBlock: 0, CollectionFocus: 'default',
    PagingInfo: {PageNumber: page, RecordsPerPage: limit, PagingToken: options.pagingToken ?? ''},
    RequestContext: {Data: {UserId: userId, CultureId: 'en-US', AncestrySearchClient: 'androidAncestryApp'}},
    Features: [], JudgmentFilter: 1, JudgmentToken: ''};
}
