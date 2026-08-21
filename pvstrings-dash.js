/* ============================================================================
 * PV Strings Dashboard — cards + strategy for the PV Strings integration
 * https://github.com/doccodyblue/ha-pvstrings-dash
 *
 * One ES module, no build step: this file is both source and artifact.
 *
 * SECTION INDEX (in dependency order — search for "SECTION:"):
 *   HEADER    version, module constants
 *   CONST     translation-key taxonomy, feature table
 *   I18N      de/en dictionary, t()
 *   THEME     palette tokens, base CSS, hatch pattern
 *   FMT       number/date/energy formatting (Intl, HA timezone)
 *   DATA      websocket wrappers, registry model, statistics helpers
 *   UI        problem panel, withheld chip, tooltip, base card class
 *   CARD:SKYMAP / CARD:FORECAST / CARD:CONVERSION / CARD:CHAIN / CARD:DAILY / CARD:KVTABLE
 *   STRATEGY  registry -> generated dashboard
 *   REGISTER  customElements.define + customCards/customStrategies
 *
 * Design rules (SPEC §0 — every render path obeys them):
 *   1. "Not yet" and "nothing" never look the same.
 *   2. Every derived number is traceable to its inputs in <= 1 click.
 *   3. A card that cannot draw something says why. Never an empty panel.
 * ========================================================================== */

/* ============================ SECTION: HEADER ============================ */

const PVS_VERSION = "0.6.0";
const PVS_MIN_INTEGRATION = "1.8.0";

/* ============================ SECTION: CONST ============================= */

// Entity taxonomy: the integration's translation_keys. Entity ids are
// language-dependent (German install -> German ids), so identification goes
// through the registry + these keys, never through entity_id patterns.
const PLANT_KEYS = [
  "forecast_today", "forecast_remaining", "forecast_tomorrow",
  "forecast_day_after", "forecast_next_hour", "potential_now",
  "peak_hour_today", "produced_today", "power_now", "deviation_yesterday",
  "wmape_7d", "wmape_30d", "bias_7d", "wmape_day_ahead_7d",
  "wmape_day_ahead_30d", "bias_day_ahead_30d", "savings_today",
  "savings_month", "savings_total", "amortisation",
  "rain_probability_tomorrow", "model_observations", "ghi_forecast",
  "strings_detail", "collector_health",
  // conversion layer (>= 1.20) — only published when an output path is
  // configured; absence is normal, not an error
  "forecast_ac_today", "forecast_ac_tomorrow",
];
const STRING_KEYS = [
  "string_sky_map", "string_shading_now", "string_forecast_today",
  "string_forecast_remaining", "string_forecast_tomorrow",
  "string_potential_now", "string_produced_today",
];
const GROUP_KEYS = ["group_forecast_remaining",
  // conversion layer (>= 1.20): direct groups publish _ac, storage groups
  // publish _battery_charge; a group without an output path has neither
  "group_forecast_ac", "group_forecast_battery_charge"];

// unique_id suffixes -> translation_key (registry rows may omit
// translation_key on older cores; the unique_id suffix is stable).
const UNIQUE_SUFFIX_TO_KEY = {
  sky_map: "string_sky_map",
  shading_now: "string_shading_now",
  // string_* and plant keys share suffixes (forecast_today etc.); the device
  // model ("PV plant" vs "PV string") disambiguates in buildModel().
};

// Feature detection (README "The contract"): the question is "can I draw
// this", never "what release is this". Tests run on an entity's attributes.
const FEATURES = {
  forecast_list: {
    test: (a) => Array.isArray(a?.forecast),
    attr: "forecast", since: "1.0.0",
  },
  chain_steps: {
    test: (a) => a?.forecast?.[0]?.physics_kwh !== undefined,
    attr: "forecast[].physics_kwh", since: "1.8.0",
  },
  unshaded: {
    test: (a) => a?.forecast?.[0]?.unshaded_kwh !== undefined,
    attr: "forecast[].unshaded_kwh", since: "1.7.0",
  },
  // conversion entities must say what they are — without output_path and
  // curve_source the card would silently assume AC semantics
  conv_output: {
    test: (a) => a != null && "output_path" in a && "curve_source" in a,
    attr: "output_path & curve_source", since: "1.20.0",
  },
  sky_cells: {
    test: (a) => Array.isArray(a?.cells),
    attr: "cells", since: "1.8.0",
  },
  sky_ratio: {
    test: (a) => !a?.cells?.length || a.cells[0].ratio !== undefined,
    attr: "cells[].ratio", since: "1.15.0",
  },
  // Presence check, deliberately separate from sky_ratio:
  // level: null is a valid state (single-string plants and strings without
  // enough shared epochs have none — structural, not "not yet");
  // a MISSING key is the contract error (problem panel).
  sky_level: {
    test: (a) => a != null && "level" in a && "fit_method" in a,
    attr: "level & fit_method", since: "1.18.0",
  },
};

function requireFeatures(stateObj, keys) {
  const a = stateObj?.attributes;
  const missing = [];
  for (const k of keys) {
    const f = FEATURES[k];
    if (!f.test(a)) missing.push({ attr: f.attr, since: f.since });
  }
  return missing.length ? { ok: false, missing } : { ok: true };
}

/* ============================ SECTION: I18N ============================== */

const STR = {
  en: {
    // shared
    "not_available": "not available",
    "entity_missing": "Entity not found: {entity}",
    "no_entity_config": "No entity configured. Pick a PV Strings sensor.",
    "needs_attr": "needs {attr} on {entity} (PV Strings {since} or newer)",
    "found_without": "Found an entity without it.",
    "stats_unavailable": "No recorder statistics for {entity} — check the recorder include/exclude filters.",
    "more_info": "show source entity",
    "kwh": "kWh",
    "today": "Today",
    "tomorrow": "Tomorrow",
    "remaining": "Remaining",
    "now": "now",
    "in_progress": "hour in progress ({min} min)",
    "not_yet_hour": "not yet — hour is in the future",
    "day_running": "today, still running",
    // sky map
    "sky_level": "level",
    "sky_fit_differential": "differential",
    "sky_fit_absolute": "absolute",
    "sky_level_tip": "Clear-view level relative to physics — 1.05 means: delivers 5 % above physics where nothing is in the way.",
    "sky_level_none": "no level — a single-string plant, or not enough shared epochs with the sibling strings",
    "sky_cells": "{n} cells observed",
    "sky_share_of_year": "≈ {pct}% of the year's sun path",
    "sky_no_cells": "No sky cells learned yet — the map fills in as the sun crosses new positions. {obs} raw observations collected so far.",
    "sky_unobserved": "never observed — not “no loss”",
    "sky_loss": "loss",
    "sky_loss_clear": "loss (clear day)",
    "sky_pooled": "pooled (all year)",
    "sky_season_ascending": "season: ascending sun (Dec–Jun)",
    "sky_season_descending": "season: descending sun (Jun–Dec)",
    "sky_ratio_gt1": "ratio above 1.0 — measurement above the physics envelope",
    "sky_sun_below": "sun below 3° — no shading value at night",
    "sky_sun_outside": "sun outside the observed window",
    "sky_layer_pooled": "Pooled",
    "sky_layer_ascending": "Dec–Jun",
    "sky_layer_descending": "Jun–Dec",
    "sky_obs": "observations",
    // forecast
    "fc_forecast": "Forecast",
    "fc_unshaded": "Unshaded",
    "fc_actual": "Actual",
    "fc_no_hours": "The forecast list is empty — the weather source has not covered any hours yet.",
    "fc_gap": "hour not covered by the weather source",
    "fc_known_shadow": "known shadow",
    "fc_delta": "actual vs forecast",
    "fc_group_unshaded": "Group sensors publish no separate unshaded series (the attribute is a copy) — unshaded hidden.",
    "fc_actual_unresolved": "Actual production hidden: could not resolve the production sensor for this entity.",
    "fc_hero_ist": "actual today",
    "fc_hero_prog": "forecast today",
    "fc_hourly_fallback": "actual drawn from hourly statistics (no 5-minute power data available)",
    // conversion (AC / battery charge)
    "conv_not_ready": "waiting for forecast data",
    "conv_dc": "DC potential",
    "conv_out_direct": "AC potential",
    "conv_out_storage": "battery charge",
    "conv_hero_dc": "DC today",
    "conv_hero_direct": "AC today",
    "conv_hero_storage": "charge today",
    "conv_eff_today": "conversion today",
    "conv_eff_tip_direct": "Day total AC / day total DC — after the conversion curve and the AC rating. Hardware potential: never capped at regulatory limits.",
    "conv_eff_tip_storage": "Day total charge / day total DC — after the charge path's conversion curve. DC energy into the storage, not AC.",
    "conv_curve_datasheet": "datasheet curve",
    "conv_curve_custom": "custom curve",
    "conv_curve_neutral": "unconverted (output = DC)",
    "conv_curve_fixed_factors": "fixed factors",
    "conv_fixed_factors_tip": "Fixed per-stage factors applied to DC (e.g. MPPT × charge) — configured values, not measured.",
    "conv_neutral_note": "No conversion curve configured — the output equals DC by definition, this is not a measured 0 % loss.",
    "conv_clipped": "clipping {v} kWh",
    "conv_clipped_tip": "Energy above the inverter's AC rating — a hardware cap, not a conversion loss.",
    "conv_strip": "{out} / DC per hour",
    "conv_low_dc": "too little DC for a meaningful ratio",
    // chain
    "chain_title": "Forecast chain",
    "chain_physics": "raw physics",
    "chain_shading": "sky map",
    "chain_model": "per-string model",
    "chain_published": "published",
    "chain_measured": "measured",
    "chain_source_bias": "source bias ×{v} — applied upstream to the irradiance, already inside the physics figure. Shown as context, not a link.",
    "chain_discrepancy": "physics × shading × model ≠ published ({a} vs {b}) — this should never happen; the integration has a bug or this card mis-parses.",
    "chain_hour": "Hour",
    "chain_no_hour": "No forecast row for this hour.",
    "chain_needs_string": "This card reads the per-hour chain, which only string forecast sensors publish.",
    // daily
    "daily_title": "Day-ahead vs actual",
    "daily_soll": "Forecast (day-ahead)",
    "daily_ist": "Actual",
    "daily_no_issue": "no forecast issued that evening",
    "daily_provenance": "day-ahead = {entity} as recorded {date} {hour}:00 (recorder statistics)",
    "daily_window_sum": "{n} days: forecast {soll} — actual {ist}",
    "daily_wabs": "weighted |error|",
    // accuracy / strategy
    "v_overview": "Overview",
    "v_strings": "Strings",
    "v_accuracy": "Accuracy",
    "v_nerd": "Nerd",
    "s_today": "Today",
    "s_tomorrow": "Tomorrow & weather",
    "s_savings": "Savings",
    "s_groups": "Inverter groups",
    "s_conversion": "Conversion (AC / storage)",
    "conv_partial_storage": "In the battery-charge forecast, not in AC: {list}",
    "conv_partial_unconverted": "In no output forecast (no output path configured): {list}",
    "conv_never_sum": "AC and battery charge are different kinds of energy — AC sits behind the inverter, charge is DC into the battery. Never add them.",
    "nerd_conversion": "Conversion",
    "conv_path": "path",
    "conv_curve": "curve",
    "conv_stages": "stages",
    "conv_clipped_col": "clipping",
    "conv_today_col": "conversion today",
    "nerd_conv_evidence": "Learning — conversion evidence",
    "conv_ev_stage": "stage",
    "conv_ev_pairs": "usable / rows",
    "conv_stage_inverter": "inverter",
    "conv_stage_mppt": "MPPT",
    "conv_ev_loading": "loading collection evidence…",
    "conv_ev_admin": "Conversion learning evidence lives in the entry diagnostics, which need an admin user — hence empty here.",
    "conv_ev_unavailable": "The entry diagnostics could not be loaded — from here, whether collection runs cannot be checked.",
    "conv_ev_none": "The integration collects no conversion evidence yet — nothing is configured to learn from.",
    "conv_ev_note": "usable = pairs cleared by the censoring check; it always trails rows by up to an hour — the gate working, not a fault. A 0 / 0 row is configured but collecting nothing.",
    "s_nowcast": "Nowcast (continuously updated)",
    "s_dayahead": "Day-ahead (issued the evening before)",
    "s_daily": "Day by day",
    "acc_note": "**Nowcast** may correct itself during the day; **day-ahead** is frozen the evening before. The two are **not comparable until both windows are full** — the day counts below say how far along each one is.\n\n**WMAPE** = weighted mean absolute percentage error: the sum of all forecast errors divided by the sum of actual production — 10 % means the forecasts were off by 10 % in total, with sunny hours weighing more than dawn hours.",
    "nerd_explain_title": "What these numbers mean",
    "nerd_explain": "- **factor / n_eff** (learning buckets): the factor is the learned correction the physics forecast gets multiplied by — 1.05 means \"reality delivered 5 % more than computed\". n_eff is the effective weight of evidence behind it (recent hours count more); small values mean the factor is still tentative.\n- **weather × daypart**: the plant learns separately per weather class and time of day. \"never seen\" means exactly that — this weather has not occurred at this time of day yet, which is itself a finding. The string × daypart layer says \"not yet active\" instead: those buckets only switch on past ~70 % of the evidence ceiling, and only active ones are published.\n- **Source bias (hour × horizon)**: the weather source's systematic error per local hour and forecast horizon, as a factor on irradiance. *measured* = learned against a real sensor; *nowcast* = only against the source's own short-horizon run — a much weaker claim.\n- **Sky map**: *level* is the string's clear-view level relative to physics — 1.05 means it delivers 5 % above physics where nothing is in the way. Where strings share enough epochs the map is fitted against the sibling strings (*differential*); a single string fits *absolutely* and has no level. On a differential map each cell's loss is the clear-day loss — what the shadow costs on a clear day; at runtime the integration scales it by the direct-light share, so an overcast day loses almost nothing. n is the beam-weighted observation count — smaller than before 1.18, which does not mean less data.\n- **Collection / censoring**: coverage is the share of 5-minute intervals actually captured — counted over daylight hours only (PV Strings ≥ 1.16), so a source that sleeps at night is not penalised. *lower bound* marks hours where the inverter was curtailed — real yield would have been higher, so the value only counts as a minimum.\n- **Skip reasons**: what the learn cycle deliberately did NOT learn from, and why. On a plant that learns nothing, this list is the entire diagnosis.\n- **Training maturity**: the weather bar is the evidence held across all weather × daypart buckets, relative to the most a bucket can ever hold (learning forgets slowly, so the count saturates — 100 % means \"as learned as it gets\", not \"finished\"; the tick marks where green begins — the point that in practice counts as fully learned). The shading bar is the share of the year's sun path each string has observed; it can only grow as fast as the calendar.\n- **Conversion (AC / battery charge)**: optional — appears once a group has an output path. AC is energy behind the inverter, capped at its AC rating when clipping applies but never at regulatory limits; battery charge is DC into the storage, whose discharge time is a control decision — the two are never added. Conversion curves come from a datasheet or your own data, they are not learned; *unconverted* means no curve is configured, not a measured 0 % loss.",
    "strategy_no_integration": "## PV Strings\nNo PV Strings entities found. Install and configure the [PV Strings integration](https://github.com/doccodyblue/ha-pvstrings) first — this dashboard builds itself from its sensors.",
    "missing_card": "**{key}** expected here, but no such entity exists on this device — it was not silently omitted. Check whether the integration version publishes it, or whether the entity is disabled.",
    // nerd
    "nerd_learning": "Learning — log-ratio buckets",
    "nerd_plant_buckets": "Plant: weather × daypart",
    "nerd_string_offsets": "Per-string offsets",
    "nerd_string_daypart": "String × daypart",
    "nerd_bucket_missing": "never seen",
    "nerd_bucket_below": "not yet active",
    "cens_coverage": "coverage",
    "cens_curtailed": "curtailed",
    "nerd_source_bias": "Source bias (local hour × horizon)",
    "nerd_truth_measured": "learned against a measured sensor",
    "nerd_truth_nowcast": "learned only against the source's own short-horizon run — a much weaker claim",
    "nerd_collection": "Collection",
    "nerd_censoring": "Censoring split (today)",
    "nerd_skips": "Learn-cycle skip reasons",
    "nerd_sky": "Sky maps",
    "maturity_title": "Training maturity",
    "maturity_weather": "Weather correction",
    "maturity_shading": "Shading (sky maps)",
    "maturity_buckets": "{seen} of {total} buckets seen",
    "maturity_no_lat": "location unknown — no sun-path reference",
    "kv_empty": "attribute {path} is empty or missing on {entity}",
    "factor": "factor",
    "weather_clear": "clear", "weather_partly_cloudy": "partly cloudy",
    "weather_overcast": "overcast", "weather_rain": "rain",
    "daypart_morning": "morning", "daypart_midday": "midday",
    "daypart_afternoon": "afternoon",
    "vk_measured": "measured", "vk_lower_bound": "lower bound",
    "vk_reconstructed": "reconstructed",
    /* i18n-en-end */
  },
  de: {
    "not_available": "nicht verfügbar",
    "entity_missing": "Entity nicht gefunden: {entity}",
    "no_entity_config": "Keine Entity konfiguriert. Wähle einen PV-Strings-Sensor.",
    "needs_attr": "braucht {attr} auf {entity} (PV Strings {since} oder neuer)",
    "found_without": "Gefundene Entity hat es nicht.",
    "stats_unavailable": "Keine Recorder-Statistik für {entity} — Recorder-Filter (include/exclude) prüfen.",
    "more_info": "Quell-Entity anzeigen",
    "kwh": "kWh",
    "today": "Heute",
    "tomorrow": "Morgen",
    "remaining": "Rest",
    "now": "jetzt",
    "in_progress": "Stunde läuft ({min} min)",
    "not_yet_hour": "noch nicht — Stunde liegt in der Zukunft",
    "day_running": "heute, läuft noch",
    "sky_level": "Niveau",
    "sky_fit_differential": "differenziell",
    "sky_fit_absolute": "absolut",
    "sky_level_tip": "Freisicht-Niveau relativ zur Physik — 1,05 heißt: liefert 5 % über Physik, wo nichts im Weg ist.",
    "sky_level_none": "kein Niveau — Ein-Strang-Anlage oder zu wenige gemeinsame Epochen mit den Geschwister-Strängen",
    "sky_cells": "{n} Zellen beobachtet",
    "sky_share_of_year": "≈ {pct}% des Jahres-Sonnenwegs",
    "sky_no_cells": "Noch keine Himmelszellen gelernt — die Karte füllt sich, während die Sonne neue Positionen überstreicht. Bisher {obs} Roh-Beobachtungen.",
    "sky_unobserved": "nie beobachtet — nicht „kein Verlust“",
    "sky_loss": "Verlust",
    "sky_loss_clear": "Verlust (klarer Tag)",
    "sky_pooled": "gepoolt (ganzjährig)",
    "sky_season_ascending": "Saison: steigende Sonne (Dez–Jun)",
    "sky_season_descending": "Saison: fallende Sonne (Jun–Dez)",
    "sky_ratio_gt1": "Ratio über 1.0 — Messung über der Physik-Hüllkurve",
    "sky_sun_below": "Sonne unter 3° — nachts kein Verschattungswert",
    "sky_sun_outside": "Sonne außerhalb des beobachteten Fensters",
    "sky_layer_pooled": "Gepoolt",
    "sky_layer_ascending": "Dez–Jun",
    "sky_layer_descending": "Jun–Dez",
    "sky_obs": "Beobachtungen",
    "fc_forecast": "Prognose",
    "fc_unshaded": "Unverschattet",
    "fc_actual": "Ist",
    "fc_no_hours": "Die Prognoseliste ist leer — die Wetterquelle hat noch keine Stunden abgedeckt.",
    "fc_gap": "Stunde von der Wetterquelle nicht abgedeckt",
    "fc_known_shadow": "bekannter Schatten",
    "fc_delta": "Ist vs. Prognose",
    "fc_group_unshaded": "Gruppen-Sensoren publizieren keine eigene Unverschattet-Serie (das Attribut ist eine Kopie) — Unverschattet ausgeblendet.",
    "fc_actual_unresolved": "Ist-Produktion ausgeblendet: Produktionssensor für diese Entity nicht auflösbar.",
    "fc_hero_ist": "Ist heute",
    "fc_hero_prog": "Prognose heute",
    "fc_hourly_fallback": "Ist aus Stundenstatistik gezeichnet (keine 5-Minuten-Leistungsdaten verfügbar)",
    "conv_not_ready": "warte auf Prognosedaten",
    "conv_dc": "DC-Potenzial",
    "conv_out_direct": "AC-Potenzial",
    "conv_out_storage": "Akkuladung",
    "conv_hero_dc": "DC heute",
    "conv_hero_direct": "AC heute",
    "conv_hero_storage": "Ladung heute",
    "conv_eff_today": "Wandlung heute",
    "conv_eff_tip_direct": "Tagessumme AC / Tagessumme DC — nach Kennlinie und AC-Nennwert. Hardware-Potenzial: nie an Regel- oder Rechtslimits gedeckelt.",
    "conv_eff_tip_storage": "Tagessumme Ladung / Tagessumme DC — nach Kennlinie des Ladepfads. DC-Energie in den Speicher, kein AC.",
    "conv_curve_datasheet": "Datenblatt-Kennlinie",
    "conv_curve_custom": "eigene Kennlinie",
    "conv_curve_neutral": "ungewandelt (Ausgang = DC)",
    "conv_curve_fixed_factors": "feste Faktoren",
    "conv_fixed_factors_tip": "Feste Faktoren je Stufe auf DC angewendet (z. B. MPPT × Laden) — konfigurierte Werte, nicht gemessen.",
    "conv_neutral_note": "Keine Kennlinie konfiguriert — der Ausgang ist per Definition gleich DC, das ist kein gemessener 0-%-Verlust.",
    "conv_clipped": "Clipping {v} kWh",
    "conv_clipped_tip": "Energie über dem AC-Nennwert des Wechselrichters — eine Hardware-Kappung, kein Wandlungsverlust.",
    "conv_strip": "{out} / DC pro Stunde",
    "conv_low_dc": "zu wenig DC für einen sinnvollen Quotienten",
    "chain_title": "Prognosekette",
    "chain_physics": "Roh-Physik",
    "chain_shading": "Himmelskarte",
    "chain_model": "Strang-Modell",
    "chain_published": "veröffentlicht",
    "chain_measured": "gemessen",
    "chain_source_bias": "Source-Bias ×{v} — wurde upstream auf die Einstrahlung angewendet und steckt bereits in der Physik-Zahl. Kontext, kein Kettenglied.",
    "chain_discrepancy": "Physik × Verschattung × Modell ≠ veröffentlicht ({a} vs {b}) — das darf nie passieren; Bug in der Integration oder diese Karte liest falsch.",
    "chain_hour": "Stunde",
    "chain_no_hour": "Keine Prognosezeile für diese Stunde.",
    "chain_needs_string": "Diese Karte liest die Stundenkette, die nur Strang-Prognosesensoren publizieren.",
    "daily_title": "Day-Ahead vs. Ist",
    "daily_soll": "Prognose (Day-Ahead)",
    "daily_ist": "Ist",
    "daily_no_issue": "an dem Abend keine Prognose ausgegeben",
    "daily_provenance": "Day-Ahead = {entity}, Stand {date} {hour}:00 (Recorder-Statistik)",
    "daily_window_sum": "{n} Tage: Prognose {soll} — Ist {ist}",
    "daily_wabs": "gewichteter |Fehler|",
    "v_overview": "Übersicht",
    "v_strings": "Stränge",
    "v_accuracy": "Genauigkeit",
    "v_nerd": "Nerd",
    "s_today": "Heute",
    "s_tomorrow": "Morgen & Wetter",
    "s_savings": "Ersparnis",
    "s_groups": "Wechselrichter-Gruppen",
    "s_conversion": "Wandlung (AC / Speicher)",
    "conv_partial_storage": "In der Akkuladungs-Prognose, nicht im AC: {list}",
    "conv_partial_unconverted": "In keiner Ausgangs-Prognose (kein Ausgabepfad konfiguriert): {list}",
    "conv_never_sum": "AC und Akkuladung sind verschiedene Energiearten — AC liegt hinter dem Wechselrichter, Ladung ist DC in den Speicher. Niemals addieren.",
    "nerd_conversion": "Wandlung",
    "conv_path": "Pfad",
    "conv_curve": "Kennlinie",
    "conv_stages": "Stufen",
    "conv_clipped_col": "Clipping",
    "conv_today_col": "Wandlung heute",
    "nerd_conv_evidence": "Lernen — Wandlungs-Evidenz",
    "conv_ev_stage": "Stufe",
    "conv_ev_pairs": "usable / rows",
    "conv_stage_inverter": "Wechselrichter",
    "conv_stage_mppt": "MPPT",
    "conv_ev_loading": "Sammel-Evidenz wird geladen…",
    "conv_ev_admin": "Die Wandlungs-Evidenz steckt in den Entry-Diagnosen, die einen Admin-Benutzer erfordern — daher hier leer.",
    "conv_ev_unavailable": "Die Entry-Diagnosen ließen sich nicht laden — ob die Sammlung läuft, lässt sich von hier nicht prüfen.",
    "conv_ev_none": "Die Integration sammelt noch keine Wandlungs-Evidenz — nichts zum Lernen konfiguriert.",
    "conv_ev_note": "usable = von der Zensurprüfung freigegebene Messpaare; hinkt rows stets bis zu einer Stunde hinterher — die Leitplanke arbeitet, kein Fehler. Eine 0 / 0-Zeile ist eingerichtet und sammelt trotzdem nichts.",
    "s_nowcast": "Nowcast (laufend aktualisiert)",
    "s_dayahead": "Day-Ahead (am Vorabend eingefroren)",
    "s_daily": "Tag für Tag",
    "acc_note": "**Nowcast** darf sich tagsüber nachkorrigieren; **Day-Ahead** ist am Vorabend eingefroren. Die beiden sind **erst vergleichbar, wenn beide Fenster voll sind** — die Tageszähler unten zeigen, wie weit jedes ist.\n\n**WMAPE** = gewichteter mittlerer absoluter Prozentfehler: die Summe aller Prognosefehler geteilt durch die Summe der echten Erträge — 10 % heißt, die Prognosen lagen in Summe 10 % daneben, wobei sonnige Stunden stärker zählen als Dämmerstunden.",
    "nerd_explain_title": "Was diese Zahlen bedeuten",
    "nerd_explain": "- **Faktor / n_eff** (Lern-Buckets): Der Faktor ist die gelernte Korrektur, mit der die Physik-Prognose multipliziert wird — 1,05 heißt „real kam 5 % mehr als gerechnet\". n_eff ist das wirksame Beweisgewicht dahinter (jüngere Stunden zählen mehr); kleine Werte heißen: noch vorläufig.\n- **Wetter × Tagesabschnitt**: Die Anlage lernt getrennt pro Wetterklasse und Tageszeit. „nie gesehen\" heißt genau das — dieses Wetter gab es zu dieser Tageszeit noch nicht, und auch das ist ein Befund. Der String × Tagesabschnitt-Layer sagt stattdessen „noch nicht aktiv\": Diese Buckets schalten sich erst ab ~70 % der Beweis-Decke zu, und nur aktive werden veröffentlicht.\n- **Source-Bias (Stunde × Horizont)**: der systematische Fehler der Wetterquelle je lokaler Stunde und Vorhersage-Horizont, als Faktor auf die Einstrahlung. *measured* = gegen einen echten Sensor gelernt; *nowcast* = nur gegen den Kurzfrist-Lauf der Quelle selbst — eine deutlich schwächere Aussage.\n- **Himmelskarte**: Das *Niveau* ist das Freisicht-Niveau des Strangs relativ zur Physik — 1,05 heißt: liefert 5 % über Physik, wo nichts im Weg ist. Wo Stränge genug gemeinsame Epochen haben, wird die Karte gegen die Geschwister-Stränge gefittet (*differenziell*); ein einzelner Strang fittet *absolut* und hat kein Niveau. Auf einer differenziellen Karte ist der Verlust jeder Zelle der Klartag-Verlust — was der Schatten an einem klaren Tag kostet; zur Laufzeit skaliert die Integration ihn mit dem Direktlicht-Anteil, ein trüber Tag verliert also fast nichts. n ist die beam-gewichtete Beobachtungszahl — kleiner als vor 1.18, was nicht „weniger Daten“ heißt.\n- **Erfassung / Zensur**: coverage ist der Anteil tatsächlich erfasster 5-Minuten-Intervalle — gezählt nur über Tageslichtstunden (PV Strings ≥ 1.16), eine nachts schlafende Quelle wird also nicht bestraft. *Untergrenze* markiert Stunden mit Abregelung — der echte Ertrag wäre höher gewesen, der Wert zählt nur als Minimum.\n- **Skip-Gründe**: wovon der Lernzyklus bewusst NICHT gelernt hat, und warum. Auf einer Anlage, die nichts lernt, ist diese Liste die ganze Diagnose.\n- **Lernreife**: Der Wetter-Balken ist das gehaltene Beweisgewicht über alle Wetter × Tagesabschnitt-Buckets, relativ zum Maximum, das ein Bucket je halten kann (das Lernen vergisst langsam, der Zähler sättigt — 100 % heißt „so gelernt wie es wird\", nicht „fertig\"; die Marke zeigt, wo Grün beginnt — der Punkt, der praktisch als fertig gelernt gilt). Der Verschattungs-Balken ist der Anteil des Jahres-Sonnenwegs, den jeder Strang schon gesehen hat; er wächst höchstens so schnell wie der Kalender.\n- **Wandlung (AC / Akkuladung)**: optional — erscheint, sobald eine Gruppe einen Ausgabepfad hat. AC ist Energie hinter dem Wechselrichter, bei Clipping am AC-Nennwert gedeckelt, aber nie an Regel- oder Rechtslimits; Akkuladung ist DC-Energie in den Speicher, deren Ausspeisezeitpunkt eine Regelentscheidung ist — die beiden werden nie addiert. Kennlinien kommen aus dem Datenblatt oder eigener Messung, sie werden nicht gelernt; „ungewandelt“ heißt: keine Kennlinie konfiguriert, nicht 0 % Verlust gemessen.",
    "strategy_no_integration": "## PV Strings\nKeine PV-Strings-Entities gefunden. Zuerst die [PV-Strings-Integration](https://github.com/doccodyblue/ha-pvstrings) installieren und einrichten — dieses Dashboard baut sich aus ihren Sensoren.",
    "missing_card": "**{key}** wurde hier erwartet, aber es gibt keine solche Entity an diesem Gerät — sie wurde nicht stillschweigend weggelassen. Prüfen, ob die Integrationsversion sie publiziert oder ob die Entity deaktiviert ist.",
    "nerd_learning": "Lernen — Log-Ratio-Buckets",
    "nerd_plant_buckets": "Anlage: Wetter × Tagesabschnitt",
    "nerd_string_offsets": "Strang-Offsets",
    "nerd_string_daypart": "Strang × Tagesabschnitt",
    "nerd_bucket_missing": "nie gesehen",
    "nerd_bucket_below": "noch nicht aktiv",
    "cens_coverage": "Erfassung",
    "cens_curtailed": "Abregelung",
    "nerd_source_bias": "Source-Bias (lokale Stunde × Horizont)",
    "nerd_truth_measured": "gegen einen Messsensor gelernt",
    "nerd_truth_nowcast": "nur gegen den Kurzfrist-Lauf der Quelle selbst gelernt — eine deutlich schwächere Aussage",
    "nerd_collection": "Erfassung",
    "nerd_censoring": "Zensur-Split (heute)",
    "nerd_skips": "Skip-Gründe des Lernzyklus",
    "nerd_sky": "Himmelskarten",
    "maturity_title": "Lernreife",
    "maturity_weather": "Wetter-Korrektur",
    "maturity_shading": "Verschattung (Himmelskarten)",
    "maturity_buckets": "{seen} von {total} Buckets gesehen",
    "maturity_no_lat": "Standort unbekannt — keine Sonnenweg-Referenz",
    "kv_empty": "Attribut {path} ist leer oder fehlt auf {entity}",
    "factor": "Faktor",
    "weather_clear": "klar", "weather_partly_cloudy": "teils bewölkt",
    "weather_overcast": "bedeckt", "weather_rain": "Regen",
    "daypart_morning": "Vormittag", "daypart_midday": "Mittag",
    "daypart_afternoon": "Nachmittag",
    "vk_measured": "gemessen", "vk_lower_bound": "Untergrenze",
    "vk_reconstructed": "rekonstruiert",
    /* i18n-de-end */
  },
};

function langOf(hass) {
  const l = (hass?.locale?.language ?? hass?.language ?? "en").toLowerCase();
  return l.startsWith("de") ? "de" : "en";
}

function t(hass, key, vars) {
  const lang = typeof hass === "string" ? hass : langOf(hass);
  let s = STR[lang]?.[key] ?? STR.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) {
    s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

/* ============================ SECTION: THEME ============================= */

// Series identity, consistent across all cards (validated with the dataviz
// palette validator against HA's default surfaces #ffffff / #1c1c1c):
//   model quantities = blue, its earlier stage (unshaded) = light ordinal
//   step of the same hue, measurement = orange, loss = violet sequential.
// Loss ramp = shadow ramp: light means clear sky, dark means shadow — the
// iconic mapping (shading IS darkness) needs no legend to be learned. The
// direction is the SAME in both themes (a sunny sky is bright, also at
// night-mode); the dark end carries a cool violet cast, like real shadows.
const LOSS_RAMP_LIGHT = ["#f4f2ee", "#e0ddd8", "#c8c5c2", "#aaa8a8",
  "#8a888d", "#68656f", "#454250", "#262230"];
const LOSS_RAMP_DARK = ["#eceae5", "#d3d0cc", "#b5b2b1", "#959398",
  "#75727c", "#555260", "#393647", "#262230"];

const BASE_CSS = `
  :host {
    --pvs-model: #2a78d6;
    --pvs-model-ghost: #a8c9f2;
    --pvs-measure: #eb6834;
    --pvs-sun: #eda100;
    --pvs-unobserved: color-mix(in srgb, var(--secondary-text-color, #727272) 16%, var(--card-background-color, #fff));
    --pvs-hairline: color-mix(in srgb, var(--primary-text-color, #212121) 9%, transparent);
    --pvs-cell-stroke: color-mix(in srgb, var(--primary-text-color, #212121) 16%, transparent);
    --pvs-chip-bg: color-mix(in srgb, var(--primary-text-color, #212121) 5%, transparent);
    --pvs-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    ${LOSS_RAMP_LIGHT.map((c, i) => `--pvs-loss-${i}: ${c};`).join("\n    ")}
  }
  :host([dark]) {
    --pvs-model: #3987e5;
    --pvs-model-ghost: #21548f;
    --pvs-measure: #d95926;
    --pvs-sun: #eda100;
    ${LOSS_RAMP_DARK.map((c, i) => `--pvs-loss-${i}: ${c};`).join("\n    ")}
  }
  * { box-sizing: border-box; }
  ha-card { padding: 16px; overflow: hidden; position: relative; }
  .pvs-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
  .pvs-title { font-size: 15px; font-weight: 600; letter-spacing: 0.2px; color: var(--primary-text-color); margin-right: auto; }
  .pvs-sub { font-size: 11px; color: var(--secondary-text-color); }
  .pvs-num { font-family: var(--pvs-mono); font-variant-numeric: tabular-nums; }
  .pvs-chip {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 11px; line-height: 1; padding: 5px 8px; border-radius: 6px;
    background: var(--pvs-chip-bg); color: var(--secondary-text-color);
    border: 1px solid transparent; white-space: nowrap;
  }
  .pvs-chip.clickable { cursor: pointer; transition: border-color 150ms; }
  .pvs-chip.clickable:hover { border-color: var(--pvs-hairline); }
  .pvs-chip .v { font-family: var(--pvs-mono); font-variant-numeric: tabular-nums; color: var(--primary-text-color); font-size: 12px; }
  .pvs-chip.warn { background: color-mix(in srgb, var(--warning-color, #ffa600) 14%, transparent); color: var(--primary-text-color); }
  .pvs-chip.warn ha-icon, .pvs-chip.warn .ico { color: var(--warning-color, #ffa600); }
  .pvs-withheld {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 11px; line-height: 1.3; padding: 4px 8px; border-radius: 6px;
    border: 1px dashed color-mix(in srgb, var(--secondary-text-color, #727272) 55%, transparent);
    color: var(--secondary-text-color); background: transparent;
  }
  .pvs-problem {
    display: flex; gap: 12px; padding: 14px;
    border-radius: 8px; border: 1px solid color-mix(in srgb, var(--warning-color, #ffa600) 40%, transparent);
    background: color-mix(in srgb, var(--warning-color, #ffa600) 7%, transparent);
    color: var(--primary-text-color); font-size: 12.5px; line-height: 1.5;
  }
  .pvs-problem .ico { flex: none; font-size: 18px; }
  .pvs-problem code { font-family: var(--pvs-mono); font-size: 11.5px; background: var(--pvs-chip-bg); padding: 1px 4px; border-radius: 4px; }
  .pvs-problem .ent { color: var(--secondary-text-color); font-size: 11.5px; margin-top: 4px; }
  .pvs-legend { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 10px; font-size: 11px; color: var(--secondary-text-color); align-items: center; }
  .pvs-legend .it { display: inline-flex; align-items: center; gap: 6px; }
  .pvs-legend .sw { width: 10px; height: 10px; border-radius: 2px; flex: none; }
  .pvs-tip {
    position: absolute; z-index: 5; pointer-events: none;
    background: var(--card-background-color, #fff);
    border: 1px solid var(--pvs-hairline);
    box-shadow: 0 4px 16px rgba(0,0,0,0.18);
    border-radius: 8px; padding: 9px 11px; font-size: 11.5px; line-height: 1.55;
    color: var(--primary-text-color); max-width: 260px;
    opacity: 0; transform: translateY(3px); transition: opacity 120ms, transform 120ms;
  }
  .pvs-tip.on { opacity: 1; transform: translateY(0); }
  .pvs-tip .h { font-weight: 600; margin-bottom: 3px; }
  .pvs-tip .r { display: flex; justify-content: space-between; gap: 14px; }
  .pvs-tip .r .k { color: var(--secondary-text-color); }
  .pvs-tip .r .v { font-family: var(--pvs-mono); font-variant-numeric: tabular-nums; }
  .pvs-click { cursor: pointer; }
  svg text { fill: var(--secondary-text-color); font-size: 10px; font-family: inherit; }
  svg .axis text { font-family: var(--pvs-mono); font-variant-numeric: tabular-nums; }
  svg .grid { stroke: var(--pvs-hairline); stroke-width: 1; }
  @media (prefers-reduced-motion: reduce) {
    * { transition: none !important; animation: none !important; }
  }
`;

// One shared SVG hatch pattern factory: 45° lines, tone-on-tone.
// Returns the <pattern> markup; reference it as fill="url(#<id>)".
function hatchPattern(id, stroke = "var(--secondary-text-color)") {
  return `<pattern id="${id}" width="6" height="6" patternTransform="rotate(45)"
    patternUnits="userSpaceOnUse">
    <line x1="0" y="0" x2="0" y2="6" stroke="${stroke}" stroke-width="1.1" opacity="0.45"/>
  </pattern>`;
}

function lossColor(lossPct) {
  // loss 0..95 -> ramp index 0..7
  const i = Math.max(0, Math.min(7, Math.floor((lossPct / 95) * 8)));
  return `var(--pvs-loss-${i})`;
}

function isDarkTheme(hass, el) {
  if (hass?.themes?.darkMode !== undefined) return !!hass.themes.darkMode;
  // Fallback: luminance of the resolved card background.
  try {
    const bg = getComputedStyle(el).getPropertyValue("--card-background-color").trim();
    const m = bg.match(/^#([0-9a-f]{6})$/i);
    if (m) {
      const n = parseInt(m[1], 16);
      const lum = (0.2126 * (n >> 16 & 255) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255)) / 255;
      return lum < 0.4;
    }
  } catch (_) { /* keep default */ }
  return false;
}

/* ============================ SECTION: FMT =============================== */

const _fmtCache = new Map();
function _intl(kind, lang, opts) {
  const key = kind + lang + JSON.stringify(opts);
  let f = _fmtCache.get(key);
  if (!f) {
    f = kind === "n" ? new Intl.NumberFormat(lang, opts) : new Intl.DateTimeFormat(lang, opts);
    _fmtCache.set(key, f);
  }
  return f;
}

function fmtNum(hass, v, digits = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  return _intl("n", langOf(hass), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
}
function fmtKwh(hass, v, digits = 2) {
  return v == null ? "–" : `${fmtNum(hass, v, digits)} kWh`;
}
function fmtPct(hass, v, digits = 0) {
  return v == null ? "–" : `${fmtNum(hass, v, digits)} %`;
}
function fmtSigned(hass, v, digits = 2) {
  if (v == null) return "–";
  return (v >= 0 ? "+" : "−") + fmtNum(hass, Math.abs(v), digits);
}

// The ONLY sanctioned way to bucket a UTC timestamp into HA-local calendar
// parts (DST-safe). Never use ts % 86400.
function localParts(hass, dateOrMs) {
  const d = typeof dateOrMs === "number" ? new Date(dateOrMs) : dateOrMs;
  const tz = hass?.config?.time_zone;
  const f = _intl("d", "en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
  });
  const p = {};
  for (const part of f.formatToParts(d)) p[part.type] = part.value;
  return {
    dayKey: `${p.year}-${p.month}-${p.day}`,
    hour: parseInt(p.hour, 10),
    minute: parseInt(p.minute, 10),
    weekday: p.weekday,
  };
}

function fmtWeekday(hass, ms) {
  return _intl("d", langOf(hass), { timeZone: hass?.config?.time_zone, weekday: "short" }).format(new Date(ms));
}
function fmtDayShort(hass, ms) {
  return _intl("d", langOf(hass), { timeZone: hass?.config?.time_zone, day: "numeric", month: "numeric" }).format(new Date(ms));
}
function fmtHour(hass, ms) {
  return _intl("d", langOf(hass), { timeZone: hass?.config?.time_zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
}

// Start of the HA-local day containing `ms`, minus `daysBack` days, as epoch ms.
// Walks backwards hour by hour from a coarse guess — cheap and DST-correct.
function localMidnightMs(hass, ms, daysBack = 0) {
  let target = ms - daysBack * 86400000;
  const dayKey = localParts(hass, target).dayKey;
  // coarse: jump to earlier until day changes, then binary refine by hour
  let lo = target - 26 * 3600000, hi = target;
  while (hi - lo > 60000) {
    const mid = Math.floor((lo + hi) / 2);
    if (localParts(hass, mid).dayKey === dayKey) hi = mid; else lo = mid;
  }
  return hi - (hi % 60000);
}

/* ============================ SECTION: DATA ============================== */

// Module-level cache with in-flight dedupe. TTL depends on whether the
// window touches "now".
const _wsCache = new Map();
function cachedWS(key, ttlMs, factory) {
  const hit = _wsCache.get(key);
  const now = Date.now();
  if (hit && now - hit.t < ttlMs) return hit.promise;
  const promise = factory().catch((e) => { _wsCache.delete(key); throw e; });
  _wsCache.set(key, { t: now, promise });
  return promise;
}

// ---- registry model -------------------------------------------------------

async function getRegistryModel(hass) {
  return cachedWS("registry", 5 * 60000, async () => {
    const [entities, devices] = await Promise.all([
      hass.callWS({ type: "config/entity_registry/list" }),
      hass.callWS({ type: "config/device_registry/list" }),
    ]);
    const devById = new Map(devices.map((d) => [d.id, d]));
    const model = { plants: [], strings: [], groups: [], byEntityId: new Map() };
    const nodeByDevice = new Map();

    const knownKeys = new Set([...PLANT_KEYS, ...STRING_KEYS, ...GROUP_KEYS]);
    const keyFromUnique = (uid, level) => {
      // unique_id = <entry>_<key> (plant) or <entry>_<sub>_<key> (string/group)
      const base = level === "plant" ? PLANT_KEYS
        : level === "group" ? GROUP_KEYS : STRING_KEYS;
      for (const k of base) {
        const plain = k.replace(/^string_|^group_/, "");
        if (uid.endsWith(`_${plain}`) || uid.endsWith(`_${k}`)) return k;
      }
      return null;
    };

    for (const e of entities) {
      if (e.platform !== "pvstrings" || e.disabled_by) continue;
      const dev = devById.get(e.device_id);
      if (!dev) continue;
      const level = dev.model === "PV plant" ? "plant"
        : dev.model === "PV string" ? "string"
        : dev.model === "Curtailment group" ? "group" : null;
      if (!level) continue;
      let node = nodeByDevice.get(dev.id);
      if (!node) {
        node = {
          deviceId: dev.id,
          // config entry id — the stable handle for the entry-level
          // diagnostics download (data.conversion_evidence lives there)
          entryId: dev.config_entry_id ?? null,
          name: dev.name_by_user || dev.name,
          viaDeviceId: dev.via_device_id ?? null, byKey: {},
        };
        nodeByDevice.set(dev.id, node);
        model[level === "plant" ? "plants" : level === "string" ? "strings" : "groups"].push(node);
      }
      let tk = e.translation_key;
      if (level === "string" && tk && !tk.startsWith("string_")) tk = `string_${tk}`;
      if (level === "group" && tk && !tk.startsWith("group_")) tk = `group_${tk}`;
      if (!tk || !knownKeys.has(tk)) tk = keyFromUnique(e.unique_id ?? "", level) ?? tk;
      if (tk) node.byKey[tk] = e.entity_id;
      model.byEntityId.set(e.entity_id, { node, level, key: tk });
    }
    // link strings/groups to their plant
    for (const list of [model.strings, model.groups]) {
      for (const n of list) {
        n.plant = model.plants.find((p) => p.deviceId === n.viaDeviceId)
          ?? model.plants[0] ?? null;
      }
    }
    // stable order: registry order is creation order; sort by name for humans
    model.strings.sort((a, b) => a.name.localeCompare(b.name));
    return model;
  });
}

// Same-device sibling entity by translation_key.
async function sibling(hass, entityId, key) {
  const m = await getRegistryModel(hass);
  return m.byEntityId.get(entityId)?.node?.byKey?.[key] ?? null;
}
// Hop to the plant device (from a string/group entity; identity for plant).
async function plantSibling(hass, entityId, key) {
  const m = await getRegistryModel(hass);
  const info = m.byEntityId.get(entityId);
  if (!info) return null;
  const plant = info.level === "plant" ? info.node : info.node.plant;
  return plant?.byKey?.[key] ?? null;
}

// ---- diagnostics ----------------------------------------------------------

// Entry-level diagnostics download. Since HA 2024-ish this is an HTTP
// endpoint, not a WS command, and it is admin-only: a non-admin viewer gets
// 401/403, which the card shows as a note — never as a contract violation.
// The collector's conversion evidence (learning pairs rows/usable per stage)
// lives under data.conversion_evidence; the block is absent until the
// integration collects, which is "not configured", not an error.
async function conversionEvidence(hass, entryId) {
  if (!entryId) return { error: "no_entry" };
  try {
    return await cachedWS(`conv_ev|${entryId}`, 5 * 60000, async () => {
      try {
        const res = await hass.fetchWithAuth(
          `/api/diagnostics/config_entry/${entryId}`);
        if (res.status === 401 || res.status === 403) return { error: "admin" };
        if (!res.ok) return { error: "unavailable" };
        const json = await res.json();
        return { evidence: json?.data?.conversion_evidence ?? null };
      } catch (_) { return { error: "unavailable" }; }
    });
  } catch (_) { return { error: "unavailable" }; }
}

// ---- statistics -----------------------------------------------------------

const _tsNorm = (v) => (typeof v === "number" ? (v > 1e12 ? v : v * 1000)
  : new Date(v).getTime());

async function wsStats(hass, { ids, startISO, endISO, period, types }) {
  const key = `stats|${ids.join(",")}|${startISO}|${endISO}|${period}|${types}`;
  const touchesNow = !endISO || new Date(endISO).getTime() > Date.now() - 3600000;
  return cachedWS(key, touchesNow ? 5 * 60000 : 30 * 60000, async () => {
    const res = await hass.callWS({
      type: "recorder/statistics_during_period",
      start_time: startISO,
      ...(endISO ? { end_time: endISO } : {}),
      statistic_ids: ids,
      period,
      types,
      units: { energy: "kWh" },
    });
    const out = new Map();
    for (const [id, rows] of Object.entries(res ?? {})) {
      out.set(id, rows.map((r) => ({
        startMs: _tsNorm(r.start), endMs: _tsNorm(r.end),
        change: r.change ?? null, state: r.state ?? null,
        sum: r.sum ?? null, mean: r.mean ?? null,
      })));
    }
    return out;
  });
}

// Hourly production (kWh per hour bucket) from a TOTAL_INCREASING sensor.
async function hourlyActuals(hass, producedEntityId, startISO, endISO) {
  const m = await wsStats(hass, {
    ids: [producedEntityId], startISO, endISO, period: "hour", types: ["change"],
  });
  return m.get(producedEntityId) ?? [];
}
// Daily production for the last n days (recorder handles local days + DST).
async function dailyActuals(hass, producedEntityId, nDays) {
  const start = new Date(localMidnightMs(hass, Date.now(), nDays)).toISOString();
  const m = await wsStats(hass, {
    ids: [producedEntityId], startISO: start, endISO: null,
    period: "day", types: ["change"],
  });
  return m.get(producedEntityId) ?? [];
}

// Day-ahead issued values: for each local day D, the forecast_tomorrow state
// as recorded in the hour bucket that STARTS at issue_hour on D-1 (the
// integration floor_hour()-stamps 18:xx runs to issued_at=18:00 and
// overwrites within the issue hour, so the last state in the 18->19 bucket
// IS the final day-ahead figure). Fallback: last bucket ending within
// (issue_hour, issue_hour+2]. Missing bucket => null ("no forecast issued").
async function issuedForecasts(hass, tomorrowEntityId, nDays, issueHour) {
  const start = new Date(localMidnightMs(hass, Date.now(), nDays + 1)).toISOString();
  const m = await wsStats(hass, {
    ids: [tomorrowEntityId], startISO: start, endISO: null,
    period: "hour", types: ["state"],
  });
  const rows = m.get(tomorrowEntityId) ?? [];
  const byIssueDay = new Map(); // dayKey of issue evening -> value
  for (const r of rows) {
    if (r.state == null) continue;
    const p = localParts(hass, r.startMs);
    if (p.hour === issueHour) byIssueDay.set(p.dayKey, r.state);
    else if (p.hour > issueHour && p.hour <= issueHour + 1 && !byIssueDay.has(p.dayKey)) {
      byIssueDay.set(p.dayKey, r.state); // fallback bucket
    }
  }
  return byIssueDay; // caller maps: soll(day D) = byIssueDay.get(dayKey(D-1))
}

/* ============================ SECTION: UI ================================ */

function problemHTML(hass, { reason, entity, missing = [], hint }) {
  const lines = missing.map((mi) =>
    `<div>${t(hass, "needs_attr", { attr: `<code>${mi.attr}</code>`, entity: `<code>${entity ?? "?"}</code>`, since: mi.since })}</div>`
  ).join("");
  return `<div class="pvs-problem">
    <span class="ico">⚠︎</span>
    <div>
      ${reason ? `<div>${reason}</div>` : ""}
      ${lines}${missing.length ? `<div>${t(hass, "found_without")}</div>` : ""}
      ${entity ? `<div class="ent">${entity}</div>` : ""}
      ${hint ? `<div class="ent">${hint}</div>` : ""}
    </div>
  </div>`;
}

function withheldHTML(text) {
  return `<span class="pvs-withheld">◌ ${text}</span>`;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

class PvsBaseCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._config = null;
    this._renderToken = 0;
  }
  setConfig(config) {
    this._config = config ?? {};
    if (this._hass) this._render();
  }
  set hass(h) {
    const prev = this._hass;
    this._hass = h;
    if (!this._config) return;
    this.toggleAttribute("dark", isDarkTheme(h, this));
    if (this._shouldUpdate(prev, h)) this._render();
  }
  get hass() { return this._hass; }
  // Cards override: list of entity_ids whose state object identity gates re-render.
  watchedEntities() {
    return this._config?.entity ? [this._config.entity] : [];
  }
  _shouldUpdate(prev, next) {
    if (!prev) return true;
    for (const id of [...this.watchedEntities(), ...(this._extraWatched ?? [])]) {
      if (id && prev.states[id] !== next.states[id]) return true;
    }
    return false;
  }
  _fireMoreInfo(entityId) {
    // bubbles + composed: the event must escape the shadow root to reach HA.
    this.dispatchEvent(new CustomEvent("hass-more-info", {
      bubbles: true, composed: true, detail: { entityId },
    }));
  }
  // Shared: wire delegated click handling for [data-more-info] elements.
  _wireMoreInfo() {
    if (this._miWired) return;
    this._miWired = true;
    this.shadowRoot.addEventListener("click", (ev) => {
      const el = ev.target.closest?.("[data-more-info]");
      if (el) this._fireMoreInfo(el.getAttribute("data-more-info"));
    });
  }
  getCardSize() { return 4; }
  _render() { /* overridden */ }
}

// ---- tooltip controller (one per card) ------------------------------------

function wireTooltip(card, { selector, content }) {
  const root = card.shadowRoot;
  const show = (target, ev) => {
    const tip = root.querySelector(".pvs-tip");
    if (!tip) return;
    const html = content(target, ev);
    if (!html) { tip.classList.remove("on"); return; }
    tip.innerHTML = html;
    tip.classList.add("on");
    const cardEl = root.querySelector("ha-card");
    const cr = cardEl.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    let x = ev.clientX - cr.left + 12;
    let y = ev.clientY - cr.top + 12;
    if (x + tr.width > cr.width - 8) x = ev.clientX - cr.left - tr.width - 12;
    if (y + tr.height > cr.height - 8) y = cr.height - tr.height - 8;
    tip.style.left = `${Math.max(4, x)}px`;
    tip.style.top = `${Math.max(4, y)}px`;
  };
  root.addEventListener("pointermove", (ev) => {
    const el = ev.target.closest?.(selector);
    if (el) show(el, ev);
    else root.querySelector(".pvs-tip")?.classList.remove("on");
  });
  root.addEventListener("pointerleave", () => {
    root.querySelector(".pvs-tip")?.classList.remove("on");
  });
}

// ---- minimal visual editor -------------------------------------------------

function makeEditor(schema) {
  return class extends HTMLElement {
    setConfig(config) { this._config = config; this._draw(); }
    set hass(h) { this._h = h; this._draw(); }
    _draw() {
      if (!this._h || !this._config) return;
      if (customElements.get("ha-form")) {
        if (!this._form) {
          this._form = document.createElement("ha-form");
          this._form.addEventListener("value-changed", (ev) => {
            ev.stopPropagation();
            this.dispatchEvent(new CustomEvent("config-changed", {
              bubbles: true, composed: true,
              detail: { config: { ...this._config, ...ev.detail.value } },
            }));
          });
          this.appendChild(this._form);
        }
        this._form.hass = this._h;
        this._form.data = this._config;
        this._form.schema = schema;
        this._form.computeLabel = (s) => s.label ?? s.name;
      } else if (!this._fallback) {
        // Editors are deliberately dumb; YAML always works without them.
        this._fallback = true;
        this.innerHTML = `<p style="font-size:12px">ha-form unavailable — edit this card in YAML.</p>`;
      }
    }
  };
}

const ENTITY_SCHEMA = { name: "entity", selector: { entity: { filter: { integration: "pvstrings" } } } };

/* ========================= SECTION: CARD:SKYMAP ========================== */

// Approximate count of 10°x5° sky bins the sun crosses in a year at `lat`
// (elevation >= 3°). Used for "≈ P% of the year's sun path". Memoized.
const _annualBins = new Map();
function annualSkyCells(lat) {
  const key = Math.round(lat * 10);
  if (_annualBins.has(key)) return _annualBins.get(key);
  const rad = Math.PI / 180;
  const bins = new Set();
  for (let doy = 0; doy < 365; doy += 14) {
    const decl = 23.44 * Math.sin(2 * Math.PI * (284 + doy) / 365);
    for (let min = 0; min < 1440; min += 20) {
      const H = (min / 4 - 180) * rad; // hour angle, solar noon = 0
      const sinEl = Math.sin(lat * rad) * Math.sin(decl * rad)
        + Math.cos(lat * rad) * Math.cos(decl * rad) * Math.cos(H);
      const el = Math.asin(sinEl) / rad;
      if (el < 3) continue;
      let az = Math.acos(
        (Math.sin(decl * rad) - sinEl * Math.sin(lat * rad))
        / (Math.cos(Math.asin(sinEl)) * Math.cos(lat * rad))
      ) / rad;
      if (H > 0) az = 360 - az;
      bins.add(`${Math.floor(az / 10)}|${Math.floor(el / 5)}`);
    }
  }
  _annualBins.set(key, bins.size);
  return bins.size;
}

// Cut the azimuth domain at the largest circular gap between observed bins.
function azDomain(azValues) {
  const uniq = [...new Set(azValues)].sort((a, b) => a - b);
  if (!uniq.length) return { start: 0, span: 360 };
  if (uniq.length === 1) return { start: uniq[0] - 10, span: 30 };
  let gapAt = 0, gapSize = -1;
  for (let i = 0; i < uniq.length; i++) {
    const next = uniq[(i + 1) % uniq.length];
    const gap = ((next - uniq[i] - 10) + 360) % 360;
    if (gap > gapSize) { gapSize = gap; gapAt = next; }
  }
  const span = 360 - gapSize;
  return { start: gapAt, span };
}

const COMPASS = { 0: "N", 90: "E", 180: "S", 270: "W" };

class PvsSkyMapCard extends PvsBaseCard {
  setConfig(config) {
    if (!config?.entity) {
      this._config = config ?? {};
      this.shadowRoot.innerHTML = `<style>${BASE_CSS}</style><ha-card>${problemHTML(this._hass, { reason: t(this._hass, "no_entity_config") })}</ha-card>`;
      return;
    }
    this._layer = "pooled";
    this._shadingId = undefined; // unresolved
    super.setConfig(config);
  }
  watchedEntities() {
    return [this._config?.entity, this._shadingId].filter(Boolean);
  }
  getCardSize() { return 5; }
  getGridOptions() { return { columns: 12, min_columns: 6, rows: "auto" }; }

  async _resolveSiblings() {
    if (this._shadingId !== undefined || !this._hass) return;
    this._shadingId = null;
    try {
      this._shadingId = await sibling(this._hass, this._config.entity, "string_shading_now");
      this._extraWatched = [this._shadingId].filter(Boolean);
      if (this._shadingId) this._render();
    } catch (_) { /* registry unavailable: sun marker simply absent */ }
  }

  _render() {
    const hass = this._hass, cfg = this._config;
    if (!hass || !cfg?.entity) return;
    this._resolveSiblings();
    const st = hass.states[cfg.entity];
    const card = (inner) => {
      this.shadowRoot.innerHTML = `<style>${BASE_CSS}${SKY_CSS}</style><ha-card>${inner}<div class="pvs-tip"></div></ha-card>`;
      this._wire();
    };
    if (!st) return card(problemHTML(hass, { reason: t(hass, "entity_missing", { entity: cfg.entity }) }));
    const need = requireFeatures(st, ["sky_cells", "sky_ratio", "sky_level"]);
    if (!need.ok) return card(problemHTML(hass, { entity: cfg.entity, missing: need.missing }));

    const attrs = st.attributes;
    const cells = attrs.cells ?? [];
    const shading = this._shadingId ? hass.states[this._shadingId] : null;
    const title = cfg.title ?? shading?.attributes?.name
      ?? attrs.friendly_name?.replace(/ (Himmelskarte|Sky map)$/i, "") ?? cfg.entity;

    // ---- header ----
    // level: null is structural "nothing" (single string / too few shared
    // epochs), not "not yet" — method-only chip, never the withheld style.
    const level = attrs.level;
    const fitTxt = t(hass, attrs.fit_method === "differential"
      ? "sky_fit_differential" : "sky_fit_absolute");
    const levelBadge = level == null
      ? `<span class="pvs-chip clickable" data-more-info="${cfg.entity}"
           title="${esc(t(hass, "sky_level_none"))}">${fitTxt}</span>`
      : `<span class="pvs-chip clickable" data-more-info="${cfg.entity}"
           title="${esc(t(hass, "sky_level_tip"))}">
           ${t(hass, "sky_level")} <span class="v">${fmtNum(hass, level, 2)}</span>
           <span class="pvs-sub">· ${fitTxt}</span></span>`;
    const pooledCount = cells.filter((c) => c.season == null).length;
    const lat = hass.config?.latitude;
    const annual = lat != null ? annualSkyCells(lat) : null;
    const share = annual ? Math.round((pooledCount / annual) * 100) : null;
    const cellChip = `<span class="pvs-chip clickable" data-more-info="${cfg.entity}">
        <span class="v">${pooledCount}</span> ${t(hass, "sky_cells", { n: "" }).replace("{n} ", "").trim() || "cells"}
        ${share != null ? `<span class="pvs-sub">· ${t(hass, "sky_share_of_year", { pct: share })}</span>` : ""}
      </span>`;
    // ---- empty-but-valid state (rule 1: "not yet", never a blank) ----
    if (!cells.length) {
      const obs = shading?.attributes?.observations ?? "?";
      return card(`
        <div class="pvs-head"><span class="pvs-title">${esc(title)}</span>${levelBadge}</div>
        ${withheldHTML(t(hass, "sky_no_cells", { obs }))}`);
    }

    // ---- layers, dedupe pooled vs seasonal ----
    const layers = { pooled: new Map(), ascending: new Map(), descending: new Map() };
    for (const c of cells) {
      const k = `${c.az}|${c.el}`;
      layers[c.season == null ? "pooled" : c.season]?.set(k, c);
    }
    const hasSeasons = (cfg.seasons ?? true) &&
      (layers.ascending.size + layers.descending.size > 0);
    if (!hasSeasons) this._layer = "pooled";
    const layer = layers[this._layer] ?? layers.pooled;

    // ---- window over ALL layers so the frame doesn't jump when toggling ----
    const allCells = cells;
    const { start, span } = azDomain(allCells.map((c) => c.az));
    const els = allCells.map((c) => c.el);
    const elMin = Math.max(0, Math.min(...els) - 5);
    const elMax = Math.min(85, Math.max(...els) + 5);
    const nAz = Math.round(span / 10) + 2; // +1 bin margin each side
    const nEl = Math.round((elMax - elMin) / 5) + 1;
    const CW = 26, CH = 17, PAD_L = 34, PAD_B = 22, PAD_T = 6, PAD_R = 6;
    const W = PAD_L + nAz * CW + PAD_R, H = PAD_T + nEl * CH + PAD_B;
    // Continuous mapping: column 0's lower az edge is start-10; the top of
    // the highest band (lower edge elMax) is elMax+5.
    const xOf = (az) => PAD_L + ((((az - start + 10) % 360) + 360) % 360) / 10 * CW;
    const yOf = (el) => PAD_T + (elMax + 5 - el) / 5 * CH;

    // ---- cells ----
    let rects = "";
    for (let ai = 0; ai < nAz; ai++) {
      const az = ((start - 10 + ai * 10) % 360 + 360) % 360;
      for (let ei = 0; ei < nEl; ei++) {
        const el = elMax - ei * 5;
        if (el < 0) continue;
        const c = layer.get(`${az}|${el}`);
        const x = PAD_L + ai * CW, y = PAD_T + ei * CH;
        if (c) {
          // observed cells are filled AND outlined — the light end of the
          // shadow ramp must never melt into the card background (a clear
          // cell is not "nothing")
          rects += `<rect class="cell" x="${x}" y="${y}" width="${CW}" height="${CH}"
            fill="${lossColor(c.loss)}" stroke="var(--pvs-cell-stroke)" stroke-width="1"
            data-cell='${esc(JSON.stringify({ az, el, loss: c.loss, ratio: c.ratio, n: c.n, season: c.season }))}'/>`;
        } else {
          // never observed: unfilled + hatched — on the shadow ramp neither
          // end may collide with this
          rects += `<rect x="${x}" y="${y}" width="${CW}" height="${CH}" fill="url(#pvs-hatch)"
            stroke="none" data-unobs="1"/>`;
        }
      }
    }

    // ---- axes ----
    let axes = "";
    for (let az = 0; az < 360; az += 30) {
      const rel = (((az - start + 10) % 360) + 360) % 360;
      if (rel > span + 20) continue;
      const x = PAD_L + rel / 10 * CW;
      axes += `<text x="${x}" y="${H - 8}" text-anchor="middle" class="axis">${COMPASS[az] ?? az + "°"}</text>`;
    }
    for (let el = Math.ceil(elMin / 15) * 15; el <= elMax; el += 15) {
      axes += `<text x="${PAD_L - 6}" y="${yOf(el) + 4}" text-anchor="end" class="axis">${el}°</text>`;
    }

    // ---- sun marker ----
    let sun = "", sunLine = "";
    if ((cfg.show_sun ?? true) && shading) {
      const sa = shading.attributes;
      if (sa.sun_elevation != null && sa.sun_elevation >= 3) {
        let sx = xOf(sa.sun_azimuth);
        let sy = yOf(sa.sun_elevation);
        const clampedX = Math.max(PAD_L + 6, Math.min(W - PAD_R - 6, sx));
        const outside = clampedX !== sx || sy < PAD_T || sy > H - PAD_B;
        sy = Math.max(PAD_T + 6, Math.min(H - PAD_B - 6, sy));
        sun = `<g class="sun" data-more-info="${this._shadingId}">
          <circle cx="${clampedX}" cy="${sy}" r="7" fill="var(--pvs-sun)"
            stroke="var(--card-background-color)" stroke-width="2"/>
          <circle cx="${clampedX}" cy="${sy}" r="10.5" fill="none"
            stroke="var(--pvs-sun)" stroke-width="1" opacity="0.5" class="sun-ring"/>
          ${outside ? `<text x="${clampedX}" y="${sy - 14}" text-anchor="middle">${esc(t(hass, "sky_sun_outside"))}</text>` : ""}
        </g>`;
      } else {
        sunLine = `<div class="sky-warnline dim">☾ ${t(hass, "sky_sun_below")}</div>`;
      }
    }

    // ---- layer switch ----
    const seg = hasSeasons ? `<div class="sky-seg">
        ${["pooled", "ascending", "descending"].map((l) => `
          <button class="${this._layer === l ? "on" : ""}" data-layer="${l}">
            ${t(hass, "sky_layer_" + l)}</button>`).join("")}
      </div>` : "";

    // ---- legend: ramp scale + unobserved swatch ----
    const rampStops = Array.from({ length: 8 }, (_, i) =>
      `<stop offset="${(i / 7) * 100}%" stop-color="var(--pvs-loss-${i})"/>`).join("");
    const legend = `<div class="pvs-legend">
      <span class="it"><svg width="72" height="10"><defs>
        <linearGradient id="pvs-ramp">${rampStops}</linearGradient></defs>
        <rect width="72" height="10" rx="2" fill="url(#pvs-ramp)"/></svg>
        ${t(hass, attrs.fit_method === "differential" ? "sky_loss_clear" : "sky_loss")} 0–95%</span>
      <span class="it"><svg width="14" height="12">
        <rect x="0.5" y="0.5" width="13" height="11" rx="2" fill="url(#pvs-hatch-l)"
          stroke="var(--pvs-cell-stroke)" stroke-width="1"/></svg>
        ${t(hass, "sky_unobserved")}</span>
    </div>`;

    card(`
      <div class="pvs-head">
        <span class="pvs-title">${esc(title)}</span>
        ${seg}${levelBadge}${cellChip}
      </div>
      ${sunLine}
      <div class="sky-wrap">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
          <defs>${hatchPattern("pvs-hatch")}${hatchPattern("pvs-hatch-l")}</defs>
          ${rects}${axes}${sun}
        </svg>
      </div>
      ${legend}`);
  }

  _wire() {
    this._wireMoreInfo();
    if (this._wired) return;
    this._wired = true;
    this.shadowRoot.addEventListener("click", (ev) => {
      const b = ev.target.closest?.("[data-layer]");
      if (b) { this._layer = b.getAttribute("data-layer"); this._render(); }
    });
    wireTooltip(this, {
      selector: "[data-cell],[data-unobs]",
      content: (el) => {
        const hass = this._hass;
        if (el.hasAttribute("data-unobs")) {
          return `<div class="h">${t(hass, "sky_unobserved")}</div>`;
        }
        const c = JSON.parse(el.getAttribute("data-cell"));
        const seasonTxt = c.season == null ? t(hass, "sky_pooled")
          : t(hass, "sky_season_" + c.season);
        const differential = hass?.states[this._config?.entity]
          ?.attributes?.fit_method === "differential";
        return `<div class="h">${c.az}°–${c.az + 10}° · ${c.el}°–${c.el + 5}°</div>
          <div class="r"><span class="k">${t(hass, differential ? "sky_loss_clear" : "sky_loss")}</span><span class="v">${fmtNum(hass, c.loss, 1)} %</span></div>
          <div class="r"><span class="k">ratio</span><span class="v">${fmtNum(hass, c.ratio, 3)}${c.ratio > 1 ? " ↑" : ""}</span></div>
          <div class="r"><span class="k">n</span><span class="v">${fmtNum(hass, c.n, 1)}</span></div>
          <div class="pvs-sub">${seasonTxt}${c.ratio > 1 ? `<br>${t(hass, "sky_ratio_gt1")}` : ""}</div>`;
      },
    });
  }

  static getConfigElement() {
    return document.createElement("pvstrings-sky-map-editor");
  }
  static getStubConfig(hass, entities) {
    const guess = (entities ?? []).find((e) =>
      hass.states[e]?.attributes?.cells !== undefined && e.startsWith("sensor."));
    return { entity: guess ?? "" };
  }
}

const SKY_CSS = `
  .sky-wrap svg { width: 100%; height: auto; display: block; }
  .sky-warnline {
    font-size: 11.5px; line-height: 1.5; margin: 2px 0 8px;
    color: var(--primary-text-color);
    padding: 6px 9px; border-radius: 6px;
    background: color-mix(in srgb, var(--warning-color, #ffa600) 10%, transparent);
  }
  .sky-warnline.dim { background: var(--pvs-chip-bg); color: var(--secondary-text-color); }
  .sky-seg { display: inline-flex; border: 1px solid var(--pvs-hairline); border-radius: 6px; overflow: hidden; }
  .sky-seg button {
    all: unset; font-size: 10.5px; padding: 4px 8px; cursor: pointer;
    color: var(--secondary-text-color); transition: background 150ms;
  }
  .sky-seg button:hover { background: var(--pvs-chip-bg); }
  .sky-seg button.on { background: var(--pvs-chip-bg); color: var(--primary-text-color); font-weight: 600; }
  .cell { transition: opacity 150ms; }
  .cell:hover { opacity: 0.75; }
  .sun { cursor: pointer; }
  .sun-ring { animation: pvs-pulse 3s ease-in-out infinite; transform-origin: center; }
  @keyframes pvs-pulse { 0%,100% { opacity: 0.5; } 50% { opacity: 0.15; } }
`;

/* ======================== SECTION: CARD:FORECAST ========================= */

function niceMax(v) {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
    if (v <= m * mag) return m * mag;
  }
  return 10 * mag;
}

class PvsForecastCard extends PvsBaseCard {
  setConfig(config) {
    this._resolved = null;
    this._actuals = null;
    this._actualsProblem = null;
    super.setConfig(config ?? {});
  }
  watchedEntities() {
    const r = this._resolved;
    return [this._config?.entity, r?.tomorrowId, r?.dayAfterId,
      r?.producedIds?.[0]].filter(Boolean);
  }
  getCardSize() { return 5; }
  // "full": a section with column_span > 1 doubles its internal grid, and a
  // card pinned to 12 columns would only fill half of it.
  getGridOptions() { return { columns: "full", rows: "auto" }; }

  async _resolve() {
    if (this._resolved !== null || !this._hass || !this._config?.entity) return;
    this._resolved = false; // in flight
    const hass = this._hass, id = this._config.entity;
    try {
      const m = await getRegistryModel(hass);
      const info = m.byEntityId.get(id);
      const kind = info?.level ?? "plant";
      const r = { kind };
      if (kind === "plant") {
        r.tomorrowId = info.node.byKey.forecast_tomorrow ?? null;
        r.dayAfterId = info.node.byKey.forecast_day_after ?? null;
        r.remainingId = info.node.byKey.forecast_remaining ?? null;
        r.producedIds = [info.node.byKey.produced_today].filter(Boolean);
        r.powerId = info.node.byKey.power_now ?? null;
      } else if (kind === "string") {
        r.remainingId = info.node.byKey.string_forecast_remaining ?? null;
        r.tomorrowId = info.node.byKey.string_forecast_tomorrow ?? null;
        r.producedIds = [info.node.byKey.string_produced_today].filter(Boolean);
        // the string's configured power entity, via the plant's strings_detail
        const sdId = info.node.plant?.byKey?.strings_detail;
        const sd = sdId ? hass.states[sdId]?.attributes?.strings : null;
        r.powerId = sd?.[info.node.name]?.power_entity ?? null;
      } else { // group: match member names against string devices
        const names = hass.states[id]?.attributes?.strings ?? [];
        const ids = names.map((n) =>
          m.strings.find((s) => s.name === n)?.byKey?.string_produced_today ?? null);
        r.producedIds = ids.filter(Boolean);
        r.membersUnresolved = ids.some((x) => !x);
      }
      this._resolved = r;
      this._render();
      this._loadActuals();
      if ((this._config.style ?? "bars") === "line") this._loadPower();
    } catch (e) {
      this._resolved = { kind: "plant", producedIds: [], error: String(e) };
      this._render();
    }
  }

  async _loadActuals() {
    const hass = this._hass, r = this._resolved;
    if (!r || !(this._config.show_actual ?? true)) return;
    if (!r.producedIds?.length || r.membersUnresolved) {
      this._actualsProblem = r?.membersUnresolved ? "fc_actual_unresolved" : null;
      return;
    }
    const token = ++this._renderToken;
    const startMs = localMidnightMs(hass, Date.now());
    try {
      const stats = await wsStats(hass, {
        ids: r.producedIds,
        startISO: new Date(startMs).toISOString(),
        endISO: null, period: "hour", types: ["change"],
      });
      if (token !== this._renderToken) return;
      const byHour = new Map();
      let sawRows = false;
      for (const id of r.producedIds) {
        for (const row of stats.get(id) ?? []) {
          sawRows = true;
          if (row.change != null) {
            byHour.set(row.startMs, (byHour.get(row.startMs) ?? 0) + row.change);
          }
        }
      }
      this._actuals = byHour;
      this._actualsProblem = sawRows ? null : "stats_unavailable";
      this._render();
    } catch (_) {
      if (token === this._renderToken) {
        this._actualsProblem = "stats_unavailable";
        this._render();
      }
    }
  }

  // 5-minute mean power for the line style. Falls back to hourly statistics
  // (marked as such) when the power entity has no short-term statistics.
  async _loadPower() {
    const hass = this._hass, r = this._resolved;
    if (!r?.powerId) { this._power = null; return; }
    const token = this._renderToken; // don't outrace _loadActuals' bump
    const startMs = localMidnightMs(hass, Date.now());
    try {
      const stats = await wsStats(hass, {
        ids: [r.powerId],
        startISO: new Date(startMs).toISOString(), endISO: null,
        period: "5minute", types: ["mean"], // units left as-is; W assumed below
      });
      const unit = hass.states[r.powerId]?.attributes?.unit_of_measurement ?? "W";
      const scale = unit === "kW" ? 1000 : 1;
      this._power = (stats.get(r.powerId) ?? [])
        .filter((x) => x.mean != null)
        .map((x) => ({ ms: x.startMs + 150000, w: x.mean * scale }));
      this._render();
    } catch (_) {
      this._power = null;
      this._render();
    }
  }

  _renderLine(card, st, r) {
    const hass = this._hass, cfg = this._config;
    const title = cfg.title ?? st.attributes.friendly_name?.replace(/ (Prognose heute|Forecast today)$/i, "") ?? cfg.entity;
    const rows = this._rows();
    if (!rows.length) {
      return card(`<div class="pvs-head"><span class="pvs-title">${esc(title)}</span></div>
        ${withheldHTML(t(hass, "fc_no_hours"))}`);
    }
    const isGroup = r.kind === "group";
    const showUnshaded = (cfg.show_unshaded ?? true) && !isGroup;
    const days = cfg.days ?? 1;
    const startMs = localMidnightMs(hass, Date.now());
    const windowMs = days * 24 * 3600000;
    const nowMs = Date.now();

    // series in W: forecast/unshaded at hour centers; actual 5-min or hourly
    const fcPts = rows.map((x) => ({ ms: x.ms + 1800000, v: x.potential * 1000 }));
    const unPts = showUnshaded
      ? rows.map((x) => ({ ms: x.ms + 1800000, v: x.unshaded * 1000 })) : [];
    let actPts = [], hourlyFallback = false;
    if (this._power?.length) {
      actPts = this._power.filter((p) => p.ms >= startMs && p.ms <= nowMs)
        .map((p) => ({ ms: p.ms, v: Math.max(0, p.w) }));
    } else if (this._actuals) {
      hourlyFallback = true;
      actPts = [...this._actuals.entries()]
        .filter(([ms]) => ms + 3600000 <= nowMs + 60000)
        .sort((a, b) => a[0] - b[0])
        .map(([ms, kwh]) => ({ ms: ms + 1800000, v: kwh * 1000 }));
    }

    let maxV = 100;
    for (const p of [...fcPts, ...unPts, ...actPts]) maxV = Math.max(maxV, p.v);
    const yMax = niceMax(maxV * 1.06);
    // wide: for full-width placement — wider AND taller drawing area, so a
    // card spanning two columns reads as the hero chart, not as a squished
    // copy of the narrow one.
    const wide = !!cfg.wide;
    const PAD_L = 42, PAD_R = 6, PAD_T = 10, PAD_B = 22;
    const PH = wide ? 300 : 168;
    const PW = wide ? 1330 : 620;
    const W = PAD_L + PW + PAD_R, H = PAD_T + PH + PAD_B;
    const xOf = (ms) => PAD_L + ((ms - startMs) / windowMs) * PW;
    const yOf = (v) => PAD_T + PH - (v / yMax) * PH;

    const path = (pts, maxGap) => {
      let d = "", prev = null;
      for (const p of pts) {
        d += `${!prev || p.ms - prev.ms > maxGap ? "M" : "L"}${xOf(p.ms).toFixed(1)} ${yOf(p.v).toFixed(1)}`;
        prev = p;
      }
      return d;
    };
    // Monotone cubic interpolation (Fritsch–Carlson): passes through every
    // data point and never overshoots — it rounds the corners the smooth
    // physics implies without inventing extrema the data does not have.
    // (A plain Catmull-Rom/Bézier spline stays taboo per SPEC §2.)
    const smoothPath = (pts, maxGap) => {
      let d = "", run = [];
      const emit = () => {
        const P = run.map((p) => [xOf(p.ms), yOf(p.v)]);
        run = [];
        if (!P.length) return;
        d += `M${P[0][0].toFixed(1)} ${P[0][1].toFixed(1)}`;
        const n = P.length;
        if (n < 2) return;
        const h = [], delta = [];
        for (let i = 0; i < n - 1; i++) {
          h.push(P[i + 1][0] - P[i][0]);
          delta.push((P[i + 1][1] - P[i][1]) / h[i]);
        }
        const m = [delta[0]];
        for (let i = 1; i < n - 1; i++) {
          m.push(delta[i - 1] * delta[i] <= 0 ? 0 : (delta[i - 1] + delta[i]) / 2);
        }
        m.push(delta[n - 2]);
        for (let i = 0; i < n - 1; i++) {
          if (delta[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
          if (m[i] / delta[i] > 3) m[i] = 3 * delta[i];
          if (m[i + 1] / delta[i] > 3) m[i + 1] = 3 * delta[i];
        }
        for (let i = 0; i < n - 1; i++) {
          const c1x = P[i][0] + h[i] / 3, c1y = P[i][1] + m[i] * h[i] / 3;
          const c2x = P[i + 1][0] - h[i] / 3, c2y = P[i + 1][1] - m[i + 1] * h[i] / 3;
          d += `C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${P[i + 1][0].toFixed(1)} ${P[i + 1][1].toFixed(1)}`;
        }
      };
      for (const p of pts) {
        if (run.length && p.ms - run[run.length - 1].ms > maxGap) emit();
        run.push(p);
      }
      emit();
      return d;
    };
    // Forecast/unshaded are smoothed (hourly means of a smooth process);
    // the measured 5-minute line stays raw — its jitter is information.
    const fcLine = (cfg.smooth ?? true) ? smoothPath : path;
    // area under the actual line, one closed path per contiguous run
    const area = (pts, maxGap) => {
      let d = "", run = [];
      const flush = () => {
        if (run.length < 2) { run = []; return; }
        d += `M${xOf(run[0].ms).toFixed(1)} ${yOf(0).toFixed(1)}`
          + run.map((p) => `L${xOf(p.ms).toFixed(1)} ${yOf(p.v).toFixed(1)}`).join("")
          + `L${xOf(run[run.length - 1].ms).toFixed(1)} ${yOf(0).toFixed(1)}Z`;
        run = [];
      };
      for (const p of pts) {
        if (run.length && p.ms - run[run.length - 1].ms > maxGap) flush();
        run.push(p);
      }
      flush();
      return d;
    };
    const HOUR_GAP = 2 * 3600000, FIVE_GAP = 16 * 60000;
    const actGap = hourlyFallback ? HOUR_GAP : FIVE_GAP;

    // axes: y 0/half/max, x every 4h (1 day) or 6h
    let grid = "";
    const unitKw = yMax >= 10000;
    const yTicks = wide ? [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax) : [0, yMax / 2, yMax];
    for (const v of yTicks) {
      grid += `<line class="grid" x1="${PAD_L}" y1="${yOf(v)}" x2="${W - PAD_R}" y2="${yOf(v)}"/>
        <text class="axis" x="${PAD_L - 5}" y="${yOf(v) + 3}" text-anchor="end">${unitKw ? fmtNum(hass, v / 1000, 1) : fmtNum(hass, v, 0)}</text>`;
    }
    grid += `<text class="axis" x="${PAD_L - 5}" y="${PAD_T - 2}" text-anchor="end" style="font-size:8.5px">${unitKw ? "kW" : "W"}</text>`;
    const stepH = wide ? (days === 1 ? 2 : 4) : (days === 1 ? 4 : 6);
    for (let hOff = 0; hOff <= days * 24; hOff += stepH) {
      const ms = startMs + hOff * 3600000;
      const x = xOf(ms);
      if (hOff % 24 === 0 && hOff > 0 && hOff < days * 24) {
        grid += `<line class="grid" x1="${x}" y1="${PAD_T}" x2="${x}" y2="${PAD_T + PH}"/>`;
      }
      if (hOff < days * 24 || days === 1) {
        grid += `<text class="axis" x="${x}" y="${H - 8}" text-anchor="middle">${fmtHour(hass, ms)}</text>`;
      }
    }
    // now marker
    let now = "";
    if (nowMs > startMs && nowMs < startMs + windowMs) {
      const nx = xOf(nowMs);
      now = `<line x1="${nx}" y1="${PAD_T - 3}" x2="${nx}" y2="${PAD_T + PH}"
        stroke="var(--pvs-measure)" stroke-width="1" stroke-dasharray="2 3" opacity="0.7"/>`;
    }

    // hero numbers
    const prodId = r.producedIds?.[0];
    const prodSt = prodId ? hass.states[prodId] : null;
    const heroIst = prodSt && !isNaN(parseFloat(prodSt.state))
      ? `<div class="fc-hero-item clickable" data-more-info="${prodId}">
          <span class="hv" style="color:var(--pvs-measure)">${fmtNum(hass, parseFloat(prodSt.state), 1)}<span class="hu">kWh</span></span>
          <span class="hl">${t(hass, "fc_hero_ist")}</span></div>` : "";
    const fcState = isGroup ? st.attributes.today_kwh : parseFloat(st.state);
    const heroProg = fcState != null && !isNaN(fcState)
      ? `<div class="fc-hero-item right clickable" data-more-info="${cfg.entity}">
          <span class="hv" style="color:var(--pvs-model)">${fmtNum(hass, fcState, 1)}<span class="hu">kWh</span></span>
          <span class="hl">${t(hass, "fc_hero_prog")}</span></div>` : "";

    this._lineGeom = { startMs, windowMs, PAD_L, PW, W };
    this._lineSeries = {
      fc: new Map(rows.map((x) => [x.ms, x])),
      act: actPts, hourlyFallback,
    };

    const notes = [];
    if (hourlyFallback && actPts.length) notes.push(`<div class="fc-note">${t(hass, "fc_hourly_fallback")}</div>`);
    if (this._actualsProblem === "stats_unavailable" && !actPts.length) {
      notes.push(`<div class="fc-note">${t(hass, "stats_unavailable", { entity: r.powerId ?? r.producedIds?.join(", ") ?? "?" })}</div>`);
    }

    card(`
      <div class="fc-hero${wide ? " wide" : ""}">${heroIst}<span class="fc-hero-title">${esc(title)}</span>${heroProg}</div>
      ${notes.join("")}
      <div class="fc-wrap"><svg class="fc-line" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="aspect-ratio:${W}/${H}">
        ${grid}
        ${actPts.length ? `<path d="${area(actPts, actGap)}" fill="var(--pvs-measure)" opacity="0.13"/>` : ""}
        ${unPts.length ? `<path d="${fcLine(unPts, HOUR_GAP)}" fill="none" stroke="var(--pvs-model-ghost)" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>` : ""}
        ${fcPts.length ? `<path d="${fcLine(fcPts, HOUR_GAP)}" fill="none" stroke="var(--pvs-model)" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>` : ""}
        ${actPts.length ? `<path d="${path(actPts, actGap)}" fill="none" stroke="var(--pvs-measure)" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>` : ""}
        ${now}
        <line class="fc-xh" x1="-10" y1="${PAD_T}" x2="-10" y2="${PAD_T + PH}" stroke="var(--secondary-text-color)" stroke-width="1" opacity="0"/>
        <rect class="lhit" x="${PAD_L}" y="${PAD_T}" width="${PW}" height="${PH}" fill="transparent"/>
      </svg></div>
      <div class="pvs-legend">
        ${unPts.length ? `<span class="it"><span class="sw" style="background:var(--pvs-model-ghost)"></span>${t(hass, "fc_unshaded")}</span>` : ""}
        <span class="it"><span class="sw" style="background:var(--pvs-model)"></span>${t(hass, "fc_forecast")}</span>
        ${actPts.length ? `<span class="it"><span class="sw" style="background:var(--pvs-measure)"></span>${t(hass, "fc_actual")}</span>` : ""}
      </div>`);
  }

  _rows() {
    // -> [{ms, potential, unshaded}] across the configured window, sparse.
    const hass = this._hass, cfg = this._config, r = this._resolved;
    const st = hass.states[cfg.entity];
    const own = st?.attributes?.forecast ?? [];
    let rows = own;
    if (r?.kind === "plant") {
      const extra = [r.tomorrowId, r.dayAfterId]
        .map((id) => (id && hass.states[id]?.attributes?.forecast) || []);
      rows = [...own, ...extra.flat()];
    }
    const startMs = localMidnightMs(hass, Date.now());
    const endMs = startMs + (cfg.days ?? 2) * 24 * 3600000 + 3600000; // DST slack
    const out = [];
    const seen = new Set();
    for (const row of rows) {
      const ms = new Date(row.datetime).getTime();
      if (ms < startMs || ms >= endMs || seen.has(ms)) continue;
      seen.add(ms);
      out.push({ ms, potential: row.potential_kwh, unshaded: row.unshaded_kwh });
    }
    out.sort((a, b) => a.ms - b.ms);
    return out;
  }

  _render() {
    const hass = this._hass, cfg = this._config;
    if (!hass || !cfg) return;
    const card = (inner) => {
      this.shadowRoot.innerHTML = `<style>${BASE_CSS}${FC_CSS}</style><ha-card>${inner}<div class="pvs-tip"></div></ha-card>`;
      this._wire();
    };
    if (!cfg.entity) return card(problemHTML(hass, { reason: t(hass, "no_entity_config") }));
    const st = hass.states[cfg.entity];
    if (!st) return card(problemHTML(hass, { reason: t(hass, "entity_missing", { entity: cfg.entity }) }));
    const need = requireFeatures(st, ["forecast_list", "unshaded"]);
    if (!need.ok) return card(problemHTML(hass, { entity: cfg.entity, missing: need.missing }));
    this._resolve();
    const r = this._resolved || { kind: "plant", producedIds: [] };
    const isGroup = r.kind === "group";
    if ((cfg.style ?? "bars") === "line") return this._renderLine(card, st, r);
    const showUnshaded = (cfg.show_unshaded ?? true) && !isGroup;
    const showActual = (cfg.show_actual ?? true);

    const rows = this._rows();
    const title = cfg.title ?? st.attributes.friendly_name ?? cfg.entity;
    if (!rows.length) {
      return card(`<div class="pvs-head"><span class="pvs-title">${esc(title)}</span></div>
        ${withheldHTML(t(hass, "fc_no_hours"))}`);
    }

    // ---- slot grid: hourly, contiguous from first to last covered day ----
    const startMs = localMidnightMs(hass, Date.now());
    const days = cfg.days ?? 2;
    const nSlots = days * 24;
    const byMs = new Map(rows.map((x) => [x.ms, x]));
    const actuals = this._actuals;
    const nowMs = Date.now();
    const curHourMs = nowMs - (nowMs % 3600000);

    // daylight span per day (first..last covered hour) for gap ticks
    const dayCover = new Map();
    for (const x of rows) {
      const dk = localParts(hass, x.ms).dayKey;
      const c = dayCover.get(dk) ?? { min: Infinity, max: -Infinity };
      c.min = Math.min(c.min, x.ms); c.max = Math.max(c.max, x.ms);
      dayCover.set(dk, c);
    }

    let maxV = 0;
    for (const x of rows) maxV = Math.max(maxV, showUnshaded ? x.unshaded : x.potential);
    if (actuals) for (const v of actuals.values()) maxV = Math.max(maxV, v);
    const yMax = niceMax(maxV * 1.05);

    const SW = 13, PAD_L = 30, PAD_R = 4, PAD_T = 8, PAD_B = 24, PH = 130;
    const W = PAD_L + nSlots * SW + PAD_R, H = PAD_T + PH + PAD_B;
    const yOf = (v) => PAD_T + PH - (v / yMax) * PH;

    let bars = "", hits = "", seps = "", labels = "";
    for (let i = 0; i < nSlots; i++) {
      const ms = startMs + i * 3600000;
      const x0 = PAD_L + i * SW;
      const lp = localParts(hass, ms);
      if (lp.hour === 0 && i > 0) {
        seps += `<line class="grid" x1="${x0}" y1="${PAD_T}" x2="${x0}" y2="${PAD_T + PH}"/>`;
      }
      if (lp.hour === 12) {
        labels += `<text x="${x0}" y="${H - 9}" text-anchor="middle">${fmtWeekday(hass, ms)} ${fmtDayShort(hass, ms)}</text>`;
      }
      const row = byMs.get(ms);
      const act = actuals?.get(ms);
      const isPast = ms + 3600000 <= nowMs, isCur = ms === curHourMs;
      const cov = dayCover.get(lp.dayKey);
      if (!row && cov && ms > cov.min && ms < cov.max) {
        // uncovered daylight hour: hatch tick, visually distinct from a zero bar
        bars += `<rect x="${x0 + 1.5}" y="${PAD_T + PH - 4}" width="${SW - 3}" height="4"
          fill="url(#pvs-hatch-fc)" data-gap="1"/>`;
      }
      if (row) {
        if (showUnshaded && row.unshaded > 0) {
          bars += `<rect x="${x0 + 0.5}" y="${yOf(row.unshaded)}" width="${SW - 1}"
            height="${Math.max(0, PAD_T + PH - yOf(row.unshaded))}" rx="2"
            fill="var(--pvs-model-ghost)"/>`;
        }
        if (row.potential > 0) {
          const bw = SW * 0.62;
          bars += `<rect x="${x0 + (SW - bw) / 2}" y="${yOf(row.potential)}" width="${bw}"
            height="${Math.max(0, PAD_T + PH - yOf(row.potential))}" rx="2"
            fill="var(--pvs-model)"/>`;
        }
      }
      if (showActual && act != null && (isPast || isCur) && act > 0) {
        const aw = SW * 0.32;
        const ay = yOf(act);
        bars += `<rect x="${x0 + (SW - aw) / 2}" y="${ay}" width="${aw}"
          height="${Math.max(0, PAD_T + PH - ay)}" rx="1.5"
          fill="var(--pvs-measure)" stroke="var(--card-background-color)" stroke-width="1"/>`;
        if (isCur) {
          bars += `<rect x="${x0 + (SW - aw) / 2}" y="${ay}" width="${aw}" height="${Math.min(8, PAD_T + PH - ay)}"
            fill="url(#pvs-hatch-fc)"/>`;
        }
      }
      const payload = { ms, f: row?.potential ?? null, u: row?.unshaded ?? null,
        a: act ?? null, cur: isCur, gap: !row && cov && ms > cov.min && ms < cov.max };
      hits += `<rect class="hit" x="${x0}" y="${PAD_T}" width="${SW}" height="${PH}"
        fill="transparent" data-slot='${esc(JSON.stringify(payload))}'/>`;
    }

    // now marker
    if (curHourMs >= startMs && curHourMs < startMs + nSlots * 3600000) {
      const nx = PAD_L + ((nowMs - startMs) / 3600000) * SW;
      seps += `<line x1="${nx}" y1="${PAD_T - 3}" x2="${nx}" y2="${PAD_T + PH}"
        stroke="var(--pvs-measure)" stroke-width="1" stroke-dasharray="2 3" opacity="0.8"/>
        <text x="${nx}" y="${PAD_T - 1}" text-anchor="middle" fill="var(--pvs-measure)"
        style="font-size:9px">${t(hass, "now")}</text>`;
    }

    // y axis: 0, half, max
    let yaxis = "";
    for (const v of [0, yMax / 2, yMax]) {
      yaxis += `<line class="grid" x1="${PAD_L}" y1="${yOf(v)}" x2="${W - PAD_R}" y2="${yOf(v)}"/>
        <text class="axis" x="${PAD_L - 4}" y="${yOf(v) + 3}" text-anchor="end">${fmtNum(hass, v, v < 2 && v !== 0 ? 1 : 0)}</text>`;
    }

    // header chips
    const chips = [];
    const chip = (label, value, entityId, sub) => {
      if (value == null) return;
      chips.push(`<span class="pvs-chip clickable" ${entityId ? `data-more-info="${entityId}"` : ""}>
        ${label} <span class="v">${value}</span>${sub ? ` <span class="pvs-sub">${sub}</span>` : ""}</span>`);
    };
    if (isGroup) {
      chip(t(hass, "today"), fmtKwh(hass, st.attributes.today_kwh, 1), cfg.entity);
      chip(t(hass, "remaining"), fmtKwh(hass, parseFloat(st.state), 1), cfg.entity);
      chip(t(hass, "tomorrow"), fmtKwh(hass, st.attributes.tomorrow_kwh, 1), cfg.entity);
    } else {
      chip(t(hass, "today"), fmtKwh(hass, parseFloat(st.state), 1), cfg.entity);
      if (r.remainingId) {
        const rs = hass.states[r.remainingId];
        chip(t(hass, "remaining"), rs ? fmtKwh(hass, parseFloat(rs.state), 1) : null, r.remainingId);
      }
      if (r.tomorrowId && days > 1) {
        const ts2 = hass.states[r.tomorrowId];
        chip(t(hass, "tomorrow"), ts2 ? fmtKwh(hass, parseFloat(ts2.state), 1) : null, r.tomorrowId);
      }
    }

    const notes = [];
    if (isGroup && (cfg.show_unshaded ?? true)) {
      notes.push(`<div class="fc-note">${t(hass, "fc_group_unshaded")}</div>`);
    }
    if (this._actualsProblem === "fc_actual_unresolved") {
      notes.push(`<div class="fc-note">${t(hass, "fc_actual_unresolved")}</div>`);
    } else if (this._actualsProblem === "stats_unavailable") {
      notes.push(`<div class="fc-note">${t(hass, "stats_unavailable", { entity: r.producedIds?.join(", ") ?? "?" })}</div>`);
    }

    const legend = `<div class="pvs-legend">
      ${showUnshaded ? `<span class="it"><span class="sw" style="background:var(--pvs-model-ghost)"></span>${t(hass, "fc_unshaded")}</span>` : ""}
      <span class="it"><span class="sw" style="background:var(--pvs-model)"></span>${t(hass, "fc_forecast")}</span>
      ${showActual ? `<span class="it"><span class="sw" style="background:var(--pvs-measure)"></span>${t(hass, "fc_actual")}</span>` : ""}
      <span class="it"><svg width="14" height="10"><rect width="14" height="10" rx="2" fill="url(#pvs-hatch-fcl)"/></svg>${t(hass, "fc_gap")}</span>
    </div>`;

    card(`
      <div class="pvs-head"><span class="pvs-title">${esc(title)}</span>${chips.join("")}</div>
      ${notes.join("")}
      <div class="fc-wrap"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="aspect-ratio:${W}/${H}">
        <defs>${hatchPattern("pvs-hatch-fc", "var(--pvs-measure)")}${hatchPattern("pvs-hatch-fcl")}</defs>
        ${yaxis}${seps}${bars}${hits}
      </svg></div>
      ${legend}`);
  }

  _wire() {
    this._wireMoreInfo();
    if (this._wired) return;
    this._wired = true;
    this.shadowRoot.addEventListener("pointerleave", () => {
      this.shadowRoot.querySelector(".fc-xh")?.setAttribute("opacity", "0");
    });
    wireTooltip(this, {
      selector: ".hit,.lhit",
      content: (el, ev) => {
        if (el.classList.contains("lhit")) return this._lineTip(ev);
        const hass = this._hass;
        const d = JSON.parse(el.getAttribute("data-slot"));
        if (d.f == null && d.a == null) {
          return d.gap ? `<div class="h">${fmtHour(hass, d.ms)}</div><div>${t(hass, "fc_gap")}</div>` : null;
        }
        const shadow = (d.u > 0 && d.f != null) ? (1 - d.f / d.u) * 100 : null;
        const delta = (d.a != null && d.f != null) ? d.a - d.f : null;
        return `<div class="h">${fmtWeekday(hass, d.ms)} ${fmtHour(hass, d.ms)}</div>
          ${d.f != null ? `<div class="r"><span class="k">${t(hass, "fc_forecast")}</span><span class="v">${fmtKwh(hass, d.f)}</span></div>` : ""}
          ${d.u != null && d.u !== d.f ? `<div class="r"><span class="k">${t(hass, "fc_unshaded")}</span><span class="v">${fmtKwh(hass, d.u)}</span></div>` : ""}
          ${shadow != null && shadow > 0.5 ? `<div class="r"><span class="k">${t(hass, "fc_known_shadow")}</span><span class="v">${fmtNum(hass, shadow, 0)} %</span></div>` : ""}
          ${d.a != null ? `<div class="r"><span class="k">${t(hass, "fc_actual")}</span><span class="v">${fmtKwh(hass, d.a)}</span></div>` : ""}
          ${delta != null && !d.cur ? `<div class="r"><span class="k">${t(hass, "fc_delta")}</span><span class="v">${fmtSigned(hass, delta)} kWh</span></div>` : ""}
          ${d.cur ? `<div class="pvs-sub">${t(hass, "in_progress", { min: new Date().getMinutes() })}</div>` : ""}`;
      },
    });
  }

  _lineTip(ev) {
    const hass = this._hass;
    const g = this._lineGeom, s = this._lineSeries;
    if (!g || !s) return null;
    const svg = this.shadowRoot.querySelector("svg.fc-line");
    const rect = svg.getBoundingClientRect();
    const vx = (ev.clientX - rect.left) / rect.width * g.W;
    const ms = g.startMs + (vx - g.PAD_L) / g.PW * g.windowMs;
    const hourMs = ms - (ms % 3600000);
    const fc = s.fc.get(hourMs);
    let act = null, best = 21 * 60000;
    for (const p of s.act) {
      const d = Math.abs(p.ms - ms);
      if (d < best) { best = d; act = p; }
    }
    const xh = svg.querySelector(".fc-xh");
    if (xh) { xh.setAttribute("x1", vx); xh.setAttribute("x2", vx); xh.setAttribute("opacity", "0.4"); }
    if (!fc && !act) return null;
    const shadow = fc && fc.unshaded > 0 ? (1 - fc.potential / fc.unshaded) * 100 : null;
    return `<div class="h">${fmtWeekday(hass, ms)} ${fmtHour(hass, ms)}</div>
      ${fc ? `<div class="r"><span class="k">${t(hass, "fc_forecast")}</span><span class="v">${fmtNum(hass, fc.potential * 1000, 0)} W</span></div>` : ""}
      ${fc && fc.unshaded !== fc.potential ? `<div class="r"><span class="k">${t(hass, "fc_unshaded")}</span><span class="v">${fmtNum(hass, fc.unshaded * 1000, 0)} W</span></div>` : ""}
      ${shadow != null && shadow > 0.5 ? `<div class="r"><span class="k">${t(hass, "fc_known_shadow")}</span><span class="v">${fmtNum(hass, shadow, 0)} %</span></div>` : ""}
      ${act ? `<div class="r"><span class="k">${t(hass, "fc_actual")}</span><span class="v">${fmtNum(hass, act.v, 0)} W</span></div>` : ""}
      ${s.hourlyFallback && act ? `<div class="pvs-sub">${t(hass, "fc_hourly_fallback")}</div>` : ""}`;
  }

  static getConfigElement() { return document.createElement("pvstrings-forecast-editor"); }
  static getStubConfig(hass, entities) {
    const guess = (entities ?? []).find((e) =>
      Array.isArray(hass.states[e]?.attributes?.forecast));
    return { entity: guess ?? "", days: 2 };
  }
}

const FC_CSS = `
  .fc-wrap svg { width: 100%; height: auto; display: block; }
  .fc-note { font-size: 11px; color: var(--secondary-text-color); margin: 2px 0 6px; }
  .hit, .lhit { cursor: crosshair; }
  .fc-hero { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 8px; }
  .fc-hero-title {
    flex: 1; text-align: center; align-self: center;
    font-size: 13px; font-weight: 600; color: var(--secondary-text-color);
    letter-spacing: 0.2px; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .fc-hero-item { display: flex; flex-direction: column; gap: 1px; }
  .fc-hero-item.right { text-align: right; }
  .fc-hero-item.clickable { cursor: pointer; }
  .fc-hero-item .hv { font-family: var(--pvs-mono); font-variant-numeric: tabular-nums; font-size: 24px; font-weight: 700; line-height: 1.1; }
  .fc-hero-item .hu { font-size: 12px; font-weight: 500; margin-left: 3px; opacity: 0.75; }
  .fc-hero-item .hl { font-size: 11px; color: var(--secondary-text-color); }
  .fc-hero.wide .hv { font-size: 32px; }
  .fc-hero.wide .hu { font-size: 14px; }
  .fc-hero.wide .fc-hero-title { font-size: 15px; }
`;

/* ======================= SECTION: CARD:CONVERSION ======================== */

// DC potential vs converted output (AC or battery charge) for one group.
// Semantics per the integration's contract: the output is hardware
// potential (capped at the AC rating, never at regulatory limits),
// clipping is a hardware cap and not a conversion loss, and a neutral
// curve means "unconverted" — not a measured 0 % loss. The per-hour ratio
// strip omits hours whose DC is too small for a meaningful quotient
// (hatched, rule 1: absence is shown, never faked as a value).
// Curve-source label for chip and nerd table. fixed_factors carries the
// applied multiplier (conversion_factor, e.g. 0.9312 = MPPT 0.97 × charge
// 0.96) — showing it is the point; without it, the label alone.
function curveLabel(hass, source, factor) {
  if (!source) return null;
  if (source === "fixed_factors")
    return t(hass, "conv_curve_fixed_factors") +
      (factor != null ? ` × ${fmtNum(hass, factor, 3)}` : "");
  return ["datasheet", "custom", "neutral"].includes(source)
    ? t(hass, "conv_curve_" + source) : esc(source);
}

class PvsConversionCard extends PvsBaseCard {
  watchedEntities() {
    return [this._config?.entity, this._config?.dc_entity].filter(Boolean);
  }
  getCardSize() { return 4; }
  getGridOptions() { return { columns: "full", rows: "auto" }; }

  _render() {
    const hass = this._hass, cfg = this._config;
    if (!hass || !cfg) return;
    const card = (inner) => {
      this.shadowRoot.innerHTML = `<style>${BASE_CSS}${FC_CSS}</style><ha-card>${inner}<div class="pvs-tip"></div></ha-card>`;
      this._wire();
    };
    if (!cfg.entity || !cfg.dc_entity) return card(problemHTML(hass, { reason: t(hass, "no_entity_config") }));
    const outSt = hass.states[cfg.entity], dcSt = hass.states[cfg.dc_entity];
    if (!outSt) return card(problemHTML(hass, { reason: t(hass, "entity_missing", { entity: cfg.entity }) }));
    if (!dcSt) return card(problemHTML(hass, { reason: t(hass, "entity_missing", { entity: cfg.dc_entity }) }));

    const a = outSt.attributes;
    const path = a.output_path === "storage" ? "storage" : "direct";
    const outLabel = t(hass, "conv_out_" + path);
    const title = cfg.title ?? a.friendly_name ?? cfg.entity;
    // Coordinator not ready is "not yet", never a contract error.
    if (outSt.state === "unavailable" || dcSt.state === "unavailable") {
      return card(`<div class="pvs-head"><span class="pvs-title">${esc(title)}</span></div>
        ${withheldHTML(t(hass, "conv_not_ready"))}`);
    }
    for (const [st, id, feats] of [[outSt, cfg.entity, ["forecast_list", "conv_output"]],
      [dcSt, cfg.dc_entity, ["forecast_list"]]]) {
      const need = requireFeatures(st, feats);
      if (!need.ok) return card(problemHTML(hass, { entity: id, missing: need.missing }));
    }

    // ---- today's hours from both lists ----
    const startMs = localMidnightMs(hass, Date.now());
    const endMs = startMs + 25 * 3600000; // DST slack
    const pick = (st) => {
      const m = new Map();
      for (const row of st.attributes.forecast ?? []) {
        const ms = new Date(row.datetime).getTime();
        if (ms >= startMs && ms < endMs && !m.has(ms)) m.set(ms, row.potential_kwh);
      }
      return m;
    };
    const dc = pick(dcSt), out = pick(outSt);

    // ---- header chips ----
    const neutral = a.curve_source === "neutral";
    const dcToday = dcSt.attributes.today_kwh;
    const outToday = a.today_kwh;
    const chips = [];
    if (!neutral && outToday != null && dcToday > 0) {
      chips.push(`<span class="pvs-chip clickable" data-more-info="${cfg.entity}"
        title="${esc(t(hass, "conv_eff_tip_" + path))}">
        ${t(hass, "conv_eff_today")} <span class="v">${fmtNum(hass, (outToday / dcToday) * 100, 1)} %</span></span>`);
    }
    if (a.curve_source) {
      chips.push(`<span class="pvs-chip clickable" data-more-info="${cfg.entity}"
        title="${esc(neutral ? t(hass, "conv_neutral_note")
          : a.curve_source === "fixed_factors" ? t(hass, "conv_fixed_factors_tip")
          : t(hass, "more_info"))}">${curveLabel(hass, a.curve_source, a.conversion_factor)}</span>`);
    }
    if (!neutral && a.clipped_kwh > 0) {
      chips.push(`<span class="pvs-chip warn" title="${esc(t(hass, "conv_clipped_tip"))}">
        <span class="ico">⚠︎</span> ${t(hass, "conv_clipped", { v: fmtNum(hass, a.clipped_kwh, 2) })}</span>`);
    }
    const heroDc = dcToday != null
      ? `<div class="fc-hero-item clickable" data-more-info="${cfg.dc_entity}">
          <span class="hv" style="color:var(--secondary-text-color)">${fmtNum(hass, dcToday, 1)}<span class="hu">kWh</span></span>
          <span class="hl">${t(hass, "conv_hero_dc")}</span></div>` : "";
    const heroOut = outToday != null
      ? `<div class="fc-hero-item right clickable" data-more-info="${cfg.entity}">
          <span class="hv" style="color:var(--pvs-model)">${fmtNum(hass, outToday, 1)}<span class="hu">kWh</span></span>
          <span class="hl">${t(hass, "conv_hero_" + path)}</span></div>` : "";
    const head = `
      <div class="fc-hero">${heroDc}<span class="fc-hero-title">${esc(title)}</span>${heroOut}</div>
      ${chips.length ? `<div class="pvs-head" style="justify-content:flex-start">${chips.join("")}</div>` : ""}`;

    if (!dc.size) return card(head + withheldHTML(t(hass, "fc_no_hours")));

    // ---- geometry: hourly bars + ratio strip in one SVG ----
    const nSlots = 24;
    const SW = 26, PAD_L = 34, PAD_R = 6, PAD_T = 8, PH = 108;
    const GAP = 12, STRIP_H = 30, PAD_B = 20;
    const W = PAD_L + nSlots * SW + PAD_R;
    const H = PAD_T + PH + GAP + STRIP_H + PAD_B;
    const STRIP_Y = PAD_T + PH + GAP;
    let maxV = 0;
    for (const v of dc.values()) maxV = Math.max(maxV, v ?? 0);
    const yMax = niceMax(maxV * 1.05);
    const yOf = (v) => PAD_T + PH - (v / yMax) * PH;
    // materiality: below this DC an hourly quotient is noise, not signal
    const thresh = Math.max(0.05, 0.04 * maxV);

    let bars = "", strip = "", hits = "", labels = "";
    for (let i = 0; i < nSlots; i++) {
      const ms = startMs + i * 3600000;
      const x0 = PAD_L + i * SW;
      const lp = localParts(hass, ms);
      if (lp.hour % 4 === 0) {
        labels += `<text class="axis" x="${x0 + SW / 2}" y="${H - 6}" text-anchor="middle">${fmtHour(hass, ms)}</text>`;
      }
      const d = dc.get(ms), o = out.get(ms);
      if (d != null && d > 0) {
        bars += `<rect x="${x0 + 1}" y="${yOf(d)}" width="${SW - 2}" height="${PAD_T + PH - yOf(d)}"
          fill="var(--pvs-model-ghost)" rx="1"/>`;
      }
      if (o != null && o > 0) {
        bars += `<rect x="${x0 + 1}" y="${yOf(o)}" width="${SW - 2}" height="${PAD_T + PH - yOf(o)}"
          fill="var(--pvs-model)" rx="1"/>`;
      }
      // ratio strip: honest — hatched where DC is immaterial
      const material = d != null && d >= thresh;
      const ratio = material && o != null ? o / d : null;
      if (!neutral) {
        if (ratio != null) {
          const rh = Math.min(1, ratio) * STRIP_H;
          strip += `<rect x="${x0 + 1}" y="${STRIP_Y + STRIP_H - rh}" width="${SW - 2}" height="${rh}"
            fill="var(--pvs-model)" opacity="0.45" rx="1"/>`;
        } else if (d != null && d > 0) {
          strip += `<rect x="${x0 + 1}" y="${STRIP_Y}" width="${SW - 2}" height="${STRIP_H}"
            fill="url(#pvs-conv-hatch)" stroke="none"/>`;
        }
      }
      const tip = { h: lp.hour, dc: d ?? null, out: o ?? null,
        ratio: ratio != null ? ratio : null, low: d != null && d > 0 && !material };
      hits += `<rect x="${x0}" y="${PAD_T}" width="${SW}" height="${H - PAD_T - PAD_B}"
        fill="transparent" data-conv='${esc(JSON.stringify(tip))}'/>`;
    }

    // axes: kWh ticks for the bars, 100 % line for the strip
    let grid = "";
    for (const v of [0, yMax / 2, yMax]) {
      grid += `<line class="grid" x1="${PAD_L}" y1="${yOf(v)}" x2="${W - PAD_R}" y2="${yOf(v)}"/>
        <text class="axis" x="${PAD_L - 5}" y="${yOf(v) + 3}" text-anchor="end">${fmtNum(hass, v, 1)}</text>`;
    }
    if (!neutral) {
      grid += `<line class="grid" x1="${PAD_L}" y1="${STRIP_Y}" x2="${W - PAD_R}" y2="${STRIP_Y}"/>
        <line class="grid" x1="${PAD_L}" y1="${STRIP_Y + STRIP_H}" x2="${W - PAD_R}" y2="${STRIP_Y + STRIP_H}"/>
        <text class="axis" x="${PAD_L - 5}" y="${STRIP_Y + 4}" text-anchor="end">100%</text>
        <text class="axis" x="${PAD_L - 5}" y="${STRIP_Y + STRIP_H + 3}" text-anchor="end">0</text>`;
    }

    const notes = [];
    if (neutral) notes.push(`<div class="fc-note">${t(hass, "conv_neutral_note")}</div>`);
    if (a.note) notes.push(`<div class="fc-note">${esc(a.note)}</div>`);

    card(`
      ${head}
      ${notes.join("")}
      <div class="fc-wrap"><svg class="fc-line" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="aspect-ratio:${W}/${H}">
        <defs>${hatchPattern("pvs-conv-hatch")}</defs>
        ${grid}${bars}${strip}${labels}${hits}
      </svg></div>
      <div class="pvs-legend">
        <span class="it"><span class="sw" style="background:var(--pvs-model-ghost)"></span>${t(hass, "conv_dc")}</span>
        <span class="it"><span class="sw" style="background:var(--pvs-model)"></span>${outLabel}</span>
        ${neutral ? "" : `<span class="it"><span class="sw" style="background:var(--pvs-model);opacity:0.45"></span>${t(hass, "conv_strip", { out: outLabel })}</span>`}
      </div>`);
  }

  _wire() {
    this._wireMoreInfo();
    if (this._wired) return;
    this._wired = true;
    wireTooltip(this, {
      selector: "[data-conv]",
      content: (el) => {
        const hass = this._hass;
        const c = JSON.parse(el.getAttribute("data-conv"));
        const outLabel = t(hass, "conv_out_" +
          (this._hass?.states[this._config?.entity]?.attributes?.output_path === "storage" ? "storage" : "direct"));
        return `<div class="h">${String(c.h).padStart(2, "0")}:00–${String((c.h + 1) % 24).padStart(2, "0")}:00</div>
          ${c.dc != null ? `<div class="r"><span class="k">${t(hass, "conv_dc")}</span><span class="v">${fmtNum(hass, c.dc, 2)} kWh</span></div>` : ""}
          ${c.out != null ? `<div class="r"><span class="k">${outLabel}</span><span class="v">${fmtNum(hass, c.out, 2)} kWh</span></div>` : ""}
          ${c.ratio != null ? `<div class="r"><span class="k">${outLabel} / DC</span><span class="v">${fmtNum(hass, c.ratio * 100, 1)} %</span></div>` : ""}
          ${c.low ? `<div class="pvs-sub">${t(hass, "conv_low_dc")}</div>` : ""}`;
      },
    });
  }

  static getConfigElement() {
    return document.createElement("pvstrings-conversion-editor");
  }
}

/* ========================= SECTION: CARD:CHAIN =========================== */

class PvsChainCard extends PvsBaseCard {
  setConfig(config) {
    this._hourMs = null; // null = follow "now"
    this._measured = undefined;
    super.setConfig(config ?? {});
  }
  getCardSize() { return 4; }

  async _loadMeasured(hourMs) {
    const hass = this._hass;
    const token = ++this._renderToken;
    this._measured = undefined;
    try {
      const producedId = await sibling(hass, this._config.entity, "string_produced_today");
      if (!producedId) { this._measured = { err: "unresolved" }; return this._render(); }
      this._producedId = producedId;
      const rows = await hourlyActuals(hass, producedId,
        new Date(hourMs).toISOString(), new Date(hourMs + 3600000).toISOString());
      if (token !== this._renderToken) return;
      const row = rows.find((x) => x.startMs === hourMs);
      this._measured = { kwh: row?.change ?? null, hourMs };
      this._render();
    } catch (_) {
      if (token === this._renderToken) { this._measured = { err: "stats" }; this._render(); }
    }
  }

  _render() {
    const hass = this._hass, cfg = this._config;
    if (!hass || !cfg) return;
    const card = (inner) => {
      this.shadowRoot.innerHTML = `<style>${BASE_CSS}${CHAIN_CSS}</style><ha-card>${inner}</ha-card>`;
      this._wire();
    };
    if (!cfg.entity) return card(problemHTML(hass, { reason: t(hass, "no_entity_config") }));
    const st = hass.states[cfg.entity];
    if (!st) return card(problemHTML(hass, { reason: t(hass, "entity_missing", { entity: cfg.entity }) }));
    const need = requireFeatures(st, ["forecast_list", "chain_steps"]);
    if (!need.ok) {
      return card(problemHTML(hass, {
        entity: cfg.entity, missing: need.missing,
        hint: t(hass, "chain_needs_string"),
      }));
    }
    const rows = (st.attributes.forecast ?? [])
      .map((r) => ({ ...r, ms: new Date(r.datetime).getTime() }))
      .sort((a, b) => a.ms - b.ms);
    if (!rows.length) {
      return card(`<div class="pvs-head"><span class="pvs-title">${t(hass, "chain_title")}</span></div>
        ${withheldHTML(t(hass, "fc_no_hours"))}`);
    }
    const nowMs = Date.now(), curHourMs = nowMs - (nowMs % 3600000);
    let hourMs = this._hourMs ?? curHourMs;
    if (!rows.some((r) => r.ms === hourMs)) {
      // nearest available row
      hourMs = rows.reduce((best, r) =>
        Math.abs(r.ms - hourMs) < Math.abs(best - hourMs) ? r.ms : best, rows[0].ms);
    }
    const row = rows.find((r) => r.ms === hourMs);
    const idx = rows.indexOf(row);
    if (this._measured?.hourMs !== hourMs && hourMs + 3600000 <= nowMs + 3600000) {
      if (this._measured === undefined || this._measured?.hourMs !== hourMs) {
        if (hourMs <= curHourMs) this._loadMeasured(hourMs);
      }
    }

    const title = st.attributes.friendly_name?.replace(/ (Prognose heute|Forecast today)$/i, "") ?? cfg.entity;
    const isFuture = hourMs > curHourMs, isCur = hourMs === curHourMs;

    const product = row.physics_kwh * row.shading * row.model;
    const mismatch = Math.abs(product - row.potential_kwh) > 1e-3;
    const afterShading = row.physics_kwh * row.shading;

    const meter = (f) => {
      const w = Math.max(0, Math.min(1, f)) * 56;
      return `<svg width="56" height="6"><rect width="56" height="6" rx="3" fill="var(--pvs-chip-bg)"/>
        <rect width="${w}" height="6" rx="3" fill="var(--pvs-model)"/></svg>`;
    };
    const kwhCell = (v) => `<span class="pvs-num v">${fmtNum(hass, v, 3)}</span><span class="unit">kWh</span>`;

    let measuredHtml;
    if (isFuture) {
      measuredHtml = withheldHTML(t(hass, "not_yet_hour"));
    } else if (this._measured === undefined) {
      measuredHtml = `<span class="pvs-sub">…</span>`;
    } else if (this._measured.err) {
      measuredHtml = `<span class="pvs-sub">⚠︎ ${t(hass, "stats_unavailable", { entity: this._producedId ?? cfg.entity })}</span>`;
    } else if (this._measured.kwh == null) {
      measuredHtml = withheldHTML(isCur
        ? t(hass, "in_progress", { min: new Date().getMinutes() })
        : t(hass, "not_available"));
    } else {
      const delta = this._measured.kwh - row.potential_kwh;
      measuredHtml = `${kwhCell(this._measured.kwh)}
        <span class="delta ${delta >= 0 ? "up" : "down"}">${fmtSigned(hass, delta, 3)} kWh</span>
        ${isCur ? `<span class="pvs-sub">· ${t(hass, "in_progress", { min: new Date().getMinutes() })}</span>` : ""}`;
    }

    card(`
      <div class="pvs-head">
        <span class="pvs-title">${esc(title)} — ${t(hass, "chain_title")}</span>
        <span class="ch-stepper">
          <button data-step="-1" ${idx === 0 ? "disabled" : ""}>◀</button>
          <span class="pvs-num">${fmtWeekday(hass, hourMs)} ${fmtHour(hass, hourMs)}</span>
          <button data-step="1" ${idx === rows.length - 1 ? "disabled" : ""}>▶</button>
          <button data-step="0" title="${t(hass, "now")}" ${this._hourMs == null ? "disabled" : ""}>⦿</button>
        </span>
      </div>
      <div class="ch-bias">${t(hass, "chain_source_bias", { v: fmtNum(hass, row.source_bias, 3) })}</div>
      <div class="ch-grid">
        <div class="lab" data-more-info="${cfg.entity}">${t(hass, "chain_physics")}</div>
        <div></div><div></div>
        <div class="val">${kwhCell(row.physics_kwh)}</div>

        <div class="lab op">× ${t(hass, "chain_shading")}</div>
        <div class="fac"><span class="pvs-num">${fmtNum(hass, row.shading, 3)}</span>${meter(row.shading)}</div>
        <div class="eff pvs-num">${fmtSigned(hass, afterShading - row.physics_kwh, 3)}</div>
        <div class="val dim">${kwhCell(afterShading)}</div>

        <div class="lab op">× ${t(hass, "chain_model")}</div>
        <div class="fac"><span class="pvs-num">${fmtNum(hass, row.model, 3)}</span>${meter(row.model)}</div>
        <div class="eff pvs-num">${fmtSigned(hass, product - afterShading, 3)}</div>
        <div class="val dim">${kwhCell(product)}</div>

        <div class="lab pub" data-more-info="${cfg.entity}">= ${t(hass, "chain_published")}</div>
        <div></div><div></div>
        <div class="val pub">${kwhCell(row.potential_kwh)}</div>

        ${mismatch ? `<div class="ch-mismatch">⚠︎ ${t(hass, "chain_discrepancy", { a: fmtNum(hass, product, 4), b: fmtNum(hass, row.potential_kwh, 4) })}</div>` : ""}

        <div class="lab meas" ${this._producedId ? `data-more-info="${this._producedId}"` : ""}>${t(hass, "chain_measured")}</div>
        <div class="meas-val">${measuredHtml}</div>
      </div>`);
  }

  _wire() {
    this._wireMoreInfo();
    if (this._wired) return;
    this._wired = true;
    this.shadowRoot.addEventListener("click", (ev) => {
      const b = ev.target.closest?.("[data-step]");
      if (!b || b.disabled) return;
      const step = parseInt(b.getAttribute("data-step"), 10);
      const st = this._hass.states[this._config.entity];
      const rows = (st?.attributes?.forecast ?? [])
        .map((r) => new Date(r.datetime).getTime()).sort((a, b2) => a - b2);
      if (step === 0) { this._hourMs = null; this._measured = undefined; this._render(); return; }
      const nowMs = Date.now();
      const cur = this._hourMs ?? nowMs - (nowMs % 3600000);
      const curIdx = rows.findIndex((ms) => ms >= cur);
      const next = rows[Math.max(0, Math.min(rows.length - 1,
        (curIdx === -1 ? rows.length - 1 : curIdx) + step))];
      if (next != null) { this._hourMs = next; this._measured = undefined; this._render(); }
    });
  }

  static getConfigElement() { return document.createElement("pvstrings-chain-editor"); }
  static getStubConfig(hass, entities) {
    const guess = (entities ?? []).find((e) =>
      hass.states[e]?.attributes?.forecast?.[0]?.physics_kwh !== undefined);
    return { entity: guess ?? "" };
  }
}

const CHAIN_CSS = `
  .ch-stepper { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; }
  .ch-stepper button {
    all: unset; cursor: pointer; padding: 3px 7px; border-radius: 5px;
    font-size: 10px; color: var(--secondary-text-color); background: var(--pvs-chip-bg);
    transition: color 150ms;
  }
  .ch-stepper button:hover:not([disabled]) { color: var(--primary-text-color); }
  .ch-stepper button[disabled] { opacity: 0.35; cursor: default; }
  .ch-bias {
    font-size: 11px; line-height: 1.5; color: var(--secondary-text-color);
    padding: 6px 9px; margin-bottom: 12px; border-radius: 6px;
    background: var(--pvs-chip-bg); font-style: italic;
  }
  .ch-grid {
    display: grid; grid-template-columns: minmax(90px, 1fr) auto auto auto;
    gap: 7px 14px; align-items: center; font-size: 12.5px;
  }
  .ch-grid .lab { color: var(--primary-text-color); }
  .ch-grid .lab[data-more-info] { cursor: pointer; text-decoration: underline dotted color-mix(in srgb, currentColor 40%, transparent); text-underline-offset: 3px; }
  .ch-grid .lab.op { color: var(--secondary-text-color); padding-left: 12px; }
  .ch-grid .fac { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; }
  .ch-grid .eff { text-align: right; color: var(--secondary-text-color); font-size: 11.5px; }
  .ch-grid .val { text-align: right; white-space: nowrap; }
  .ch-grid .val .v { font-size: 14px; }
  .ch-grid .val.dim .v { color: var(--secondary-text-color); font-size: 12.5px; }
  .ch-grid .val .unit { font-size: 10px; color: var(--secondary-text-color); margin-left: 4px; }
  .ch-grid .pub { font-weight: 700; }
  .ch-grid .val.pub { border-top: 1px solid var(--pvs-hairline); padding-top: 7px; }
  .ch-grid .val.pub .v { font-size: 16px; color: var(--pvs-model); }
  .ch-grid .lab.pub { border-top: 1px solid var(--pvs-hairline); padding-top: 7px; }
  .ch-grid .meas { color: var(--pvs-measure); font-weight: 600; margin-top: 4px; }
  .ch-grid .meas-val { grid-column: 2 / 5; text-align: right; margin-top: 4px; white-space: nowrap; }
  .ch-grid .meas-val .v { font-size: 15px; color: var(--pvs-measure); }
  .ch-grid .meas-val .unit { font-size: 10px; color: var(--secondary-text-color); margin-left: 4px; }
  .delta { font-family: var(--pvs-mono); font-size: 11.5px; margin-left: 10px; }
  .delta.up { color: var(--success-color, #0ca30c); }
  .delta.down { color: var(--error-color, #d03b3b); }
  .ch-mismatch {
    grid-column: 1 / 5; font-size: 11.5px; line-height: 1.5; padding: 7px 9px;
    border-radius: 6px; color: var(--primary-text-color);
    background: color-mix(in srgb, var(--error-color, #d03b3b) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--error-color, #d03b3b) 40%, transparent);
  }
`;

/* ========================= SECTION: CARD:DAILY =========================== */

class PvsDailyCard extends PvsBaseCard {
  setConfig(config) {
    this._data = null;
    this._problem = null;
    super.setConfig(config ?? {});
  }
  getCardSize() { return 4; }
  getGridOptions() { return { columns: 12, min_columns: 6, rows: "auto" }; }
  _shouldUpdate(prev) { return !prev; } // recorder data; no per-state refresh

  async _load() {
    const hass = this._hass, cfg = this._config;
    if (this._loading) return;
    this._loading = true;
    const token = ++this._renderToken;
    try {
      const m = await getRegistryModel(hass);
      const info = m.byEntityId.get(cfg.entity);
      if (!info) { this._problem = { reason: t(hass, "entity_missing", { entity: cfg.entity }) }; return; }
      const isString = info.level === "string";
      const tomorrowKey = isString ? "string_forecast_tomorrow" : "forecast_tomorrow";
      const producedKey = isString ? "string_produced_today" : "produced_today";
      const tomorrowId = info.node.byKey[tomorrowKey];
      const producedId = info.node.byKey[producedKey];
      if (!tomorrowId || !producedId) {
        this._problem = {
          entity: cfg.entity,
          reason: `${t(hass, "not_available")}: ${!tomorrowId ? tomorrowKey : producedKey}`,
        };
        return;
      }
      // issue hour from the plant's day-ahead sensors (fallback 18)
      let issueHour = 18;
      for (const key of ["wmape_day_ahead_30d", "wmape_day_ahead_7d", "deviation_yesterday"]) {
        const id = await plantSibling(hass, cfg.entity, key);
        const v = id && hass.states[id]?.attributes?.issue_hour_local;
        if (typeof v === "number") { issueHour = v; break; }
      }
      const days = cfg.days ?? 14;
      const plantTomorrowId = isString
        ? await plantSibling(hass, cfg.entity, "forecast_tomorrow") : null;
      const [actualRows, issued, plantIssued] = await Promise.all([
        dailyActuals(hass, producedId, days),
        issuedForecasts(hass, tomorrowId, days, issueHour),
        plantTomorrowId ? issuedForecasts(hass, plantTomorrowId, days, issueHour) : null,
      ]);
      if (token !== this._renderToken) return;
      const actualByDay = new Map();
      for (const r of actualRows) {
        if (r.change != null) actualByDay.set(localParts(hass, r.startMs).dayKey, r.change);
      }
      const out = [];
      const todayKey = localParts(hass, Date.now()).dayKey;
      for (let back = days - 1; back >= 0; back--) {
        const dayMs = localMidnightMs(hass, Date.now(), back) + 12 * 3600000;
        const dayKey = localParts(hass, dayMs).dayKey;
        const evePrevKey = localParts(hass, localMidnightMs(hass, Date.now(), back + 1) + 12 * 3600000).dayKey;
        let soll = issued.get(evePrevKey) ?? null;
        // string_forecast_tomorrow publishes 0.0 instead of None when no rows
        // exist; the plant-level bucket is the tie-breaker (known limitation).
        const plantMissing = plantIssued ? !plantIssued.has(evePrevKey) : false;
        const noIssue = soll == null || (isString && plantMissing);
        if (noIssue) soll = null;
        out.push({
          dayMs, dayKey, evePrevKey, soll,
          ist: actualByDay.get(dayKey) ?? null,
          isToday: dayKey === todayKey,
        });
      }
      const anyStats = actualRows.length > 0 || issued.size > 0;
      this._data = { rows: out, issueHour, tomorrowId, producedId, anyStats };
      this._problem = anyStats ? null
        : { entity: `${tomorrowId}, ${producedId}`, reason: t(hass, "stats_unavailable", { entity: `${tomorrowId} / ${producedId}` }) };
    } catch (e) {
      this._problem = { reason: String(e) };
    } finally {
      this._loading = false;
      if (token === this._renderToken) this._render();
    }
  }

  _render() {
    const hass = this._hass, cfg = this._config;
    if (!hass || !cfg) return;
    const card = (inner) => {
      this.shadowRoot.innerHTML = `<style>${BASE_CSS}${DAILY_CSS}</style><ha-card>${inner}<div class="pvs-tip"></div></ha-card>`;
      this._wire();
    };
    if (!cfg.entity) return card(problemHTML(hass, { reason: t(hass, "no_entity_config") }));
    if (!hass.states[cfg.entity]) return card(problemHTML(hass, { reason: t(hass, "entity_missing", { entity: cfg.entity }) }));
    const title = cfg.title ?? `${hass.states[cfg.entity].attributes.friendly_name?.split(" Prognose")[0]?.split(" Forecast")[0] ?? ""} — ${t(hass, "daily_title")}`;

    if (!this._data && !this._problem) {
      this._load();
      return card(`<div class="pvs-head"><span class="pvs-title">${esc(title)}</span></div>
        <div class="pvs-sub">…</div>`);
    }
    if (this._problem) return card(problemHTML(hass, this._problem));

    const { rows, issueHour, tomorrowId, producedId } = this._data;
    let maxV = 0;
    for (const r of rows) maxV = Math.max(maxV, r.soll ?? 0, r.ist ?? 0);
    const yMax = niceMax(maxV * 1.05 || 1);
    const SW = 30, BW = 11, PAD_L = 30, PAD_R = 4, PAD_T = 8, PAD_B = 22, PH = 120;
    const W = PAD_L + rows.length * SW + PAD_R, H = PAD_T + PH + PAD_B;
    const yOf = (v) => PAD_T + PH - (v / yMax) * PH;

    let bars = "", hits = "", labels = "";
    rows.forEach((r, i) => {
      const x0 = PAD_L + i * SW;
      if (r.soll != null && r.soll > 0) {
        bars += `<rect x="${x0 + SW / 2 - BW - 1}" y="${yOf(r.soll)}" width="${BW}"
          height="${Math.max(1, PAD_T + PH - yOf(r.soll))}" rx="2" fill="var(--pvs-model)"/>`;
      } else if (r.soll == null) {
        bars += `<rect x="${x0 + SW / 2 - BW - 1}" y="${PAD_T + PH - 14}" width="${BW}" height="14"
          rx="2" fill="var(--pvs-unobserved)"/>
          <rect x="${x0 + SW / 2 - BW - 1}" y="${PAD_T + PH - 14}" width="${BW}" height="14"
          rx="2" fill="url(#pvs-hatch-d)"/>`;
      }
      if (r.ist != null && r.ist > 0) {
        const iy = yOf(r.ist);
        bars += `<rect x="${x0 + SW / 2 + 1}" y="${iy}" width="${BW}"
          height="${Math.max(1, PAD_T + PH - iy)}" rx="2" fill="var(--pvs-measure)"/>`;
        if (r.isToday) {
          bars += `<rect x="${x0 + SW / 2 + 1}" y="${iy}" width="${BW}"
            height="${Math.min(8, PAD_T + PH - iy)}" fill="url(#pvs-hatch-d)"/>`;
        }
      }
      if (i % 2 === (rows.length - 1) % 2) {
        labels += `<text x="${x0 + SW / 2}" y="${H - 8}" text-anchor="middle">${fmtDayShort(hass, r.dayMs)}</text>`;
      }
      hits += `<rect class="hit" x="${x0}" y="${PAD_T}" width="${SW}" height="${PH}"
        fill="transparent" data-day='${esc(JSON.stringify(r))}'/>`;
    });

    let yaxis = "";
    for (const v of [0, yMax / 2, yMax]) {
      yaxis += `<line class="grid" x1="${PAD_L}" y1="${yOf(v)}" x2="${W - PAD_R}" y2="${yOf(v)}"/>
        <text class="axis" x="${PAD_L - 4}" y="${yOf(v) + 3}" text-anchor="end">${fmtNum(hass, v, 0)}</text>`;
    }

    const scored = rows.filter((r) => r.soll != null && r.ist != null && !r.isToday);
    const sumSoll = scored.reduce((s, r) => s + r.soll, 0);
    const sumIst = scored.reduce((s, r) => s + r.ist, 0);
    const wabs = sumIst > 0
      ? scored.reduce((s, r) => s + Math.abs(r.ist - r.soll), 0) / sumIst * 100 : null;

    const legend = `<div class="pvs-legend">
      <span class="it"><span class="sw" style="background:var(--pvs-model)"></span>${t(hass, "daily_soll")}</span>
      <span class="it"><span class="sw" style="background:var(--pvs-measure)"></span>${t(hass, "daily_ist")}</span>
      <span class="it"><svg width="14" height="10"><rect width="14" height="10" rx="2" fill="var(--pvs-unobserved)"/><rect width="14" height="10" rx="2" fill="url(#pvs-hatch-dl)"/></svg>${t(hass, "daily_no_issue")}</span>
      ${scored.length ? `<span class="it" style="margin-left:auto">${t(hass, "daily_window_sum", { n: scored.length, soll: fmtKwh(hass, sumSoll, 1), ist: fmtKwh(hass, sumIst, 1) })}${wabs != null ? ` · ${t(hass, "daily_wabs")} <span class="pvs-num">${fmtNum(hass, wabs, 1)} %</span>` : ""}</span>` : ""}
    </div>`;

    card(`
      <div class="pvs-head">
        <span class="pvs-title">${esc(title)}</span>
        <span class="pvs-chip clickable" data-more-info="${tomorrowId}" title="${esc(t(hass, "more_info"))}: ${tomorrowId}">${t(hass, "daily_soll").split(" ")[0]} ↗</span>
        <span class="pvs-chip clickable" data-more-info="${producedId}" title="${esc(t(hass, "more_info"))}: ${producedId}">${t(hass, "daily_ist")} ↗</span>
      </div>
      <div class="d-wrap"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="aspect-ratio:${W}/${H}">
        <defs>${hatchPattern("pvs-hatch-d")}${hatchPattern("pvs-hatch-dl")}</defs>
        ${yaxis}${bars}${hits}
      </svg></div>
      ${legend}`);
  }

  _wire() {
    this._wireMoreInfo();
    if (this._wired) return;
    this._wired = true;
    wireTooltip(this, {
      selector: ".hit",
      content: (el) => {
        const hass = this._hass;
        const r = JSON.parse(el.getAttribute("data-day"));
        const delta = (r.soll != null && r.ist != null) ? r.ist - r.soll : null;
        const issueHour = this._data?.issueHour ?? 18;
        return `<div class="h">${fmtWeekday(hass, r.dayMs)} ${fmtDayShort(hass, r.dayMs)}${r.isToday ? ` · ${t(hass, "day_running")}` : ""}</div>
          <div class="r"><span class="k">${t(hass, "daily_soll")}</span><span class="v">${r.soll == null ? "—" : fmtKwh(hass, r.soll)}</span></div>
          <div class="r"><span class="k">${t(hass, "daily_ist")}</span><span class="v">${r.ist == null ? "—" : fmtKwh(hass, r.ist)}</span></div>
          ${delta != null && !r.isToday ? `<div class="r"><span class="k">Δ</span><span class="v">${fmtSigned(hass, delta)} kWh (${fmtSigned(hass, r.soll > 0 ? delta / r.soll * 100 : 0, 0)} %)</span></div>` : ""}
          ${r.soll == null ? `<div class="pvs-sub">${t(hass, "daily_no_issue")}</div>` : `<div class="pvs-sub">${t(hass, "daily_provenance", { entity: "forecast_tomorrow", date: r.evePrevKey, hour: issueHour })}</div>`}`;
      },
    });
  }

  static getConfigElement() { return document.createElement("pvstrings-daily-editor"); }
  static getStubConfig(hass, entities) {
    const guess = (entities ?? []).find((e) =>
      Array.isArray(hass.states[e]?.attributes?.forecast));
    return { entity: guess ?? "", days: 14 };
  }
}

const DAILY_CSS = `
  .d-wrap svg { width: 100%; height: auto; display: block; }
  .hit { cursor: crosshair; }
`;

/* ======================== SECTION: CARD:KVTABLE ========================== */

// Generic attribute renderer for the nerd view: every table header links to
// its source entity (rule 2 — Markdown tables cannot do that).
const WEATHERS = ["clear", "partly_cloudy", "overcast", "rain"];
const DAYPARTS = ["morning", "midday", "afternoon"];

class PvsKvTableCard extends PvsBaseCard {
  getCardSize() { return 3; }
  // Row-based modes (sky_overview, conversion) read entities beyond
  // cfg.entity — watch them all, or later rows render stale.
  watchedEntities() {
    const ids = this._config?.entity ? [this._config.entity] : [];
    for (const r of this._config?.rows ?? []) ids.push(r.sky, r.shading, r.out, r.dc);
    return ids.filter(Boolean);
  }

  // missingKey: the plant table's absent bucket really was never seen; the
  // string x daypart layer publishes only buckets past their activation
  // threshold, so an absent cell there may hold plenty of evidence.
  _factorCell(hass, cell, missingKey = "nerd_bucket_missing") {
    if (!cell) return `<td class="miss">${t(hass, missingKey)}</td>`;
    const dev = Math.abs(cell.factor - 1);
    const tone = dev > 0.15 ? "hot" : dev > 0.05 ? "warm" : "";
    return `<td class="${tone}"><span class="pvs-num">${fmtNum(hass, cell.factor, 3)}</span>
      <span class="n">n ${fmtNum(hass, cell.n_eff, 1)}</span></td>`;
  }

  async _stringNames() {
    // string_id (subentry ULID) -> display name, via device identifiers
    if (this._names) return this._names;
    const hass = this._hass;
    const names = new Map();
    try {
      const devices = await hass.callWS({ type: "config/device_registry/list" });
      for (const d of devices) {
        if (d.model !== "PV string" && d.model !== "Curtailment group") continue;
        for (const ident of d.identifiers ?? []) {
          if (ident[0] === "pvstrings") {
            const parts = String(ident[1]).split("_");
            if (parts.length >= 2) names.set(parts.slice(1).join("_"), d.name_by_user || d.name);
          }
        }
      }
    } catch (_) { /* ids shown raw */ }
    this._names = names;
    this._render();
    return names;
  }

  // Entry diagnostics -> data.conversion_evidence (+ scope display names).
  // Resolved once per card instance; the underlying download is capped at
  // 5 minutes by cachedWS, so state churn does not refetch it.
  async _loadConversionEvidence() {
    if (this._convEv) return;
    this._convEv = "loading";
    let out = { error: "unavailable" };
    try {
      const hass = this._hass;
      const m = await getRegistryModel(hass);
      const info = m.byEntityId.get(this._config.entity);
      const entryId = info?.node?.entryId ?? m.plants[0]?.entryId ?? null;
      const res = await conversionEvidence(hass, entryId);
      if (res.evidence && Object.keys(res.evidence).length)
        out = { names: await this._stringNames(), evidence: res.evidence };
      else if (!res.evidence) out = { error: "none" };
      else out = res;
    } catch (_) { /* stays unavailable -> withheld */ }
    this._convEv = out;
    this._render();
  }

  _render() {
    const hass = this._hass, cfg = this._config;
    if (!hass || !cfg) return;
    const card = (inner) => {
      this.shadowRoot.innerHTML = `<style>${BASE_CSS}${KV_CSS}</style><ha-card>${inner}</ha-card>`;
      this._wireMoreInfo();
    };
    if (!cfg.entity) return card(problemHTML(hass, { reason: t(hass, "no_entity_config") }));
    const st = hass.states[cfg.entity];
    if (!st) return card(problemHTML(hass, { reason: t(hass, "entity_missing", { entity: cfg.entity }) }));
    const a = st.attributes;
    const mode = cfg.mode ?? "generic";
    const title = cfg.title ?? a.friendly_name ?? cfg.entity;
    const head = `<div class="pvs-head">
      <span class="pvs-title kv-t clickable" data-more-info="${cfg.entity}">${esc(title)}</span>
    </div>`;
    const empty = (path) => card(head + withheldHTML(t(hass, "kv_empty", { path, entity: cfg.entity })));

    let body = "";
    if (mode === "log_ratio_plant") {
      const buckets = a.log_ratio?.plant;
      if (!buckets) return empty("log_ratio.plant");
      body = `<table><tr><th></th>${DAYPARTS.map((d) => `<th>${t(hass, "daypart_" + d)}</th>`).join("")}</tr>
        ${WEATHERS.map((w) => `<tr><th>${t(hass, "weather_" + w)}</th>
          ${DAYPARTS.map((d) => this._factorCell(hass, buckets[`${w}|${d}`])).join("")}</tr>`).join("")}</table>`;
    } else if (mode === "log_ratio_strings" || mode === "log_ratio_string_daypart") {
      const src = mode === "log_ratio_strings" ? a.log_ratio?.string : a.log_ratio?.string_daypart;
      if (!src || !Object.keys(src).length) return empty(`log_ratio.${mode === "log_ratio_strings" ? "string" : "string_daypart"}`);
      const names = this._names ?? (this._stringNames(), new Map());
      if (mode === "log_ratio_strings") {
        body = `<table>${Object.entries(src).map(([id, c]) =>
          `<tr><th>${esc(names.get(id) ?? id.slice(0, 8))}</th>${this._factorCell(hass, c)}</tr>`).join("")}</table>`;
      } else {
        const ids = [...new Set(Object.keys(src).map((k) => k.split("|")[0]))];
        body = `<table><tr><th></th>${DAYPARTS.map((d) => `<th>${t(hass, "daypart_" + d)}</th>`).join("")}</tr>
          ${ids.map((id) => `<tr><th>${esc(names.get(id) ?? id.slice(0, 8))}</th>
            ${DAYPARTS.map((d) => this._factorCell(hass, src[`${id}|${d}`], "nerd_bucket_below")).join("")}</tr>`).join("")}</table>`;
      }
    } else if (mode === "ghi_bias") {
      const src = a.ghi_bias;
      if (!src || !Object.keys(src).length) return empty("ghi_bias");
      const horizons = ["0-6h", "6-24h", "24-48h", "48h+"];
      const hours = [...new Set(Object.keys(src).map((k) => k.split("|")[0]))].sort();
      const truth = a.truth_source
        ?? hass.states[cfg.truth_entity ?? ""]?.attributes?.truth_source;
      body = `${truth ? `<div class="kv-note ${truth === "measured" ? "" : "warn"}">${truth === "measured" ? "✓ " + t(hass, "nerd_truth_measured") : "⚠︎ " + t(hass, "nerd_truth_nowcast")}</div>` : ""}
        <table><tr><th></th>${horizons.map((h) => `<th>${h}</th>`).join("")}</tr>
        ${hours.map((h) => `<tr><th class="pvs-num">${h}:00</th>
          ${horizons.map((hz) => this._factorCell(hass, src[`${h}|${hz}`])).join("")}</tr>`).join("")}</table>`;
    } else if (mode === "skip_reasons") {
      const lc = a.last_learn_cycle;
      if (!lc) return empty("last_learn_cycle");
      const skips = lc.skipped_because ?? {};
      const rows = Object.entries(skips).sort((x, y) => y[1] - x[1]);
      body = `<table>
        ${["hours_materialised", "observations_used", "observations_skipped", "censored_hours"]
          .filter((k) => lc[k] !== undefined)
          .map((k) => `<tr><th>${k.replaceAll("_", " ")}</th><td><span class="pvs-num">${lc[k]}</span></td></tr>`).join("")}
        ${rows.length ? `<tr><th colspan="2" class="kv-sect">skipped_because</th></tr>` : ""}
        ${rows.map(([k, v]) => `<tr><th class="dim">${esc(k)}</th><td><span class="pvs-num">${v}</span></td></tr>`).join("")}
      </table>`;
    } else if (mode === "censoring") {
      const strings = a.strings;
      if (!strings) return empty("strings");
      body = `<table><tr><th></th><th>${t(hass, "vk_measured")}</th><th>${t(hass, "vk_lower_bound")}</th><th>${t(hass, "vk_reconstructed")}</th><th>${t(hass, "cens_coverage")}</th><th>${t(hass, "cens_curtailed")}</th></tr>
        ${Object.entries(strings).map(([name, s]) => {
          const vk = s.today?.value_kinds ?? {};
          return `<tr><th>${esc(name)}</th>
            <td><span class="pvs-num">${vk.measured ?? 0}</span></td>
            <td class="${(vk.lower_bound ?? 0) > 0 ? "warm" : ""}"><span class="pvs-num">${vk.lower_bound ?? 0}</span></td>
            <td class="${(vk.reconstructed ?? 0) > 0 ? "warm" : ""}"><span class="pvs-num">${vk.reconstructed ?? 0}</span></td>
            <td><span class="pvs-num">${s.today?.coverage_mean != null ? fmtNum(hass, s.today.coverage_mean * 100, 0) + "%" : "—"}</span></td>
            <td><span class="pvs-num">${s.today?.curtailed_fraction != null ? fmtNum(hass, s.today.curtailed_fraction * 100, 0) + "%" : "—"}</span></td></tr>`;
        }).join("")}</table>`;
    } else if (mode === "collector") {
      const keys = ["intervals_written", "events_seen", "write_errors", "watchdog_ticks", "last_flush_duration_ms"];
      body = `<table>
        ${keys.filter((k) => a[k] !== undefined).map((k) =>
          `<tr><th>${k.replaceAll("_", " ")}</th><td class="${k === "write_errors" && a[k] > 0 ? "hot" : ""}"><span class="pvs-num">${a[k]}</span></td></tr>`).join("")}
        ${a.last_error ? `<tr><th class="dim">last error</th><td class="hot">${esc(a.last_error)}</td></tr>` : ""}
        ${a.weather_ok === false ? `<tr><th class="dim">weather</th><td class="hot">${esc(a.weather_error ?? "error")}</td></tr>` : ""}
        ${a.coverage_last ? `<tr><th colspan="2" class="kv-sect">coverage_last</th></tr>` : ""}
        ${Object.entries(a.coverage_last ?? {}).map(([id, v]) =>
          `<tr><th class="dim">${esc((this._names?.get(id)) ?? (this._stringNames(), id.slice(0, 8)))}</th>
           <td class="${v < 0.8 ? "warm" : ""}"><span class="pvs-num">${fmtNum(hass, v * 100, 0)} %</span></td></tr>`).join("")}
      </table>`;
    } else if (mode === "sky_overview") {
      const rows2 = (cfg.rows ?? []).map((r) => {
        const sky = hass.states[r.sky], sh = hass.states[r.shading];
        const sa2 = sky?.attributes;
        const lvl = sa2?.level;
        const fit2 = sa2 ? t(hass, sa2.fit_method === "differential"
          ? "sky_fit_differential" : "sky_fit_absolute") : null;
        const worst = sh?.attributes?.most_shaded?.[0];
        const sector = worst?.sector?.replace("|", "° · ").replace(/-/g, "–") ?? null;
        return `<tr><th class="clickable" data-more-info="${r.sky}">${esc(r.name)}</th>
          <td><span class="pvs-num">${sa2?.cells?.length ?? "—"}</span></td>
          <td>${lvl != null
            ? `<span class="pvs-num">${fmtNum(hass, lvl, 2)}</span> <span class="n">${fit2}</span>`
            : `<span class="n">${fit2 ?? "—"}</span>`}</td>
          <td>${worst ? `<span class="pvs-num" style="white-space:nowrap">${esc(sector)}°</span> <span class="n">${fmtNum(hass, worst.shading_pct, 0)}%</span>` : "—"}</td></tr>`;
      }).join("");
      body = `<table><tr><th></th><th>cells</th><th>${t(hass, "sky_level")}</th><th>max</th></tr>${rows2}</table>`;
    } else if (mode === "conversion") {
      // Curves are configured (datasheet/custom) or absent (neutral) — they
      // are not learned, so this table shows configuration + realized ratio,
      // never a training progress. `stages` has no contracted shape yet:
      // render defensively.
      const rows3 = (cfg.rows ?? []).map((r) => {
        const o = hass.states[r.out], d = hass.states[r.dc];
        const oa = o?.attributes ?? {};
        const pathTxt = oa.output_path
          ? t(hass, "conv_out_" + (oa.output_path === "storage" ? "storage" : "direct")) : "—";
        const neutral = oa.curve_source === "neutral";
        const curveTxt = curveLabel(hass, oa.curve_source, oa.conversion_factor) ?? "—";
        const stages = oa.stages;
        const stagesTxt = stages == null ? "—"
          : Array.isArray(stages)
            ? esc(stages.map((s) => s?.name ?? s?.kind ?? (typeof s === "string" ? s : "")).filter(Boolean).join(" → ") || String(stages.length))
            : `<span class="dim">${esc(JSON.stringify(stages).slice(0, 60))}</span>`;
        const ratio = !neutral && oa.today_kwh != null && d?.attributes?.today_kwh > 0
          ? oa.today_kwh / d.attributes.today_kwh : null;
        return `<tr><th class="clickable" data-more-info="${r.out}">${esc(r.name)}</th>
          <td>${pathTxt}</td>
          <td>${curveTxt}</td>
          <td>${stagesTxt}</td>
          <td>${oa.clipped_kwh > 0 ? `<span class="pvs-num">${fmtNum(hass, oa.clipped_kwh, 2)}</span> kWh` : "—"}</td>
          <td>${neutral ? `<span class="dim">${t(hass, "conv_curve_neutral")}</span>`
            : ratio != null ? `<span class="pvs-num">${fmtNum(hass, ratio * 100, 1)} %</span>` : "—"}</td></tr>`;
      }).join("");
      body = `<table><tr><th></th><th>${t(hass, "conv_path")}</th><th>${t(hass, "conv_curve")}</th><th>${t(hass, "conv_stages")}</th><th>${t(hass, "conv_clipped_col")}</th><th>${t(hass, "conv_today_col")}</th></tr>${rows3}</table>`;
    } else if (mode === "conversion_evidence") {
      // The collector's learning pairs (rows written / usable after the
      // censoring gate), from entry diagnostics. "not yet" and "nothing"
      // must not look alike: usable trailing rows is the gate working; a
      // 0/0 row is configured-but-silent — a real warning.
      const d = this._convEv;
      if (!d || d === "loading") {
        this._loadConversionEvidence();
        body = `<div class="kv-note dim">${t(hass, "conv_ev_loading")}</div>`;
      } else if (d.error === "admin") {
        body = `<div class="kv-note warn">${t(hass, "conv_ev_admin")}</div>`;
      } else if (d.error) {
        // network/endpoint trouble: unknown state, never claim "nothing"
        body = `<div class="kv-note warn">${t(hass, "conv_ev_unavailable")}</div>`;
      } else {
        const stageTxt = { inverter: t(hass, "conv_stage_inverter"),
          mppt: t(hass, "conv_stage_mppt") };
        const rows4 = Object.entries(d.evidence).map(([k, v]) => {
          const [scope, stage] = k.split("|");
          const name = d.names.get(scope) ?? scope.slice(0, 8);
          const silent = v.rows === 0;
          const pct = v.rows > 0 ? Math.round((Math.min(v.usable, v.rows) / v.rows) * 100) : 0;
          return `<tr>
            <th>${esc(name)}</th>
            <td><span class="n">${stageTxt[stage] ?? esc(stage)}</span></td>
            <td class="${silent ? "hot" : ""}"><span class="pvs-num">${v.usable}</span> / <span class="pvs-num">${v.rows}</span></td>
            <td style="width:35%"><div class="ev-bar"><div style="width:${pct}%"></div></div></td>
          </tr>`;
        }).join("");
        body = `<table><tr><th></th><th>${t(hass, "conv_ev_stage")}</th>
            <th>${t(hass, "conv_ev_pairs")}</th><th></th></tr>${rows4}</table>
          <div class="kv-note">${t(hass, "conv_ev_note")}</div>`;
      }
    } else {
      // generic: dot-path into attributes -> k/v table
      let obj = a;
      for (const p of (cfg.path ?? "").split(".").filter(Boolean)) obj = obj?.[p];
      if (obj == null || typeof obj !== "object") return empty(cfg.path ?? "(root)");
      body = `<table>${Object.entries(obj).map(([k, v]) =>
        `<tr><th>${esc(k)}</th><td>${typeof v === "object" ? `<span class="dim">${esc(JSON.stringify(v))}</span>` : `<span class="pvs-num">${esc(v)}</span>`}</td></tr>`).join("")}</table>`;
    }
    card(head + `<div class="kv-scroll">${body}</div>`);
  }

  static getConfigElement() { return document.createElement("pvstrings-chain-editor"); }
  static getStubConfig() { return { entity: "", mode: "generic" }; }
}

const KV_CSS = `
  .kv-scroll { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 11.5px; }
  th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--pvs-hairline); }
  th { color: var(--secondary-text-color); font-weight: 500; }
  tr > th:first-child { white-space: nowrap; }
  td { color: var(--primary-text-color); }
  td .n { color: var(--secondary-text-color); font-size: 10px; margin-left: 5px; }
  td.miss { color: var(--secondary-text-color); font-style: italic; opacity: 0.7; }
  td.warm { background: color-mix(in srgb, var(--warning-color, #ffa600) 9%, transparent); }
  td.hot { background: color-mix(in srgb, var(--error-color, #d03b3b) 10%, transparent); }
  .kv-t { font-size: 13px; }
  .kv-t.clickable { cursor: pointer; }
  .kv-sect { padding-top: 10px; font-size: 10px; letter-spacing: 0.6px; text-transform: uppercase; }
  .kv-note { font-size: 11px; padding: 5px 8px; border-radius: 6px; background: var(--pvs-chip-bg); color: var(--secondary-text-color); margin-bottom: 8px; }
  .kv-note.warn { background: color-mix(in srgb, var(--warning-color, #ffa600) 12%, transparent); color: var(--primary-text-color); }
  th.dim, .dim { color: var(--secondary-text-color); font-weight: 400; }
  .ev-bar { height: 8px; border-radius: 4px; background: var(--pvs-hairline);
    overflow: hidden; min-width: 70px; }
  .ev-bar > div { height: 100%; border-radius: 4px; background: var(--pvs-model); }
`;

/* ========================= SECTION: CARD:MATURITY ======================== */

// How far along the training is, on two axes with deliberately different
// clocks: weather buckets fill within weeks, the sky map can only fill as
// fast as the calendar moves the sun. One blended number would hide that.
//
// Mirrors learning.py: HALFLIFE = 15 effective observations, so a bucket's
// n_eff converges on 1/ALPHA ≈ 22 and stops there — "full" is a real,
// reachable ceiling, not an asymptote.
const MATURITY_MAX_N_EFF = 1 / (1 - 0.5 ** (1 / 15));

class PvsMaturityCard extends PvsBaseCard {
  getCardSize() { return 2; }
  getGridOptions() { return { columns: "full", rows: "auto" }; }
  watchedEntities() {
    return [this._config?.entity, ...(this._config?.rows ?? []).map((r) => r.sky)]
      .filter(Boolean);
  }

  _render() {
    const hass = this._hass, cfg = this._config;
    if (!hass || !cfg) return;

    // weather axis: evidence held across all plant buckets, vs the ceiling
    const buckets = (cfg.entity ? hass.states[cfg.entity] : null)?.attributes?.log_ratio?.plant;
    let weather = null;
    if (buckets) {
      const total = WEATHERS.length * DAYPARTS.length;
      let sum = 0, seen = 0;
      for (const w of WEATHERS) for (const d of DAYPARTS) {
        const c = buckets[`${w}|${d}`];
        if (c?.n_eff > 0) { seen++; sum += Math.min(1, c.n_eff / MATURITY_MAX_N_EFF); }
      }
      weather = { pct: (sum / total) * 100, seen, total };
    }

    // shading axis: observed pooled sky cells vs the year's sun path
    const lat = hass.config?.latitude;
    const annual = lat != null ? annualSkyCells(lat) : null;
    const perString = (cfg.rows ?? []).map((r) => {
      const sky = hass.states[r.sky];
      if (!sky || !annual) return null;
      const pooled = (sky.attributes?.cells ?? []).filter((c) => c.season == null).length;
      return { name: r.name, id: r.sky, pct: Math.min(100, (pooled / annual) * 100) };
    }).filter(Boolean);
    const shading = perString.length
      ? { pct: perString.reduce((s, x) => s + x.pct, 0) / perString.length } : null;

    // goodAt: the point that in practice counts as fully learned. Weather
    // buckets never average near 100 (forgetting keeps rare buckets low), so
    // the tick shows the real target; a sky map genuinely can fill up.
    const bar = (label, m, sub, moreInfo, goodAt, tick) => {
      const good = m != null && m.pct >= goodAt;
      return `
      <div class="mat-axis">
        <div class="mat-row">
          <span class="mat-label${moreInfo ? " clickable" : ""}"${moreInfo ? ` data-more-info="${moreInfo}"` : ""}>${esc(label)}</span>
          <span class="mat-pct pvs-num${good ? " good" : ""}">${m == null ? "—" : fmtNum(hass, m.pct, 0) + " %"}</span>
        </div>
        <div class="mat-track">
          <div class="mat-fill${good ? " good" : ""}" style="width:${m == null ? 0 : Math.max(1.5, m.pct)}%"></div>
          ${tick ? `<div class="mat-tick" style="left:${goodAt}%"></div>` : ""}
        </div>
        <div class="pvs-sub">${sub}</div>
      </div>`;
    };

    const wSub = weather
      ? t(hass, "maturity_buckets", { seen: weather.seen, total: weather.total })
      : t(hass, "kv_empty", { path: "log_ratio.plant", entity: cfg.entity ?? "model_observations" });
    const sSub = !annual
      ? t(hass, "maturity_no_lat")
      : perString.map((s) =>
          `<span class="mat-chip clickable" data-more-info="${s.id}">${esc(s.name)} · <span class="pvs-num">${fmtNum(hass, s.pct, 0)} %</span></span>`,
        ).join("") || t(hass, "kv_empty", { path: "cells", entity: "sky_map" });

    this.shadowRoot.innerHTML = `<style>${BASE_CSS}${MATURITY_CSS}</style><ha-card>
      <div class="mat-wrap">
        ${bar(t(hass, "maturity_weather"), weather, wSub, cfg.entity, 85, true)}
        ${bar(t(hass, "maturity_shading"), shading, sSub, null, 95, false)}
      </div></ha-card>`;
    this._wireMoreInfo();
  }

  static getConfigElement() { return document.createElement("pvstrings-chain-editor"); }
  static getStubConfig() { return { entity: "", rows: [] }; }
}

const MATURITY_CSS = `
  .mat-wrap { display: flex; gap: 28px; padding: 14px 16px; flex-wrap: wrap; }
  .mat-axis { flex: 1 1 240px; min-width: 0; }
  .mat-row { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 6px; }
  .mat-label { font-size: 13px; font-weight: 500; }
  .mat-label.clickable { cursor: pointer; }
  .mat-pct { font-size: 15px; font-weight: 600; }
  .mat-track { position: relative; height: 6px; border-radius: 3px; background: var(--pvs-unobserved); }
  .mat-fill { height: 100%; border-radius: 3px; background: var(--pvs-model); }
  .mat-fill.good { background: var(--success-color, #43a047); }
  .mat-pct.good { color: var(--success-color, #43a047); }
  .mat-tick { position: absolute; top: -3px; bottom: -3px; width: 2px; border-radius: 1px;
    background: color-mix(in srgb, var(--primary-text-color, #212121) 40%, transparent); }
  .mat-axis .pvs-sub { margin-top: 7px; line-height: 1.7; }
  .mat-chip { display: inline-block; margin-right: 10px; cursor: pointer; }
`;

/* ========================== SECTION: STRATEGY ============================ */

function mdCard(content) { return { type: "markdown", content }; }
function heading(text, style = "title") { return { type: "heading", heading: text, heading_style: style }; }

function tileOrMissing(hass, lang, node, key, extra = {}) {
  const id = node?.byKey?.[key];
  if (!id) return mdCard(t(lang, "missing_card", { key }));
  // Strip the device-name prefix: the section heading already names the
  // device, and full friendly names truncate in tiles.
  let name = extra.name;
  if (!name) {
    const friendly = hass.states[id]?.attributes?.friendly_name ?? "";
    if (node.name && friendly.startsWith(node.name)) {
      name = friendly.slice(node.name.length).trim();
    }
  }
  return { type: "tile", entity: id, ...(name ? { name } : {}), ...extra };
}

// For OPTIONAL entities (conversion layer): not configured means the entity
// does not exist, and nothing should appear — that is not a missing_card
// case, which is reserved for entities the contract promises.
function tileIf(hass, lang, node, key, extra = {}) {
  return node?.byKey?.[key] ? tileOrMissing(hass, lang, node, key, extra) : null;
}

async function buildViews(hass, config) {
  const lang = langOf(hass);
  const model = await getRegistryModel(hass);
  if (!model.plants.length) {
    return [{
      title: "PV Strings", path: "pv-strings",
      sections: [{ type: "grid", cards: [mdCard(t(lang, "strategy_no_integration"))] }],
      type: "sections",
    }];
  }
  const views = [];
  const multi = model.plants.length > 1;
  for (const plant of model.plants) {
    const prefix = multi ? `${plant.name} — ` : "";
    const slug = multi ? plant.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" : "";
    const strings = model.strings.filter((s) => s.plant === plant);
    const groups = model.groups.filter((g) => g.plant === plant);
    const P = (key, extra) => tileOrMissing(hass, lang, plant, key, extra);
    const forecastDays = config?.forecast_days ?? 2;

    // ---- Übersicht ----
    const overviewSections = [
      { type: "grid", column_span: 2, cards: [
        heading(t(lang, "s_today")),
        P("produced_today", { color: "orange" }),
        P("forecast_today"),
        P("forecast_remaining"),
        P("power_now", { color: "orange" }),
        P("potential_now"),
        P("peak_hour_today"),
      ] },
      { type: "grid", column_span: 2, cards: [
        plant.byKey.forecast_today
          ? { type: "custom:pvstrings-forecast", entity: plant.byKey.forecast_today,
              days: forecastDays, show_unshaded: false }
          : mdCard(t(lang, "missing_card", { key: "forecast_today" })),
      ] },
      { type: "grid", cards: [
        heading(t(lang, "s_tomorrow")),
        P("forecast_tomorrow"),
        P("forecast_day_after"),
        P("rain_probability_tomorrow"),
      ] },
    ];
    // ---- conversion layer (>= 1.20, optional): own section right after the
    // forecast chart, deliberately NOT inside the DC groups section — AC and
    // battery charge must never read as summable with the DC tiles.
    const directGroups = groups.filter((g) => g.byKey.group_forecast_ac);
    const storageGroups = groups.filter((g) => g.byKey.group_forecast_battery_charge);
    if (directGroups.length || storageGroups.length || plant.byKey.forecast_ac_today) {
      const convCards = [heading(t(lang, "s_conversion"))];
      convCards.push(...[
        tileIf(hass, lang, plant, "forecast_ac_today"),
        tileIf(hass, lang, plant, "forecast_ac_tomorrow"),
      ].filter(Boolean));
      for (const g of [...directGroups, ...storageGroups]) {
        const outKey = g.byKey.group_forecast_ac ? "group_forecast_ac" : "group_forecast_battery_charge";
        convCards.push(g.byKey.group_forecast_remaining
          ? { type: "custom:pvstrings-conversion", entity: g.byKey[outKey],
              dc_entity: g.byKey.group_forecast_remaining, title: g.name,
              grid_options: { columns: "full" } }
          : mdCard(t(lang, "missing_card", { key: "group_forecast_remaining" })));
      }
      // partial hint: name the strings that are NOT in the AC number, each
      // list labelled by where the energy actually is
      const acSt = plant.byKey.forecast_ac_today ? hass.states[plant.byKey.forecast_ac_today] : null;
      if (acSt?.attributes?.partial) {
        const lines = [];
        const sto = acSt.attributes.storage_strings ?? [];
        const unc = acSt.attributes.unconverted_strings ?? [];
        // names are user-configured — escape before they land in markdown
        if (sto.length) lines.push("- " + t(lang, "conv_partial_storage", { list: esc(sto.join(", ")) }));
        if (unc.length) lines.push("- " + t(lang, "conv_partial_unconverted", { list: esc(unc.join(", ")) }));
        lines.push("- " + t(lang, "conv_never_sum"));
        convCards.push(mdCard(lines.join("\n")));
      }
      overviewSections.splice(2, 0, { type: "grid", column_span: 2, cards: convCards });
    }
    if (groups.length) {
      overviewSections.push({ type: "grid", cards: [
        heading(t(lang, "s_groups")),
        ...groups.map((g) => tileOrMissing(hass, lang, g, "group_forecast_remaining", { name: g.name })),
      ] });
    }
    overviewSections.push({ type: "grid", column_span: 2, cards: [
      heading(t(lang, "s_savings")),
      P("savings_today"), P("savings_month"), P("savings_total"), P("amortisation"),
    ] });
    views.push({
      title: prefix + t(lang, "v_overview"), path: `${slug}overview`,
      icon: "mdi:white-balance-sunny", type: "sections", max_columns: 2,
      sections: overviewSections,
    });

    // ---- Stränge ----
    // The whole-plant Ist/Prognose chart leads the view at double width —
    // no shading series here (a plant has no single sky map).
    const plantLineSection = {
      type: "grid", column_span: 2, cards: [
        heading(plant.name),
        plant.byKey.forecast_today
          ? { type: "custom:pvstrings-forecast", entity: plant.byKey.forecast_today,
              days: 1, style: "line", wide: true, show_unshaded: false, title: plant.name }
          : mdCard(t(lang, "missing_card", { key: "forecast_today" })),
      ],
    };
    views.push({
      title: prefix + t(lang, "v_strings"), path: `${slug}strings`,
      icon: "mdi:solar-panel", type: "sections", max_columns: 2,
      sections: [plantLineSection, ...strings.map((s) => ({
        type: "grid", cards: [
          heading(s.name),
          s.byKey.string_forecast_today
            ? { type: "custom:pvstrings-forecast", entity: s.byKey.string_forecast_today, days: 1, style: "line", title: s.name }
            : mdCard(t(lang, "missing_card", { key: "string_forecast_today" })),
          s.byKey.string_sky_map
            ? { type: "custom:pvstrings-sky-map", entity: s.byKey.string_sky_map }
            : mdCard(t(lang, "missing_card", { key: "string_sky_map" })),
          tileOrMissing(hass, lang, s, "string_shading_now"),
          tileOrMissing(hass, lang, s, "string_produced_today", { color: "orange" }),
          tileOrMissing(hass, lang, s, "string_potential_now"),
        ],
      }))],
    });

    // ---- Genauigkeit ----
    const accSections = [
      // Two paragraphs (nowcast-vs-day-ahead, WMAPE) as two columns — one
      // markdown card would fill only half the spanned section's grid.
      { type: "grid", column_span: 2, cards: t(lang, "acc_note").split("\n\n").map(mdCard) },
      { type: "grid", cards: [
        heading(t(lang, "s_nowcast"), "subtitle"),
        P("wmape_7d"), P("wmape_30d"), P("bias_7d"),
      ] },
      { type: "grid", cards: [
        heading(t(lang, "s_dayahead"), "subtitle"),
        P("wmape_day_ahead_7d"), P("wmape_day_ahead_30d"),
        P("bias_day_ahead_30d"), P("deviation_yesterday"),
      ] },
      { type: "grid", column_span: 2, cards: [
        heading(t(lang, "s_daily"), "subtitle"),
        plant.byKey.forecast_today
          ? { type: "custom:pvstrings-daily", entity: plant.byKey.forecast_today, days: 14 }
          : mdCard(t(lang, "missing_card", { key: "forecast_today" })),
        ...strings.map((s) => s.byKey.string_forecast_today
          ? { type: "custom:pvstrings-daily", entity: s.byKey.string_forecast_today, days: 7, title: s.name }
          : mdCard(t(lang, "missing_card", { key: "string_forecast_today" }))),
      ] },
    ];
    views.push({
      title: prefix + t(lang, "v_accuracy"), path: `${slug}accuracy`,
      icon: "mdi:target", type: "sections", max_columns: 2, sections: accSections,
    });

    // ---- Nerd ----
    const mo = plant.byKey.model_observations;
    const ghi = plant.byKey.ghi_forecast;
    const nerdSections = [];
    nerdSections.push({ type: "grid", column_span: 3, cards: [
      heading(t(lang, "maturity_title")),
      { type: "custom:pvstrings-maturity", ...(mo ? { entity: mo } : {}),
        rows: strings.map((s) => ({ name: s.name, sky: s.byKey.string_sky_map }))
          .filter((r) => r.sky) },
    ] });
    if (mo) {
      nerdSections.push({ type: "grid", cards: [
        heading(t(lang, "nerd_learning")),
        { type: "custom:pvstrings-kv-table", entity: mo, mode: "log_ratio_plant", title: t(lang, "nerd_plant_buckets") },
        { type: "custom:pvstrings-kv-table", entity: mo, mode: "log_ratio_strings", title: t(lang, "nerd_string_offsets") },
        { type: "custom:pvstrings-kv-table", entity: mo, mode: "log_ratio_string_daypart", title: t(lang, "nerd_string_daypart") },
      ] });
      nerdSections.push({ type: "grid", cards: [
        heading(t(lang, "nerd_source_bias")),
        { type: "custom:pvstrings-kv-table", entity: mo, mode: "ghi_bias",
          title: t(lang, "nerd_source_bias"), ...(ghi ? { truth_entity: ghi } : {}) },
        ...(ghi ? [{ type: "tile", entity: ghi }] : []),
      ] });
    } else {
      nerdSections.push({ type: "grid", cards: [mdCard(t(lang, "missing_card", { key: "model_observations" }))] });
    }
    nerdSections.push({ type: "grid", cards: [
      heading(t(lang, "nerd_sky")),
      { type: "custom:pvstrings-kv-table",
        entity: strings[0]?.byKey?.string_sky_map ?? plant.byKey.strings_detail ?? mo,
        mode: "sky_overview", title: t(lang, "nerd_sky"),
        rows: strings.map((s) => ({
          name: s.name, sky: s.byKey.string_sky_map, shading: s.byKey.string_shading_now,
        })) },
    ] });
    const coll = plant.byKey.collector_health;
    const sd = plant.byKey.strings_detail;
    nerdSections.push({ type: "grid", cards: [
      heading(t(lang, "nerd_collection")),
      coll ? { type: "custom:pvstrings-kv-table", entity: coll, mode: "collector", title: t(lang, "nerd_collection") }
        : mdCard(t(lang, "missing_card", { key: "collector_health" })),
      mo ? { type: "custom:pvstrings-kv-table", entity: mo, mode: "skip_reasons", title: t(lang, "nerd_skips") }
        : mdCard(t(lang, "missing_card", { key: "model_observations" })),
    ] });
    // conversion layer (optional): configuration + realized ratio per group
    const convNerd = groups.filter((g) =>
      (g.byKey.group_forecast_ac || g.byKey.group_forecast_battery_charge) && g.byKey.group_forecast_remaining);
    if (convNerd.length) {
      // six columns: needs a double-width section and a card that opts into
      // its full grid width — same lesson as the censoring table
      const convEntity = convNerd[0].byKey.group_forecast_ac
        ?? convNerd[0].byKey.group_forecast_battery_charge;
      nerdSections.push({ type: "grid", column_span: 2, cards: [
        heading(t(lang, "nerd_conversion")),
        { type: "custom:pvstrings-kv-table",
          entity: convEntity,
          mode: "conversion", title: t(lang, "nerd_conversion"),
          grid_options: { columns: "full" },
          rows: convNerd.map((g) => ({
            name: g.name,
            out: g.byKey.group_forecast_ac ?? g.byKey.group_forecast_battery_charge,
            dc: g.byKey.group_forecast_remaining,
          })) },
        // collector evidence (rows/usable per stage): only rendered when the
        // integration collects — the card withholds otherwise, never errors
        { type: "custom:pvstrings-kv-table",
          entity: convEntity,
          mode: "conversion_evidence", title: t(lang, "nerd_conv_evidence"),
          grid_options: { columns: "full" } },
      ] });
    }
    // Six columns next to long string names: scrolls inside a single-column
    // section, so censoring gets a double-width section of its own. A
    // section's grid density scales with its span (12 units per view
    // column) and a card defaults to 12 units — one column — so the card
    // must opt into the section's full width or the span looks ignored.
    nerdSections.push({ type: "grid", column_span: 2, cards: [
      heading(t(lang, "nerd_censoring")),
      sd ? { type: "custom:pvstrings-kv-table", entity: sd, mode: "censoring",
        title: t(lang, "nerd_censoring"), grid_options: { columns: "full" } }
        : mdCard(t(lang, "missing_card", { key: "strings_detail" })),
    ] });
    // Educational footer: nerds know this, normal users may want to learn
    // it. Three balanced markdown columns under a full-width heading.
    const explBullets = t(lang, "nerd_explain").split("\n- ").map((b, i) => (i ? "- " + b : b));
    const explCols = [explBullets.slice(0, 3), explBullets.slice(3, 6), explBullets.slice(6)]
      .filter((c) => c.length).map((c) => mdCard(c.join("\n")));
    nerdSections.push({ type: "grid", column_span: 3, cards: [
      heading(t(lang, "nerd_explain_title")), ...explCols,
    ] });
    views.push({
      title: prefix + t(lang, "v_nerd"), path: `${slug}nerd`,
      icon: "mdi:flask-outline", type: "sections", max_columns: 3,
      sections: nerdSections,
    });
  }
  return views;
}

class PvsDashboardStrategy {
  static async generate(config, hass) {
    return { views: await buildViews(hass, config) };
  }
}
class PvsViewStrategy {
  static async generate(config, hass) {
    const views = await buildViews(hass, config);
    const want = config?.view ?? "overview";
    return views.find((v) => v.path?.endsWith(want)) ?? views[0];
  }
}

/* ========================== SECTION: REGISTER ============================ */

const EDITORS = {
  "pvstrings-sky-map-editor": [ENTITY_SCHEMA,
    { name: "show_sun", selector: { boolean: {} } },
    { name: "seasons", selector: { boolean: {} } }],
  "pvstrings-forecast-editor": [ENTITY_SCHEMA,
    { name: "style", selector: { select: { options: ["bars", "line"], mode: "dropdown" } } },
    { name: "wide", selector: { boolean: {} } },
    { name: "smooth", selector: { boolean: {} } },
    { name: "days", selector: { number: { min: 1, max: 3, mode: "box" } } },
    { name: "show_unshaded", selector: { boolean: {} } },
    { name: "show_actual", selector: { boolean: {} } }],
  "pvstrings-chain-editor": [ENTITY_SCHEMA],
  "pvstrings-conversion-editor": [ENTITY_SCHEMA,
    { name: "dc_entity", selector: { entity: { filter: { integration: "pvstrings" } } } },
    { name: "title", selector: { text: {} } }],
  "pvstrings-daily-editor": [ENTITY_SCHEMA,
    { name: "days", selector: { number: { min: 3, max: 60, mode: "box" } } }],
};
for (const [tag, schema] of Object.entries(EDITORS)) {
  if (!customElements.get(tag)) customElements.define(tag, makeEditor(schema));
}

const CARDS = [
  ["pvstrings-sky-map", PvsSkyMapCard, "PV Strings Sky Map",
    "The learned sky as a grid over sun position, with fit level and unobserved cells made explicit."],
  ["pvstrings-forecast", PvsForecastCard, "PV Strings Forecast",
    "Hourly forecast vs unshaded vs actual — the whole shading diagnostic in one chart."],
  ["pvstrings-conversion", PvsConversionCard, "PV Strings Conversion",
    "DC potential vs converted output (AC or battery charge), with an honest per-hour ratio strip."],
  ["pvstrings-chain", PvsChainCard, "PV Strings Chain",
    "What each model layer did to the raw physics for one hour, beside the measurement."],
  ["pvstrings-daily", PvsDailyCard, "PV Strings Daily",
    "Day-ahead forecast vs actual production, day by day."],
  ["pvstrings-kv-table", PvsKvTableCard, "PV Strings KV Table",
    "Diagnostic attribute tables (learning buckets, source bias, collection)."],
  ["pvstrings-maturity", PvsMaturityCard, "PV Strings Maturity",
    "How far the training has come: weather-bucket evidence and sun-path coverage."],
];
window.customCards = window.customCards ?? [];
for (const [tag, cls, name, description] of CARDS) {
  if (!customElements.get(tag)) customElements.define(tag, cls);
  if (!window.customCards.some((c) => c.type === tag)) {
    window.customCards.push({
      type: tag, name, description,
      preview: !["pvstrings-kv-table", "pvstrings-maturity"].includes(tag),
      documentationURL: "https://github.com/doccodyblue/ha-pvstrings-dash",
    });
  }
}

if (!customElements.get("ll-strategy-dashboard-pvstrings")) {
  customElements.define("ll-strategy-dashboard-pvstrings", PvsDashboardStrategy);
}
if (!customElements.get("ll-strategy-view-pvstrings")) {
  customElements.define("ll-strategy-view-pvstrings", PvsViewStrategy);
}
window.customStrategies = window.customStrategies ?? [];
if (!window.customStrategies.some((s) => s.type === "pvstrings")) {
  window.customStrategies.push({
    type: "pvstrings", strategyType: "dashboard",
    name: "PV Strings", description: "Zero-config dashboard for the PV Strings integration.",
  });
}

console.info(
  `%c PVSTRINGS-DASH %c v${PVS_VERSION} %c cards + strategy for PV Strings ≥ ${PVS_MIN_INTEGRATION}`,
  "background:#4c319f;color:#fff;padding:2px 6px;border-radius:3px 0 0 3px;font-weight:600",
  "background:#2a78d6;color:#fff;padding:2px 6px;border-radius:0 3px 3px 0",
  "color:#888"
);
