# Development

*[README](../README.md) · [Cards](cards.md) · [Compatibility](compatibility.md) · [Development](development.md)*

## Why a separate repository

It is where the cards are developed. Users get them from the integration:
each integration release carries a tagged release of this repository, copied
in unchanged (`tools/sync_dash.sh` over there). That ends the version skew a
separate install had — the cards and the entities they read now always
arrive together — while a card can still be fiddled with ten times in an
evening against a dev server without restarting Home Assistant each time.
The [compatibility rules](compatibility.md) still hold: a card must cope with an integration older
than itself, because the cards are written ahead of the release that ships
them.

## Dev loop

Screenshots in `docs/img` are generated, not taken by hand: start
`node tools/serve.mjs`, then run `node tools/shots.mjs` for the card images
and `node tools/details.mjs` for the detail crops used in the [card reference](cards.md). Both
render `tools/mock-preview.html`, so the images carry synthetic data and no
plant of anyone's. `tools/english.mjs` rewrites the German harness to English
on the fly, so the documentation images are English.

One ES module, plain JavaScript, no build step — `pvstrings-dash.js` is both
source and artifact. The `tools/` directory carries the dev loop:

- `tools/serve.mjs` — serves the repo with CORS so a Lovelace resource can
  point at your dev machine. That resource takes precedence over the copy
  bundled with the integration, which raises its separate-copy repair as a
  reminder; remove the resource when you are done.
- `tools/ha-ws.mjs` — minimal HA websocket client (`HA_URL` / `HA_TOKEN`)
- `tools/test.html` — renders every card with live data from your instance,
  plus a strategy dry-run: `http://localhost:8099/tools/test.html?dark=1#token=<long-lived-token>`
- `deploy.sh` — syntax-check, optional scp to `/config/www/`, cache-busts the
  resource (development only; a `/config/www/` copy counts as separate too)
