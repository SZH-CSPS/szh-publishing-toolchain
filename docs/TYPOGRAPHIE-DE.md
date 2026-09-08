# Typografie – was die Kette selbst korrigiert

Für die deutschsprachige Redaktion der *Schweizerischen Zeitschrift für Heilpädagogik*.

Sie müssen nichts Besonderes tippen. Schreiben Sie fortlaufend, mit dem Apostroph und den
Anführungszeichen Ihrer Tastatur: Die Kette setzt beim Kompilieren die richtige Typografie,
in der deklarierten Sprache des Artikels.

**Ihre Datei wird nie verändert.** Die Korrektur geschieht in dem Moment, in dem das PDF
entsteht. Das Markdown bleibt genau das, was Sie geschrieben haben – lesbar, von Fassung zu
Fassung vergleichbar – und gesetzt wird die Ausgabe.

> Die Regeln stammen aus dem Duden und dem Schweizer Usus, abgeglichen mit den 421 bereits
> auf ojs.szh.ch publizierten Beiträgen. Die Messungen im Detail stehen in
> [TYPOGRAPHIE.md](TYPOGRAPHIE.md) (auf Französisch).

---

## Die Regeln

Jede Regel trägt einen Code. Er dient dazu, über sie zu sprechen, ohne sie zu beschreiben,
und es ist derselbe, den `python3 test/typo-check.py --liste` anzeigt.

### A – Apostroph und Anführungszeichen

| Code | Sie schreiben | Sie erhalten |
|---|---|---|
| **A1** | `Boccaccio's Werk` | Boccaccio’s Werk |
| **A2** | `"ein Zitat"` oder `„ein Zitat“` | «ein Zitat» |
| **A3** | `"ein 'Wort' im Zitat"` | «ein ‹Wort› im Zitat» |

**A1** – der gerade Apostroph wird zum typografischen Apostroph `’`.

**A2** – alle Anführungszeichen (`"`, `“ ”`, `„ “`) werden zu Guillemets `« »`. Das ist das
Anführungszeichen der Zeitschrift, auf Deutsch wie auf Französisch. Die deutschen
Anführungszeichen `„ “` sind in der Schweiz **nicht** üblich.

**A3** – ein Zitat im Zitat erhält die einfachen Guillemets `‹ ›`.

### E – Abstände

| Code | Sie schreiben | Sie erhalten |
|---|---|---|
| **E1** | `« Wort »` oder `«Wort»` | «Wort» |
| **E2** | `die Folge : so` | die Folge: so |
| **E3** | `80 %` oder `80%` | 80&nbsp;% |
| **E4** | `z. B.`, `d. h.`, `S. 202` | z.&nbsp;B., d.&nbsp;h., S.&nbsp;202 |
| **E5** | `12 km`, `Abb. 4`, `3 Tagen`, `8.30 Uhr` | 12&nbsp;km, Abb.&nbsp;4, 3&nbsp;Tagen, 8.30&nbsp;Uhr |
| **E6** | `22 255 725 Franken` | 22 255 725&nbsp;Franken, in einem Block |
| **E7** | `( siehe oben )` | (siehe oben) |
| **E8** | `das Wort , dann der Rest .` | das Wort, dann der Rest. |

Das ist die Familie, in der sich Deutsch und Französisch am stärksten unterscheiden: **Das
Deutsche schliesst an, das Französische trennt durch ein geschütztes Leerzeichen.** Ein
Leerschlag vor `;` `:` `!` `?` oder innerhalb der Guillemets wird im Deutschen entfernt.

**E3** ist die Ausnahme: Vor dem Prozentzeichen steht in **beiden** Sprachen ein
geschütztes Leerzeichen.

**E4** – das geschützte Leerzeichen hält die Abkürzung zusammen, damit «B.» nicht allein
auf die nächste Zeile rutscht.

**E5** hält zusammen, was nicht über den Zeilenwechsel getrennt werden darf: eine Zahl und
ihre Einheit (`12 km`, `3 Tagen`, `8.30 Uhr`), einen Verweis und seine Nummer (`Abb. 4`,
`Tab. 2`, `Art. 8`, `Abs. 2`, `Kap. 4`, `§ 12`), einen Titel und seinen Namen
(`Dr. Meier`, `Prof. Weber`), die Initiale eines Vornamens (`J.-P. Dupont`), den Tag und
seinen Monat (`6. August 2017`), das Geld (`CHF 499.–`, `25 €`) und die römische Zahl nach
einem Namen (`Louis XIV`). Das sieht man nur im PDF: Dort brechen die Zeilen.

**E6** – eine gruppierte Zahl bricht nie mehr am Zeilenende. Die Kette gruppiert **nicht
für Sie**: Schreiben Sie `35000`, bleibt es `35000`. Die Gruppierung ist ein
redaktioneller Entscheid, wir schützen sie bloss. Das gilt auch für die schweizerische
Schreibung mit Hochkomma – `35'000` bricht ohnehin nicht.

**E7 und E8** räumen überzählige Leerschläge auf: nichts innerhalb der Klammern, nichts vor
einem Komma oder einem Punkt.

### T – Striche

| Code | Sie schreiben | Sie erhalten |
|---|---|---|
| **T1** | `ein Wort --- ein Einschub --- der Rest` | ein Wort – ein Einschub – der Rest |
| **T2** | `S. 12-25` | S.&nbsp;12–25 |

**T1** – der Strich der Zeitschrift ist der **Halbgeviertstrich** `–`, nie der
Geviertstrich `—`. Im Deutschen steht er zwischen zwei gewöhnlichen Leerzeichen.

**T2** – nur **Seitenbereiche** erhalten den Halbgeviertstrich; erkennbar sind sie am
`S.` davor. `2020-2021` und `COVID-19` behalten ihren Bindestrich.

Im Französischen gilt seit dem 08.09.2026 das Gegenteil: Dort schreibt der Westschweizer
Usus den Bindestrich (`pp. 12-25`). Die Kette wandelt in beide Richtungen, Sie müssen also
nicht daran denken.

### S – Zeichen

| Code | Sie schreiben | Sie erhalten |
|---|---|---|
| **S1** | `und so weiter...` | und so weiter… |
| **S2** | *(nur Französisch: Ordnungszahlen)* | – |
| **S4** | `usw.. hier`, `usw... hier` | usw. hier |

**S4** – der Abkürzungspunkt verschluckt den Schlusspunkt: `usw..` und `usw...` werden zu
`usw.`. Hinter einer Abkürzung stehen keine Auslassungspunkte.

### L – Zeilen und Trennungen

Diese Familie ändert keinen Buchstaben Ihres Textes: Sie entscheidet, **wo die Zeilen
brechen**. Sichtbar ist sie deshalb nur im PDF.

| Code | Was gehalten wird |
|---|---|
| **L1** | *(nur Französisch: Eigennamen werden nicht getrennt)* |
| **L2** | im Titel bleibt ein Artikel oder eine Präposition bei ihrem Wort |
| **L3** | die erste Zeile des Titels ist kürzer als die zweite |
| **L4** | *(nur Französisch: mindestens drei Buchstaben je Seite einer Worttrennung)* |

**L1 und L4 gelten im Deutschen nicht, und das ist kein Versehen.** Im Deutschen trägt
jedes Substantiv die Majuskel: Eine Erkennung von Eigennamen über die Grossschreibung
hielte die Hälfte des Textes für einen Namen und schaltete die Trennung genau dort aus, wo
sie am nötigsten ist. Und dem Deutschen Trennstellen zu nehmen, würde die Wortabstände
einer ausgeschlossenen Zeile öffnen, statt sie zu schliessen – die Sprache lebt von ihren
Zusammensetzungen.

**L2** – die Regel behebt diesen Fehler:

> Menschen mit Behinderung als Partner in der
> **Ausbildung**

Die Präposition blieb allein am Zeilenende, «Ausbildung» allein darunter. Der Umbruch
erfolgt jetzt **vor** der Präposition. Nur Titel und Untertitel: Im Text würde das
Zusammenbinden aller Funktionswörter Löcher zwischen die Wörter reissen, denn es sind die
Trennstellen, die dem Programm erlauben, den Weissraum einer Zeile zu verteilen.

**L3** – die Treppe. Ein auf volle Breite gesetzter Titel füllt seine erste Zeile und lässt
die zweite fast leer, was die Umschlagseite aus dem Gleichgewicht bringt. Der Satz will das
Gegenteil, die kurze Zeile über der langen:

> Erfahrungen von Schülerinnen und
> Schülern in inklusiven Klassen

Die Kette misst Ihren Titel in der Schrift des Umschlags, um diesen Umbruch zu finden.
Findet sie keine Lösung, die **ohne zusätzliche Zeile** auskommt, tut sie nichts: Der Satz
von vorher ist besser als ein abgeschnittener Titel.

---

## Was gemeldet, aber nie korrigiert wird

Diese beiden verlangen Ihr Urteil: Die Maschine kann es Ihnen nicht abnehmen. Sie
erscheinen nach dem Kompilieren unter **Kontrollen**.

| Code | Was gemeldet wird | Warum nur Sie entscheiden können |
|---|---|---|
| **C1** | ein `ß` in einem deutschen Artikel | `«Klauß»` ist nicht `«Klauss»`: Eigennamen und Zitate behalten ihre Schreibung |
| **C2** | gerade Anführungszeichen `"` ohne Zuordnung | nichts sagt, welches öffnet und welches schliesst |
| **C3** | *(nur Französisch: Grossbuchstabe ohne Akzent)* | – |

Zu **C1**: Die Hausregel ist `ss`. Der Filter ersetzt das `ß` aber nicht von sich aus – er
würde sonst Namen verfälschen. Prüfen Sie jede Meldung einzeln.

---

## Was die Kette nicht anrührt

- **Den Inhalt von `Code-Abschnitten`** und allem zwischen Backticks. Ein Pfad, ein
  Schlüssel, ein Befehl hat keine Typografie.
- **Die von der Gestaltung gesetzten Bezeichnungen** – das `«Abbildung 1 — Legende»`, das
  `«Quelle:»` eines Bildnachweises. Das sind Satzentscheide, keine Tippfehler.
- **Tausendertrennzeichen**, Daten und Kennungen. `2026-08-29`,
  `10.57161/r2026-03-01` und `12000` bleiben unverändert.

---

## Wenn etwas nicht stimmt

Das Ergebnis sehen Sie in der Vorschau rechts im Editor: Sie durchläuft dieselben Regeln
wie das PDF. Erscheint Ihnen eine Korrektur falsch, ist das ein Fehler des Filters und
nicht Ihres Textes – melden Sie ihn, mit dem Code der Regel.

Die Regeln werden bei jeder Durchsicht des Programms geprüft:

```sh
python3 test/typo-articles.py                 # die Regeln, an echtem Pandoc
python3 test/typo-check.py                    # die Bezeichnungen des Cockpits
python3 test/metriques-titre.py --verifier    # folgt die Titelmessung noch der Schrift?
```

Französische Fassung dieser Notiz: [TYPOGRAPHIE-FR.md](TYPOGRAPHIE-FR.md).
