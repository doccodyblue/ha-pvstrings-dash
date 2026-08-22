# Handover: Dash → PVStrings — Wandlungs-Kennlinien lernen statt behaupten

Von der Dashboard-Session, 2026-08-21. Feature-Wunsch von Andy für den
Conversion Layer (v1.20): **Wirkungsgrad-Kennlinien lernen, wo Sensorik
beide Seiten einer Wandlungsstufe misst** — statt sie nur aus Datenblatt
oder Handkonfiguration zu übernehmen.

## Motivation

`curve_source: datasheet|custom` ist eine Behauptung, keine Messung. Das
Dashboard zeigt heute ehrlich „Wandlung heute X %" — aber das ist
Prognose-durch-Kennlinie / Prognose-DC, also die Kennlinie, die sich
selbst bestätigt. Bei Andys Anlage existiert die Messung für beide
Seiten längst:

- **Hoymiles (DTU, Netz-Gruppe)**: DC-Leistung pro Kanal (CH1/CH2/CH4)
  UND AC-Leistung pro Wechselrichter werden publiziert →
  `inverter_efficiency` ist direkt lernbar (gemessen AC / gemessen DC).
- **Victron MPPT (Speicher-Gruppe)**: PV-DC und Batterieseite gemessen →
  `mppt_efficiency`/`charge_efficiency` prinzipiell ebenfalls lernbar.
  (Bitte prüfen, welche Seite bei euch wirklich als Entity ankommt.)

Wo keine Messung existiert, bleibt alles wie heute
(datasheet/custom/neutral) — Lernen ist opt-in per Datenlage, kein
neuer Zwang.

## Was gelernt werden sollte

Der klassische Wechselrichter-Wirkungsgrad ist eine Funktion der
**Auslastung** (P/P_nenn): schlecht bei Schwachlast, flach ab ~20 %.
Vorschlag, analog zur bewährten Log-Ratio-Maschinerie:

- Buckets über der Lastachse (log-nah am unteren Ende, z. B.
  2/5/10/20/35/50/75/100 % von P_nenn), pro Bucket gelerntes
  eta = out/in mit `n_eff`-Beweisgewicht und langsamem Vergessen.
- Gelernt aus den 5-Minuten-Collector-Intervallen, in denen **beide
  Seiten gemessen** vorliegen.

## Leitplanken (aus der eigenen Bug-Historie)

1. **Zensur respektieren**: Intervalle mit `lower_bound` (Abregelung!)
   oder rekonstruierten Werten NICHT lernen — sonst lernt die Kurve die
   Abregelung als Wandlungsverlust.
2. **Clipping trennen**: Stunden am AC-Nennwert nicht in die
   eta-Buckets oberhalb der Kappe mischen; die Kappe ist ein eigener,
   ggf. selbst lernbarer Parameter, kein Kurvenpunkt.
3. **Topologie**: AC misst der Wechselrichter, DC der Kanal. Die
   Netz-Gruppe spannt drei Kanäle über mehrere Wechselrichter — gelernt
   werden muss pro **physischem Wechselrichter** (Summe seiner
   Kanal-DCs vs. sein AC), die Gruppenkurve ist dann Komposition. Das
   ist die eigentliche Designfrage dieses Features.
4. **Standby-Tare**: Eigenverbrauch des Wechselrichters verzerrt die
   untersten Last-Buckets; Nacht-/Nullintervalle ausschließen.
5. Datenblatt/custom als **Prior**, nicht als Konkurrent: Das Lernen
   startet auf der konfigurierten Kurve und verschiebt sie mit Evidenz.

## Attribut-Vertrag (was das Dashboard braucht)

Das Dashboard hat bereits eine „Wandlung"-Sektion im Nerd-View und eine
Conversion-Card mit `curve_source`-Chip — für die Trainings-Anzeige
(analog Lernreife) braucht es einen stabilen, feature-detectbaren Block
auf dem Gruppen-Conversion-Sensor, z. B.:

```yaml
curve_source: learned          # vierte Stufe, erst ab genug Evidenz
curve_prior: datasheet         # worauf gelernt wurde
conversion_learning:
  stage: inverter_efficiency
  bins:                        # Lastanteil -> gelerntes eta + Beweis
    "0.05": {eta: 0.87, n_eff: 12.3}
    "0.20": {eta: 0.95, n_eff: 41.0}
  coverage: 0.6                # Anteil der Lastachse mit Evidenz
```

Form verhandelbar — wichtig ist: Präsenz des Blocks als Marker
(Feature-Detection, keine Versionsprüfung), `n_eff` pro Bucket, und ein
Reife-Maß (`coverage` o. ä.) für den Fortschrittsbalken. Solange nicht
genug Evidenz da ist, `curve_source` auf dem Prior lassen — „noch nicht"
und „nichts" nicht gleich aussehen lassen (Entwurfsregel).

Das Dashboard würde dann zeigen: gelernte Kurve vs. Prior als Vergleich,
Reife-Balken je Stufe, Chip „gelernte Kennlinie" auf der Card. Bestehende
Attribute (forecast, today_kwh, clipped_kwh, partial, …) bitte unverändert
lassen — alles Neue rein additiv.

## Offene Beobachtung aus dem Live-Betrieb (bitte klären)

Die Speicher-Gruppe meldet aktuell `curve_source: neutral`, trägt aber
`stages: [mppt_efficiency, charge_efficiency]` und liefert Ladung heute
8,8 kWh bei DC 9,4 kWh. Bei „neutral = Ausgang gleich DC" wäre Gleichheit
zu erwarten — entweder ist `neutral` hier nicht die ganze Wahrheit
(Stufen wirken doch?) oder die Tageszählung der beiden Sensoren läuft
auseinander. Das Dashboard zeigt derzeit die Note „keine Kennlinie
konfiguriert — Ausgang per Definition gleich DC", die dann faktisch
falsch wirkt.
