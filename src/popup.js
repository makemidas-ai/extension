import {
  ApiError,
  SIGNED_OUT,
  downloadOutput,
  getAccount,
  getCredits,
  listGenerations,
  listModels,
  uploadReferenceFile,
  uploadReferenceUrl,
} from './lib/api.js';
import {
  POPUP_CACHE_KEY,
  SIGNING_IN_KEY,
  isSignedIn,
  isSigningIn,
} from './lib/auth.js';
import { BASE_URL, ext, siteUrl } from './lib/config.js';
import { isFinished, loadJobs, takePending } from './lib/jobs.js';

const app = document.getElementById('app');
const errorBox = document.getElementById('error');
const signOutButton = document.getElementById('sign-out');
/** 'signed-in', 'signed-out' or 'signing-in'. */
let mode = null;
/** Bumped on every full render, so late async work for an old view is dropped. */
let view = 0;

/** The generator form's state. */
const form = {
  kind: 'image',
  /** { id, preview } once uploaded, or { error } when it couldn't be. */
  reference: null,
  models: [],
  paid: false,
  /** Credits left, or null until known. */
  balance: null,
};

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of [children].flat()) {
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return node;
}

function showError(message) {
  errorBox.textContent = message ?? '';
  errorBox.hidden = !message;
}

function handleError(error) {
  if (error instanceof ApiError && error.code === SIGNED_OUT) {
    renderSignedOut();
    return;
  }
  showError(error?.message ?? 'Something went wrong.');
}

const send = (message) => ext.runtime.sendMessage(message);

const fromTemplate = (id) =>
  document.getElementById(id).content.cloneNode(true);

const $ = (id) => document.getElementById(id);

/** Firefox asks the user to grant host access; Chrome grants it at install. */
async function ensureHostPermission() {
  const origins = [`${BASE_URL}/*`];
  if (await ext.permissions.contains({ origins })) return true;
  return ext.permissions.request({ origins });
}

async function loadCache() {
  const stored = await ext.storage.local.get(POPUP_CACHE_KEY);
  return stored[POPUP_CACHE_KEY] ?? {};
}

async function saveCache(patch) {
  // A late response after signing out must not bring the cache back.
  if (mode !== 'signed-in') return;
  const cache = await loadCache();
  await ext.storage.local.set({ [POPUP_CACHE_KEY]: { ...cache, ...patch } });
}

function renderSigningIn() {
  view += 1;
  mode = 'signing-in';
  showError(null);
  signOutButton.hidden = true;
  app.replaceChildren(
    el('section', { className: 'card' }, [
      el('p', {}, [el('span', { className: 'spinner' }), 'Finishing sign-in…']),
      el('p', { className: 'muted small' }, [
        'Approve "Browser extension" in the sign-in window. This updates by itself.',
      ]),
    ])
  );
}

function renderSignedOut() {
  view += 1;
  mode = 'signed-out';
  showError(null);
  signOutButton.hidden = true;
  app.replaceChildren(fromTemplate('signed-out'));
  $('sign-in').addEventListener('click', async () => {
    showError(null);
    // Must run in this click handler (a user gesture).
    if (!(await ensureHostPermission())) {
      showError('MakeMidas needs access to makemidas.com to sign in.');
      return;
    }
    renderSigningIn();
    const result = await send({ type: 'signIn' });
    if (result?.ok) {
      if (mode !== 'signed-in') renderSignedIn();
    } else {
      renderSignedOut();
      showError(result?.error);
    }
  });
}

// ---------------------------------------------------------------- generator

/** Models that fit the current kind and reference, cheapest first. */
function availableModels() {
  return form.models
    .filter((m) => m.kind === form.kind)
    .filter((m) => {
      if (!form.reference?.id) return true;
      return m.kind === 'image'
        ? m.maxReferences > 0
        : m.frameModes.includes('first');
    })
    .map((m) => ({ model: m, credits: estimate(m, 0) }))
    .sort((a, b) => a.credits - b.credits)
    .map((x) => x.model);
}

const usable = (model) => form.paid || model.tier === 'free';

/**
 * About how many credits one result costs, from the prices /models lists.
 * The server works out the exact charge.
 */
function estimate(model, durationSeconds) {
  if (model.kind === 'image') {
    const price =
      model.credits.find((c) => c.resolution === '1K') ?? model.credits[0];
    const refs = form.reference?.id ? 1 : 0;
    return (price?.credits ?? 0) + (model.creditsPerReference ?? 0) * refs;
  }
  const rate = model.credits[0]?.creditsPerSecond ?? 0;
  return Math.round(rate * (durationSeconds || model.durations[0] || 5));
}

function fillSelect(select, options, selected) {
  select.replaceChildren(
    ...options.map(([value, label, disabled]) =>
      el('option', { value, disabled: Boolean(disabled) }, [label])
    )
  );
  const keep = options.find(([value, , disabled]) => value === selected && !disabled);
  const first = options.find(([, , disabled]) => !disabled);
  select.value = (keep ?? first ?? options[0])?.[0] ?? '';
}

function selectedModel() {
  return form.models.find((m) => m.id === $('model').value) ?? null;
}

function renderOptions() {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.setAttribute('aria-selected', String(tab.dataset.kind === form.kind));
  }
  const models = availableModels();
  const previous = $('model').value;
  fillSelect(
    $('model'),
    models.map((m) => [
      m.id,
      usable(m) ? m.label : `${m.label} (paid plans)`,
      !usable(m),
    ]),
    previous
  );
  renderModelOptions();
}

function renderModelOptions() {
  const model = selectedModel();
  const aspect = $('aspect');
  const duration = $('duration');
  if (!model) {
    aspect.replaceChildren();
    duration.hidden = true;
    renderPrice();
    return;
  }
  fillSelect(
    aspect,
    model.aspectRatios.map((r) => [r, r]),
    aspect.value
  );
  if (model.kind === 'video') {
    duration.hidden = false;
    fillSelect(
      duration,
      model.durations.map((d) => [String(d), `${d} s`]),
      duration.value
    );
  } else {
    duration.hidden = true;
  }
  renderPrice();
}

function renderPrice() {
  const model = selectedModel();
  const button = $('generate');
  const hint = $('hint');
  if (!model) {
    button.disabled = true;
    button.textContent = 'Generate';
    hint.hidden = false;
    hint.textContent = form.reference?.id
      ? 'No model takes a picture for this. Remove the picture or switch to the other tab.'
      : 'No models available.';
    return;
  }
  const credits = estimate(model, Number($('duration').value));
  const short = form.balance !== null && form.balance < credits;
  button.disabled = !usable(model) || short;
  button.textContent = `Generate · about ${credits} credit${credits === 1 ? '' : 's'}`;
  hint.hidden = usable(model) && !short;
  if (!usable(model)) {
    hint.replaceChildren(
      model.kind === 'video'
        ? 'Video models are on paid plans. '
        : 'This model is on paid plans. ',
      el('a', { href: siteUrl('/pricing'), target: '_blank' }, ['See plans'])
    );
  } else if (short) {
    hint.replaceChildren(
      `You have ${form.balance} credit${form.balance === 1 ? '' : 's'}. `,
      el('a', { href: siteUrl('/pricing'), target: '_blank' }, ['Get more'])
    );
  }
}

function renderReference() {
  const box = $('reference');
  if (!box) return;
  const ref = form.reference;
  if (ref?.uploading) {
    box.replaceChildren(
      el('p', { className: 'muted small' }, [
        el('span', { className: 'spinner' }),
        'Adding the picture…',
      ])
    );
    return;
  }
  if (ref?.id) {
    const remove = el('button', { className: 'link small' }, ['Remove']);
    remove.addEventListener('click', () => {
      form.reference = null;
      renderReference();
      renderOptions();
    });
    box.replaceChildren(
      el('img', { src: ref.preview, alt: '' }),
      el('span', { className: 'small muted' }, [
        form.kind === 'video' ? 'First frame of the video' : 'Reference picture',
      ]),
      remove
    );
    return;
  }
  const input = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) addReference({ file });
  });
  box.replaceChildren(
    el('label', { className: 'file-button' }, [input, '+ Add a picture']),
    ref?.error ? el('span', { className: 'small error' }, [ref.error]) : ''
  );
}

/** Upload a picture from the page (url) or this computer (file). */
async function addReference({ url, file }) {
  form.reference = { uploading: true };
  renderReference();
  try {
    const id = url
      ? await uploadReferenceUrl(url)
      : await uploadReferenceFile(file);
    form.reference = { id, preview: url ?? URL.createObjectURL(file) };
  } catch (error) {
    if (error instanceof ApiError && error.code === SIGNED_OUT) {
      renderSignedOut();
      return;
    }
    form.reference = {
      error: url
        ? "Couldn't get this picture from the page. Save it, then add it here."
        : error.message,
    };
  }
  renderReference();
  renderOptions();
}

function setKind(kind) {
  form.kind = kind;
  renderReference();
  renderOptions();
}

async function generate() {
  showError(null);
  const model = selectedModel();
  const prompt = $('prompt').value.trim();
  if (!model) return;
  if (!prompt) {
    showError('Describe what to make.');
    $('prompt').focus();
    return;
  }
  const input = {
    kind: form.kind,
    prompt,
    model: model.id,
    aspectRatio: $('aspect').value,
    ...(form.kind === 'video' ? { duration: Number($('duration').value) } : {}),
    ...(form.reference?.id ? { referenceIds: [form.reference.id] } : {}),
  };
  const button = $('generate');
  button.disabled = true;
  button.textContent = 'Starting…';
  // The background worker runs it, so closing the popup doesn't stop it.
  const pending = send({ type: 'generate', input });
  setTimeout(() => {
    if (button.isConnected) renderPrice();
  }, 800);
  renderActive();
  const result = await pending;
  if (!result?.ok) {
    if (result?.code === SIGNED_OUT) renderSignedOut();
    else showError(result?.error);
    renderActive();
    return;
  }
  $('prompt').value = '';
  form.reference = null;
  renderReference();
  renderOptions();
  renderAccount().catch(() => {});
  renderRecent().catch(() => {});
}

// ------------------------------------------------------------- the results

/** Generations started from here that are still running. */
async function renderActive() {
  const section = $('active');
  if (!section) return;
  const running = (await loadJobs()).filter((j) => !isFinished(j.status));
  section.hidden = !running.length;
  section.replaceChildren(
    ...running.map((job) =>
      el('div', { className: 'job', title: job.prompt }, [
        el('span', { className: 'spinner' }),
        `${job.kind === 'video' ? 'Video' : 'Image'}: ${job.prompt}`,
      ])
    ),
    running.some((j) => j.kind === 'video')
      ? el('p', { className: 'fine' }, [
          "Videos take a few minutes. You can close this popup; you'll get a notification.",
        ])
      : ''
  );
}

async function save(url, kind) {
  const blob = await downloadOutput(url);
  const suffix =
    blob.type.split('/')[1]?.replace('jpeg', 'jpg') ??
    (kind === 'video' ? 'mp4' : 'png');
  const href = URL.createObjectURL(blob);
  const a = el('a', { href, download: `makemidas-${Date.now()}.${suffix}` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function tile(generation) {
  const output = generation.outputs.find((o) => o.url);
  const node = el('div', { className: 'tile', title: generation.prompt });
  if (!output) {
    node.append(
      el('div', { className: 'state' }, [
        generation.status === 'running'
          ? el('span', { className: 'spinner' })
          : generation.status === 'failed'
            ? 'Failed'
            : '',
      ])
    );
    return node;
  }
  const media =
    generation.kind === 'video'
      ? el('video', { src: output.url, muted: true, loop: true, preload: 'metadata' })
      : el('img', { src: output.url, alt: generation.prompt, loading: 'lazy' });
  if (generation.kind === 'video') {
    media.addEventListener('mouseenter', () => media.play().catch(() => {}));
    media.addEventListener('mouseleave', () => media.pause());
  }
  const link = el('a', { href: output.url, target: '_blank' }, [media]);
  const button = el('button', { className: 'save', title: 'Save to this computer' }, ['Save']);
  button.addEventListener('click', async (event) => {
    event.preventDefault();
    showError(null);
    try {
      await save(output.url, generation.kind);
    } catch (error) {
      handleError(error);
    }
  });
  node.append(link, button);
  return node;
}

function fillRecent(generations) {
  const grid = $('recent');
  if (!grid) return;
  if (!generations?.length) {
    grid.replaceChildren(
      el('p', { className: 'muted small' }, ['Nothing yet. Your results show up here.'])
    );
    return;
  }
  grid.replaceChildren(...generations.map(tile));
}

async function renderRecent() {
  const { generations } = await listGenerations(6);
  // Signed links expire, so cache only what's needed to draw placeholders.
  fillRecent(generations);
}

async function renderAccount() {
  const [account, credits] = await Promise.all([getAccount(), getCredits()]);
  form.paid = credits.paid;
  form.balance = credits.balance;
  if ($('generate')) renderPrice();
  const line = [
    account.email,
    `${credits.balance} credit${credits.balance === 1 ? '' : 's'}`,
  ].join(' · ');
  await saveCache({ accountLine: line, paid: credits.paid });
  const node = $('account');
  if (node) node.textContent = line;
}

async function renderModels() {
  const { models } = await listModels();
  form.models = models;
  await saveCache({ models });
  renderOptions();
}

async function renderSignedIn() {
  const current = ++view;
  mode = 'signed-in';
  showError(null);
  signOutButton.hidden = false;
  app.replaceChildren(fromTemplate('signed-in'));
  $('open-site').href = siteUrl('/generate');
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => setKind(tab.dataset.kind));
  }
  $('model').addEventListener('change', renderModelOptions);
  $('duration').addEventListener('change', renderPrice);
  $('generate').addEventListener('click', generate);

  // Last known values first, so the popup is useful before the API answers.
  const cache = await loadCache();
  if (current !== view) return;
  if (cache.accountLine) $('account').textContent = cache.accountLine;
  form.paid = Boolean(cache.paid);
  form.models = cache.models ?? [];

  // A right-click on a picture or on selected text.
  const pending = await takePending();
  ext.action.setBadgeText({ text: '' });
  if (pending) {
    form.kind = pending.kind;
    if (pending.prompt) $('prompt').value = pending.prompt.slice(0, 4000);
  }
  renderReference();
  renderOptions();
  if (pending?.referenceUrl) addReference({ url: pending.referenceUrl });
  $('prompt').focus();

  const results = await Promise.allSettled([
    renderAccount(),
    renderModels(),
    renderActive(),
    renderRecent(),
  ]);
  const failed = results.find((r) => r.status === 'rejected');
  if (failed && current === view) handleError(failed.reason);
}

signOutButton.addEventListener('click', () => {
  // Switch right away; the background forgets the tokens and revokes them.
  renderSignedOut();
  send({ type: 'signOut' });
});

// Sign-in and generations finish in the background (often after this popup
// closed and was reopened): follow the stored state.
ext.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (changes.auth?.newValue?.accessToken && mode !== 'signed-in') {
    renderSignedIn();
  } else if (
    changes[SIGNING_IN_KEY] &&
    !changes[SIGNING_IN_KEY].newValue &&
    mode === 'signing-in' &&
    !(await isSignedIn())
  ) {
    renderSignedOut();
  }
  if (changes.jobs && mode === 'signed-in') {
    renderActive();
    const finished = (changes.jobs.newValue ?? []).some(
      (j) =>
        isFinished(j.status) &&
        !(changes.jobs.oldValue ?? []).some(
          (o) => o.id === j.id && o.status === j.status
        )
    );
    if (finished) {
      renderRecent().catch(() => {});
      renderAccount().catch(() => {});
    }
  }
});

(async () => {
  if (await isSignedIn()) await renderSignedIn();
  else if (await isSigningIn()) renderSigningIn();
  else renderSignedOut();
})();
