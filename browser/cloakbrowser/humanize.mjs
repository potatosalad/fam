/** Keep Playwright selector support while using CloakBrowser's human actions. */
export async function humanizeBrowser(browser) {
  const {patchBrowser, resolveConfig, UnsupportedHumanizeSelectorError} = await import('cloakbrowser/human');
  patchBrowser(browser, resolveConfig('default'));
  const adaptPage = page => {
    for (const action of ['fill', 'press', 'type', 'click', 'dblclick', 'hover', 'check', 'uncheck', 'selectOption']) {
      const original = page[action].bind(page);
      page[action] = async (selector, ...args) => {
        try {return await original(selector, ...args);}
        catch (error) {
          // This resolver error occurs before input. Resolve :visible, role,
          // and chained selectors with Playwright, then use a humanized handle.
          // Never replay a timeout, detached element, or ambiguous interaction.
          if (!(error instanceof UnsupportedHumanizeSelectorError)) throw error;
          const options = args.at(-1);
          const element = await page.waitForSelector(selector, {state: 'visible',
            timeout: options && typeof options === 'object' ? options.timeout : undefined});
          try {return await element[action](...args);}
          finally {await element.dispose();}
        }
      };
    }
  };
  const adaptContext = context => {
    for (const page of context.pages()) adaptPage(page);
    context.on('page', adaptPage);
  };
  for (const context of browser.contexts()) adaptContext(context);
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async options => {const context = await newContext(options); adaptContext(context); return context;};
}
