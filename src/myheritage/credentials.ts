import { loadLoginCredentials } from '../shared/credentials.js';
export type { Credentials as MyHeritageCredentials } from '../shared/credentials.js';

export function loadMyHeritageCredentials() {
  return loadLoginCredentials('myheritage');
}
