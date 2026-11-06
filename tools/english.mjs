// The mock harness is written in German (language, entity and group names).
// Documentation screenshots are English: this rewrites the harness page on
// the fly, so the harness itself stays as it is.
const MAP = [
  ['language: "de", locale: { language: "de" }', 'language: "en", locale: { language: "en" }'],
  ['"Lernen — Wandlungs-Evidenz"', '"Learning — conversion evidence"'],
  ['"Wandlungs-Kennlinie — Netz"', '"Conversion curve — Grid"'],
  ['"Wandlungs-Kennlinie — Ost-WR"', '"Conversion curve — East inverter"'],
  ['"Strang × Tagesabschnitt"', '"String × time of day"'],
  ['"Himmelskarten"', '"Sky maps"'], ['"Wandlung"', '"Conversion"'],
  ["PV Anlage", "PV Plant"], ["Strang Ost", "East string"], ["Strang West", "West string"],
  ["Strang Süd", "South string"], ["Ost-WR", "East inverter"], ['"Netz', '"Grid'], ['"Speicher', '"Battery'],
  ["Strang 1 Sued 30", "String 1 South 30"], ["Strang 4 CH2 Ost", "String 4 East"],
  ["Strang 5 CH4 Ost Gartenhaus", "String 5 East shed"],
  ['"Ersparnis — Herkunft"', '"Savings — provenance"'],
  ['"Source-Bias nach Stunde × Horizont"', '"Source bias by hour × horizon"'],
  ['"Stränge: Offset und Tagesabschnitt"', '"Strings: offset and time of day"'],
  ['"Zensur-Split (heute)"', '"Censoring split (today)"'],
  ['"Abweichung gestern"', '"Deviation yesterday"'], ['"Bias 7 Tage"', '"Bias 7 days"'],
  ['"Bias Tag voraus 30 Tage"', '"Day-ahead bias 30 days"'],
  ['"Fehler Tag voraus 30 Tage"', '"Day-ahead error 30 days"'],
  ['"Fehler Tag voraus 7 Tage"', '"Day-ahead error 7 days"'],
  ['"WMAPE 30 Tage"', '"WMAPE 30 days"'], ['"WMAPE 7 Tage"', '"WMAPE 7 days"'],
  ['"Laden"', '"Charging"'], ['"Wechselrichter"', '"Inverter"'], ['"gesamt"', '"total"'], ['"heute"', '"today"'],
  [" Genauigkeit Tag voraus 30 Tage", " day-ahead accuracy 30 days"],
  [" Modell-Beobachtungen (reif)", " model observations (mature)"], [" Modell-Beobachtungen", " model observations"],
  [" Einstrahlung Prognose", " irradiance forecast"], [" Erfassungsabdeckung", " collector coverage"],
  [" Ersparnis gesamt", " savings total"], [" Ersparnis heute", " savings today"],
  [" Strang-Detail", " strings detail"], [" Prognose morgen", " forecast tomorrow"],
  [" Restprognose AC heute", " remaining AC today"],
  [" Restprognose Akkuladung heute", " remaining battery charge today"],
  [" Restprognose heute", " remaining today"], [" Prognose heute", " forecast today"],
  [" Ertrag heute", " yield today"], [" Leistung jetzt", " power now"],
  [" Himmelskarte", " sky map"], [" Verschattung jetzt", " shading now"],
  [" Zelltemperatur", " cell temperature"],
];

export async function english(page) {
  await page.route("**/tools/mock-preview.html*", async (route) => {
    const r = await route.fetch();
    let s = await r.text();
    for (const [a, z] of MAP) s = s.split(a).join(z);
    await route.fulfill({ response: r, body: s });
  });
}
