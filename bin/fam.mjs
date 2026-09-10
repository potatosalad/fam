#!/usr/bin/env node
import {fileURLToPath} from 'node:url';
import {pinBuild} from './build-state.mjs';

// npm packages use dist; linked development checkouts pin each invocation to a
// complete build so lazy imports still work while another build is published.
const directory = await pinBuild(fileURLToPath(new URL('../', import.meta.url)));
await import(new URL(`../${directory}/cli.js`, import.meta.url));
