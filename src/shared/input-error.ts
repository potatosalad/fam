/** A known local input problem, distinct from remote rejections and execution failures. */
export class InputError extends Error {
  readonly code = 'INVALID_ARGUMENT';
}
