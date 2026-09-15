export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
export type QueryValue = string | number | bigint | boolean | readonly (string | number | bigint | boolean)[] | undefined;
export type Query = Record<string, QueryValue>;
/** Replayable bodies only: streams cannot safely be retried after a definitive 401. */
export type UploadBody = FormData | Blob | Uint8Array | string;
export type ResponseMode = 'json' | 'void' | 'text' | 'binary';
export interface ApiRequest {
  /** Explicitly known read-only POSTs may use transient retries; writes must not. */
  retryable?: boolean;
  method?: HttpMethod;
  query?: Query;
  headers?: Record<string, string>;
  body?: unknown;
  encoding?: 'json' | 'raw';
  response?: ResponseMode;
}
export interface ApiResponse<T> {
  data: T;
  status: number;
  /** Cookies are persisted privately and omitted from returned headers. */
  headers: Readonly<Record<string, string>>;
  /** Present after a bounded, same-origin person GET redirect. URLs omit queries. */
  redirect?: {requestedUrl: string; resolvedUrl: string};
}
