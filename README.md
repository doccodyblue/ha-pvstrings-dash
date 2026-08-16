# PV Strings — Dashboard

Cards and a zero-configuration dashboard strategy for the
[PV Strings](https://github.com/doccodyblue/ha-pvstrings) integration.

Install it, add the strategy, and you get a working dashboard for however many
strings you have — without opening a card editor. Or ignore the strategy and
use the cards on their own.

**Optional.** The integration publishes everything through ordinary entities
and attributes and works perfectly well without any of this.

| | |
|---|---|
| ![Sky map](docs/img/sky-map-dark.png) | ![Forecast line](docs/img/forecast-line-dark.png) |
| ![Chain](docs/img/chain-dark.png) | ![Daily](docs/img/daily-dark.png) |

---

## Installation

### HACS (recommended)

1. HACS → three-dot menu → **Custom repositories**
2. Repository: `doccodyblue/ha-pvstrings-dash`, type: **Dashboard**
3. Install **PV Strings Dashboard**. HACS registers the Lovelace resource
   automatically.

### Manual

Copy `pvstrings-dash.js` to `/config/www/` and add a Lovelace resource:
`/local/pvstrings-dash.js`, type *JavaScript module*.

### The generated dashboard

Settings → Dashboards → **Add dashboard** → *New dashboard from scratch*,
then open it, enter the raw configuration editor (three-dot menu) and replace
the content with:

```yaml
strategy:
  type: custom:pvstrings
```

That is the entire configuration. The strategy reads the entity registry and
builds four views: **Overview** (today, remaining, tomorrow, power, forecast
chart, savings — written for people, not for debugging), **Strings** (one
section per string: forecast line chart, sky map, shading, yield),
**Accuracy** (nowcast vs day-ahead, with the day-by-day comparison), and
**Nerd** (learning buckets, source-bias table, collection health, skip
reasons). Views follow `hass.language` (German/English). The generated YAML
is a normal dashboard config — take it over and edit it if you want to.

---

## The cards

### `pvstrings-sky-map`

The learned sky as a grid over sun position: ten degrees of azimuth by five of
elevation, only the observed range drawn, with the sun's current position
marked.

```yaml
type: custom:pvstrings-sky-map
entity: sensor.<string>_sky_map      # German installs: sensor.<strang>_himmelskarte
show_sun: true      # optional
seasons: true       # optional — seasonal layer toggle when split cells exist
```

Two things it deliberately gets right, both learned the hard way:

- **A cell nobody has observed is not a cell with no loss.** Unobserved cells
  are hatched neutral — never the light end of the loss ramp.
- **A flat map is meaningless without its reference.** `reference_ratio` is
  always on the card; below 0.9 it carries a warning, because a reference
  inside the shadow is a map that has normalised the shadow away.

### `pvstrings-forecast`

Hourly forecast, unshaded potential, and actual production — one axis.
The gap between unshaded and forecast is the shadow the model knows; the gap
to the measurement is what it does not.

```yaml
type: custom:pvstrings-forecast
entity: sensor.<plant>_forecast_today   # plant, string, or curtailment group
days: 2             # 1–3
style: bars         # or: line
show_unshaded: true
show_actual: true
```

`style: line` (what the strategy uses for string sections) draws the actual
series from the string's configured power entity via the recorder's
**5-minute statistics** — the high resolution comes from real data, never
from smoothing. Forecast and unshaded stay hourly, drawn as straight
segments. If no 5-minute statistics exist, the card falls back to hourly
means and says so on the card.

### `pvstrings-chain`

What each layer did to the raw physics for one hour: physics → × sky map →
× per-string model → published, with the measurement beside it. The source
bias is shown as context, not as a link — it was applied upstream and is
already inside the physics figure. The card also verifies the multiplication
it displays and complains loudly if the invariant does not hold.

```yaml
type: custom:pvstrings-chain
entity: sensor.<string>_forecast_today   # needs the per-string chain attrs
hour: now
```

### `pvstrings-daily`

Day-ahead forecast against actual production, day by day. The day-ahead value
is reconstructed from long-term statistics: the value of `forecast_tomorrow`
as recorded in the issue hour (18:00) of the evening before — the same
definition the integration's own `deviation_yesterday` uses, and verified
against it. Days without an evening forecast show a hatched "no forecast
issued" marker, never a zero bar.

```yaml
type: custom:pvstrings-daily
entity: sensor.<plant>_forecast_today    # any sensor of the target device
days: 14
```

### `pvstrings-kv-table`

Small diagnostic table renderer the nerd view is built from (learning
buckets, source-bias matrix, censoring split, skip reasons). Every table
header links to its source entity. Usable standalone via `mode:` —
see the strategy-generated YAML for examples.

---

## The contract

Cards **detect the attributes they need**, and never sniff a version number.
When something is missing they say which attribute, and which integration
version introduced it:

> needs `reference_ratio` on `sensor.…_sky_map` (PV Strings ≥ 1.15.0)

Feature detection rather than a version string, because the question a card
actually has is "can I draw this", not "what release is this".

A missing entity is reported in place. The strategy never silently omits a
card it meant to include.

| Feature | Needs PV Strings |
|---|---|
| forecast card (hourly + unshaded) | ≥ 1.8.0 |
| chain card (per-hour factors) | ≥ 1.8.0 |
| sky map with `ratio` / `reference_ratio` | ≥ 1.15.0 |
| curtailment-group sections | ≥ 1.14.0 |
| daily card (issue-hour reconstruction) | ≥ 1.10.0 |

The three design rules behind all of this, bought with the integration's own
bug history (three arithmetic bugs, all of which looked exactly like "not
enough data yet" from the outside):

1. **"Not yet" and "nothing" never look the same.** Every withheld figure
   shows how far off publishing it is, in the place the figure would be.
2. **Every derived number can be traced to its inputs** in at most one click.
3. **A card that cannot draw something says why.** Never an empty panel.

---

## Why a separate repository

HACS classifies a repository as *either* an integration *or* a Lovelace
plugin, and it decides from the layout. A repository carrying
`custom_components/` is an integration and its JavaScript cannot be installed
as a plugin. So the cards live here.

The split has a second benefit and one real cost. The benefit: a card gets
fiddled with ten times in an evening, and coupling that to integration
releases would mean restarting Home Assistant ten times. The cost is version
skew, and it fails quietly — which is exactly what *The contract* above is
for.

---

## Development

One ES module, plain JavaScript, no build step — `pvstrings-dash.js` is both
source and artifact. The `tools/` directory carries the dev loop:

- `tools/serve.mjs` — serves the repo with CORS so a Lovelace resource can
  point at your dev machine
- `tools/ha-ws.mjs` — minimal HA websocket client (`HA_URL` / `HA_TOKEN`)
- `tools/test.html` — renders every card with live data from your instance,
  plus a strategy dry-run: `http://localhost:8099/tools/test.html?dark=1#token=<long-lived-token>`
- `deploy.sh` — syntax-check, optional scp to `/config/www/`, cache-busts the
  resource
