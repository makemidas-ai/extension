# Store listing (Chrome Web Store, Edge Add-ons, Firefox Add-ons)

Packages: `npm run build` → `dist/makemidas-chrome-<version>.zip` (Chrome and Edge) and `dist/makemidas-firefox-<version>.zip` (Firefox).
Images: `store/screenshot-1.png`, `store/screenshot-2.png` (1280×800), `store/promo-tile-440x280.png`, icon `src/icons/icon-128.png`. Rendered from `store/src/store.html` (`#shot-1`, `#shot-2`, `#promo`) with captures of the popup; re-render after UI changes.

## Basics

- **Name:** MakeMidas: AI Image & Video Generator
- **Summary (≤132 chars, from the manifest):** Turn any picture or text on the web into AI images and videos with Nano Banana, GPT Image, Veo, Kling and more.
- **Category:** Chrome "Productivity → Tools" (or "Art & Design" if offered); Edge "Productivity"; Firefox "Photos, Music & Videos"
- **Language:** English
- **Website:** https://makemidas.com/developers
- **Support:** https://makemidas.com/contact (support@makemidas.com)
- **Privacy policy:** https://makemidas.com/privacy (section "MakeMidas Browser Extension")
- **Source code:** https://github.com/makemidas-ai/extension (MIT), once pushed
- **Price:** free (uses the user's MakeMidas credits; signed-in accounts get free daily credits for the free image models)

## Description

Make AI images and videos from anything you see on the web.

Right-click a picture and choose "Create an image from this picture" to restyle it, or "Turn this picture into a video" to animate it. Select some text and choose "Create an image from …" to use it as the prompt. The MakeMidas popup opens with everything filled in: pick a model and generate.

Models
• Images: Nano Banana, GPT Image, Seedream, Flux, Grok Imagine and more
• Videos: Veo, Kling, Seedance, Wan, Hailuo and more
• Each model shows its price in credits before you generate

How it works
• Sign in once with your MakeMidas account (or create one in the sign-in window).
• Generate from the popup. Images are ready in seconds; videos take a few minutes, and you get a notification when one is ready.
• See your recent results in the popup, save them in one click, or open them on makemidas.com.

What you need
• A MakeMidas account. Signed-in accounts get free credits every day for the free image models; video models and the other image models are on paid plans.
• Generations spend your credits at the same prices as the website.

Privacy
• The extension sends only what you choose: the address of a picture you right-click, a picture you add, and your prompt, and only to makemidas.com.
• It doesn't read the pages you visit or track your browsing.
• Pictures you add are deleted within 48 hours.

## Chrome Web Store: privacy practices tab

**Single purpose:** Generate AI images and videos with the user's MakeMidas account from a picture or text the user picks on a web page, or from a prompt typed in the popup, and show the results.

**Permission justifications:**
- `contextMenus`: add "Create an image from this picture", "Turn this picture into a video" and "Create an image from …" to the right-click menu on images and selected text.
- `identity`: open the MakeMidas sign-in window (OAuth 2.1 with PKCE) and receive the authorization code.
- `storage`: keep the sign-in tokens, the generations the user started and the last account details, on this device.
- `alarms`: check running videos every 30 seconds until they finish.
- `notifications`: tell the user when a video (or an image finished after the popup closed) is ready or failed.
- Host permission `https://makemidas.com/*`: call the MakeMidas API (sign-in, credits, models, uploads, generations) and download results.

**Remote code:** No. All code is in the package; the extension only calls the MakeMidas REST API.

**Data usage (suggested ticks, confirm when filling the form):**
- Authentication information: yes (OAuth tokens for the user's MakeMidas account, stored locally and sent only to makemidas.com).
- Website content: the address of the picture the user right-clicks, or the text they selected (as a prompt), is sent to makemidas.com only when they act on it. Nothing is collected in the background.
- Certify: not sold to third parties; not used for unrelated purposes; not used for creditworthiness or lending.

## Firefox (AMO)

- Add-on ID: `browser-extension@makemidas.com`, minimum Firefox 140 (needed for `data_collection_permissions`).
- Data collection declared in the manifest: `authenticationInfo`, `websiteContent` (the chosen picture address or selected text).
- Source code: not minified or bundled, so no separate source upload should be needed.
- Firefox asks for access to makemidas.com the first time you click "Sign in".
- Not yet tested in Firefox: load `dist/firefox/manifest.json` from `about:debugging` and sign in once before submitting.

## Edge Add-ons

Upload the same Chrome zip. Sign-in registers whatever `identity.getRedirectURL()` returns in Edge, so no server change is needed; test sign-in once in Edge before submitting.

## After publishing

- Add the store links to https://makemidas.com/developers and apply `store/after-approval/help-section.patch` to the makemidas repo (help page section, en and zh).
- Record the listings in `.rankup/integrations.md` and check each listing page's link to makemidas.com for the backlink ledger.
