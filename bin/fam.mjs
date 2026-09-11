#!/usr/bin/env node
import {fileURLToPath} from 'node:url';
import {enterInstallation} from './update-state.mjs';

// npm packages use dist; linked development checkouts pin each invocation to a
// complete build so lazy imports still work while another build is published.
const directory = await enterInstallation(fileURLToPath(new URL('../', import.meta.url)));
await import(new URL(`../${directory}/cli.js`, import.meta.url));
