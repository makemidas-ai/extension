import { ext } from './config.js';

/**
 * Generations started from the extension, kept so the background worker
 * can notify when they finish and the popup can show their progress.
 */

const JOBS_KEY = 'jobs';
const MAX_JOBS = 20;

export async function loadJobs() {
  const stored = await ext.storage.local.get(JOBS_KEY);
  return stored[JOBS_KEY] ?? [];
}

const saveJobs = (jobs) =>
  ext.storage.local.set({ [JOBS_KEY]: jobs.slice(0, MAX_JOBS) });

export async function addJob(job) {
  const jobs = (await loadJobs()).filter((j) => j.id !== job.id);
  await saveJobs([{ ...job, startedAt: Date.now() }, ...jobs]);
}

export async function updateJob(id, patch) {
  const jobs = await loadJobs();
  await saveJobs(jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)));
}

export async function removeJob(id) {
  await saveJobs((await loadJobs()).filter((j) => j.id !== id));
}

export const isFinished = (status) => status === 'done' || status === 'failed';

/**
 * What a right-click asked for, waiting for the popup to pick it up:
 * `{ kind, referenceUrl?, prompt?, at }`.
 */
export const PENDING_KEY = 'pending';

export async function takePending() {
  const stored = await ext.storage.local.get(PENDING_KEY);
  const pending = stored[PENDING_KEY];
  if (!pending) return null;
  await ext.storage.local.remove(PENDING_KEY);
  // A right-click from long ago is stale.
  return Date.now() - pending.at < 10 * 60 * 1000 ? pending : null;
}
