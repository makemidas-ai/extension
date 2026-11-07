import { BASE_URL, CLIENT_NAME, RESOURCE, SCOPE, ext } from './config.js';

/**
 * OAuth 2.1 sign-in against MakeMidas's authorization server: dynamic
 * client registration, PKCE (S256) and the browser's identity redirect
 * (https://<extension id>.chromiumapp.org/ in Chrome and Edge,
 * https://<hash>.extensions.allizom.org/ in Firefox). The client is
 * registered once per install and reused; the user approves
 * "Browser extension" on makemidas.com/auth/connect.
 *
 * Requests never send cookies (credentials: 'omit'), so they can't act with
 * the user's website session.
 */

const AUTH_KEY = 'auth';
/** Set while the sign-in window is open or the code is being exchanged. */
export const SIGNING_IN_KEY = 'signingIn';
/** Account, credits and recent results the popup shows while it refreshes. */
export const POPUP_CACHE_KEY = 'popupCache';
/** Refresh this long before the access token expires. */
const REFRESH_MARGIN_MS = 60 * 1000;

const base64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const randomString = (size) =>
  base64url(crypto.getRandomValues(new Uint8Array(size)));

async function sha256(text) {
  return base64url(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  );
}

export class AuthError extends Error {}

async function postJson(path, body, form = false) {
  const res = await fetch(new URL(path, BASE_URL), {
    method: 'POST',
    credentials: 'omit',
    headers: {
      'Content-Type': form
        ? 'application/x-www-form-urlencoded'
        : 'application/json',
    },
    body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}
  if (!res.ok) {
    const detail =
      data?.error_description || data?.error || text.slice(0, 200) || '';
    throw new AuthError(`Sign-in failed (${res.status}) ${detail}`.trim());
  }
  return data;
}

async function loadAuth() {
  const stored = await ext.storage.local.get(AUTH_KEY);
  return stored[AUTH_KEY] ?? null;
}

const saveAuth = (auth) => ext.storage.local.set({ [AUTH_KEY]: auth });

/** A client registered for this install's redirect URI. */
async function ensureClient(auth, redirectUri) {
  if (auth?.clientId && auth.redirectUri === redirectUri) return auth;
  const client = await postJson('/api/auth/oauth2/register', {
    client_name: CLIENT_NAME,
    redirect_uris: [redirectUri],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  });
  return { clientId: client.client_id, redirectUri };
}

const withTokens = (auth, tokens) => ({
  ...auth,
  accessToken: tokens.access_token,
  // A refresh may not return a new refresh token; keep the old one then.
  refreshToken: tokens.refresh_token ?? auth.refreshToken ?? null,
  expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
});

/** Open the sign-in window and store the tokens. Runs in the background. */
export async function signIn() {
  await ext.storage.local.set({ [SIGNING_IN_KEY]: Date.now() });
  try {
    await runSignIn();
  } finally {
    await ext.storage.local.remove(SIGNING_IN_KEY);
  }
}

async function runSignIn() {
  const redirectUri = ext.identity.getRedirectURL();
  const client = await ensureClient(await loadAuth(), redirectUri);
  await saveAuth({ clientId: client.clientId, redirectUri });

  const verifier = randomString(32);
  const state = randomString(16);
  const authorize = new URL('/api/auth/oauth2/authorize', BASE_URL);
  authorize.search = new URLSearchParams({
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: redirectUri,
    code_challenge: await sha256(verifier),
    code_challenge_method: 'S256',
    scope: SCOPE,
    resource: RESOURCE,
    state,
  }).toString();

  let returned;
  try {
    returned = await ext.identity.launchWebAuthFlow({
      url: authorize.toString(),
      interactive: true,
    });
  } catch {
    throw new AuthError('Sign-in was cancelled.');
  }
  const params = new URL(returned).searchParams;
  if (params.get('error')) {
    throw new AuthError(
      params.get('error') === 'access_denied'
        ? 'Sign-in was cancelled.'
        : `Sign-in failed: ${params.get('error')}`
    );
  }
  if (params.get('state') !== state || !params.get('code')) {
    throw new AuthError('Sign-in failed: unexpected response.');
  }

  const tokens = await postJson(
    '/api/auth/oauth2/token',
    {
      grant_type: 'authorization_code',
      code: params.get('code'),
      redirect_uri: redirectUri,
      client_id: client.clientId,
      code_verifier: verifier,
      resource: RESOURCE,
    },
    true
  );
  await saveAuth(withTokens(client, tokens));
}

/** A valid access token, refreshed when it's about to expire; null if signed out. */
export async function getAccessToken({ forceRefresh = false } = {}) {
  const auth = await loadAuth();
  if (!auth?.accessToken) return null;
  if (!forceRefresh && auth.expiresAt - REFRESH_MARGIN_MS > Date.now()) {
    return auth.accessToken;
  }
  if (!auth.refreshToken) return null;
  try {
    const tokens = await postJson(
      '/api/auth/oauth2/token',
      {
        grant_type: 'refresh_token',
        refresh_token: auth.refreshToken,
        client_id: auth.clientId,
        resource: RESOURCE,
      },
      true
    );
    const next = withTokens(auth, tokens);
    await saveAuth(next);
    return next.accessToken;
  } catch {
    // Refresh token expired or revoked: sign in again.
    await saveAuth({ clientId: auth.clientId, redirectUri: auth.redirectUri });
    return null;
  }
}

/** Forget the tokens right away, then revoke them on the server (best effort). */
export async function signOut() {
  const auth = await loadAuth();
  // The revoke endpoint deletes this client too, so register a new one next time.
  await ext.storage.local.remove([AUTH_KEY, POPUP_CACHE_KEY]);
  if (auth?.accessToken) {
    await fetch(new URL('/api/v1/auth/revoke', BASE_URL), {
      method: 'POST',
      credentials: 'omit',
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    }).catch(() => {});
  }
}

export async function isSignedIn() {
  return Boolean((await loadAuth())?.accessToken);
}

/** A sign-in started in the last 5 minutes and not finished yet. */
export async function isSigningIn() {
  const stored = await ext.storage.local.get(SIGNING_IN_KEY);
  const startedAt = stored[SIGNING_IN_KEY];
  return Boolean(startedAt && Date.now() - startedAt < 5 * 60 * 1000);
}
