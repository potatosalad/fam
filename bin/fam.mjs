#!/usr/bin/env node
import {readFile} from 'node:fs/promises';

// npm packages use dist; linked development checkouts pin each invocation to a
// complete build so lazy imports still work while another build is published.
let directory = 'dist';
try {
  const build = JSON.parse(await readFile(new URL('../.fam-build.json', import.meta.url), 'utf8'));
  if (!/^\.fam-build-[A-Za-z0-9]+$/.test(build.directory)) throw new Error('Invalid fam build snapshot.');
  directory = build.directory;
} catch (error) {if (error.code !== 'ENOENT') throw error;}
await import(new URL(`../${directory}/cli.js`, import.meta.url));
