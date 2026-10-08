#!/usr/bin/env python3
"""Traduit le rapport XML de veraPDF en quelques lignes qu'un rédacteur peut lire.

    verapdf --flavour ua1 --format xml a.pdf b.pdf > r.xml
    python3 rapport-ua.py r.xml          # ou : ... | python3 rapport-ua.py

Sortie : le verdict en français, puis en allemand (orthographe suisse). Chaque ligne porte
le préfixe « [pdf-ua] », ou « [pdf-ua] [de] » pour l'allemand, comme « [pipeline] » dans
le Makefile.

Codes de sortie :
    0  tous les PDF sont conformes PDF/UA-1
    1  au moins un PDF n'est pas conforme  (verdict)
    2  le rapport est illisible ou vide     (panne d'outillage, pas un verdict)
Le code de veraPDF se lit en amont, dans le Makefile : 4 (fichier introuvable), 7 (fichier
illisible) et 127 (veraPDF absent) sont des pannes. Sinon, un validateur absent se lirait
comme un PDF conforme.

Chaque règle en échec sort ainsi :

    [pdf-ua]   • Titre du document manquant (1 fois, page(s) 3)
    [pdf-ua]         En cause : …
    [pdf-ua]         À faire  : …
    [pdf-ua]   ISO 14289-1 7.1-9

La puce sert à la rédaction : la cause, ce qu'il faut faire, le nombre d'occurrences et
les pages. La ligne « ISO 14289-1 » sert à retrouver la règle chez veraPDF et à signaler un
bogue ; elle reste dans le journal, et le cockpit l'écarte grâce à son retrait de deux
espaces (voir lib/journal.js).

Bibliothèque standard seule (xml.etree) : l'image WSL n'a ni PyYAML ni lxml.
"""
import re
import sys
import xml.etree.ElementTree as ET

PREFIXE = '[pdf-ua]'

# ── Les règles que la chaîne SZH peut casser ────────────────────────────────────
# Pour chacune : un titre, la cause et ce qu'il faut faire. Une règle absente sort avec son
# libellé anglais brut, et sa ligne « ISO 14289-1 » permet de la retrouver chez veraPDF
# (github.com/veraPDF/veraPDF-validation-profiles/wiki/PDFUA-Part-1-rules).
REGLES = {
  # Même forme que la liste « À corriger » du cockpit (lib/constats.js, SECOND_ETAGE) :
  #   titre  un groupe nominal court : ce qui ne va pas ;
  #   cause  pourquoi c'est un défaut, d'où il vient, les cas connus (le cockpit l'affiche
  #          en infobulle, avec le repère ISO) ;
  #   geste  une phrase qui commence par le verbe. Pour un défaut de la chaîne : le
  #          signaler.
  ('5', '1'): (
    ("Le PDF ne s'annonce pas PDF/UA",
     "Les métadonnées XMP du fichier ne portent pas l'identification PDF/UA : le PDF a "
     "probablement été produit sans la variante PDF/UA-1 (voir le journal de "
     "compilation, ligne « balisage PDF indisponible »).",
     "Recompilez ; si le défaut revient, signalez-le."),
    ("Das PDF weist sich nicht als PDF/UA aus",
     "Die XMP-Metadaten enthalten die PDF/UA-Kennung nicht: das PDF wurde "
     "wahrscheinlich ohne die Variante PDF/UA-1 erzeugt (siehe Kompilierprotokoll, "
     "Zeile « balisage PDF indisponible »).",
     "Kompilieren Sie neu; kehrt der Fehler zurück, melden Sie ihn.")),
  ('6.2', '1'): (
    ("PDF non balisé",
     "Le fichier ne déclare pas de balisage (MarkInfo/Marked) : le PDF est sorti par le "
     "repli non balisé. La sortie d'erreur de la compilation dit pourquoi.",
     "Recompilez ; si le défaut revient, signalez-le."),
    ("PDF nicht getaggt",
     "Die Datei deklariert kein Tagging (MarkInfo/Marked): das PDF stammt aus dem "
     "untaggten Rückfall. Die Fehlerausgabe der Kompilierung sagt, warum.",
     "Kompilieren Sie neu; kehrt der Fehler zurück, melden Sie ihn.")),
  ('7.1', '3'): (
    ("Contenu hors de la structure du document",
     "Un texte ou un dessin n'est ni balisé ni marqué décoratif : il est dessiné dans un "
     "calque de transparence, où il perd son rattachement à la structure. Cause connue : "
     "une propriété CSS opacity inférieure à 1 dans la feuille de style. La transparence "
     "ne se règle pas par opacity : la couleur se compose sur son fond et opacity reste à "
     "1. Le filigrane de couverture et le point médian entre auteur·e·s sont déjà traités "
     "ainsi dans pipeline/styles/print.css — s'il en réapparaît un, c'est une opacity qui "
     "vient d'être ajoutée.",
     "Défaut de la chaîne de compilation, pas de l'article : signalez-le."),
    ("Inhalt ausserhalb der Dokumentstruktur",
     "Ein Text oder eine Zeichnung ist weder getaggt noch als dekorativ markiert: er wird "
     "in einer Transparenzebene gezeichnet und verliert dort seine Verbindung zur "
     "Struktur. Bekannte Ursache: eine CSS-Eigenschaft opacity kleiner als 1 im "
     "Stylesheet. Transparenz wird nicht über opacity geregelt: die Farbe wird auf ihrem "
     "Hintergrund gemischt und opacity bleibt auf 1. Wasserzeichen und Mittelpunkt "
     "zwischen den Autorinnen und Autoren sind in pipeline/styles/print.css schon so "
     "gelöst — taucht der Fehler wieder auf, wurde eine neue opacity eingeführt.",
     "Fehler der Kompilierkette, nicht des Artikels: melden Sie ihn.")),
  ('7.1', '9'): (
    ("Titre du document manquant",
     "Les métadonnées du PDF ne portent aucun titre : un lecteur d'écran n'a rien à "
     "annoncer à l'ouverture du fichier.",
     "Saisissez le titre dans la fiche de l'article, puis recompilez."),
    ("Dokumenttitel fehlt",
     "Die PDF-Metadaten enthalten keinen Titel: ein Screenreader hat beim Öffnen der "
     "Datei nichts anzusagen.",
     "Geben Sie den Titel im Datenblatt des Artikels ein und kompilieren Sie neu.")),
  ('7.1', '10'): (
    ("Titre du document non affiché",
     "La préférence d'affichage « DisplayDocTitle » manque : le lecteur PDF affichera le "
     "nom de fichier au lieu du titre.",
     "Défaut de la chaîne de compilation, pas de l'article : signalez-le."),
    ("Dokumenttitel nicht angezeigt",
     "Die Anzeigeeinstellung « DisplayDocTitle » fehlt: der PDF-Betrachter zeigt den "
     "Dateinamen statt des Titels.",
     "Fehler der Kompilierkette, nicht des Artikels: melden Sie ihn.")),
  ('7.1', '11'): (
    ("PDF sans structure",
     "Le fichier ne porte aucun arbre de structure : rien n'y dit ce qui est un titre, un "
     "paragraphe ou un tableau, ni dans quel ordre le lire. Un lecteur d'écran n'a rien à "
     "annoncer que la suite des caractères dessinés. Même cause que « PDF non balisé » : "
     "le document est sorti par le repli non balisé (journal de compilation, ligne "
     "« balisage PDF indisponible »).",
     "Recompilez ; si le défaut revient, signalez-le."),
    ("PDF ohne Struktur",
     "Die Datei enthält keinen Strukturbaum: nichts sagt, was Titel, Absatz oder "
     "Tabelle ist, und in welcher Reihenfolge gelesen wird. Ein Screenreader hat nur "
     "die Folge der gezeichneten Zeichen anzusagen. Gleiche Ursache wie bei « PDF nicht "
     "getaggt »: das Dokument stammt aus dem untaggten Rückfall (Kompilierprotokoll, "
     "Zeile « balisage PDF indisponible »).",
     "Kompilieren Sie neu; kehrt der Fehler zurück, melden Sie ihn.")),
  ('7.2', '29'): (
    ("Langue invalide",
     "Une langue est déclarée dans une forme que la norme ne reconnaît pas ; la fiche de "
     "l'article doit dire fr, de ou it.",
     "Choisissez fr, de ou it comme langue dans la fiche de l'article."),
    ("Ungültige Sprache",
     "Eine Sprache ist in einer Form angegeben, die die Norm nicht kennt; das Datenblatt "
     "des Artikels muss fr, de oder it angeben.",
     "Wählen Sie im Datenblatt des Artikels fr, de oder it als Sprache.")),
  ('7.2', '34'): (
    ("Langue du document non déclarée",
     "Le document ne déclare aucune langue par défaut : un lecteur d'écran ne sait pas "
     "dans quelle langue lire le texte.",
     "Choisissez la langue dans la fiche de l'article, puis recompilez."),
    ("Sprache des Dokuments nicht angegeben",
     "Das Dokument gibt keine Standardsprache an: ein Screenreader weiss nicht, in "
     "welcher Sprache er den Text lesen soll.",
     "Wählen Sie die Sprache im Datenblatt des Artikels und kompilieren Sie neu.")),
  ('7.3', '1'): (
    ("Image sans description",
     "Une image balisée « figure » n'a pas de texte de remplacement : un lecteur d'écran "
     "annoncerait « image » sans rien pouvoir en dire. Une image purement décorative, "
     "déclarée comme telle, sort en décor, hors de la structure. Une image posée dans un "
     "tableau (le bloc des autrices et auteurs, par exemple) est relevée elle aussi.",
     "Ajoutez une description dans « Médias de l'article », ou cochez « Image purement "
     "décorative »."),
    ("Bild ohne Beschreibung",
     "Ein als « Abbildung » getaggtes Bild hat keinen Alternativtext: ein Screenreader "
     "würde « Bild » ansagen, ohne mehr sagen zu können. Ein als rein dekorativ "
     "gekennzeichnetes Bild wird als Dekor ausserhalb der Struktur ausgegeben. Auch ein "
     "Bild in einer Tabelle (etwa im Block der Autorinnen und Autoren) wird gemeldet.",
     "Ergänzen Sie eine Beschreibung unter « Medien des Artikels » oder kreuzen Sie "
     "« Rein dekoratives Bild » an.")),
  ('7.4.2', '1'): (
    ("Niveau de titre sauté",
     "La suite des titres descend de plus d'un cran (par exemple un titre de niveau 3 "
     "juste après un niveau 1) : un lecteur d'écran qui parcourt les titres croit qu'une "
     "section manque.",
     "Un titre saute un niveau (un « Titre 3 » juste après un « Titre 1 »). Placez le "
     "curseur dessus et choisissez Mise en forme → Titre 2."),
    ("Übersprungene Überschriftenebene",
     "Die Überschriften springen um mehr als eine Ebene (etwa Ebene 3 direkt nach "
     "Ebene 1): ein Screenreader, der die Überschriften durchgeht, meint, ein Abschnitt "
     "fehle.",
     "Eine Überschrift überspringt eine Ebene (eine «Überschrift 3» direkt nach einer "
     "«Überschrift 1»). Setzen Sie den Cursor darauf und wählen Sie Formatierung → "
     "Überschrift 2.")),
  ('7.5', '1'): (
    ("Tableau aux en-têtes incomplets",
     "Une cellule n'est reliée à aucun en-tête : un lecteur d'écran ne peut pas dire à "
     "quelle colonne elle appartient. Deux causes connues : le tableau ne déclare pas sa "
     "ligne d'en-tête, ou une cellule d'en-tête est fusionnée sur plusieurs colonnes — le "
     "moteur de rendu ne la rattache alors qu'à la première, et les colonnes suivantes "
     "restent sans en-tête.",
     "Ouvrez le tableau, déclarez sa ligne d'en-tête et évitez d'y fusionner des cellules."),
    ("Tabelle mit unvollständigen Kopfzellen",
     "Eine Zelle ist mit keiner Kopfzelle verbunden: ein Screenreader kann nicht sagen, "
     "zu welcher Spalte sie gehört. Zwei bekannte Ursachen: die Tabelle legt ihre "
     "Kopfzeile nicht fest, oder eine Kopfzelle ist über mehrere Spalten verbunden — die "
     "Rendering-Engine ordnet sie dann nur der ersten zu, und die folgenden Spalten "
     "bleiben ohne Kopfzelle.",
     "Öffnen Sie die Tabelle, legen Sie die Kopfzeile fest und verbinden Sie darin keine "
     "Zellen.")),
  ('7.5', '2'): (
    ("En-tête de tableau introuvable",
     "Une cellule renvoie à un en-tête qui n'est pas dans le tableau : les en-têtes "
     "déclarés ne correspondent plus aux cellules.",
     "Ouvrez le tableau et déclarez de nouveau sa ligne d'en-tête."),
    ("Kopfzelle der Tabelle nicht gefunden",
     "Eine Zelle verweist auf eine Kopfzelle, die es in der Tabelle nicht gibt: die "
     "festgelegten Kopfzellen passen nicht mehr zu den Zellen.",
     "Öffnen Sie die Tabelle und legen Sie ihre Kopfzeile erneut fest.")),
  ('7.18.3', '1'): (
    ("Ordre de tabulation non déclaré",
     "Une page porte des liens, mais ne dit pas que la touche de tabulation doit les "
     "parcourir dans l'ordre du document. Qui lit au clavier les reçoit alors dans "
     "l'ordre où ils ont été écrits dans le fichier, qui n'est pas celui de la lecture. "
     "Le moteur de rendu n'écrit pas cette clé.",
     "Défaut de la chaîne de compilation, pas de l'article : signalez-le."),
    ("Tabulatorreihenfolge nicht angegeben",
     "Eine Seite enthält Verknüpfungen, sagt aber nicht, dass die Tabulatortaste sie in "
     "der Reihenfolge des Dokuments durchlaufen soll. Wer mit der Tastatur liest, "
     "erhält sie sonst in der Reihenfolge, in der sie in die Datei geschrieben wurden. "
     "Die Rendering-Engine schreibt diesen Schlüssel nicht.",
     "Fehler der Kompilierkette, nicht des Artikels: melden Sie ihn.")),
  ('7.18.5', '1'): (
    ("Lien mal balisé",
     "Des zones cliquables ne sont pas rattachées à un élément « lien » de la structure. "
     "Cause connue : un « a » du gabarit ou de la chaîne contient une balise interne "
     "(span, svg, sup) ; le moteur de rendu produit alors une zone cliquable par boîte, "
     "et une seule est correcte. Un « a » ne doit contenir que du texte : dans "
     "pipeline/templates/szh-article.html, la flèche et le logo sont volontairement à "
     "l'extérieur du lien, et la chaîne réordonne les appels de note en « sup > a » — si "
     "l'erreur revient, c'est qu'un élément a été remis dans un lien.",
     "Défaut de la chaîne de compilation, pas de l'article : signalez-le."),
    ("Link falsch getaggt",
     "Klickbare Bereiche sind nicht mit einem « Link »-Element der Struktur verbunden. "
     "Bekannte Ursache: ein « a » in der Vorlage oder in der Kette enthält ein inneres "
     "Tag (span, svg, sup); die Rendering-Engine erzeugt dann einen klickbaren Bereich "
     "pro Box, und nur einer davon ist korrekt. Ein « a » darf nur Text enthalten: in "
     "pipeline/templates/szh-article.html liegen Pfeil und Logo bewusst ausserhalb des "
     "Links, und die Kette ordnet die Fussnotenzeichen zu « sup > a » um — kehrt der "
     "Fehler zurück, wurde wieder ein Element in einen Link gesetzt.",
     "Fehler der Kompilierkette, nicht des Artikels: melden Sie ihn.")),
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
    ("Calque de dessin réutilisé",
     "Un même calque (Form XObject) porte du contenu balisé et est référencé plusieurs "
     "fois : il perd sa structure. Cause connue : une propriété CSS opacity ou un filtre "
     "de transparence. Même remède que pour « Contenu hors de la structure du "
     "document » : supprimer l'opacity de la feuille de style et pré-mélanger la couleur.",
     "Défaut de la chaîne de compilation, pas de l'article : signalez-le."),
    ("Zeichenebene mehrfach genutzt",
     "Dieselbe Ebene (Form XObject) trägt getaggten Inhalt und wird mehrfach "
     "referenziert: sie verliert ihre Struktur. Bekannte Ursache: eine CSS-Eigenschaft "
     "opacity oder ein Transparenzfilter. Gleiche Abhilfe wie bei « Inhalt ausserhalb "
     "der Dokumentstruktur »: die opacity im Stylesheet entfernen und die Farbe "
     "vormischen.",
     "Fehler der Kompilierkette, nicht des Artikels: melden Sie ihn.")),
  ('7.21.4.1', '1'): (
    ("Police non incorporée",
     "Une police utilisée n'est pas embarquée dans le fichier : le texte s'affichera "
     "avec une autre police, ou pas du tout. Ce sont les polices du poste de "
     "compilation qui manquent.",
     "Défaut de la chaîne de compilation, pas de l'article : signalez-le."),
    ("Schrift nicht eingebettet",
     "Eine verwendete Schrift steckt nicht in der Datei: der Text erscheint mit einer "
     "anderen Schrift oder gar nicht. Es fehlen Schriften auf dem Kompilier-Rechner.",
     "Fehler der Kompilierkette, nicht des Artikels: melden Sie ihn.")),
  ('7.21.4.1', '2'): (
    ("Glyphe manquant dans une police",
     "Un caractère du texte n'existe pas dans la police incorporée. Cas connus : "
     "l'espace fine insécable (U+202F) et le triangle de puce (U+25B8).",
     "Défaut de la chaîne de compilation, pas de l'article : signalez-le."),
    ("Fehlende Glyphe in einer Schrift",
     "Ein Zeichen des Textes fehlt in der eingebetteten Schrift. Bekannte Fälle: das "
     "schmale geschützte Leerzeichen (U+202F) und das Aufzählungsdreieck (U+25B8).",
     "Fehler der Kompilierkette, nicht des Artikels: melden Sie ihn.")),
  ('7.21.7', '1'): (
    ("Texte non extractible",
     "Une police ne dit pas à quels caractères ses dessins correspondent : le texte "
     "n'est ni lisible par un lecteur d'écran ni copiable.",
     "Défaut de la chaîne de compilation, pas de l'article : signalez-le."),
    ("Text nicht extrahierbar",
     "Eine Schrift gibt nicht an, welchen Zeichen ihre Zeichnungen entsprechen: der "
     "Text ist weder für Screenreader lesbar noch kopierbar.",
     "Fehler der Kompilierkette, nicht des Artikels: melden Sie ihn.")),
  ('7.21.8', '1'): (
    ("Caractère absent de la police",
     "Le texte appelle un dessin que la police n'a pas (glyphe « .notdef ») : un "
     "caractère exotique (symbole, alphabet non latin), le plus souvent. S'il n'y en a "
     "aucun dans l'article, c'est un défaut de la chaîne.",
     "Remplacez le caractère exotique de l'article ; s'il n'y en a aucun, signalez-le."),
    ("Zeichen fehlt in der Schrift",
     "Der Text ruft eine Zeichnung ab, die die Schrift nicht hat (Glyphe « .notdef »): "
     "meist ein exotisches Zeichen (Symbol, nichtlateinisches Alphabet). Gibt es im "
     "Artikel keines, ist es ein Fehler der Kette.",
     "Ersetzen Sie das exotische Zeichen im Artikel; gibt es keines, melden Sie es.")),
}

# ── Les défauts de la chaîne, dits à la rédaction ───────────────────────────────
# Une phrase par langue, qui remplace la cause dans la puce pour la rédaction. La cause de
# REGLES devient le détail technique, écrit sous le repère ISO : il reste dans le journal
# de l'export, et le cockpit ne le lit pas.
CHAINE = {
  ('5', '1'): (
    "Le fichier ne dit pas qu'il suit la norme d'accessibilité ; votre article n'y est pour rien.",
    "Die Datei gibt nicht an, dass sie der Barrierefreiheitsnorm folgt; Ihr Artikel ist nicht "
    "die Ursache."),
  ('6.2', '1'): (
    "Le PDF est sorti sans balisage, un lecteur d'écran ne peut pas le suivre ; votre article "
    "n'y est pour rien.",
    "Das PDF wurde ohne Tagging erzeugt, ein Screenreader kann ihm nicht folgen; Ihr Artikel "
    "ist nicht die Ursache."),
  ('7.1', '3'): (
    "Un élément de la mise en page échappe au balisage ; votre article n'y est pour rien.",
    "Ein Element des Layouts entgeht dem Tagging; Ihr Artikel ist nicht die Ursache."),
  ('7.1', '10'): (
    "Le lecteur PDF affichera le nom du fichier au lieu du titre ; votre article n'y est pour "
    "rien.",
    "Der PDF-Betrachter zeigt den Dateinamen statt des Titels; Ihr Artikel ist nicht die "
    "Ursache."),
  ('7.1', '11'): (
    "Le PDF ne dit pas ce qui est un titre, un paragraphe ou un tableau ; votre article n'y est "
    "pour rien.",
    "Das PDF sagt nicht, was Titel, Absatz oder Tabelle ist; Ihr Artikel ist nicht die "
    "Ursache."),
  ('7.18.3', '1'): (
    "Au clavier, les liens d'une page ne se parcourent pas dans l'ordre de lecture ; votre "
    "article n'y est pour rien.",
    "Mit der Tastatur werden die Links einer Seite nicht in Lesereihenfolge durchlaufen; Ihr "
    "Artikel ist nicht die Ursache."),
  ('7.18.5', '1'): (
    "Un lien de la mise en page est mal annoncé aux lecteurs d'écran ; votre article n'y est "
    "pour rien.",
    "Ein Link des Layouts wird Screenreadern falsch angesagt; Ihr Artikel ist nicht die "
    "Ursache."),
  ('7.18.5', '2'): (
    "Une zone cliquable de la mise en page n'a pas de description ; votre article n'y est pour "
    "rien.",
    "Ein klickbarer Bereich des Layouts hat keine Beschreibung; Ihr Artikel ist nicht die "
    "Ursache."),
  ('7.18.1', '2'): (
    "Une annotation de la mise en page n'a pas de description ; votre article n'y est pour "
    "rien.",
    "Eine Anmerkung des Layouts hat keine Beschreibung; Ihr Artikel ist nicht die Ursache."),
  ('7.20', '2'): (
    "Un élément de la mise en page perd son balisage ; votre article n'y est pour rien.",
    "Ein Element des Layouts verliert sein Tagging; Ihr Artikel ist nicht die Ursache."),
  ('7.21.4.1', '1'): (
    "Une police manque sur le poste qui compile ; votre article n'y est pour rien.",
    "Auf dem Kompilier-Rechner fehlt eine Schrift; Ihr Artikel ist nicht die Ursache."),
  ('7.21.4.1', '2'): (
    "Un caractère du texte manque dans une police de la mise en page ; votre article n'y est "
    "pour rien.",
    "Ein Zeichen des Textes fehlt in einer Schrift des Layouts; Ihr Artikel ist nicht die "
    "Ursache."),
  ('7.21.7', '1'): (
    "Une police ne permet ni de lire ni de copier le texte ; votre article n'y est pour rien.",
    "Eine Schrift lässt den Text weder vorlesen noch kopieren; Ihr Artikel ist nicht die "
    "Ursache."),
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
    'technique':  '  Détail technique : ',
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
    'technique':  '  Technisches Detail: ',
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
                technique = ''
                redaction = CHAINE.get((clause, test))
                if redaction:
                    technique, cause = cause, redaction[0 if code == 'fr' else 1]
                combien = mots['occ_1'] if n == 1 else mots['occ_n'] % n
                pages = pages_en_cause(regle)
                if pages:
                    combien += mots['pages'] % ', '.join(str(p) for p in pages)
                dire(marque, mots['regle'] % (titre, combien))
                if cause:
                    replier(cause, marque, mots['cause'])
                if geste:
                    replier(geste, marque, mots['geste'])
                # Le repère ISO, sur sa propre ligne (voir l'en-tête).
                dire(marque, mots['repere'] % (clause, test))
                # Après le repère, lib/journal.js ne rattache plus rien à la règle : le
                # détail technique reste dans le journal seulement.
                if technique:
                    replier(technique, marque, mots['technique'])
        if rates:
            dire(marque, mots['total_ko'] % (rates, len(fichiers)))
        else:
            dire(marque, mots['total_ok'] % len(fichiers))

    sys.exit(sortie)


if __name__ == '__main__':
    main()
