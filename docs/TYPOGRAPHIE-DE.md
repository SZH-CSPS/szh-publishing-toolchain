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

## Die zwölf Regeln

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

Das ist die Familie, in der sich Deutsch und Französisch am stärksten unterscheiden: **Das
Deutsche schliesst an, das Französische trennt durch ein geschütztes Leerzeichen.** Ein
Leerschlag vor `;` `:` `!` `?` oder innerhalb der Guillemets wird im Deutschen entfernt.

**E3** ist die Ausnahme: Vor dem Prozentzeichen steht in **beiden** Sprachen ein
geschütztes Leerzeichen.

**E4** – das geschützte Leerzeichen hält die Abkürzung zusammen, damit «B.» nicht allein
auf die nächste Zeile rutscht.

### T – Striche

| Code | Sie schreiben | Sie erhalten |
|---|---|---|
| **T1** | `ein Wort --- ein Einschub --- der Rest` | ein Wort – ein Einschub – der Rest |
| **T2** | `S. 12-25` | S.&nbsp;12–25 |

**T1** – der Strich der Zeitschrift ist der **Halbgeviertstrich** `–`, nie der
Geviertstrich `—`. Im Deutschen steht er zwischen zwei gewöhnlichen Leerzeichen.

**T2** – nur **Seitenbereiche** erhalten den Halbgeviertstrich; erkennbar sind sie am
`S.` davor. `2020-2021` und `COVID-19` behalten ihren Bindestrich.

### S – Zeichen

| Code | Sie schreiben | Sie erhalten |
|---|---|---|
| **S1** | `und so weiter...` | und so weiter… |
| **S2** | *(nur Französisch: Ordnungszahlen)* | – |

---

## Was gemeldet, aber nie korrigiert wird

Diese beiden verlangen Ihr Urteil: Die Maschine kann es Ihnen nicht abnehmen. Sie
erscheinen nach dem Kompilieren unter **Kontrollen**.

| Code | Was gemeldet wird | Warum nur Sie entscheiden können |
|---|---|---|
| **C1** | ein `ß` in einem deutschen Artikel | `«Klauß»` ist nicht `«Klauss»`: Eigennamen und Zitate behalten ihre Schreibung |
| **C2** | gerade Anführungszeichen `"` ohne Zuordnung | nichts sagt, welches öffnet und welches schliesst |

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
python3 test/typo-articles.py    # die zwölf Regeln, an echtem Pandoc
python3 test/typo-check.py       # dieselben Regeln, an der Oberfläche des Cockpits
```

Französische Fassung dieser Notiz: [TYPOGRAPHIE-FR.md](TYPOGRAPHIE-FR.md).
