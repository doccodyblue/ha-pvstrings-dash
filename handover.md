# Handover: PVStrings v1.18–v1.20 — Himmelskarte & Conversion Layer

Stand 22.08.2026. Alles ab v1.20 liegt **unreleased auf main** und läuft
auf Andys Instanz — Release-Freeze bis die Validierung durch ist.
Feature-Detection statt Versionsprüfung ist damit doppelt wichtig: die
Integration kann Dinge können, die keine Versionsnummer ankündigt.

Was hier drinsteht:

0. **Neu am 22.08. abends — Nowcast**: die Restprognose reagiert jetzt
   auf den Einstrahlungssensor und ändert sich alle 15 Minuten statt
   stündlich. Für euch relevant, weil sich damit das Änderungsverhalten
   der Prognosesensoren ändert. Gleich unten.
0b. **Sofort**: der Wandlungs-Erklärtext stimmt nicht mehr — „wird nicht
   gelernt" ist seit dem 22.08. überholt.
1. **Stufe B — gelernte Kennlinien**: neu, mit dem Attribut-Vertrag, den
   ihr vorgeschlagen habt, und den drei Zuständen, die eure Anzeige
   unterscheiden muss.
2. **Teil 2 — Conversion Layer**: die AC-/Akkuladungs-Entities, ihre
   Semantik und die Fallstricke beim Anzeigen.
3. **Teil 1 — Himmelskarte**: der Breaking Change `reference_ratio` →
   `level`/`fit_method` aus v1.18.
4. **Antwort auf euer `handover-wandlung-lernen.md`**: was gemessen wurde
   und welche Stufe nicht lernbar ist — ganz am Ende.

## Neu: Nowcast — die Restprognose reagiert auf den eigenen Sensor

### Was sich verhält

Bisher wurde eine laufende Prognose erst korrigiert, wenn der
Wetteranbieter seinen nächsten Lauf veröffentlichte. Am 22.08. hat
Andys Sensor um 11 Uhr die Sonne gesehen, die Prognose zog um 13:02
nach — die beste Stunde war da vorbei und steht bis heute 0,5 kWh zu
niedrig im Protokoll.

Jetzt wird der gemessene Klarheitsindex der letzten 15 Minuten in die
kommenden Intervalle eingeblendet und mit wachsendem Horizont wieder
zur Anbieterprognose zurückgeführt. Reichweite maximal zwei Stunden.

**Für euch die wichtigste Folge:** Die Prognosesensoren (`Prognose
heute`, `Restprognose heute`, die Strang- und Gruppenpendants, die
AC-Sensoren) ändern sich jetzt in **jedem 15-Minuten-Zyklus** statt nur
dann, wenn neue Wetterzeilen eintreffen. Wer auf Zustandsänderungen
triggert oder Verläufe zeichnet, bekommt deutlich mehr Punkte. Das ist
gewollt, aber es lohnt sich zu prüfen, ob irgendwo eine Automation an
„hat sich geändert" hängt.

Vergangene Stunden bleiben unangetastet — der Nowcast fasst
ausschließlich Intervalle an, die noch bevorstehen. `Prognose heute`
bewegt sich also weiterhin nur in seinem Zukunftsanteil.

### Neue Attribute

Alle am Anlagensensor **Einstrahlung Prognose**
(`sensor.<anlage>_einstrahlung_prognose`), bewusst nur dort und nicht
in den großen `forecast`-Listen — die schreibt der Recorder sonst bei
jeder Änderung komplett neu.

| Attribut | Typ | Bedeutung |
|---|---|---|
| `nowcast_active` | bool | Läuft der Nowcast gerade? |
| `nowcast_reason` | str \| null | Wenn nicht: warum. `no_source`, `no_measurement`, `too_dark` (Nacht), `thin_window` (noch keine Messintervalle, z.B. die ersten Minuten nach einem HA-Neustart), `stale`, `frozen_sensor`, `learning_off` |
| `nowcast_kt` | float | Gemessener Klarheitsindex, 0…1,1 |
| `nowcast_weight_now` | float | Gewicht am nächsten Intervall, 0…1 |
| `nowcast_halflife_min` | int | 70 bei ruhigem, 31 bei aufgerissenem Himmel |
| `nowcast_sky` | str | `calm`, `broken` oder `unknown` |
| `nowcast_spread` | float \| null | Streuung des Fehlers im Rückfenster |
| `nowcast_intervals` | int | Messintervalle hinter `kt` |
| `nowcast_trust` | float | Dämpfung 0…1, solange das Bias-Modell dünn ist |

`nowcast_active: false` mit gesetztem `nowcast_reason` ist der
Normalfall bei Nacht und auf Anlagen ohne Sensor — kein Fehler.
Wenn ihr es anzeigt, ist der Grund die interessantere Zahl.

### Zwei Fallstricke

**`truth_source: "nowcast"` an demselben Sensor meint etwas völlig
anderes** und ist älter als dieses Feature. Dort heißt es: „mangels
Sensor wird gegen den eigenen kurzen Prognosehorizont gelernt" — also
fast das Gegenteil. Wir haben es nicht umbenannt, weil das eure Anzeige
bricht. Nicht verwechseln, und bitte nicht als „Nowcast läuft" lesen.

**`forecast_error_wm2` und `nowcast_kt` sind nicht ineinander
umrechenbar.** Ersteres vergleicht die *rohe* Anbieterzeile mit der
Messung, der Nowcast rechnet gegen die bias-korrigierte Prognose. Die
beiden dürfen auseinanderlaufen, ohne dass etwas kaputt ist.

### Was sich nicht ändert

Keine neuen Entities, keine geänderten unique_ids, keine geänderten
Einheiten. Die Trefferquoten-Kennzahlen bleiben, wo sie sind — die
day-ahead-Zahl ist vom Nowcast unberührt, weil dessen Gewicht am
Abend-Stichtag längst null ist. Die rollierenden `wmape_7d`/`30d` bei
Vorlauf 0 messen die Korrektur künftig mit; falls ihr sie beschriftet,
ist „Kurzfrist-Treffsicherheit" jetzt die ehrlichere Bezeichnung als
„Modellgüte".

## Sofort: der Wandlungs-Erklärtext stimmt nicht mehr

Der aktuelle Nerd-Text lautet:

> Kennlinien kommen aus dem Datenblatt oder eigener Messung, sie werden
> nicht gelernt; „ungewandelt" heißt: keine Kennlinie konfiguriert,
> nicht 0 % Verlust gemessen.

Drei Dinge daran sind inzwischen falsch oder waren es schon immer:

1. **„sie werden nicht gelernt"** — gilt seit dem 22.08. nicht mehr.
   Stufe B ist gebaut: die Datenblattkurve ist jetzt ein *Prior*, den
   gemessene DC/AC-Paare korrigieren. Details unten.
2. **„oder eigener Messung"** — die Alternative zum Datenblatt ist
   `custom`: von Hand eingetragene Stützstellen in einem Textfeld. Eine
   Behauptung des Nutzers, keine Messung. Der Unterschied ist jetzt
   wichtig, weil es *echte* gemessene Kennlinien gibt und für die kein
   Wort mehr übrig wäre. Besser: „selbst eingetragen".
3. **Der Speicherpfad hat gar keine Kennlinie.** Er rechnet mit festen
   Faktoren (MPPT × Laden), `curve_source: fixed_factors`.

Vorschlag als Ganzes:

> Wandlung (AC / Akkuladung): optional — erscheint, sobald eine Gruppe
> einen Ausgabepfad hat. AC ist Energie hinter dem Wechselrichter, bei
> Clipping am AC-Nennwert gedeckelt, aber nie an Regel- oder
> Rechtslimits; Akkuladung ist DC-Energie in den Speicher, deren
> Ausspeisezeitpunkt eine Regelentscheidung ist — die beiden werden nie
> addiert. Der Direktpfad rechnet mit einer lastabhängigen Kennlinie aus
> dem Datenblatt oder selbst eingetragen; wo gemessene DC/AC-Paare
> vorliegen und der Besitzer es einschaltet, korrigiert die Anlage diese
> Kennlinie mit der eigenen Messung. Der Speicherpfad rechnet mit festen
> Faktoren. „Ungewandelt" heißt: keine Kennlinie konfiguriert, nicht
> 0 % Verlust gemessen.

---

## Wichtigster Befund des Abends: nicht jeder Wechselrichter misst AC

Bevor ihr etwas zum Lernen baut — dieser Zustand wird bei vielen Nutzern
der Normalfall sein, und er braucht eine eigene Darstellung.

Der HMS-1600-4T meldet über die DTU **keinen gemessenen AC-Wert**,
sondern DC × 0,95. Live nachgewiesen: vier Momentaufnahmen bei 28, 36,
30 und 65 % Last ergaben viermal 0,950 auf drei Nachkommastellen, und
über Fünf-Minuten-Intervalle integriert liegt der „gemessene"
Wirkungsgrad zwischen 2 % und 75 % Last innerhalb von 0,25
Prozentpunkten — bei einer Streuung von zwei Zehntausendsteln. Echte
Hardware verliert dort zehn Punkte und mehr.

PVStrings erkennt das jetzt selbst und **verweigert das Lernen**:
`conversion_learning.blocked = "output_appears_derived_from_input"`.
Die Kennlinie bleibt auf dem Datenblatt, die Messwerte bleiben
sichtbar.

**Was das Dashboard daraus machen sollte:** Nicht als Fehler zeigen —
es ist eine Eigenschaft der Hardware, kein Defekt und nichts, was der
Nutzer falsch gemacht hat. Aber auch nicht verschweigen, denn es
erklärt, warum ein eingeschaltetes Lernen nie vorankommt. Eine ruhige
Zeile wie „Wechselrichter meldet einen rechnerischen AC-Wert — die
Kennlinie bleibt beim Datenblatt" trifft es. Der Ausweg für den Nutzer
ist eine echte Messsteckdose am AC-Ausgang; wer die hat, trägt sie als
gemessene AC-Leistung ein und das Lernen läuft.

---

## Stufe B: gelernte Kennlinien (neu, 22.08.)

Die Datenblattkurve ist ab sofort ein Ausgangspunkt, kein Dogma. Wo
beide Seiten einer Wandlungsstufe gemessen werden, wandern die
Stützstellen zur gemessenen Effizienz — jede einzeln, jede mit eigener
Evidenz.

### Vier Zustände, die ihr unterscheiden müsst

Das ist die wichtigste Anzeige-Entscheidung, und es ist wieder die alte
Regel „noch nicht ≠ nichts":

| Zustand | `curve_source` | `conversion_learning` | Anzeige |
|---|---|---|---|
| Lernen aus | `datasheet` / `custom` | **fehlt** | wie bisher |
| Lernen an, sammelt noch | `datasheet` / `custom` | vorhanden, `coverage` klein | „sammelt" mit Reifegrad |
| Lernen an, Evidenz reicht | `learned` | vorhanden | gelernt vs. Datenblatt zeigen |
| Evidenz verworfen | `datasheet` / `custom` | vorhanden, `blocked` gesetzt | Hinweis, siehe Abschnitt oben |

**Die Anwesenheit des Blocks ist der Schalter-Indikator**, nicht das
Label: Der Block reist mit, sobald Lernen eingeschaltet ist — auch ohne
eine einzige Messung, auch nach einem Neustart. Fehlt er, ist Lernen
aus.

**`curve_source` wird erst `learned`, wenn eine Stützstelle materiell
messungsgetrieben ist.** Darunter ist die Kurve bereits leicht bewegt
(die Punkte wandern stufenlos mit ihrer Evidenz, es gibt keine
Schwelle, hinter der sich etwas versteckt) — aber drei Messungen eine
gelernte Kennlinie zu nennen wäre Angeberei.

### Attribute, wenn gelernt wird

Auf dem Gruppen-Conversion-Sensor, zusätzlich zu den bekannten:

```yaml
curve_source: learned
curve_prior: datasheet          # oder custom — worauf gelernt wurde
conversion_learning:
  stage: inverter_efficiency
  coverage: 0.17                # bewegte / erreichbare Stützstellen
  max_load: 0.689               # höchste je beobachtete Last
  blocked: null                 # oder ein Grund, siehe oben
  bins:
    "0.02": {eta: 0.8822, prior: 0.8600, measured: 0.9528, spread: 0.0017,
             n_eff: 15.8, learned: false, reachable: true}
    "1.00": {eta: 0.9620, prior: 0.9620, measured: null,   spread: null,
             n_eff: 0.0,  learned: false, reachable: false}
```

- `bins`-Schlüssel ist der **Lastanteil** (0.50 = 50 % der AC-Nennleistung).
- `eta` ist der angewendete Wert, `prior` der Datenblattwert an derselben
  Stelle, `measured` die rohe Messung dahinter — das Tripel für euren
  Vergleich. **`eta` liegt zwischen den beiden**: die Punkte wandern
  anteilig zu ihrer Evidenz, es gibt keine harte Schwelle mehr.
- `measured` reist ab der ersten Messung mit, lange bevor der Punkt die
  Kurve trägt. Damit kann man einem Stützpunkt beim Entstehen zusehen —
  genau diese Sichtbarkeit hat den DTU-Befund oben aufgedeckt.
- `spread` ist die gewichtete Streuung: wie ruhig der Punkt ist. Kleine
  Streuung bei viel Evidenz heißt „steht", große heißt „springt noch".
- `reachable: false` heißt: diese Last hat die Anlage nie erreicht und
  wird sie physikalisch auch nicht (Generator zu klein für den
  Wechselrichter). Solche Punkte bleiben für immer auf dem Datenblatt und
  zählen **nicht** in `coverage` — sonst stünde der Reifegradbalken auf
  ewig unter 100 % und läse sich als „wird nie fertig".
- `n_eff` ist gewichtete Evidenz (Deckung × Aktualität), keine Stückzahl.
- `max_load` macht sichtbar, warum etwas unerreichbar ist.

### Was die Kurve nicht lernt (für Erklärtexte)

Gekappte Intervalle (am Nennwert folgt der Ausgang nicht mehr dem
Eingang), der Standby-Sockel unter 1 % Last (dort dominiert der
Eigenverbrauch des Wechselrichters) und alles, was die Zensur als
gedrosselt markiert hat. Gelernte Punkte sind zudem auf ±5
Prozentpunkte um das Datenblatt gedeckelt — ein Tag mit kaputtem Sensor
kann die Kurve nicht umschreiben. Und ganze Kurven werden verworfen,
wenn die Messung zu flach ist, um eine zu sein (Abschnitt oben).

**Eine Falle für Nutzer mit Messsteckdose**, die ihr im Hilfetext
erwähnen könntet: Hängt am selben Messpunkt noch etwas anderes — bei
Andy zwei Kameras mit zusammen rund 10 W — verfälscht das den
Wirkungsgrad genau dort, wo die Kurve am interessantesten ist. Bei
1000 W sind 10 W ein Prozent; bei 32 W (2 % Last) ein Drittel. Und
unterhalb der Fremdlast dreht der Fluss sogar um. Die Steckdose gehört
also allein an den Wechselrichter.

### Diagnose-JSON

`data.model.conversion_curves` — dieselbe Struktur wie
`conversion_learning`, aber für **alle** lernenden Bereiche, auch die,
deren Stützstellen noch nicht bewegt sind. Das ist die Quelle für den
Zwischenzustand „eingeschaltet, sammelt noch".

### Was weiterhin nicht gelernt wird

Die **MPPT-Stufe**. Ihre Messpaare werden gesammelt, angewendet wird
weiter ein fester Faktor — gemessen 0,972 gegen konfigurierte 0,97, der
Pauschalwert stimmt also fast. Bei `curve_source: fixed_factors` gibt es
folglich nie einen `conversion_learning`-Block.

---

## Teil 2 (v1.20, unreleased auf main): Conversion Layer / AC-Prognose

Neu, rein **additiv** — alle bestehenden Entities unverändert. Erscheint
nur, wenn der Nutzer je Gruppe einen „Ausgabepfad" konfiguriert; ohne
Konfiguration existiert nichts davon. Das Dashboard muss mit fehlenden
Entities umgehen (Feature-Detection, nicht Versionsprüfung).

### Neue Entities

| Entity (translation_key) | unique_id | Gerät | existiert wenn |
|---|---|---|---|
| `group_forecast_ac` „Restprognose AC heute" | `<entry>_<group>_forecast_ac` | Gruppen-Gerät | Gruppe hat `output_path: direct` |
| `group_forecast_battery_charge` „Restprognose Akkuladung heute" | `<entry>_<group>_forecast_battery_charge` | Gruppen-Gerät | Gruppe hat `output_path: storage` |
| `forecast_ac_today` / `forecast_ac_tomorrow` „Prognose AC heute/morgen" | `<entry>_forecast_ac_today/_tomorrow` | Anlagen-Gerät | ≥ 1 direct-Gruppe |

Alle: kWh, `device_class: energy`, `state_class: total`.

**State-Semantik unterscheidet sich:** Gruppen-Sensoren = **Rest heute**
(wie der bestehende DC-Gruppensensor), mit `today_kwh`/`tomorrow_kwh` als
Attribute. Die Plant-AC-Sensoren dagegen = **Ganztag** (today bzw.
tomorrow komplett) — `forecast_ac_today` neben einem Gruppen-Restwert
darzustellen erzeugt sonst einen scheinbaren Widerspruch.

**Entity-Discovery (wichtig — Cards brauchen `entity_id`s, keine
`unique_id`s):** Die realen entity_ids entstehen aus Geräte- und
Sensorname und sind installationsabhängig. Rezept: Entity Registry
lesen (`config/entity_registry/list` via WebSocket), auf
`platform === "pvstrings"` filtern und das **unique_id-Suffix** matchen
(`_forecast_ac`, `_forecast_battery_charge`, `_forecast_ac_today`,
`_forecast_ac_tomorrow`) — das Suffix ist der stabile Vertrag.
„Gruppen-Gerät"/„Anlagen-Gerät" heißt: der Sensor hängt am HA-Device der
jeweiligen Gruppe (benannt nach dem Gruppentitel, z. B. „Netz") bzw. am
Anlagen-Device. Zusätzlich sollte die Card eine explizite
Entity-Konfiguration erlauben, wie bei den bestehenden Cards.

**Stundenliste `forecast`:** gleiche Form wie überall
(`[{datetime, potential_kwh, …}]`), ABER: auf den Conversion-Sensoren
enthält `potential_kwh` die **konvertierte** Energie (AC bzw.
Akkuladung), nicht das DC-Potenzial — der Feldname ist historisch.
Nie mit DC-Stundenreihen summieren oder als DC beschriften.

### Semantik — wichtig für jede Darstellung

- **AC (direct) und Akkuladung (storage) niemals summieren.** AC ist
  Energie hinter dem Wechselrichter; Akkuladung ist DC-Energie in den
  Speicher, deren Ausspeisezeitpunkt eine Regelentscheidung ist. Jedes
  Entity trägt ein `semantics`-Attribut mit genau dieser Erklärung.
- **AC ist Hardware-Potenzial**: am AC-Nennwert gedeckelt (wenn Clipping
  aktiv), aber NIE an Regel- oder Rechtslimits (800-W-Fälle!). Nicht als
  „einspeisbare Energie" beschriften.
- Plant-AC-Sensoren tragen `partial` (bool) + zwei Namenslisten:
  `unconverted_strings` (ohne Gruppe oder `none`-Gruppe — komplett
  unsichtbar) und `storage_strings` (in der Akkuladungs-Prognose statt
  hier). `partial: true` sobald eine der Listen belegt ist — bei Andy
  also immer (Speicher-Gruppe). Bei `partial: true` gehört ein Hinweis
  in die Anzeige, idealerweise mit beiden Listen getrennt beschriftet.
- **Attribut-Scope beachten:** `output_path`, `curve_source`
  (vier Werte, siehe unten), `conversion_factor` (nur bei festen
  Faktoren), `stages`, `today_kwh`, `tomorrow_kwh`,
  `strings` und (bei direct) `clipped_kwh`/`note` gibt es NUR auf den
  **Gruppen**-Conversion-Sensoren. Die **Plant-AC**-Sensoren tragen
  ausschließlich `forecast`, `partial`, `unconverted_strings`,
  `storage_strings`, `semantics` — Kennlinien-Details dort abzufragen
  liefert `undefined`.
- `curve_source` kennt vier Werte: `datasheet` / `custom` (lastabhängige
  Kennlinie), `neutral` (**nur direct**: keine Kennlinie, AC = DC —
  „ungewandelt", nicht „0 % Verlust gemessen") und `fixed_factors`
  (**storage**: feste Faktoren, angewendet). Bei `fixed_factors` liefert
  das Attribut `conversion_factor` den tatsächlich angewendeten
  Multiplikator (bei Andy 0,9312 = MPPT 0,97 × Laden 0,96) — damit ist
  die frühere Fehlanzeige „Ausgang per Definition gleich DC" auf der
  Speicher-Karte behoben; sie war ein falsches Signal von PVStrings,
  kein Dashboard-Fehler.
- Verfügbarkeit, präzise: Gruppen-Conversion-Sensor ist `unavailable`,
  wenn der Koordinator keine Daten hat, die Gruppe keine Mitglieder hat
  oder (noch) kein Konversionsergebnis vorliegt. Plant-AC ist
  `unavailable`, solange keine direct-Gruppe konfiguriert ist. Eine
  Entity kann also existieren und trotzdem dauerhaft `unavailable` sein
  — „noch nicht" und „nichts" nicht gleich darstellen (bestehende
  Entwurfsregel).

### Bestehendes (unverändert, zur Sicherheit)

DC-Gruppensensor `group_forecast_remaining` bleibt für jede Gruppe, auch
mit konfiguriertem Pfad; alle Plant-/String-Sensoren unverändert.

---

## Teil 1 (v1.18/v1.19): Änderungen am Himmelskarte-Sensor

Von der PVStrings-Session, 2026-08-21. Betrifft `pvstrings-dash.js`
(Feature-Detection Z. ~76–90 und Himmelskarten-Card).

## Breaking: `reference_ratio` existiert nicht mehr (seit v1.18.0)

Der Himmelskarte-Sensor (`string_sky_map`) hat das Attribut
`reference_ratio` verloren. Ersatz sind zwei neue Attribute:

- **`level`** (`float | null`): Freisicht-Niveau des Strangs relativ zur
  Physik (z. B. `1.05` = liefert 5 % über Physik, wo nichts im Weg ist).
  `null` ist ein gültiger Zustand: Ein-Strang-Anlagen und Stränge ohne
  genug gemeinsame Epochen mit ihren Geschwistern haben kein Level.
- **`fit_method`** (`"differential" | "absolute"`): pro Strang, nicht pro
  Anlage — in einer Anlage können beide vorkommen. `differential` heißt:
  Karte wurde gegen die Geschwister-Stränge gefittet.

Feature-Detection-Vorschlag: `"level" in a && "fit_method" in a` als
Marker für ≥ 1.18; der bestehende `reference_ratio`-Eintrag (since 1.15.0)
matcht auf 1.18+ nicht mehr und sollte durch den neuen ersetzt werden
(alte Installationen ≤ 1.17 liefern weiterhin `reference_ratio`).

## Semantik-Änderungen an `cells` (Format unverändert)

`cells[]` behält die Felder `az, el, loss, ratio, n, season`. Aber:

- **`loss` ist bei `fit_method: "differential"` der Klartag-Verlust** —
  was der Schatten an einem klaren Tag kostet. Zur Laufzeit wird er von
  der Integration mit dem Direktlicht-Anteil skaliert (trüber Tag → kaum
  Abzug). Falls die Legende/der Erklärtext „Verlust" erklärt: „Verlust an
  einem klaren Tag" ist jetzt die korrekte Formulierung. Bei
  `"absolute"` bleibt es der gemischte Hüllkurven-Verlust wie bisher.
- `ratio` bleibt Roh-Messung/Physik (Hüllkurve) auf allen Zellen,
  inklusive der saisonalen Splits (dort jetzt pro Jahreshälfte).
- Die `n`-Werte sind kleiner als vor 1.18 (beam-gewichtet); nicht als
  „weniger Daten" fehlinterpretieren.

## Diagnose-JSON (falls die Cards sie je lesen)

`data.model.shading` ist seit 1.18 verschachtelt:
`{ "method": ..., "levels": {string_id: float}, "strings": {string_id: {cells, most_shaded}} }`
— vorher lagen die string_ids flach unter `shading`. **Keys können
fehlen:** `levels` enthält nur differenziell gefittete Stränge, `strings`
nur Karten mit beobachteten Zellen. Nie über alle Strang-Ids iterieren
und Vollständigkeit erwarten.

## Nicht geändert

Entity-Struktur, `string_shading_now` (0 % = freie Sicht, 100 % = voller
Schatten), Gruppen-Sensoren, `attributes.today_kwh`-Verankerung.

## Anzeige-Idee (optional, kein Muss)

`level` und `fit_method` sind neue, gut zeigbare Diagnosewerte: ein Chip
„Niveau 1,05 · differenziell" neben der Himmelskarte beantwortet die
Frage, gegen was die Verluste gemessen sind. `level: null` +
`fit_method: "absolute"` → Chip weglassen oder „absolut" zeigen —
„noch nicht" und „nichts" nicht gleich aussehen lassen (Entwurfsregel).

---

## Antwort auf `handover-wandlung-lernen.md` (Dash → PVStrings)

**Kurz: gute Idee, umgesetzt — aber eine der drei Stufen ist nicht
lernbar, und zwar messbar nicht.**

### Was gemessen wurde (Live, 21.08. abends)

| Stufe | Messpaar | Verdikt |
|---|---|---|
| `inverter_efficiency` | `gartenhaus_powerdc` → `gartenhaus_power` | **lernbar** (209,4 → 199,0 W = 0,950) |
| `mppt_efficiency` | je Regler `panel_power` → `battery_power` | **lernbar** (0,972 / 0,971) |
| `charge_efficiency` | `battery_power` → `felicity_laden_leistung` | **nicht lernbar** |

Zur dritten Zeile, weil ihr explizit danach gefragt habt („bitte prüfen,
welche Seite bei euch wirklich als Entity ankommt"): Summe batterieseitig
471,3 W, Felicity meldet 58,1 W Ladeleistung. Das sind keine 12 %
Wirkungsgrad — das ist der **Hausverbrauch**, der vom DC-Bus abgeht. Der
Akku ist ein Knoten mit mehreren Flüssen, kein Zweitor. Dieses Paar zu
lernen hieße, die Grundlast als Wandlungsverlust zu lernen.
`charge_efficiency` bleibt daher ein konfigurierter Wert.

### Zu Punkt 3 (Topologie) — entschärft

Bei Andy ist die Netz-Gruppe **genau ein** HMS-1600-4T: CH1+CH2+CH3+CH4 =
165,5 W = `gartenhaus_powerdc` (die DTU publiziert die Summe selbst).
Gruppe = Wechselrichter, keine Komposition nötig. Allgemein gilt: die
AC-Entity gehört der Gruppe, die DC-Seite ist die Summe ihrer Stränge —
zeigt jemand auf mehrere Wechselrichter, lernt er deren Mischkurve, und
das ist konsistent, weil die Prognose auch auf Gruppenebene anwendet.

### Was jetzt gebaut ist (Stufe 1 von 2)

**Nur das Sammeln.** Ab sofort schreibt der Kollektor je 5 Minuten die
Messpaare mit (`conversion_5min`, Schema v6): Eingangsseite aus den
vorhandenen Strang-Messungen, Ausgangsseite aus `ac_power_entity`
(Gruppe) bzw. dem neuen Strang-Feld `mppt_output_entity`. Eure
Leitplanken 1, 2 und 4 sind drin: zensierte Intervalle werden markiert
(der Lernlauf stempelt sie, sobald die Physik geurteilt hat) und fallen
aus dem Trainingsset; unbeurteilte Zeilen gelten als unbrauchbar, nicht
als sauber. **Noch nichts liest diese Daten** — `curve_source: learned`
und der `conversion_learning`-Block existieren noch nicht.

### Euer Reifegrad-Signal, ab sofort nutzbar

Diagnose-JSON, `data.conversion_evidence`:

```json
{
  "<scope_id>|inverter": { "rows": 15, "usable": 4 },
  "<scope_id>|mppt":     { "rows": 14, "usable": 3 }
}
```

- **`rows`** = geschriebene Messpaare, **`usable`** = davon zensurgeprüft
  und sauber. `usable` hinkt `rows` immer etwas hinterher: frisch
  geschriebene Paare stehen auf „noch nicht beurteilt" und werden erst vom
  stündlichen Lernlauf freigegeben. Das ist kein Fehler, sondern die
  Zensur-Leitplanke — als Fortschrittsbalken also `usable` nehmen, nicht
  `rows`.
- **Konfigurierte Stufen erscheinen immer**, notfalls mit `rows: 0`. Ein
  Eintrag mit lauter Nullen heißt „eingerichtet, sammelt aber nichts" und
  ist ein echtes Warnsignal; ein *fehlender* Eintrag heißt „nicht
  eingerichtet". Bitte in der Anzeige unterscheiden — die beiden Zustände
  sahen bis heute Abend gleich aus, und genau dadurch ist ein Strang eine
  Dreiviertelstunde lang unbemerkt nicht gesammelt worden (stale Runtime
  nach zwei Reconfigures im Sekundenabstand; ein Reload behebt es).
- `scope_id` ist die Gruppen-ID bei `inverter`, die Strang-ID bei `mppt` —
  dieselben IDs wie in den Subentries.

Live-Stand bei Andy heute Abend: `inverter` 15/4, MPPT Strang 1 14/3,
MPPT Strang 2 2/0 (zuletzt konfiguriert). Realistisch sind ein paar
hundert verwertbare Paare pro Stufe und Sonnentag.

### Neues Konfigurationsfeld (falls ihr Setup-Zustände anzeigt)

Strang-Subentry: **`mppt_output_entity`** — die batterieseitige Leistung
des Ladereglers. Zusammen mit `power_entity` (Panel-Seite) ist das das
Messpaar der MPPT-Stufe. Optional; ohne das Feld wird für diesen Strang
nichts gesammelt.

### Stufe 2 ist gebaut (22.08.) — euer Vertrag wurde übernommen

Nicht in zwei Wochen, sondern am Tag danach: die Leitplanken, die ihr
in Punkt 1–5 aufgeschrieben habt, standen ohnehin in der Spec, und mit
ihnen ist frühes Bauen ungefährlich. `curve_source: learned`,
`curve_prior`, `conversion_learning.bins`, `coverage` — genau wie
skizziert, rein additiv, bestehende Attribute unverändert. Details im
Abschnitt „Stufe B" oben.

Eure fünf Punkte, wie umgesetzt:

1. **Zensur respektieren** — gedrosselte und rekonstruierte Intervalle
   sind schon beim Sammeln markiert und fallen aus dem Fit.
2. **Clipping trennen** — Intervalle am Nennwert sind ausgeschlossen;
   die Kappe bleibt ein eigener Parameter, kein Kurvenpunkt.
3. **Topologie** — bei Andy entfällt sie (Gruppe = ein Wechselrichter).
   Allgemein: die AC-Entity gehört der Gruppe, die DC-Seite ist die
   Summe ihrer Stränge, gelernt wird also die Mischkurve genau der
   Einheit, auf die die Prognose sie auch anwendet.
4. **Standby-Tare** — unter 1 % Last wird nicht gelernt. Die Schwelle
   ist noch geraten und wird aus den Daten nachgezogen, sobald genug
   Schwachlast-Paare da sind.
5. **Datenblatt als Prior** — wörtlich so gebaut: Punkte ohne genug
   Evidenz behalten den Datenblattwert, gelernte sind auf ±5
   Prozentpunkte darum gedeckelt, und der Deckel gilt auch nach einem
   Neustart gegen den dann gültigen Prior.

Was offen bleibt: die MPPT-Stufe (siehe oben) und das Feintuning der
Bucket-Grenzen, sobald ein paar klare Tage in den Daten liegen.
