import { loadLoginCredentials } from '../credentials.js';
export type { Credentials as MyHeritageCredentials } from '../credentials.js';

export function loadMyHeritageCredentials() {
  return loadLoginCredentials('myheritage');
}
