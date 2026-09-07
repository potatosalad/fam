import { browserJson, captureAuthentication, type CaptureOptions, type CaptureRecipe } from '../shared/browser-capture.js';
import type { SavedFindmypastSession } from './auth.js';
import { importFindmypastHar } from './har.js';
import { graphqlOperation } from './catalog.js';

export function findmypastCaptureRecipe(region = 'com'): CaptureRecipe<SavedFindmypastSession> {
  if (!['com', 'co.uk'].includes(region)) throw new Error('--region must be com or co.uk.');
  return {
    provider: 'findmypast', startUrl: `https://www.findmypast.${region}/family-tree`,
    urlFilter: /^https:\/\/www\.findmypast\.(?:com|co\.uk)\/titan\/marshal\/graphql(?:\?[^#]*)?$/,
    instructions: 'fam checks your account automatically after sign-in.',
    async advance(page) {
      const url = new URL(page.url());
      if (!['https://www.findmypast.com', 'https://www.findmypast.co.uk'].includes(url.origin)) return false;
      const result = await browserJson(page, url.origin, '/titan/marshal/graphql', JSON.stringify({
        operationName: 'GetCurrentUserProfile', query: graphqlOperation('GetCurrentUserProfile').document, variables: {},
      }), 'application/json');
      return Boolean(result?.data?.currentUserProfile?.id && !result.errors?.length);
    },
    importHar: importFindmypastHar,
  };
}
export const captureFindmypast = (options?: CaptureOptions, region?: string) => captureAuthentication(findmypastCaptureRecipe(region), options);
