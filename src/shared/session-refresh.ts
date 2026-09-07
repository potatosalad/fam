/** Only an explicit authentication rejection permits replay, never a permission or transport failure. */
export function isAuthenticationFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return ('status' in error && error.status === 401) || ('code' in error && error.code === 'session-rejected');
}

/** HTTP 200 can still reject GraphQL authentication. Partial results must not be replayed. */
export function isGraphQLAuthenticationFailure(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const result = value as {data?: unknown; errors?: {extensions?: {code?: string}}[]};
  return result.data == null && Array.isArray(result.errors) && result.errors.length > 0
    && result.errors.every(error => error?.extensions?.code === 'UNAUTHENTICATED');
}

/** At most one renewal per operation, including proactive expiry refresh. */
export async function withSessionRefresh<T>(send: () => Promise<T>, refresh?: () => Promise<void>, expiresSoon = false): Promise<T> {
  if (expiresSoon && refresh) {await refresh(); return send();}
  try {return await send();}
  catch (error) {
    if (!refresh || !isAuthenticationFailure(error)) throw error;
    await refresh();
    return send();
  }
}
