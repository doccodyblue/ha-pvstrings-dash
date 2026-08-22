# Feature: nerd explainer — coverage counts daylight hours only

> Internal working note for implementation. Not meant for the public repo —
> delete once implemented. Keep the public changelog free of any plant-owner
> specifics (names, addresses, entity ids), per the pseudonymity policy.

## Background

PVStrings integration v1.16.0 changed the semantics of the per-string quality
stats on `strings_detail` (`coverage_mean`, `intervals`, `samples_mean`,
`curtailed_fraction`, `value_kinds`): the stats window is now clamped to the
day's astronomical daylight (sunrise to sunset at the plant location).

Reason: averaged over the whole day, the figure graded the source's
night-time manners instead of its data quality. A Victron MPPT reports a
numeric 0 W all night and counted as covered; a DTU-style source (OpenDTU/
Ahoy and friends) goes `unavailable` while the microinverter sleeps and
started every day with a systematic handicap exactly as long as the night
(verified live: 0.62 vs 0.96 on the same day, both with gap-free daytime
capture). See the integration's CHANGELOG 1.16.0 for the full story.

## Change (this repo)

The nerd explainer's coverage sentence must say that coverage counts daylight
hours only. Two places, one bullet each — the **Collection / censoring** /
**Erfassung / Zensur** bullet inside the `nerd_explain` translation blobs in
`pvstrings-dash.js`:

- EN blob (~line 189): currently
  `coverage is the share of 5-minute intervals actually captured.`
  Suggested:
  `coverage is the share of 5-minute intervals actually captured, counted
  over daylight hours only (sunrise to sunset) — a source that sleeps at
  night is not penalised for it.`
- DE blob (~line 300): currently
  `coverage ist der Anteil tatsächlich erfasster 5-Minuten-Intervalle.`
  Suggested:
  `coverage ist der Anteil tatsächlich erfasster 5-Minuten-Intervalle,
  gezählt nur über Tageslichtstunden (Sonnenauf- bis -untergang) — eine
  Quelle, die nachts schläft, wird dafür nicht bestraft.`

Wording may be tightened, but both languages must carry the same meaning, and
the *lower bound* / *Untergrenze* half of the bullet stays as it is.

Do **not** put an integration version number into the explainer text itself —
it ages badly there. The release notes are the place to say the sentence
describes integration ≥ 1.16.0 behaviour.

## Non-goals / do not touch

- No version gate: cards do feature-detection, not version checks. Users on
  an older integration simply see a slightly generous description until they
  update; `PVS_MIN_INTEGRATION` stays where it is unless something else
  already forces a bump.
- The censoring table itself ("Erfassung" column) renders whatever the
  integration publishes — no logic change needed.

## Verify while in there (no change expected)

Before sunrise the integration now publishes the stats in their empty shape
(`coverage_mean: null`, `intervals: 0`, empty `value_kinds`). The cards
already render missing values as withheld rather than as zeros — confirm the
censoring section and the explainer degrade gracefully against that shape at
05:00 (design rule of this repo: "not yet" and "nothing" must never look
alike).

## Release

- Bump `PVS_VERSION` (0.3.6 → 0.3.7), changelog/release per this repo's
  conventions.
- Release notes: one paragraph — the explainer now says coverage counts
  daylight hours only, matching integration v1.16.0 semantics. No
  plant-owner specifics.
