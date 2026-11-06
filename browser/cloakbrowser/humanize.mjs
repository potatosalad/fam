/** Apply CloakBrowser's human input to fam's independent CDP connection. */
export async function humanizeBrowser(browser) {
  // CloakBrowser 0.6+ resolves every Playwright selector (including :visible,
  // roles, and chains) in its humanized engine and patches new contexts/pages.
  const {patchBrowser, resolveConfig} = await import('cloakbrowser/human');
  patchBrowser(browser, resolveConfig('default'));
}
