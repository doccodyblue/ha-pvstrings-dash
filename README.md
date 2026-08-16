# PV Strings — Dashboard

Cards and a dashboard strategy for the
[PV Strings](https://github.com/doccodyblue/ha-pvstrings) integration.

Install it and pick the strategy; you get a working dashboard for however many
strings you have, without opening a card editor. Or ignore the strategy and use
the cards on your own.

**Optional.** The integration publishes everything through ordinary entities and
attributes and works perfectly well without any of this.

---

## Why a separate repository

HACS classifies a repository as *either* an integration *or* a Lovelace plugin,
and it decides from the layout. A repository carrying `custom_components/` is an
integration and its JavaScript cannot be installed as a plugin. So cards want
their own repository — this one.

The split has a second benefit and one real cost.

The benefit: a card gets fiddled with ten times in an evening, and coupling that
to integration releases would mean restarting Home Assistant ten times.

The cost is **version skew**, and it fails quietly: a card asks for an attribute
the installed integration does not publish yet and draws an empty sky instead of
saying so. Everything that has gone wrong in this project so far has looked
exactly like "not enough data yet", so this repository refuses to add to the
pile — see *The contract* below.

---

## What it provides

### `pvstrings-sky-map`

The learned sky as a grid over sun position: ten degrees of azimuth by five of
elevation, one map per string, with the sun's current cell marked.

No built-in card can draw it, which is the whole reason this exists.

Two things it must get right, both learned the hard way:

- **A cell nobody has observed is not a cell with no loss.** In August the sun
  has never crossed the winter sky; those cells correct nothing and must look
  *unlike* the "no loss" end of the ramp, not like its lightest step.
- **A flat map is meaningless without its reference.** Nothing in the way and
  everything equally in the way draw the same picture. The map's
  `reference_ratio` and each cell's own `ratio` are therefore part of the card,
  not an optional detail — a reference sitting well below 1.0 is the signature
  of a map normalising a shadow away.

### `pvstrings-forecast`

The hourly forecast, for the plant or for one string.

Plotted against it: the same curve with the sky map switched off
(`unshaded_kwh`), so the gap between the two *is* the shadow the model has
learned — and what remains to the measured curve is the part it has not. Actual
production is overlaid for the hours already past.

One axis. Never two.

### `pvstrings-chain`

What each layer did to the raw physics for one hour: source bias, sky map,
per-string model, and the published figure. Reading it against the measurement
is how you tell a weather error from a shading error from a model error.

### The strategy

Assembles a dashboard from the entity registry: plant overview, one section per
string, accuracy, and the diagnostics view below. Adapts to the number of
strings and to whether curtailment groups exist. Built-in cards plus the three
above; nothing else is required.

---

## The contract

Cards **detect the attributes they need**, and never sniff a version number.
When something is missing they say which attribute, and which integration
version introduced it:

> `pvstrings-sky-map` needs `reference_ratio` on the sky map entity
> (PV Strings 1.15.1 or newer). Found an entity without it.

Feature detection rather than a version string, because the question a card
actually has is "can I draw this", not "what release is this".

A missing entity is reported in place. The strategy never silently omits a card
it meant to include.

---

## Status

Specification only. Nothing is built yet. See [SPEC.md](SPEC.md).
