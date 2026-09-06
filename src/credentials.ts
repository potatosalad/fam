import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { readPrivateJson, writePrivateJson } from './storage.js';

export type Service = 'familysearch' | 'ancestry' | 'myheritage';
export interface Credentials { username: string; password: string }

const loginFile = (service: Service) => service === 'familysearch' ? 'login.json' : `${service}/login.json`;

function validate(value: unknown, service: Service): Credentials {
  if (!value || typeof value !== 'object' || !('username' in value) || !('password' in value)
      || typeof value.username !== 'string' || !value.username.trim()
      || typeof value.password !== 'string' || !value.password) {
    throw new Error(`Both a nonempty username and password are required for ${service}.`);
  }
  return { username: value.username, password: value.password };
}

function environmentCredentials(service: Service): Credentials | undefined {
  const prefix = service.toUpperCase();
  const username = process.env[`${prefix}_USERNAME`], password = process.env[`${prefix}_PASSWORD`];
  if (username === undefined && password === undefined) return undefined;
  if (!username?.trim() || !password) throw new Error(`Set both ${prefix}_USERNAME and ${prefix}_PASSWORD to nonempty values.`);
  return { username, password };
}

/** Library clients never prompt or execute external commands to obtain credentials. */
export async function loadLoginCredentials(service: Service): Promise<Credentials> {
  const environment = environmentCredentials(service);
  if (environment) return environment;
  const saved = await readPrivateJson<unknown>(loginFile(service));
  if (saved !== undefined) return validate(saved, service);
  throw new Error(`No ${service} credentials configured. Run "${service} credentials" or set ${service.toUpperCase()}_USERNAME and ${service.toUpperCase()}_PASSWORD.`);
}

async function promptCredentials(service: Service): Promise<Credentials> {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new Error(`Credential setup needs a terminal. Set ${service.toUpperCase()}_USERNAME and ${service.toUpperCase()}_PASSWORD, or pipe a JSON object to "${service} credentials --stdin".`);
  }
  let hidden = false;
  const output = new Writable({ write(chunk, _encoding, done) { if (!hidden) process.stderr.write(chunk); done(); } });
  const terminal = createInterface({ input: process.stdin, output, terminal: true });
  const controller = new AbortController();
  terminal.on('SIGINT', () => controller.abort());
  terminal.on('close', () => controller.abort());
  try {
    const username = await terminal.question(`${service} username: `, { signal: controller.signal });
    process.stderr.write('Password (hidden): ');
    hidden = true;
    const password = await terminal.question('', { signal: controller.signal });
    return validate({ username, password }, service);
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Credential setup cancelled; nothing was saved.');
    throw error;
  } finally {
    terminal.close();
    output.end();
    process.stderr.write('\n');
  }
}

async function stdinCredentials(service: Service): Promise<Credentials> {
  if (process.stdin.isTTY) throw new Error('Pipe a JSON object with username and password to --stdin; omit --stdin for hidden interactive entry.');
  let input = '', bytes = 0;
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 64 * 1024) throw new Error('Credential JSON exceeded 64 KiB.');
    input += chunk;
  }
  let value: unknown;
  try { value = JSON.parse(input); }
  catch { throw new Error('Credential input must be a JSON object with username and password.'); }
  return validate(value, service);
}

/** Explicit setup replaces saved login details; sign in again to switch accounts. */
export async function configureCredentials(service: Service, options: { stdin?: boolean } = {}): Promise<Credentials> {
  const credentials = options.stdin ? await stdinCredentials(service) : environmentCredentials(service) ?? await promptCredentials(service);
  await writePrivateJson(loginFile(service), credentials);
  return credentials;
}
