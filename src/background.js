import {
  ApiError,
  SIGNED_OUT,
  createGeneration,
  getGeneration,
} from './lib/api.js';
import { AuthError, signIn, signOut } from './lib/auth.js';
import { ext, siteUrl } from './lib/config.js';
import {
  PENDING_KEY,
  addJob,
  isFinished,
  loadJobs,
  removeJob,
  updateJob,
} from './lib/jobs.js';

/**
 * Background worker: the right-click menu, sign-in (the popup closes when the
 * sign-in window opens, so the flow runs here), starting generations (an
 * image can take a minute or two, longer than a popup stays open) and
 * checking running videos so the user gets a notification when one is done.
 */

const MENU_IMAGE = 'image-from-picture';
const MENU_VIDEO = 'video-from-picture';
const MENU_TEXT = 'image-from-text';
const POLL_ALARM = 'poll';
const POLL_MINUTES = 0.5;

ext.runtime.onInstalled.addListener(async () => {
  await ext.contextMenus.removeAll();
  ext.contextMenus.create({
    id: MENU_IMAGE,
    title: 'Create an image from this picture',
    contexts: ['image'],
  });
  ext.contextMenus.create({
    id: MENU_VIDEO,
    title: 'Turn this picture into a video',
    contexts: ['image'],
  });
  ext.contextMenus.create({
    id: MENU_TEXT,
    title: 'Create an image from "%s"',
    contexts: ['selection'],
  });
});

function notify(id, title, message) {
  ext.notifications.create(id, {
    type: 'basic',
    iconUrl: ext.runtime.getURL('icons/icon-128.png'),
    title,
    message,
  });
}

/** Open the popup, or mark the icon when the browser won't. */
async function openPopup() {
  try {
    await ext.action.openPopup();
    return;
  } catch {
    // Not supported, or no focused window.
  }
  await ext.action.setBadgeBackgroundColor?.({ color: '#C96442' });
  await ext.action.setBadgeText({ text: '1' });
  notify(
    'pending',
    'Ready in MakeMidas',
    'Click the MakeMidas icon in the toolbar to continue.'
  );
}

ext.contextMenus.onClicked.addListener(async (info) => {
  let pending = null;
  if (info.menuItemId === MENU_TEXT && info.selectionText) {
    pending = { kind: 'image', prompt: info.selectionText.trim() };
  } else if (
    (info.menuItemId === MENU_IMAGE || info.menuItemId === MENU_VIDEO) &&
    info.srcUrl
  ) {
    pending = {
      kind: info.menuItemId === MENU_VIDEO ? 'video' : 'image',
      referenceUrl: info.srcUrl,
    };
  }
  if (!pending) return;
  await ext.storage.local.set({
    [PENDING_KEY]: { ...pending, at: Date.now() },
  });
  await openPopup();
});

/**
 * Chrome stops an idle extension worker after 30 seconds, even while a
 * fetch is waiting; calling an extension API now and then keeps it alive.
 */
async function keepAlive(work) {
  const timer = setInterval(() => ext.runtime.getPlatformInfo(), 20 * 1000);
  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
}

/** True while the popup is open, so a finished image needs no notification. */
async function popupIsOpen() {
  try {
    const contexts = await ext.runtime.getContexts({
      contextTypes: ['POPUP'],
    });
    return contexts.length > 0;
  } catch {
    return false;
  }
}

function notifyFinished(generation) {
  const done = generation.status === 'done';
  notify(
    `job:${generation.id}`,
    done
      ? generation.kind === 'video'
        ? 'Your video is ready'
        : 'Your image is ready'
      : 'Generation failed',
    done
      ? 'Click to open it in MakeMidas.'
      : generation.error || 'Open MakeMidas for details.'
  );
}

/** Start a generation and remember it; videos are polled until done. */
async function startGeneration(input) {
  const placeholder = `starting:${Date.now()}`;
  await addJob({
    id: placeholder,
    kind: input.kind,
    prompt: input.prompt,
    status: 'running',
  });
  let generation;
  try {
    generation = await keepAlive(() => createGeneration(input));
  } finally {
    await removeJob(placeholder);
  }
  await addJob({
    id: generation.id,
    kind: generation.kind,
    prompt: generation.prompt,
    status: generation.status,
    webUrl: generation.webUrl,
  });
  if (isFinished(generation.status)) {
    if (!(await popupIsOpen())) notifyFinished(generation);
  } else {
    ext.alarms.create(POLL_ALARM, { periodInMinutes: POLL_MINUTES });
  }
  return generation;
}

async function pollJobs() {
  const pending = (await loadJobs()).filter(
    (j) => !isFinished(j.status) && !j.id.startsWith('starting:')
  );
  if (!pending.length) {
    ext.alarms.clear(POLL_ALARM);
    return;
  }
  for (const job of pending) {
    let current;
    try {
      current = await getGeneration(job.id);
    } catch (error) {
      if (error instanceof ApiError && error.code === SIGNED_OUT) return;
      if (error instanceof ApiError && error.status === 404) {
        await updateJob(job.id, { status: 'failed', error: 'Not found' });
      }
      continue;
    }
    if (!isFinished(current.status)) continue;
    await updateJob(job.id, {
      status: current.status,
      error: current.error,
      webUrl: current.webUrl,
    });
    notifyFinished(current);
  }
}

ext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) pollJobs();
});

ext.notifications.onClicked.addListener(async (id) => {
  ext.notifications.clear(id);
  if (id === 'pending') return;
  if (!id.startsWith('job:')) return;
  const job = (await loadJobs()).find((j) => j.id === id.slice(4));
  ext.tabs.create({ url: siteUrl(job?.webUrl ?? '/generate') });
});

// Messages from the popup.
ext.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const run = async () => {
    switch (message?.type) {
      case 'signIn':
        await signIn();
        // The popup closed when the sign-in window opened: bring it back.
        // openPopup needs Chrome 127+ and a focused window; ignore failures.
        try {
          await ext.action.openPopup?.();
        } catch {
          // no focused window, or not supported
        }
        return { ok: true };
      case 'signOut':
        await signOut();
        return { ok: true };
      case 'generate':
        return { ok: true, generation: await startGeneration(message.input) };
      default:
        return { ok: false, error: 'Unknown message' };
    }
  };
  run()
    .then(sendResponse)
    .catch((error) =>
      sendResponse({
        ok: false,
        error:
          error instanceof AuthError || error instanceof ApiError
            ? error.message
            : 'Something went wrong. Please try again.',
        code: error instanceof ApiError ? error.code : null,
      })
    );
  return true;
});
