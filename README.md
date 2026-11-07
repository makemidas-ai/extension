# MakeMidas browser extension

Make AI images and videos from anything on the web with [MakeMidas](https://makemidas.com): Nano Banana, GPT Image, Seedream, Veo, Kling and more, on your MakeMidas credits.

- **Right-click a picture:** "Create an image from this picture" or "Turn this picture into a video".
- **Right-click selected text:** "Create an image from …" puts it in the prompt.
- **Popup:** pick a model and aspect ratio (each model shows its price in credits), generate, see recent results and save them.
- **Notifications** when a video is ready.

Works in Chrome, Edge and Firefox. Signed-in accounts get free daily credits for the free image models; video models are on paid plans.

## How it works

- **Sign-in:** OAuth 2.1 with PKCE through the browser's identity window. You approve "Browser extension" on makemidas.com. Tokens are kept in the extension's local storage, and requests never send your website cookies.
- **API:** the same REST API as the [MakeMidas CLI](https://github.com/makemidas-ai/cli) (`https://makemidas.com/api/v1`). A right-clicked picture is sent as its address (`POST /api/v1/uploads` with `{ url }`) and downloaded by MakeMidas, so the extension needs no access to other sites.
- **Generations** run in the background worker, so closing the popup doesn't stop them; running videos are checked every 30 seconds.
- **What is sent:** only the picture address, picture file or prompt you choose, and your sign-in tokens, and only to makemidas.com. The extension does not read pages or track browsing. See the [privacy policy](https://makemidas.com/privacy).

## Permissions

| Permission | Why |
| --- | --- |
| `contextMenus` | The right-click items on pictures and selected text |
| `identity` | The sign-in window |
| `storage` | Your sign-in tokens and the generations you started |
| `alarms`, `notifications` | Check running videos and tell you when they're done |
| `https://makemidas.com/*` | Call the MakeMidas API and download results |

## Build

No dependencies and no bundler: the files in `src/` ship as written.

```bash
npm run build        # dist/chrome, dist/firefox and store zips
npm run build:local  # point at a dev server on http://localhost:4000
```

Load `dist/chrome` with "Load unpacked" on `chrome://extensions` (Developer mode), or `dist/firefox/manifest.json` from `about:debugging` in Firefox.

## License

MIT
