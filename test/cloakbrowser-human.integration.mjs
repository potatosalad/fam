import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {humanizeBrowser} from '../browser/cloakbrowser/humanize.mjs';

test('CDP humanization handles fam login selectors and trusted typing', async () => {
 const directory=await mkdtemp(join(tmpdir(),'fam-human-cdp-'));
 const browser = await chromium.launchPersistentContext(directory,{headless:true,channel:process.env.FAM_TEST_BROWSER_CHANNEL,args:['--remote-debugging-port=0']});
 let attached;
 try {
  const port=(await readFile(join(directory,'DevToolsActivePort'),'utf8')).split('\n')[0];
  attached=await chromium.connectOverCDP('http://127.0.0.1:'+port);
  await humanizeBrowser(attached);
  const context=await attached.newContext(), page=await context.newPage();
  await page.setContent('<form><input type=email><input type=password><button>Sign in</button></form><script>window.events=[];document.addEventListener("keydown",e=>events.push({key:e.key,trusted:e.isTrusted}));document.querySelector("form").addEventListener("submit",e=>{e.preventDefault();window.submitted=true})</script>');
  const email=page.locator('input[type=email]:visible:enabled:not([readonly]), input[autocomplete=username]:visible:enabled:not([readonly])').first();
  await email.fill('reader@example.test');
  await page.locator('input[type=password]:visible').first().fill('Synthetic-Password9!');
  await page.locator('input[type=password]:visible').first().press('Enter');
  assert.equal(await email.inputValue(),'reader@example.test');
  assert.equal(await page.evaluate(()=>window.submitted),true);
  const events=await page.evaluate(()=>window.events);
  assert.ok(events.length>30); assert.ok(events.every(e=>e.trusted));
 } finally {await attached?.close(); await browser.close(); await rm(directory,{recursive:true,force:true});}
});
