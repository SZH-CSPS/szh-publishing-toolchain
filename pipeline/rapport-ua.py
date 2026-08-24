#!/usr/bin/env python3
"""Traduit le rapport XML de veraPDF en quelques lignes qu'un rédacteur peut lire.

    verapdf --flavour ua1 --format xml a.pdf b.pdf > r.xml
    python3 rapport-ua.py r.xml          # ou : ... | python3 rapport-ua.py

Sortie : le verdict en français, puis le même en allemand (orthographe suisse). Chaque
ligne porte le préfixe « [pdf-ua] », « [pdf-ua] [de] » pour l'allemand : format stable,
repérable au grep, et calqué sur « [pipeline] » / « [pipeline] [de] » du Makefile.

Codes de sortie — et ils ne disent pas la même chose :
    0  tous les PDF sont conformes PDF/UA-1
    1  au moins un PDF n'est pas conforme  (verdict)
    2  le rapport est illisible ou vide     (panne d'outillage, PAS un verdict)
Le code de veraPDF lui-même se lit en amont, dans le Makefile : 4 (fichier introuvable),
7 (fichier illisible) et 127 (veraPDF absent) sont des pannes, non des verdicts. Sans
cette distinction, un validateur manquant se lirait comme un PDF conforme.

Deux publics, deux lignes — et c'est pourquoi la référence de norme n'est plus dans la
phrase. Chaque règle en échec sort ainsi :

    [pdf-ua]   • Le document n'a pas de titre (1 fois, page(s) 3)
    [pdf-ua]         En cause : …
    [pdf-ua]         À faire  : …
    [pdf-ua]   ISO 14289-1 7.1-9

La puce est pour la rédactrice : ce qui est en cause, le geste, et de quoi retrouver
l'endroit — combien de fois, sur quelles pages. Le « ISO 14289-1 7.1-9 » n'aide personne à
corriger un article ; il n'aide qu'à ouvrir un signalement de bogue, et il est le seul
moyen de retrouver la règle chez veraPDF. Il a donc sa ligne, en dessous : elle reste dans
le journal de compilation, et le cockpit la laisse tomber avec le reste du bruit
d'outillage (son retrait de deux espaces suffit à le lui dire — voir lib/journal.js).
Une ligne portée par un rapport, pas un mot glissé dans une phrase.

Aucune dépendance : xml.etree suffit, l'image WSL n'a pas PyYAML et n'aura pas lxml.
"""
import re
import sys
import xml.etree.ElementTree as ET

PREFIXE = '[pdf-ua]'

# ── Les règles que la chaîne SZH peut casser ────────────────────────────────────
# Pour chacune : un titre, ce qui est EN CAUSE, et LE GESTE de correction. Une règle
# absente de ce tableau sort avec son libellé anglais brut — une phrase anglaise vaut
# mieux qu'un silence — et sa ligne « ISO 14289-1 » suffit alors à retrouver la règle chez
# veraPDF (github.com/veraPDF/veraPDF-validation-profiles/wiki/PDFUA-Part-1-rules).
# Les neuf règles réellement rencontrées sur le corpus sont toutes ici.
REGLES = {
  ('5', '1'): (
    ("Le PDF ne s'annonce pas PDF/UA",
     "Les métadonnées XMP du fichier ne portent pas l'identification PDF/UA.",
     "Relancez la compilation : le PDF a probablement été produit sans la variante "
     "PDF/UA-1 (voir le journal de compilation, ligne « balisage PDF indisponible »)."),
    ("Das PDF weist sich nicht als PDF/UA aus",
     "Die XMP-Metadaten enthalten die PDF/UA-Kennung nicht.",
     "Kompilieren Sie neu: das PDF wurde wahrscheinlich ohne die Variante PDF/UA-1 "
     "erzeugt (siehe Kompilierprotokoll, Zeile « balisage PDF indisponible »).")),
  ('6.2', '1'): (
    ("Le PDF n'est pas balisé",
     "Le fichier ne déclare pas de balisage (MarkInfo/Marked).",
     "Même cause que ci-dessus : le PDF est sorti par le repli non balisé. Regardez la "
     "sortie d'erreur de la compilation."),
    ("Das PDF ist nicht getaggt",
     "Die Datei deklariert kein Tagging (MarkInfo/Marked).",
     "Gleiche Ursache wie oben: das PDF stammt aus dem untaggten Rückfall. Prüfen Sie "
     "die Fehlerausgabe der Kompilierung.")),
  ('7.1', '3'): (
    ("Du contenu n'est ni balisé ni marqué décoratif",
     "Un texte ou un dessin est dessiné dans un calque de transparence, où il perd son "
     "rattachement à la structure du document. Cause connue : une propriété CSS "
     "opacity inférieure à 1 dans la feuille de style.",
     "Ne réglez pas la transparence par opacity : composez la couleur sur son fond "
     "et laissez-la à 1. Le filigrane de couverture et le point médian entre "
     "auteur·e·s sont déjà traités ainsi dans pipeline/styles/print.css — s'il en "
     "réapparaît un, c'est une opacity qui vient d'être ajoutée."),
    ("Inhalt ist weder getaggt noch als dekorativ markiert",
     "Ein Text oder eine Zeichnung wird in einer Transparenzebene gezeichnet und "
     "verliert dort ihre Verbindung zur Dokumentstruktur. Bekannte Ursache: eine "
     "CSS-Eigenschaft opacity kleiner als 1 im Stylesheet.",
     "Regeln Sie Transparenz nicht über opacity: mischen Sie die Farbe auf ihrem "
     "Hintergrund und lassen Sie opacity auf 1. Wasserzeichen und Mittelpunkt zwischen "
     "den Autorinnen und Autoren sind in pipeline/styles/print.css schon so gelöst — "
     "taucht der Fehler wieder auf, wurde eine neue opacity eingeführt.")),
  ('7.1', '9'): (
    ("Le document n'a pas de titre",
     "Les métadonnées du PDF ne portent aucun titre.",
     "Ouvrez « Métadonnées des articles » dans le cockpit, saisissez le titre de "
     "l'article, enregistrez, puis recompilez."),
    ("Das Dokument hat keinen Titel",
     "Die PDF-Metadaten enthalten keinen Titel.",
     "Öffnen Sie « Metadaten der Artikel » im Cockpit, geben Sie den Titel ein, "
     "speichern Sie und kompilieren Sie neu.")),
  ('7.1', '10'): (
    ("Le lecteur PDF affichera le nom de fichier au lieu du titre",
     "La préférence d'affichage « DisplayDocTitle » manque.",
     "Défaut de la chaîne de compilation, pas de l'article : signalez-le."),
    ("Der PDF-Betrachter zeigt den Dateinamen statt des Titels",
     "Die Anzeigeeinstellung « DisplayDocTitle » fehlt.",
     "Fehler der Kompilierkette, nicht des Artikels: melden Sie ihn.")),
  ('7.1', '11'): (
    ("Le PDF n'a pas d'arbre de structure",
     "Le fichier ne porte aucune structure de document : rien n'y dit ce qui est un "
     "titre, un paragraphe ou un tableau, ni dans quel ordre le lire. Un lecteur "
     "d'écran n'a rien à annoncer que la suite des caractères dessinés.",
     "Même cause que « Le PDF n'est pas balisé » : le document est sorti par le repli "
     "non balisé. Relancez la compilation et regardez le journal, ligne « balisage PDF "
     "indisponible » ; si elle revient, c'est un défaut de la chaîne, signalez-le."),
    ("Das PDF hat keinen Strukturbaum",
     "Die Datei enthält keine Dokumentstruktur: nichts sagt, was Titel, Absatz oder "
     "Tabelle ist, und in welcher Reihenfolge gelesen wird. Ein Screenreader hat nur "
     "die Folge der gezeichneten Zeichen anzusagen.",
     "Gleiche Ursache wie bei « Das PDF ist nicht getaggt »: das Dokument stammt aus "
     "dem untaggten Rückfall. Kompilieren Sie neu und prüfen Sie das Protokoll, Zeile "
     "« balisage PDF indisponible »; kehrt sie zurück, ist es ein Fehler der Kette — "
     "melden Sie ihn.")),
  ('7.2', '29'): (
    ("Étiquette de langue invalide",
     "Une langue est déclarée dans une forme que la norme ne reconnaît pas.",
     "Dans la fiche de l'article, la clé « lang: » doit valoir fr, de ou it."),
    ("Ungültige Sprachkennung",
     "Eine Sprache ist in einer Form angegeben, die die Norm nicht kennt.",
     "Im Datenblatt des Artikels muss der Schlüssel « lang: » fr, de oder it lauten.")),
  ('7.2', '34'): (
    ("La langue du texte n'est pas déterminable",
     "Le document ne déclare aucune langue par défaut.",
     "Renseignez « lang: » dans la fiche de l'article (fr, de ou it), enregistrez et "
     "recompilez."),
    ("Die Sprache des Textes ist nicht bestimmbar",
     "Das Dokument gibt keine Standardsprache an.",
     "Setzen Sie « lang: » im Datenblatt des Artikels (fr, de oder it), speichern Sie "
     "und kompilieren Sie neu.")),
  ('7.3', '1'): (
    ("Image sans description",
     "Une image balisée « figure » n'a pas de texte de remplacement : un lecteur "
     "d'écran annoncerait « image » sans rien pouvoir en dire.",
     "Ouvrez « Médias de l'article » dans le cockpit et renseignez la description de "
     "l'image ; si elle est purement décorative, cochez-la comme telle (description "
     "vide) — le rendu la sortira alors en décor, hors de la structure."),
    ("Bild ohne Beschreibung",
     "Ein als « Abbildung » getaggtes Bild hat keinen Alternativtext: ein Screenreader "
     "würde « Bild » ansagen, ohne mehr sagen zu können.",
     "Öffnen Sie « Medien des Artikels » im Cockpit und erfassen Sie die "
     "Bildbeschreibung; ist das Bild rein dekorativ, kennzeichnen Sie es als solches "
     "(leere Beschreibung) — die Ausgabe stellt es dann als Dekor dar.")),
  ('7.4.2', '1'): (
    ("Un niveau de titre est sauté",
     "La suite des titres descend de plus d'un cran (par exemple un titre de niveau 3 "
     "juste après un niveau 1).",
     "Dans l'article, rétablissez la marche des titres : pas de saut de niveau."),
    ("Eine Überschriftenebene wird übersprungen",
     "Die Überschriften springen um mehr als eine Ebene (etwa Ebene 3 direkt nach "
     "Ebene 1).",
     "Stellen Sie im Artikel die Abfolge der Überschriften wieder her: keine "
     "übersprungene Ebene.")),
  ('7.5', '1'): (
    ("Cellule de tableau sans en-tête rattachable",
     "Une cellule n'est reliée à aucun en-tête : la structure du tableau ne se déduit "
     "pas toute seule.",
     "Ouvrez l'éditeur de tableaux du cockpit et déclarez la ligne (et, s'il y en a, la "
     "colonne) d'en-tête."),
    ("Tabellenzelle ohne zuordenbare Kopfzelle",
     "Eine Zelle ist mit keiner Kopfzelle verbunden: die Tabellenstruktur ergibt sich "
     "nicht von selbst.",
     "Öffnen Sie den Tabelleneditor im Cockpit und deklarieren Sie die Kopfzeile (und "
     "gegebenenfalls die Kopfspalte).")),
  ('7.5', '2'): (
    ("Cellule de tableau qui renvoie à un en-tête inexistant",
     "Une cellule référence un en-tête qui n'est pas dans le tableau.",
     "Ouvrez l'éditeur de tableaux du cockpit et vérifiez les en-têtes déclarés."),
    ("Tabellenzelle verweist auf eine fehlende Kopfzelle",
     "Eine Zelle verweist auf eine Kopfzelle, die es in der Tabelle nicht gibt.",
     "Öffnen Sie den Tabelleneditor im Cockpit und prüfen Sie die deklarierten "
     "Kopfzellen.")),
  ('7.18.3', '1'): (
    ("L'ordre de tabulation d'une page n'est pas déclaré",
     "Une page porte des liens, mais ne dit pas que la touche de tabulation doit les "
     "parcourir dans l'ordre du document. Qui lit au clavier les reçoit alors dans "
     "l'ordre où ils ont été écrits dans le fichier, qui n'est pas celui de la lecture.",
     "Défaut de la chaîne de compilation, pas de l'article : le moteur de rendu "
     "n'écrit pas cette clé. Signalez-le."),
    ("Die Tabulatorreihenfolge einer Seite ist nicht angegeben",
     "Eine Seite enthält Verknüpfungen, sagt aber nicht, dass die Tabulatortaste sie in "
     "der Reihenfolge des Dokuments durchlaufen soll. Wer mit der Tastatur liest, "
     "erhält sie sonst in der Reihenfolge, in der sie in die Datei geschrieben wurden.",
     "Fehler der Kompilierkette, nicht des Artikels: die Rendering-Engine schreibt "
     "diesen Schlüssel nicht. Melden Sie ihn.")),
  ('7.18.5', '1'): (
    ("Lien mal balisé",
     "Des zones cliquables ne sont pas rattachées à un élément « lien » de la "
     "structure. Cause connue : un « a » du gabarit ou de la chaîne contient une balise "
     "interne (span, svg, sup) ; le moteur de rendu produit alors une zone cliquable "
     "par boîte, et une seule est correcte.",
     "Un « a » ne doit contenir que du texte. Dans "
     "pipeline/templates/szh-article.html, la flèche et le logo sont volontairement à "
     "l'extérieur du lien, et le Makefile réordonne les appels de note en "
     "« sup > a » : si l'erreur revient, c'est qu'un élément a été remis dans un lien."),
    ("Link falsch getaggt",
     "Klickbare Bereiche sind nicht mit einem « Link »-Element der Struktur verbunden. "
     "Bekannte Ursache: ein « a » in der Vorlage oder in der Kette enthält ein inneres "
     "Tag (span, svg, sup); die Rendering-Engine erzeugt dann einen klickbaren Bereich "
     "pro Box, und nur einer davon ist korrekt.",
     "Ein « a » darf nur Text enthalten. In pipeline/templates/szh-article.html liegen "
     "Pfeil und Logo bewusst ausserhalb des Links, und das Makefile ordnet die "
     "Fussnotenzeichen zu « sup > a » um: kehrt der Fehler zurück, wurde wieder ein "
     "Element in einen Link gesetzt.")),
  ('7.18.5', '2'): (
    ("Lien sans description",
     "Une zone cliquable n'a pas de description : rien à annoncer à sa place.",
     "Défaut de la chaîne de compilation, pas de l'article : signalez-le."),
    ("Link ohne Beschreibung",
     "Ein klickbarer Bereich hat keine Beschreibung: es gibt nichts anzusagen.",
     "Fehler der Kompilierkette, nicht des Artikels: melden Sie ihn.")),
  ('7.18.1', '2'): (
    ("Annotation sans description",
     "Une annotation du PDF n'a pas de texte de remplacement.",
     "Défaut de la chaîne de compilation, pas de l'article : signalez-le."),
    ("Anmerkung ohne Beschreibung",
     "Eine PDF-Anmerkung hat keinen Alternativtext.",
     "Fehler der Kompilierkette, nicht des Artikels: melden Sie ihn.")),
  ('7.20', '2'): (
    ("Un calque de dessin est réutilisé et perd sa structure",
     "Un même calque (Form XObject) porte du contenu balisé et est référencé plusieurs "
     "fois. Cause connue : une propriété CSS opacity ou un filtre de transparence.",
     "Même geste que pour « du contenu n'est ni balisé ni marqué décoratif » : "
     "supprimez l'opacity de la feuille de style et pré-mélangez la couleur."),
    ("Eine Zeichenebene wird mehrfach genutzt und verliert ihre Struktur",
     "Dieselbe Ebene (Form XObject) trägt getaggten Inhalt und wird mehrfach "
     "referenziert. Bekannte Ursache: eine CSS-Eigenschaft opacity oder ein "
     "Transparenzfilter.",
     "Gleicher Griff wie bei « Inhalt ist weder getaggt noch als dekorativ markiert »: "
     "entfernen Sie die opacity im Stylesheet und mischen Sie die Farbe vor.")),
  ('7.21.4.1', '1'): (
    ("Police non incorporée",
     "Une police utilisée n'est pas embarquée dans le fichier : le texte s'affichera "
     "avec une autre police, ou pas du tout.",
     "Défaut de la chaîne de compilation (polices de l'image WSL) : signalez-le."),
    ("Schrift nicht eingebettet",
     "Eine verwendete Schrift steckt nicht in der Datei: der Text erscheint mit einer "
     "anderen Schrift oder gar nicht.",
     "Fehler der Kompilierkette (Schriften des WSL-Abbilds): melden Sie ihn.")),
  ('7.21.4.1', '2'): (
    ("Glyphe manquant dans une police",
     "Un caractère du texte n'existe pas dans la police incorporée. Cas connus : "
     "l'espace fine insécable (U+202F) et le triangle de puce (U+25B8).",
     "Défaut de la chaîne de compilation (polices de l'image WSL) : signalez-le."),
    ("Fehlende Glyphe in einer Schrift",
     "Ein Zeichen des Textes fehlt in der eingebetteten Schrift. Bekannte Fälle: das "
     "schmale geschützte Leerzeichen (U+202F) und das Aufzählungsdreieck (U+25B8).",
     "Fehler der Kompilierkette (Schriften des WSL-Abbilds): melden Sie ihn.")),
  ('7.21.7', '1'): (
    ("Texte non extractible",
     "Une police ne dit pas à quels caractères ses dessins correspondent : le texte "
     "n'est ni lisible par un lecteur d'écran ni copiable.",
     "Défaut de la chaîne de compilation (polices de l'image WSL) : signalez-le."),
    ("Text nicht extrahierbar",
     "Eine Schrift gibt nicht an, welchen Zeichen ihre Zeichnungen entsprechen: der "
     "Text ist weder für Screenreader lesbar noch kopierbar.",
     "Fehler der Kompilierkette (Schriften des WSL-Abbilds): melden Sie ihn.")),
  ('7.21.8', '1'): (
    ("Caractère absent de la police",
     "Le texte appelle un dessin que la police n'a pas (glyphe « .notdef »).",
     "Cherchez dans l'article un caractère exotique (symbole, alphabet non latin) et "
     "remplacez-le ; sinon, c'est un défaut de la chaîne, signalez-le."),
    ("Zeichen fehlt in der Schrift",
     "Der Text ruft eine Zeichnung ab, die die Schrift nicht hat (Glyphe « .notdef »).",
     "Suchen Sie im Artikel ein exotisches Zeichen (Symbol, nichtlateinisches "
     "Alphabet) und ersetzen Sie es; sonst ist es ein Fehler der Kette, melden Sie "
     "ihn.")),
}

# ── Gabarits de phrases ────────────────────────────────────────────────────────
LANGUES = (
  ('fr', '', {
    'conforme':   'PDF/UA-1 : %s — conforme.',
    'nonconf':    'PDF/UA-1 : %s — NON conforme, %d règle(s) en échec.',
    'nonanalyse': '%s — non analysé par le validateur.',
    'regle':      '  • %s (%s)',
    'repere':     '  ISO 14289-1 %s-%s',
    'occ_1':      '1 fois',
    'occ_n':      '%d fois',
    'pages':      ', page(s) %s',
    'cause':      '      En cause : ',
    'geste':      '      À faire  : ',
    'total_ok':   'Tous les PDF du numéro sont conformes PDF/UA-1 (%d fichier(s)).',
    'total_ko':   '%d fichier(s) sur %d ne sont pas conformes : l\'export est arrêté.',
    'vide':       'Le validateur PDF/UA n\'a rendu aucun verdict : rapport vide.',
    'illisible':  'Rapport PDF/UA illisible : %s',
  }),
  ('de', '[de] ', {
    'conforme':   'PDF/UA-1: %s — konform.',
    'nonconf':    'PDF/UA-1: %s — NICHT konform, %d Regel(n) nicht erfüllt.',
    'nonanalyse': '%s — vom Prüfer nicht analysiert.',
    'regle':      '  • %s (%s)',
    'repere':     '  ISO 14289-1 %s-%s',
    'occ_1':      '1 Mal',
    'occ_n':      '%d Mal',
    'pages':      ', Seite(n) %s',
    'cause':      '      Ursache: ',
    'geste':      '      Zu tun : ',
    'total_ok':   'Alle PDF dieser Ausgabe sind PDF/UA-1-konform (%d Datei(en)).',
    'total_ko':   '%d von %d Datei(en) sind nicht konform: der Export wird angehalten.',
    'vide':       'Der PDF/UA-Prüfer hat kein Urteil abgegeben: leerer Bericht.',
    'illisible':  'PDF/UA-Bericht nicht lesbar: %s',
  }),
)

LARGEUR = 84          # repli de ligne des explications


def dire(marque, texte):
    print('%s %s%s' % (PREFIXE, marque, texte))


def replier(texte, marque, tete):
    """Une explication longue, repliée sous son en-tête, alignée sur sa marge."""
    creux = ' ' * len(tete)
    mots, ligne = texte.split(), ''
    lignes = []
    for mot in mots:
        if ligne and len(ligne) + 1 + len(mot) > LARGEUR:
            lignes.append(ligne)
            ligne = mot
        else:
            ligne = (ligne + ' ' + mot) if ligne else mot
    if ligne:
        lignes.append(ligne)
    for i, l in enumerate(lignes):
        dire(marque, (tete if i == 0 else creux) + l)


def pages_en_cause(regle):
    """Numéros de page (base 1) lus dans les contextes veraPDF. Le contexte est un
    chemin d'objets PDF illisible pour un rédacteur ; seul le numéro de page l'aide."""
    vues = []
    for check in regle.findall('check'):
        m = re.search(r'/pages\[(\d+)\]', check.findtext('context') or '')
        if m:
            n = int(m.group(1)) + 1
            if n not in vues:
                vues.append(n)
    return sorted(vues)


def lire(source):
    try:
        return ET.parse(source)
    except Exception as e:                       # rapport tronqué, vide, non XML
        for _, marque, mots in LANGUES:
            dire(marque, mots['illisible'] % e)
        sys.exit(2)


def main():
    source = sys.argv[1] if len(sys.argv) > 1 else sys.stdin
    arbre = lire(source)

    # Un passage par langue : le rédacteur lit un bloc entier, pas des lignes alternées.
    fichiers = list(arbre.getroot().iter('job'))
    if not fichiers:
        for _, marque, mots in LANGUES:
            dire(marque, mots['vide'])
        sys.exit(2)

    sortie = 0
    for code, marque, mots in LANGUES:
        rates = 0
        for job in fichiers:
            nom = (job.findtext('item/name') or '?').replace('\\', '/').rsplit('/', 1)[-1]
            rapport = job.find('validationReport')
            if rapport is None:
                dire(marque, mots['nonanalyse'] % nom)
                rates += 1
                sortie = max(sortie, 2)
                continue
            if rapport.get('isCompliant') == 'true':
                dire(marque, mots['conforme'] % nom)
                continue
            rates += 1
            sortie = max(sortie, 1)
            details = rapport.find('details')
            regles = details.findall('rule') if details is not None else []
            dire(marque, mots['nonconf'] % (nom, len(regles)))
            for regle in regles:
                clause = regle.get('clause') or '?'
                test = regle.get('testNumber') or '?'
                n = int(regle.get('failedChecks') or 0)
                connue = REGLES.get((clause, test))
                if connue:
                    titre, cause, geste = connue[0 if code == 'fr' else 1]
                else:
                    titre = (regle.findtext('description') or 'règle %s-%s'
                             % (clause, test)).strip()
                    cause, geste = '', ''
                combien = mots['occ_1'] if n == 1 else mots['occ_n'] % n
                pages = pages_en_cause(regle)
                if pages:
                    combien += mots['pages'] % ', '.join(str(p) for p in pages)
                dire(marque, mots['regle'] % (titre, combien))
                if cause:
                    replier(cause, marque, mots['cause'])
                if geste:
                    replier(geste, marque, mots['geste'])
                # Le repère, en dernier et sur sa propre ligne : voir « Deux publics »
                # en tête de fichier. Sa faible indentation le fait tomber du côté du
                # bruit d'outillage dans le cockpit, et il reste dans le journal.
                dire(marque, mots['repere'] % (clause, test))
        if rates:
            dire(marque, mots['total_ko'] % (rates, len(fichiers)))
        else:
            dire(marque, mots['total_ok'] % len(fichiers))

    sys.exit(sortie)


if __name__ == '__main__':
    main()
