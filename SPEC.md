# PV Strings Dashboard — specification

Draft, 2026-08-16. Three cards and a strategy, shipped as one ES module, no
build step, no dependency on any other Lovelace plugin.

---

## 0. Design rules that come out of the integration's own history

Three bugs were found in PV Strings in one week. All three were arithmetic, and
all three presented identically from the outside: **as "not enough data yet"**.
A correction layer gated above the value it could reach; a sky map whose
reference settled inside a shadow; the same map, once repaired, putting phantom
loss on a panel with a clear view.

Nobody caught them from a dashboard, because the dashboards showed the *result*
and not what the result rested on. So:

1. **"Not yet" and "nothing" never look the same.** Every withheld figure shows
   how far off publishing it is, in the same place as the figure would be.
2. **Every derived number can be traced to its inputs** in at most one click.
3. **The card says when it cannot draw something.** Never an empty panel.

These are not decorations. They are the reason this repository is worth
building rather than pointing people at a YAML gist.

---

## 1. `pvstrings-sky-map`

```yaml
type: custom:pvstrings-sky-map
entity: sensor.strang_1_sued_30_himmelskarte
```

**Data.** `cells[]` with `az`, `el`, `loss`, `ratio`, `n`, `season`;
`level` and `fit_method` on the entity (PV Strings ≥ 1.18). Sun position from
`sensor.<string>_verschattung_jetzt` (`sun_azimuth`, `sun_elevation`) when
present.

**Grid.** Azimuth across, elevation up. 10° × 5°. Only the observed range is
drawn, not the full hemisphere — a plant sees maybe a third of it.

**Colour.** Loss is a magnitude, so a *sequential* ramp: one hue, light to dark.
Not the blue-to-red currently in use — that is a diverging ramp doing a
sequential job, and it invents a meaningless midpoint.

**Unobserved cells are not on the ramp at all.** Neutral fill, or hatched. A
cell the sun has never crossed must not read as a cell with no loss; they mean
opposite things and one of them is why a broken map looked healthy for two days.

**Always visible on the card**, not behind a tooltip:

- `level` and `fit_method` — the string's clear-view level relative to physics
  and whether the map was fitted against the sibling strings (*differential*,
  losses are clear-day losses) or absolutely; a null level (single string, too
  few shared epochs) shows the method only — structural "nothing", not "not yet"
- observed cell count, and how much of the year's sky that is

**Hover** gives the cell: azimuth and elevation range, loss, its own `ratio`,
`n`, and whether it is a pooled or seasonal value.

---

## 2. `pvstrings-forecast`

```yaml
type: custom:pvstrings-forecast
entity: sensor.pv_anlage_prognose_heute   # oder ein Strang
days: 2
show_unshaded: true
show_actual: true
```

Three series, one axis, all kilowatt-hours per hour:

| Series | Source | Why |
|---|---|---|
| Forecast | `forecast[].potential_kwh` | the published figure |
| Unshaded | `forecast[].unshaded_kwh` | the gap to *forecast* is the shadow the map found |
| Actual | measured hourly production | the gap to *unshaded* is what it has not found |

Reading the three together is the whole diagnostic: shadow the model knows,
shadow it does not, and weather error.

Works identically for the plant entity and for a string entity — same
attribute shape, so one card. For a curtailment group, `today_kwh` and
`tomorrow_kwh` come from the group entity instead.

Bars for the hourly detail, not a smoothed line: the values *are* hourly
buckets and a spline across them draws a resolution the data does not have.

**Amendment (2026-08-16).** A `style: line` variant exists and is what the
strategy uses for the per-string sections. It keeps the honesty rule by
changing the data, not by smoothing: the actual series comes from the string's
configured power entity via the recorder's 5-minute statistics (mean power),
which *is* high-resolution, while forecast and unshaded stay hourly and are
drawn as straight segments between hour centres — no splines. One axis, watts.
When no 5-minute statistics exist the card falls back to hourly means and says
so on the card. The plant overview keeps bars.

---

## 2b. `pvstrings-conversion` (PV Strings ≥ 1.20, optional)

```yaml
type: custom:pvstrings-conversion
entity: sensor.<gruppe>_restprognose_ac_heute   # or …_akkuladung_heute
dc_entity: sensor.<gruppe>_rest_heute
```

**Data.** Both entities carry the usual hourly `forecast` list plus
`today_kwh`. The output entity adds `output_path` (`direct|storage`),
`curve_source` (`datasheet|custom|neutral|fixed_factors`; with
`fixed_factors`, `conversion_factor` carries the applied multiplier),
`stages` (shape not yet contracted — render defensively), for direct
groups `clipped_kwh` and optionally `note`. These entities exist only
when the user configured an output path — absence is normal and renders
nothing (no missing_card).

**Chart.** One day. DC potential as ghost bars, converted output in front;
below, a 0–100 % ratio strip (output/DC per hour). Hours whose DC is below
`max(0.05 kWh, 4 % of the day's peak DC hour)` get a hatched strip cell —
a quotient of two near-zeros is noise, not a measurement.

**Semantics (from the integration's contract).** AC and battery charge are
never summed. AC is hardware potential: capped at the AC rating, never at
regulatory limits — never labelled "feed-in". Clipping is a separate warn
chip (a hardware cap is not a conversion loss). `curve_source: neutral`
renders as "unconverted" with no ratio strip — output = DC by definition
is not a measured 0 % loss. `fixed_factors` shows the applied factor
(× 0.931) — configured, not measured. `unavailable` coordinator state
shows the withheld "waiting" style, checked before feature detection, so
startup never looks like a contract violation.

**Strategy placement.** Overview view, own "conversion" section directly
after the forecast chart — deliberately not inside the DC groups section,
so AC/charge tiles never read as summable with DC tiles. Plant AC
today/tomorrow appear as plain tiles; when the plant sensor says
`partial: true`, a markdown card names `storage_strings` and
`unconverted_strings` separately. The nerd view gets a per-group
configuration table (path, curve, stages, clipping, realized ratio) —
curves are configured, not learned, so there is no training display.

---

## 3. `pvstrings-chain`

```yaml
type: custom:pvstrings-chain
entity: sensor.strang_1_sued_30_prognose_heute
hour: now
```

Raw physics → source bias → sky map → per-string model → published, with the
measurement beside it. One row per layer, each showing its factor and what it
did in kilowatt-hours.

**The source bias is not a link in the chain** and must not be drawn as one: it
was applied upstream, to the irradiance, and is already inside the physics
figure. It is shown as context. Multiplying it in a second time is a mistake
the integration has a test against; the card should not reintroduce it
visually.

---

## 4. The strategy

```yaml
strategy:
  type: custom:pvstrings
```

Generates, from the entity registry:

**Overview** — today, remaining, tomorrow, current power; the plant forecast
graph; per-group remaining where groups exist.

**Per string** — one section each, generated from whatever strings are
configured: forecast graph, sky map, current shading, today's yield. Six
strings produce six sections; nobody edits anything.

**Accuracy** — day-ahead beside nowcast, with the daily bias, and the day count
each rests on. The two are *not* comparable until both windows are full, and
the card says so rather than inviting the comparison.

**Nerd view** — everything the models will admit to:

- *Learning:* the log-ratio buckets — plant by weather class × daypart, the
  per-string offsets, the string × daypart interaction — each with its factor
  and `n_eff`. Buckets that do not exist yet are listed as missing, because
  which weather has never been seen is itself the finding.
- *Source bias:* the (local hour × horizon) table, and `truth_source` — whether
  the bias is being learned against a measured sensor or only against the
  source's own short-horizon run, which is a much weaker claim.
- *Sky map:* cells learned per string, `level` / `fit_method`, the worst sectors.
- *Collection:* coverage, intervals written, events seen, write errors,
  and the censoring split — how many intervals were measured, how many were
  lower bounds, and why.
- *Skip reasons:* the learn cycle's own tally of what it declined and for which
  of its reasons. On a plant learning nothing this is the entire diagnosis, and
  it is currently visible only in a log line.

---

## 5. Packaging

One ES module, plain JavaScript, no build step — Home Assistant loads modules
directly and a toolchain here would buy nothing. HACS category *plugin*.

`hacs.json` declares the filename; the release attaches it. Cards register
themselves with `customElements.define` and the strategy with the dashboard
strategy API.

---

## 6. Open questions

- Does the strategy need a config at all, or is zero-configuration the whole
  point? Leaning strongly towards zero, with the generated YAML takeable as a
  starting point for anybody who wants to edit it.
- The sky map at six strings: six grids on one view, or one grid with a string
  selector? Six is honest and immediately comparable; one is calmer.
- Should the nerd view be a separate dashboard rather than a view? It is the
  part most likely to be wanted on a second screen while something is being
  debugged.
- Translations. The integration ships German and English; the cards would have
  to follow, and a strategy that generates titles has to pick a language
  somewhere.
