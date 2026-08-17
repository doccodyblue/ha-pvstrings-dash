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
 *   CARD:SKYMAP / CARD:FORECAST / CARD:CHAIN / CARD:DAILY / CARD:KVTABLE
 *   STRATEGY  registry -> generated dashboard
 *   REGISTER  customElements.define + customCards/customStrategies
 *
 * Design rules (SPEC §0 — every render path obeys them):
 *   1. "Not yet" and "nothing" never look the same.
 *   2. Every derived number is traceable to its inputs in <= 1 click.
 *   3. A card that cannot draw something says why. Never an empty panel.
 * ========================================================================== */

/* ============================ SECTION: HEADER ============================ */

const PVS_VERSION = "0.1.1";
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
];
const STRING_KEYS = [
  "string_sky_map", "string_shading_now", "string_forecast_today",
  "string_forecast_remaining", "string_forecast_tomorrow",
  "string_potential_now", "string_produced_today",
];
const GROUP_KEYS = ["group_forecast_remaining"];

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
  sky_cells: {
    test: (a) => Array.isArray(a?.cells),
    attr: "cells", since: "1.8.0",
  },
  sky_ratio: {
    test: (a) => !a?.cells?.length || a.cells[0].ratio !== undefined,
    attr: "cells[].ratio", since: "1.15.0",
  },
  // Presence check, deliberately separate from sky_ratio:
  // reference_ratio: null is a valid "not yet" state (withheld chip);
  // a MISSING key is the contract error (problem panel).
  sky_reference: {
    test: (a) => a != null && "reference_ratio" in a,
    attr: "reference_ratio", since: "1.15.0",
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
    "sky_reference": "reference",
    "sky_reference_warn": "Reference below {v} — a reference inside the shadow normalises the shadow away. Losses on this map are relative to an already-shaded best hour.",
    "sky_reference_withheld": "reference not established yet",
    "sky_cells": "{n} cells observed",
    "sky_share_of_year": "≈ {pct}% of the year's sun path",
    "sky_no_cells": "No sky cells learned yet — the map fills in as the sun crosses new positions. {obs} raw observations collected so far.",
    "sky_unobserved": "never observed — not “no loss”",
    "sky_loss": "loss",
    "sky_pooled": "pooled (all year)",
    "sky_season_ascending": "season: ascending sun (Dec–Jun)",
    "sky_season_descending": "season: descending sun (Jun–Dec)",
    "sky_ratio_gt1": "ratio above 1.0 — cell outperforms the reference",
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
    "s_nowcast": "Nowcast (continuously updated)",
    "s_dayahead": "Day-ahead (issued the evening before)",
    "s_daily": "Day by day",
    "acc_note": "**Nowcast** may correct itself during the day; **day-ahead** is frozen the evening before. The two are **not comparable until both windows are full** — the day counts below say how far along each one is.",
    "strategy_no_integration": "## PV Strings\nNo PV Strings entities found. Install and configure the [PV Strings integration](https://github.com/doccodyblue/ha-pvstrings) first — this dashboard builds itself from its sensors.",
    "missing_card": "**{key}** expected here, but no such entity exists on this device — it was not silently omitted. Check whether the integration version publishes it, or whether the entity is disabled.",
    // nerd
    "nerd_learning": "Learning — log-ratio buckets",
    "nerd_plant_buckets": "Plant: weather × daypart",
    "nerd_string_offsets": "Per-string offsets",
    "nerd_string_daypart": "String × daypart",
    "nerd_bucket_missing": "never seen",
    "nerd_source_bias": "Source bias (local hour × horizon)",
    "nerd_truth_measured": "learned against a measured sensor",
    "nerd_truth_nowcast": "learned only against the source's own short-horizon run — a much weaker claim",
    "nerd_collection": "Collection",
    "nerd_censoring": "Censoring split (today)",
    "nerd_skips": "Learn-cycle skip reasons",
    "nerd_sky": "Sky maps",
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
    "sky_reference": "Referenz",
    "sky_reference_warn": "Referenz unter {v} — eine Referenz im Schatten normalisiert den Schatten weg. Verluste auf dieser Karte sind relativ zu einer bereits verschatteten besten Stunde.",
    "sky_reference_withheld": "Referenz noch nicht etabliert",
    "sky_cells": "{n} Zellen beobachtet",
    "sky_share_of_year": "≈ {pct}% des Jahres-Sonnenwegs",
    "sky_no_cells": "Noch keine Himmelszellen gelernt — die Karte füllt sich, während die Sonne neue Positionen überstreicht. Bisher {obs} Roh-Beobachtungen.",
    "sky_unobserved": "nie beobachtet — nicht „kein Verlust“",
    "sky_loss": "Verlust",
    "sky_pooled": "gepoolt (ganzjährig)",
    "sky_season_ascending": "Saison: steigende Sonne (Dez–Jun)",
    "sky_season_descending": "Saison: fallende Sonne (Jun–Dez)",
    "sky_ratio_gt1": "Ratio über 1.0 — Zelle übertrifft die Referenz",
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
    "s_nowcast": "Nowcast (laufend aktualisiert)",
    "s_dayahead": "Day-Ahead (am Vorabend eingefroren)",
    "s_daily": "Tag für Tag",
    "acc_note": "**Nowcast** darf sich tagsüber nachkorrigieren; **Day-Ahead** ist am Vorabend eingefroren. Die beiden sind **erst vergleichbar, wenn beide Fenster voll sind** — die Tageszähler unten zeigen, wie weit jedes ist.",
    "strategy_no_integration": "## PV Strings\nKeine PV-Strings-Entities gefunden. Zuerst die [PV-Strings-Integration](https://github.com/doccodyblue/ha-pvstrings) installieren und einrichten — dieses Dashboard baut sich aus ihren Sensoren.",
    "missing_card": "**{key}** wurde hier erwartet, aber es gibt keine solche Entity an diesem Gerät — sie wurde nicht stillschweigend weggelassen. Prüfen, ob die Integrationsversion sie publiziert oder ob die Entity deaktiviert ist.",
    "nerd_learning": "Lernen — Log-Ratio-Buckets",
    "nerd_plant_buckets": "Anlage: Wetter × Tagesabschnitt",
    "nerd_string_offsets": "Strang-Offsets",
    "nerd_string_daypart": "Strang × Tagesabschnitt",
    "nerd_bucket_missing": "nie gesehen",
    "nerd_source_bias": "Source-Bias (lokale Stunde × Horizont)",
    "nerd_truth_measured": "gegen einen Messsensor gelernt",
    "nerd_truth_nowcast": "nur gegen den Kurzfrist-Lauf der Quelle selbst gelernt — eine deutlich schwächere Aussage",
    "nerd_collection": "Erfassung",
    "nerd_censoring": "Zensur-Split (heute)",
    "nerd_skips": "Skip-Gründe des Lernzyklus",
    "nerd_sky": "Himmelskarten",
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
const LOSS_RAMP_LIGHT = ["#ede9fa", "#dcd3f5", "#c8b9ef", "#b29ce7",
  "#9a7fdd", "#8163d0", "#6749bd", "#4c319f"];
const LOSS_RAMP_DARK = ["#2c2740", "#3b3159", "#4c3d75", "#5f4b92",
  "#7660b4", "#8f7bd4", "#ab9cec", "#cabffa"];

const BASE_CSS = `
  :host {
    --pvs-model: #2a78d6;
    --pvs-model-ghost: #a8c9f2;
    --pvs-measure: #eb6834;
    --pvs-sun: #eda100;
    --pvs-unobserved: color-mix(in srgb, var(--secondary-text-color, #727272) 16%, var(--card-background-color, #fff));
    --pvs-hairline: color-mix(in srgb, var(--primary-text-color, #212121) 9%, transparent);
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
          deviceId: dev.id, name: dev.name_by_user || dev.name,
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
    const need = requireFeatures(st, ["sky_cells", "sky_ratio", "sky_reference"]);
    if (!need.ok) return card(problemHTML(hass, { entity: cfg.entity, missing: need.missing }));

    const attrs = st.attributes;
    const cells = attrs.cells ?? [];
    const shading = this._shadingId ? hass.states[this._shadingId] : null;
    const title = cfg.title ?? shading?.attributes?.name
      ?? attrs.friendly_name?.replace(/ (Himmelskarte|Sky map)$/i, "") ?? cfg.entity;

    // ---- header ----
    const ref = attrs.reference_ratio;
    const refBadge = ref == null
      ? withheldHTML(t(hass, "sky_reference_withheld"))
      : `<span class="pvs-chip ${ref < 0.9 ? "warn" : ""} clickable" data-more-info="${cfg.entity}"
           title="${ref < 0.9 ? esc(t(hass, "sky_reference_warn", { v: "0.9" })) : t(hass, "more_info")}">
           ${ref < 0.9 ? `<span class="ico">⚠︎</span>` : ""}
           ${t(hass, "sky_reference")} <span class="v">${fmtNum(hass, ref, 2)}</span></span>`;
    const pooledCount = cells.filter((c) => c.season == null).length;
    const lat = hass.config?.latitude;
    const annual = lat != null ? annualSkyCells(lat) : null;
    const share = annual ? Math.round((pooledCount / annual) * 100) : null;
    const cellChip = `<span class="pvs-chip clickable" data-more-info="${cfg.entity}">
        <span class="v">${pooledCount}</span> ${t(hass, "sky_cells", { n: "" }).replace("{n} ", "").trim() || "cells"}
        ${share != null ? `<span class="pvs-sub">· ${t(hass, "sky_share_of_year", { pct: share })}</span>` : ""}
      </span>`;
    const refWarnLine = (ref != null && ref < 0.9)
      ? `<div class="sky-warnline">⚠︎ ${t(hass, "sky_reference_warn", { v: "0.9" })}</div>` : "";

    // ---- empty-but-valid state (rule 1: "not yet", never a blank) ----
    if (!cells.length) {
      const obs = shading?.attributes?.observations ?? "?";
      return card(`
        <div class="pvs-head"><span class="pvs-title">${esc(title)}</span>${refBadge}</div>
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
          rects += `<rect class="cell" x="${x}" y="${y}" width="${CW}" height="${CH}"
            fill="${lossColor(c.loss)}" stroke="var(--card-background-color)" stroke-width="1"
            data-cell='${esc(JSON.stringify({ az, el, loss: c.loss, ratio: c.ratio, n: c.n, season: c.season }))}'/>`;
        } else {
          rects += `<rect x="${x}" y="${y}" width="${CW}" height="${CH}"
            fill="var(--pvs-unobserved)" stroke="var(--card-background-color)" stroke-width="1"/>
            <rect x="${x}" y="${y}" width="${CW}" height="${CH}" fill="url(#pvs-hatch)"
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
        ${t(hass, "sky_loss")} 0–95%</span>
      <span class="it"><svg width="14" height="12">
        <rect width="14" height="12" rx="2" fill="var(--pvs-unobserved)"/>
        <rect width="14" height="12" rx="2" fill="url(#pvs-hatch-l)"/></svg>
        ${t(hass, "sky_unobserved")}</span>
    </div>`;

    card(`
      <div class="pvs-head">
        <span class="pvs-title">${esc(title)}</span>
        ${seg}${refBadge}${cellChip}
      </div>
      ${refWarnLine}${sunLine}
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
        return `<div class="h">${c.az}°–${c.az + 10}° · ${c.el}°–${c.el + 5}°</div>
          <div class="r"><span class="k">${t(hass, "sky_loss")}</span><span class="v">${fmtNum(hass, c.loss, 1)} %</span></div>
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
  getGridOptions() { return { columns: 12, min_columns: 6, rows: "auto" }; }

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
    const PAD_L = 42, PAD_R = 6, PAD_T = 10, PAD_B = 22, PH = 168;
    // wide: for full-width placement — twice the drawing width keeps the
    // rendered height identical when the card spans two columns
    const wide = !!cfg.wide;
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
    for (const v of [0, yMax / 2, yMax]) {
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
      <div class="fc-hero">${heroIst}<span class="fc-hero-title">${esc(title)}</span>${heroProg}</div>
      ${notes.join("")}
      <div class="fc-wrap"><svg class="fc-line" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="aspect-ratio:${W}/${H}">
        ${grid}
        ${actPts.length ? `<path d="${area(actPts, actGap)}" fill="var(--pvs-measure)" opacity="0.13"/>` : ""}
        ${unPts.length ? `<path d="${path(unPts, HOUR_GAP)}" fill="none" stroke="var(--pvs-model-ghost)" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>` : ""}
        ${fcPts.length ? `<path d="${path(fcPts, HOUR_GAP)}" fill="none" stroke="var(--pvs-model)" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>` : ""}
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
`;

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

  _factorCell(hass, cell) {
    if (!cell) return `<td class="miss">${t(hass, "nerd_bucket_missing")}</td>`;
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
            ${DAYPARTS.map((d) => this._factorCell(hass, src[`${id}|${d}`])).join("")}</tr>`).join("")}</table>`;
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
      body = `<table><tr><th></th><th>${t(hass, "vk_measured")}</th><th>${t(hass, "vk_lower_bound")}</th><th>${t(hass, "vk_reconstructed")}</th><th>cov</th><th>curt</th></tr>
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
        const ref = sky?.attributes?.reference_ratio;
        const worst = sh?.attributes?.most_shaded?.[0];
        const sector = worst?.sector?.replace("|", "° · ").replace(/-/g, "–") ?? null;
        return `<tr><th class="clickable" data-more-info="${r.sky}">${esc(r.name)}</th>
          <td><span class="pvs-num">${sky?.attributes?.cells?.length ?? "—"}</span></td>
          <td class="${ref != null && ref < 0.9 ? "hot" : ""}"><span class="pvs-num">${ref == null ? "—" : fmtNum(hass, ref, 2)}</span></td>
          <td>${worst ? `<span class="pvs-num" style="white-space:nowrap">${esc(sector)}°</span> <span class="n">${fmtNum(hass, worst.shading_pct, 0)}%</span>` : "—"}</td></tr>`;
      }).join("");
      body = `<table><tr><th></th><th>cells</th><th>${t(hass, "sky_reference")}</th><th>max</th></tr>${rows2}</table>`;
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
      { type: "grid", cards: [
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
    if (groups.length) {
      overviewSections.push({ type: "grid", cards: [
        heading(t(lang, "s_groups")),
        ...groups.map((g) => tileOrMissing(hass, lang, g, "group_forecast_remaining", { name: g.name })),
      ] });
    }
    overviewSections.push({ type: "grid", cards: [
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
      { type: "grid", column_span: 2, cards: [mdCard(t(lang, "acc_note"))] },
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
      sd ? { type: "custom:pvstrings-kv-table", entity: sd, mode: "censoring", title: t(lang, "nerd_censoring") }
        : mdCard(t(lang, "missing_card", { key: "strings_detail" })),
      mo ? { type: "custom:pvstrings-kv-table", entity: mo, mode: "skip_reasons", title: t(lang, "nerd_skips") }
        : mdCard(t(lang, "missing_card", { key: "model_observations" })),
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
    { name: "days", selector: { number: { min: 1, max: 3, mode: "box" } } },
    { name: "show_unshaded", selector: { boolean: {} } },
    { name: "show_actual", selector: { boolean: {} } }],
  "pvstrings-chain-editor": [ENTITY_SCHEMA],
  "pvstrings-daily-editor": [ENTITY_SCHEMA,
    { name: "days", selector: { number: { min: 3, max: 60, mode: "box" } } }],
};
for (const [tag, schema] of Object.entries(EDITORS)) {
  if (!customElements.get(tag)) customElements.define(tag, makeEditor(schema));
}

const CARDS = [
  ["pvstrings-sky-map", PvsSkyMapCard, "PV Strings Sky Map",
    "The learned sky as a grid over sun position, with reference and unobserved cells made explicit."],
  ["pvstrings-forecast", PvsForecastCard, "PV Strings Forecast",
    "Hourly forecast vs unshaded vs actual — the whole shading diagnostic in one chart."],
  ["pvstrings-chain", PvsChainCard, "PV Strings Chain",
    "What each model layer did to the raw physics for one hour, beside the measurement."],
  ["pvstrings-daily", PvsDailyCard, "PV Strings Daily",
    "Day-ahead forecast vs actual production, day by day."],
  ["pvstrings-kv-table", PvsKvTableCard, "PV Strings KV Table",
    "Diagnostic attribute tables (learning buckets, source bias, collection)."],
];
window.customCards = window.customCards ?? [];
for (const [tag, cls, name, description] of CARDS) {
  if (!customElements.get(tag)) customElements.define(tag, cls);
  if (!window.customCards.some((c) => c.type === tag)) {
    window.customCards.push({
      type: tag, name, description, preview: tag !== "pvstrings-kv-table",
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
