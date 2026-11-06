# Compatibility

*[README](../README.md) · [Cards](cards.md) · [Compatibility](compatibility.md) · [Development](development.md)*

Cards **detect the attributes they need**, and never sniff a version number.
When something is missing they say which attribute, and which integration
version introduced it:

> needs `level & fit_method` on `sensor.…_sky_map` (PV Strings ≥ 1.18.0)

Feature detection rather than a version string, because the question a card
actually has is "can I draw this", not "what release is this".

A missing entity is reported in place. The strategy never silently omits a
card it meant to include.

| Feature | Needs PV Strings |
|---|---|
| forecast card (hourly + unshaded) | ≥ 1.8.0 |
| chain card (per-hour factors) | ≥ 1.8.0 |
| sky map with `level` / `fit_method` | ≥ 1.18.0 |
| curtailment-group sections | ≥ 1.14.0 |
| conversion cards (AC / battery charge, optional) | ≥ 1.20.0 |
| learned conversion curve (`conversion_learning`) | ≥ 1.21.0 |
| nowcast card (`nowcast_active`) | ≥ 1.21.0 |
| daily card (issue-hour reconstruction) | ≥ 1.10.0 |
| savings provenance (`price.by_basis_kwh`, `export_dropped_kwh`) | ≥ 1.22.0 |
| hourly day-ahead profile (`hourly_profile`) | ≥ 1.23.0 |
| day stepper, week stepper, learning progress (`pvstrings.get_day` / `get_weeks` services) | ≥ 1.25.0 |
| weekly learning comparison (hourly error, `baseline_basis`) | ≥ 1.25.2 |
| irradiance sensor check (`sensor_check`) | ≥ 1.26.0 |
| calibration trial (`pvstrings.calibration_trial` service) | ≥ 1.26.0 |

The three design rules behind all of this, bought with the integration's own
bug history (three arithmetic bugs, all of which looked exactly like "not
enough data yet" from the outside):

1. **"Not yet" and "nothing" never look the same.** Every withheld figure
   shows how far off publishing it is, in the place the figure would be.
2. **Every derived number can be traced to its inputs** in at most one click.
3. **A card that cannot draw something says why.** Never an empty panel.
