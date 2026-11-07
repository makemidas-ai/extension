import { getAccessToken } from './auth.js';
import { BASE_URL } from './config.js';

/** MakeMidas REST API (/api/v1), the same endpoints the CLI uses. */

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const SIGNED_OUT = 'SIGNED_OUT';

/** Friendlier wording for the API's error codes. */
const MESSAGES = {
  insufficient_credits:
    'Not enough credits for this. Get more on makemidas.com/pricing.',
  upgrade_required: 'This model needs a paid plan.',
  busy: 'You have too many generations running. Wait for one to finish.',
};

async function request(path, init = {}, retry = true) {
  const token = await getAccessToken();
  if (!token) throw new ApiError(401, SIGNED_OUT, 'Sign in to MakeMidas.');
  const isForm = init.body instanceof FormData;
  let res;
  try {
    res = await fetch(new URL(`/api/v1${path}`, BASE_URL), {
      ...init,
      credentials: 'omit',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body && !isForm ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  } catch {
    throw new ApiError(0, 'NETWORK', "Can't reach makemidas.com.");
  }
  if (res.status === 401 && retry) {
    // The token may have been revoked or rotated elsewhere: refresh once.
    const fresh = await getAccessToken({ forceRefresh: true });
    if (!fresh) throw new ApiError(401, SIGNED_OUT, 'Sign in to MakeMidas.');
    return request(path, init, false);
  }
  if (!res.ok) {
    let body = null;
    try {
      body = await res.json();
    } catch {}
    const code = body?.error?.code ?? 'ERROR';
    throw new ApiError(
      res.status,
      code,
      MESSAGES[code] ?? body?.error?.message ?? `Request failed (${res.status}).`
    );
  }
  return res;
}

const json = async (path, init) => (await request(path, init)).json();

export const getAccount = () => json('/me');
export const getCredits = () => json('/credits');
export const listModels = () => json('/models');
export const listGenerations = (limit = 6) =>
  json(`/generations?limit=${limit}`);
export const getGeneration = (id) =>
  json(`/generations/${encodeURIComponent(id)}`);

/** Start a generation: images come back done, videos running. */
export const createGeneration = (input) =>
  json('/generations', { method: 'POST', body: JSON.stringify(input) });

/** Keep a picture from a web page as a reference; returns its upload id. */
export async function uploadReferenceUrl(url) {
  const { id } = await json('/uploads', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
  return id;
}

/** Upload a picture from this computer; returns its upload id. */
export async function uploadReferenceFile(file) {
  const form = new FormData();
  form.set('file', file);
  const { id } = await json('/uploads', { method: 'POST', body: form });
  return id;
}

/** A result file as a Blob, for saving to disk. */
export async function downloadOutput(url) {
  let res;
  try {
    res = await fetch(url, { credentials: 'omit' });
  } catch {
    throw new ApiError(0, 'NETWORK', "Can't reach makemidas.com.");
  }
  if (!res.ok) {
    throw new ApiError(res.status, 'ERROR', 'The download link expired.');
  }
  return res.blob();
}
