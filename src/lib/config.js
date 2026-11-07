/**
 * Settings shared by the popup and the background worker. The build script
 * (scripts/build.mjs) can point BASE_URL at a local dev server.
 */

export const BASE_URL = 'https://makemidas.com';

/**
 * The OAuth client name the user sees on the consent page. It must not
 * contain "MakeMidas": the consent page refuses apps that use that name.
 */
export const CLIENT_NAME = 'Browser extension';

export const SCOPE = 'openid profile email offline_access';

/** The protected resource tokens are issued for; /api/v1 accepts it too. */
export const RESOURCE = `${BASE_URL}/api/mcp`;

/** `chrome` in Chrome and Edge, `browser` in Firefox (both promise-based). */
export const ext = globalThis.browser ?? globalThis.chrome;

/** UTM-tagged link to a page on makemidas.com. */
export function siteUrl(path) {
  const url = new URL(path, BASE_URL);
  url.searchParams.set('utm_source', 'browser-extension');
  return url.toString();
}
