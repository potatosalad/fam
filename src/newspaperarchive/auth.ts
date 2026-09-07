import { sessionStatus as storiedStatus, type StoriedSession } from '../storied/auth.js';
export { loadSession } from '../storied/auth.js';
export { authenticateBrowser } from '../storied/browser-auth.js';
export function sessionStatus(session?: StoriedSession) {
  return {...storiedStatus(session), sessionProvider: 'storied', credentialProvider: 'storied'};
}
