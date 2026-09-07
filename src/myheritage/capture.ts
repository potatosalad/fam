import type { Page } from 'playwright';
import { browserJson, browserPage, captureAuthentication, readCapturedHar, type CaptureOptions, type CaptureRecipe } from '../shared/browser-capture.js';
import { importMyHeritageHar, type MyHeritageSession } from './auth.js';
import { checkTreePageUrl, parseTreePage } from './browser.js';
import { WEB } from './http.js';

export function myHeritageCaptureRecipe(treeUrl?: string): CaptureRecipe<MyHeritageSession> {
  const explicit = treeUrl ? checkTreePageUrl(treeUrl).href : undefined;
  const checked = new WeakMap<Page, {url: string; time: number}>();
  return {
    provider: 'myheritage', startUrl: explicit ?? WEB,
    urlFilter: /^https:\/\/www\.myheritage\.com\/(?:family-trees\/[^#]*|FP\/family-tree\.php(?:\?[^#]*)?|FP\/API\/FamilyTree\/get-current-user-permissions\.php(?:\?[^#]*)?|web-family-graph(?:ql)?(?:\/[^#]*)?)$/,
    instructions: 'Sign in normally. You can stay on any MyHeritage page; fam collects the account requests in the background.',
    async advance(page, report) {
      if (new URL(page.url()).origin !== WEB) return false;
      const last = checked.get(page);
      if (last?.url === page.url() && Date.now() - last.time < 10_000) return false;
      checked.set(page, {url: page.url(), time: Date.now()});
      // Use the browser's current cookies without depending on page-specific login
      // flags, menu labels, a readable person, or navigation in the user's tab.
      const links = await page.locator('a[href]').evaluateAll(anchors => anchors.map(a => (a as HTMLAnchorElement).href));
      const candidates = explicit ? [explicit] : [...new Set([page.url(), ...links, `${WEB}/FP/family-tree.php`])]
        .filter(link => {try {checkTreePageUrl(link); return true;} catch {return false;}});
      for (const target of candidates.slice(0, 3)) {
        const response = await browserPage(page, WEB, target);
        if (!response) continue;
        let tree;
        try {checkTreePageUrl(response.url); tree = parseTreePage(response.html);}
        catch {continue;}
        report('Website authentication found. Validating account access…');
        const query = new URLSearchParams({s: tree.siteId, lang: tree.lang, csrf_token: tree.csrf, familyTreeId: tree.treeId});
        const permissions = await browserJson(page, WEB, `/FP/API/FamilyTree/get-current-user-permissions.php?${query}`, '', '', 'GET');
        if (permissions && typeof permissions === 'object' && !Array.isArray(permissions) && permissions.success !== false &&
          permissions.status !== 'error' && !permissions.error && !permissions.errorCode) return true;
        report('The website login is present, but its account check has not succeeded. Complete any verification shown in the browser.');
        return false;
      }
      report('Waiting for a usable website session. Sign in or complete website verification; no particular page or clicks are required.');
      return false;
    },
    importHar: async path => importMyHeritageHar(await readCapturedHar(path)),
  };
}
export const captureMyHeritage = (options?: CaptureOptions, treeUrl?: string) => captureAuthentication(myHeritageCaptureRecipe(treeUrl), options);
