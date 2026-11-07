#!/usr/bin/env node
/**
 * Build store packages from src/:
 *   dist/chrome/ + dist/makemidas-chrome-<version>.zip   (Chrome Web Store, Edge Add-ons)
 *   dist/firefox/ + dist/makemidas-firefox-<version>.zip (addons.mozilla.org)
 *
 *   node scripts/build.mjs                              # production
 *   node scripts/build.mjs --base http://localhost:4000 # point at a local dev server
 *
 * No bundling or minification: the files ship as written, so store reviewers
 * read the same source that is in this repository.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const dist = join(root, 'dist');

const baseArg = process.argv.indexOf('--base');
const base = baseArg > -1 ? process.argv[baseArg + 1] : null;

const GECKO_ID = 'browser-extension@makemidas.com';

const manifest = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8'));

const variants = {
  chrome: (m) => m,
  firefox: (m) => ({
    ...m,
    background: { scripts: ['background.js'], type: 'module' },
    browser_specific_settings: {
      gecko: {
        id: GECKO_ID,
        strict_min_version: '140.0',
        data_collection_permissions: {
          required: ['authenticationInfo', 'websiteContent'],
        },
      },
    },
  }),
};

rmSync(dist, { recursive: true, force: true });
for (const [name, transform] of Object.entries(variants)) {
  const out = join(dist, name);
  mkdirSync(out, { recursive: true });
  cpSync(src, out, { recursive: true });

  const m = transform(structuredClone(manifest));
  if (base) {
    const origin = new URL(base).origin;
    m.host_permissions = [...m.host_permissions, `${origin}/*`];
    const configPath = join(out, 'lib', 'config.js');
    writeFileSync(
      configPath,
      readFileSync(configPath, 'utf8').replace(
        "BASE_URL = 'https://makemidas.com'",
        `BASE_URL = '${origin}'`
      )
    );
  }
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(m, null, 2)}\n`);

  if (!base) {
    const zip = join(dist, `makemidas-${name}-${m.version}.zip`);
    execFileSync('zip', ['-qr', '-X', zip, '.'], { cwd: out });
    console.log(`built ${zip}`);
  } else {
    console.log(`built ${out} (BASE_URL ${new URL(base).origin})`);
  }
}
