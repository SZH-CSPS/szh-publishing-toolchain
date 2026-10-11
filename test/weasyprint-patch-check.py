# Vérifie que les patchs SZH de WeasyPrint (image/patches/weasyprint-<version>/) font leur
# travail. Chaque cas est rendu en PDF/UA-1 par le WeasyPrint qui exécute ce script, puis
# jugé par veraPDF et relu dans l'arbre de structure et le flux de contenu.
#
#   /opt/weasyprint/bin/python3 test/weasyprint-patch-check.py
#   (dans la WSL SZH-Publishing ; en CI : "$RUNNER_TEMP/weasyprint/bin/python")
#
# VERAPDF et VERAPDF_JAVA : mêmes variables et mêmes valeurs par défaut que le Makefile.
# veraPDF absent est un échec.
#
# Seuls les cas des patchs appliqués sont jugés : image/patch-weasyprint.sh en écrit la
# liste dans weasyprint/szh-patchs.txt. Liste absente, ou patch appliqué sans cas ici :
# échec.
#
# Ce que chaque patch doit garantir (voir son en-tête) :
#   10-tableaux-entetes : un th colspan/rowspan est inscrit sur toutes les colonnes/lignes
#      qu'il couvre (sans lui : /Headers [] sur la 2e colonne d'un « Punkte » colspan=2,
#      PDF/UA 7.5-1) ; l'attribut HTML `headers` l'emporte sur la position ; un th en
#      display: block est ignoré, sans erreur ;
#   15-images-decoratives : une <img alt="" role="presentation"> sort en artefact, sans
#      /Figure (sinon 7.3-1), et reste dessinée ; dans un lien, son annotation est
#      rattachée au /Link ;
#   20-cesure-trait : le trait ajouté par la césure est un /Span /ActualText U+00AD autour
#      de ce seul glyphe (sinon « ensei‐gnants » au copier-coller) ;
#   25-espace-fin-de-ligne : une ligne coupée sur une espace garde cette espace dans la
#      couche texte (sinon « lamarche ») ; le dessin de l'espace est dans le 20, sans lequel
#      ce patch ne produit rien : posé seul, c'est un échec ;
#   30-marges-artefact : en-tête, pied et folio sont des /Artifact /Pagination, sans MCID
#      orphelin ; une boîte de marge qui porte un lien reste du contenu balisé ;
#   40-xmp-dc-language : la langue de <html lang> est en dc:language dans le XMP, au sein
#      de l'unique rdf:RDF du paquet (pypdf ne lit que le premier) ;
#   50-notes-doublon : une note reportée à la page suivante n'y est pas imprimée une
#      seconde fois quand un target-counter fait repaginer, ni perdue quand elle est
#      reportée depuis la dernière page ;
#   55-notes-reportees : une note reste sur la page de son appel quand c'est un paragraphe
#      suivant qui manque de lignes pour orphans ; c'est ce paragraphe qui part ;
#   60-langue-element : un élément dont lang change la langue héritée porte /Lang, bloc ou
#      en ligne (/Span) ; ni ses descendants ni un lang égal à l'héritée n'en reçoivent, ni
#      un lang mal formé ou vide (sinon 7.2-29) ;
#   65-nom-des-liens : le /Contents d'un lien vaut aria-label, sinon son texte affiché
#      (espaces normalisés, sans les notes ni le texte masqué), sinon l'alt de ses images,
#      sinon title, sinon sa cible ; un lien à aria-label ou sans texte porte le même nom
#      en /Alt de son /Link, un lien à texte n'en a pas ; la cible n'est jamais un /Alt, et
#      une image sans alt dans un lien reste une /Figure sans /Alt ;
#   70-espaces-justifiees : dans une ligne justifiée, aucun glyphe espace n'est précédé
#      d'un décalage du TJ (sinon pdfium y déduit une espace générée de largeur nulle et
#      écarte la vraie : mots collés dans Edge), et le texte extrait garde ses mots ;
#   75-auteurs-info : /Info /Author joint les auteurs « Nom, Prénom » par « ; », et
#      dc:creator garde un rdf:li par auteur ;
#   80-notes-balisees : chaque note est une /Note à /ID, rangée juste après son appel
#      (/Reference) dans l'élément qui le contient, même reportée à la page suivante ; son
#      numéro est un /Lbl ; aucune note n'est restée en bas de page dans l'arbre ; les /ID
#      sont dans l'/IDTree ; une
#      note portée par un lien, une liste ou une image garde son rôle dans une /Note ; une
#      note appelée dans un lien, un titre ou un th suit le lien, le titre ou le tableau ;
#   85-listes-imbriquees : une sous-liste est un /L enfant du /LBody de son item ; un /LI
#      ne contient que /Lbl et /LBody (sinon 7.2-20 sur <li><p>), même à puce en ligne,
#      dont le texte suit l'ordre de la ligne ; une <dl> fait un /LI par groupe de termes
#      (/Lbl) et de définitions (/LBody) ;
#   90-un-mcid-par-element : les lignes d'un paragraphe partagent un seul contenu marqué
#      par page, un seul /Span (sinon le lecteur PDF d'Edge colle la fin d'une ligne au
#      début de la suivante) ; le texte d'un élément en ligne (em, lien, lang) garde le
#      sien, et le texte du paragraphe qui l'entoure reste coupé à ses frontières ; un
#      objet en ligne peint plus tard (image, SVG, flottant, positionné, lien vide) coupe
#      aussi le texte, un <br> et une ligne de pre aussi ; une boîte de texte jamais
#      dessinée lève toujours le KeyError de WeasyPrint. Sans le 20 et le 25 : échec.
# Ce qu'ils ne changent pas : alt="" seul reste une /Figure sans /Alt, signalée, car
# l'import écrit alt="" pour toute image sans description. Le cas f doit donc échouer en
# 7.3 ; s'il passe, le contrôle ne détecte plus rien ou le patch va trop loin. Le trait
# d'un composé coupé à son trait reste un trait, et ni un <br> ni une fin de paragraphe ne
# reçoivent d'espace.
import os
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

import weasyprint
from PIL import Image
from pypdf import PdfReader
from pypdf.generic import (
    ArrayObject, ContentStream, DictionaryObject, IndirectObject, NumberObject,
    TextStringObject)
from weasyprint import HTML

VERAPDF = os.environ.get('VERAPDF', '/opt/verapdf-cli/verapdf')
VERAPDF_JAVA = os.environ.get('VERAPDF_JAVA', '/opt/jre-min')
TEMOIN = os.path.join(os.path.dirname(weasyprint.__file__), 'szh-patchs.txt')
SHY = chr(0xAD)

ENTETE = ('<!doctype html><html lang="de"><head><meta charset="utf-8"><title>T</title>'
          '</head><body>')
PIED = '</body></html>'

(ENTETES, DECOR, CESURE, ESPACE, MARGES, XMP, DOUBLON, REPORTEE, LANGUE, LIENS,
 JUSTIFIE, AUTEURS, NOTES_BALISEES, LISTES, MCID_LIGNES) = (
    '10-tableaux-entetes.patch', '15-images-decoratives.patch', '20-cesure-trait.patch',
    '25-espace-fin-de-ligne.patch', '30-marges-artefact.patch', '40-xmp-dc-language.patch',
    '50-notes-doublon.patch', '55-notes-reportees.patch', '60-langue-element.patch',
    '65-nom-des-liens.patch', '70-espaces-justifiees.patch', '75-auteurs-info.patch',
    '80-notes-balisees.patch', '85-listes-imbriquees.patch',
    '90-un-mcid-par-element.patch')
AUTEURS_NOMS = ('Fictive-Dumont, Élodie', 'Przykład, Łukasz')

# Paragraphe justifié en colonne étroite : de larges écarts entre les mots.
JUSTIFIE_TEXTE = ('Die Teilhabe misst sich an dem, was jedes Kind tun kann, und nicht an '
                  'dem, was die Schule es anschauen lässt. Die Massnahmen werden mit der '
                  'Familie besprochen und in einem Plan festgehalten.')

# Lien vide de taille fixe, comme l'icône ORCID ou le retour à l'appel de Pronto.
ICONE = '<style>a.icone{display:inline-block;width:4mm;height:4mm;background:#a6ce39}</style>'

# Pages de 100 × 80 mm à 12 lignes de 5 mm ; un renvoi target-counter vers la dernière
# page fait repaginer.
NOTES = ('<style>@page{size:100mm 80mm;margin:10mm;@footnote{margin-top:1mm}}'
         ' body{font:4mm/5mm sans-serif;margin:0;orphans:2;widows:2} p{margin:0}'
         ' .note{float:footnote} ::footnote-call{line-height:0;vertical-align:super;'
         'font-size:70%}'
         ' a.ref::after{content:" S. " target-counter(attr(href), page)}'
         ' .saut{break-before:page}</style>')
FIN = ('<p class="saut">d1 <a class="ref" href="#fin">Verweis</a></p>'
       '<p class="saut" id="fin">Ende</p>')

# nom : (patch, corps HTML, clauses veraPDF en échec attendues)
CAS = {
    # Tableau d'un article réel, réduit : « Punkte » colspan=2.
    'a-colspan': (ENTETES,
                  '<table><caption>C</caption><thead><tr><th scope="col">X</th>'
                  '<th scope="col">Beschreibung</th><th scope="colgroup" colspan="2">Punkte'
                  '</th></tr></thead><tbody><tr><td>1. Hilfe</td><td colspan="2">Ermutigen'
                  '</td><td>0</td></tr></tbody></table>', set()),
    # En-tête de ligne rowspan=2 : sans patch, la 2e ligne perd son en-tête et se décale.
    'd-rowspan': (ENTETES,
                  '<table><caption>C</caption><thead><tr><td></td><th scope="col">Wert</th>'
                  '<th scope="col">Note</th></tr></thead><tbody><tr><th scope="row" '
                  'rowspan="2">Gruppe</th><td>1</td><td>a</td></tr><tr><td>2</td><td>b</td>'
                  '</tr></tbody></table>', set()),
    # `headers` explicite, qui contredit la position.
    'c-headers': (ENTETES,
                  '<table><caption>C</caption><thead><tr><th id="h0" scope="col">A</th>'
                  '<th id="h1" scope="col">B</th><th id="h2" scope="col">C</th></tr></thead>'
                  '<tbody><tr><td headers="h0">1</td><td headers="h2">2</td>'
                  '<td headers="h1 h2">3</td></tr></tbody></table>', set()),
    # Portrait décoratif dans un tableau (bloc auteur) et image décrite.
    'e-decor': (DECOR,
                '<table><caption>C</caption><tr><td><img src="img.png" alt="" '
                'role="presentation" width="80"></td><td><img src="img.png" '
                'alt="Porträt" width="80"></td></tr></table>', set()),
    # th et tr en display: block : ce ne sont plus des cellules de grille, ignorées sans
    # erreur. HTML non conforme par construction : veraPDF n'est pas jugé (None).
    'u-tableau-bloc': (ENTETES,
                       '<style>.bloc tr,.bloc th{display:block}</style><table class="bloc">'
                       '<tr><th>Block</th></tr></table><table><caption>C</caption><thead>'
                       '<tr><th scope="col">A</th><th scope="col">B</th></tr></thead><tbody>'
                       '<tr><td>1</td><td>2</td></tr></tbody></table>', None),
    # Décor dans un lien : l'annotation de l'image reste rattachée au /Link.
    'v-decor-lien': (DECOR,
                     '<p><a href="https://www.szh.ch/"><img src="img.png" alt="" '
                     'role="presentation" width="20"> SZH</a></p>', set()),
    # Décor seul : aucune /Figure ne doit rester, mais l'image doit être peinte.
    'e-decor-seul': (DECOR,
                     '<table><caption>C</caption><tr><td><img src="img.png" alt="" '
                     'role="presentation" width="80"></td><td>Name</td></tr></table>', set()),
    # alt="" seul reste signalé (7.3-1).
    'f-alt-vide-seul': (DECOR,
                        '<table><caption>C</caption><tr><td><img src="img.png" alt="" '
                        'width="80"></td><td>x</td></tr></table>', {'7.3-1'}),
    # Non-régression : tableau ordinaire et figure décrite.
    'g-ordinaire': (DECOR,
                    '<table><caption>C</caption><thead><tr><th scope="col">A</th>'
                    '<th scope="col">B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr>'
                    '</tbody></table><figure><img src="img.png" alt="Ein Bild" width="100">'
                    '<figcaption>Legende</figcaption></figure>', set()),
    # Césure : plusieurs mots coupés dans une colonne étroite.
    'h-cesure': (CESURE,
                 '<p lang="fr" style="width:6em;hyphens:auto">Les enseignants spécialisés '
                 'accompagnent institutionnellement les élèves.</p>', set()),
    # Composé coupé à son trait : WeasyPrint n'y ajoute rien, il ne faut rien baliser.
    # hyphenate-character "-" : le trait de césure et celui du composé sont alors le même
    # caractère, seul le patch sait lequel il a ajouté.
    'i-compose': (CESURE,
                  "<p lang=\"fr\" style=\"width:3em;hyphenate-character:'-'\">Hess-Klein "
                  'Hess-Klein</p>', set()),
    # Un mot par ligne : espace en fin de ligne, sauf au <br> et en fin de paragraphe.
    'j-espace': (ESPACE,
                 '<p style="width:1em">un deux trois<br>quatre <em>cinq</em> six</p>'
                 '<p>sept</p>', set()),
    # En-tête, folio, marge de côté en artefacts ; pied à lien, qui doit rester balisé.
    'k-marges': (MARGES,
                 '<style>@page{@top-center{content:"En-tête courant"} '
                 '@bottom-right{content:counter(page)} @left-middle{content:"Côté"} '
                 '@bottom-center{content:element(pied)}} .pied{position:running(pied)}'
                 '</style><div class="pied">Voir <a href="https://www.szh.ch">szh.ch</a>'
                 '</div><p>Texte courant.</p>', set()),
    # Langue du document (ENTETE : lang="de") dans le XMP.
    'l-xmp-langue': (XMP, '<p>Ein Satz.</p>', set()),
    # Appel sur la dernière ligne de la p. 1 : la note n'y tient pas, elle passe en p. 2,
    # qui est « à jour » à la repagination ; sans le patch, la p. 3 refaite la reprend.
    'm-doublon': (DOUBLON,
                  NOTES + '<p style="orphans:1;widows:1">a1 <a class="ref" href="#fin">'
                  'Verweis</a><br>a2<br>a3<br>a4<br>a5<br>a6<br>a7<br>a8<br>a9<br>a10<br>'
                  'a11 Aufruf<span class="note">Fussnote eins, Zeile 1<br>Zeile 2</span>'
                  '</p><p>b1</p>' + FIN, set()),
    # Note appelée à la fin du dernier paragraphe, reportée seule sur une page de plus,
    # alors qu'un renvoi target-counter fait repaginer : sans le patch, elle disparaît.
    'm-reportee-fin': (DOUBLON,
                       NOTES + '<p style="orphans:1;widows:1">a1 <a class="ref" href="#ziel">'
                       'Verweis</a>' + ''.join(f'<br>a{n}' for n in range(2, 21)) +
                       '<br>a21 Aufruf<span class="note">Letzte Fussnote, Zeile 1<br>'
                       'Zeile 2<br>Zeile 3<br>Zeile 4</span></p><p id="ziel">Ende</p>',
                       set()),
    # Le paragraphe « c » n'a qu'une ligne en bas de la p. 1 (orphans: 2) : sans le patch,
    # la note du paragraphe « a » est chassée en p. 2 pour y loger c2.
    'n-reportee': (REPORTEE,
                   NOTES + '<p>a1 <a class="ref" href="#fin">Verweis</a> Aufruf<span '
                   'class="note">Fussnote eins, Zeile 1<br>Zeile 2</span><br>a2<br>a3</p>'
                   '<p>b1<br>b2<br>b3<br>b4<br>b5</p><p>c1<br>c2<br>c3<br>c4<br>c5</p>'
                   + FIN, set()),
    # Document allemand (ENTETE) : résumé français, citation anglaise, mot anglais, et un
    # lang="de" redondant qui ne doit rien produire.
    'o-langue': (LANGUE,
                 '<p>Ein Satz.</p><div lang="fr"><p>Résumé en <em>français</em>.</p></div>'
                 '<blockquote lang="en"><p>A quotation.</p></blockquote>'
                 '<p>Ein <span lang="en">Mindset</span> und <span lang="de">Wort</span>.</p>',
                 set()),
    # Valeurs de lang mal formées ou vides : aucune /Lang, sinon veraPDF 7.2-29.
    'w-langue-invalide': (LANGUE,
                          '<p>Ein <span lang="en_US">Wort</span>, <span lang="irgend was">'
                          'Satz</span>, <span lang="">leer</span> und <span lang="EN-gb">'
                          'Word</span>.</p>', set()),
    # Lien à texte, ORCID et retour à l'appel vides à aria-label, lien à title seul, lien
    # sans aucun nom, lien interne à texte sur plusieurs espaces. Pas d'élément dans un lien
    # à texte : WeasyPrint en fait un /NonStruct sous le /Link, refusé en 7.18.5-1.
    'p-liens': (LIENS,
                ICONE + '<p id="appel">Siehe <a href="https://www.szh.ch/">die Website</a>.</p>'
                '<p><a class="icone" href="https://orcid.org/0000-0002-1825-0097" '
                'aria-label="ORCID von Anna Muster"></a> '
                '<a class="icone" href="#appel" aria-label="Zurück zum Verweis 1"></a> '
                '<a class="icone" href="#ende" title="Zum Ende"></a> '
                '<a class="icone" href="https://creativecommons.org/licenses/by/4.0/"></a></p>'
                '<p id="ende"><a href="#appel">Zum   Anfang\n zurück</a></p>',
                set()),
    # Images dans des liens : une image sans description reste une /Figure sans /Alt,
    # signalée (7.3-1), et ne prend pas la cible pour nom ; une image décrite nomme son
    # lien.
    'x-liens-images': (LIENS,
                       '<p><a href="https://www.szh.ch/a"><img src="img.png" alt="" '
                       'width="20"></a> <a href="https://www.szh.ch/b"><img src="img.png" '
                       'alt="Logo" width="20"></a></p>', {'7.3-1', '7.18.5-1'}),
    # Le nom d'un lien ne compte ni le texte masqué, ni le corps d'une note appelée
    # dedans ; deux blocs y sont séparés par une espace. Notes et blocs dans un lien :
    # veraPDF n'est pas jugé (None).
    'x-liens-textes': (LIENS,
                       '<style>.note{float:footnote}</style><p id="anfang">'
                       '<a href="#ende">Sichtbar<span style="display:none">versteckt</span>'
                       '<span style="visibility:hidden">unsichtbar</span><span class="note">'
                       'Fussnote im Link.</span></a></p><div><a href="#anfang" '
                       'style="display:block"><span style="display:block">Erster</span>'
                       '<span style="display:block">Zweiter</span></a></div>'
                       '<p id="ende">Ende</p>', None),
    'q-justifie': (JUSTIFIE,
                   '<p style="width:60mm;text-align:justify;font:11pt sans-serif">'
                   + JUSTIFIE_TEXTE + '</p>', set()),
    # Deux auteurs « Nom, Prénom », comme les écrit Pronto.
    'r-auteurs': (AUTEURS,
                  ''.join(f'<meta name="author" content="{a}">' for a in AUTEURS_NOMS)
                  + '<p>Ein Satz.</p>', set()),
    # Note au milieu d'une phrase, dans un item de liste, deux notes dans un paragraphe.
    # Avec les notes 1 à 3, la p. 1 garde 8 lignes de texte : la note 4, appelée à la
    # 8e, n'y tient plus et passe en p. 2. La note 5 est en p. 2 avec son appel.
    's-notes': (NOTES_BALISEES,
                NOTES + '<style>ul{margin:0}</style><p>Ein Satz<span class="note">Note '
                'eins.</span> mit Note.</p><ul><li>Punkt a</li><li>Punkt b<span '
                'class="note">Note zwei.</span></li><li>Punkt c</li></ul>'
                '<p style="orphans:1;widows:1">Zwei<span class="note">Note drei.</span> '
                'Noten<br>y1<br>y2<br>y3 Aufruf<span class="note">Note vier.</span></p>'
                '<p>z1<br>z2 Aufruf<span class="note">Note fünf, Zeile 1<br>Zeile 2</span>'
                '</p><p>Ende</p>', set()),
    # Notes portées par une liste et par une image : enveloppées dans une /Note, sans
    # perdre leur rôle. Notes appelées dans un en-tête de tableau et dans un titre :
    # rangées après le tableau et après le titre.
    's-notes-elements': (NOTES_BALISEES,
                         NOTES + '<style>ul{margin:0}</style><h1>Titel<span class="note">'
                         'Im Titel.</span></h1><div>Liste<ul class="note"><li>Punkt</li>'
                         '</ul> danach.</div><p>Bild<img class="note" src="img.png" '
                         'alt="Bild" width="20"> danach.</p><table><caption>C</caption>'
                         '<thead><tr><th scope="col">Punkte<span class="note">Im Kopf.'
                         '</span></th></tr></thead><tbody><tr><td>1</td></tr></tbody>'
                         '</table>', set()),
    # Note portée par un lien, notes appelées dans un lien, nommé ou non par aria-label :
    # la note suit le lien. Liens à éléments : veraPDF n'est pas jugé (None).
    's-notes-liens': (NOTES_BALISEES,
                      NOTES + '<p>Link<a class="note" href="https://www.szh.ch/">Website</a>'
                      ' danach.</p><p><a href="https://www.szh.ch/">Website<span '
                      'class="note">Im Link.</span></a> danach.</p><p><a '
                      'href="https://www.szh.ch/" aria-label="SZH">Website<span '
                      'class="note">Im benannten Link.</span></a> danach.</p>', None),
    # Sous-liste entre deux textes d'un item, item à paragraphe (sans le patch : /P sous
    # /LI, 7.2-20), item réduit à une sous-liste, liste de définition à deux définitions
    # pour un terme et à deux termes pour une définition.
    't-listes': (LISTES,
                 '<ul><li>a</li><li>ba<ul><li>b1</li><li>b2</li></ul>bb</li><li>c</li></ul>'
                 '<ol><li><p>Schritt eins</p><ol><li>Teilschritt</li></ol></li>'
                 '<li><ul><li>nur eine Liste</li></ul></li></ol>'
                 '<dl><dt>Logopädie</dt><dd>Sprache.</dd><dt>Psychomotorik</dt>'
                 '<dd>Bewegung.</dd><dd>Zweite Definition.</dd><dt>Ergotherapie</dt>'
                 '<dt>Ergo</dt><dd>Zwei Begriffe.</dd></dl>', set()),
    # Puce dans la ligne : tout le texte de l'item, hors puce, dans son /LBody, dans
    # l'ordre de la ligne.
    't-liste-en-ligne': (LISTES,
                         '<ul style="list-style-position:inside"><li>Q01 eins <em>Q02 zwei'
                         '</em> Q03 drei <a href="#ziel">Q04 vier</a> Q05 fünf</li></ul>'
                         '<p id="ziel">Ziel</p>', set()),
    # Un mot par ligne, 12 lignes en p. 1 et 4 en p. 2 : un seul /Span et un seul MCID
    # pour le paragraphe sur chaque page.
    'y-mcid-lignes': (MCID_LIGNES,
                      NOTES + '<p style="width:15mm;orphans:1;widows:1">'
                      + ' '.join(f'Wort{n}' for n in range(1, 17)) + '</p>', set()),
    # Texte du paragraphe sur plusieurs lignes, coupé par un em sur deux lignes, un lien
    # et un mot français : quatre /Span pour le texte du paragraphe, un par morceau.
    'y-mcid-frontieres': (MCID_LIGNES,
                          '<p style="width:30mm;font:4mm/5mm sans-serif">Erster Teil des '
                          'Satzes <em>betont über zwei Zeilen hinweg</em> dann <a '
                          'href="#ziel">ein Link</a> und <span lang="fr">un mot</span> '
                          'danach ein Text über mehrere Zeilen am Ende.</p>'
                          '<p id="ziel">Ziel</p>', set()),
    # Objets en ligne que WeasyPrint peint après le texte : image décrite, SVG à <title>,
    # flottant, positionné, relatif, inline-block à z-index, lien vide à aria-label. Le
    # texte qui les suit ne rejoint pas celui qui les précède : chaque /P finit par son
    # texte. Images sans description : veraPDF n'est pas jugé (None).
    'y-mcid-ordre': (MCID_LIGNES,
                     '<style>p{width:60mm;font:4mm/5mm sans-serif}.f{float:right;width:15mm}'
                     '.a{position:absolute;top:60mm;left:0}.r{position:relative;top:0.5mm}'
                     '.ib{display:inline-block;position:relative;z-index:2}</style>'
                     '<p>Eins<img alt="Formel" src="img.png" width="10">zwei und ein Text '
                     'über mehrere Zeilen bis zum Ende.</p>'
                     '<p>Eins <svg width="10" height="10" xmlns="http://www.w3.org/2000/svg">'
                     '<title>Symbol</title><rect width="10" height="10"/></svg> zwei und ein '
                     'Text über mehrere Zeilen bis zum Ende.</p>'
                     '<p>Eins <span class="f">Fliessend</span> zwei und ein Text über mehrere '
                     'Zeilen bis zum Ende.</p>'
                     '<p>Eins <span class="a">Absolut</span> zwei und ein Text über mehrere '
                     'Zeilen bis zum Ende.</p>'
                     '<p>Eins <span class="r">Relativ</span> zwei und ein Text über mehrere '
                     'Zeilen bis zum Ende.</p>'
                     '<p>Eins <span class="ib">Block</span> zwei und ein Text über mehrere '
                     'Zeilen bis zum Ende.</p>'
                     '<p>Eins <a href="https://www.szh.ch/" aria-label="Profil"></a> zwei und '
                     'ein Text über mehrere Zeilen bis zum Ende.</p>', None),
    # Lignes sans espace ni trait à leur fin : <br>, pre. Le texte du contenu marqué n'y
    # aurait pas de séparateur : chaque ligne garde le sien.
    'y-mcid-sauts': (MCID_LIGNES,
                     '<p>Eins<br>zwei<br><br>drei</p><pre>vier\nfünf\n\nsechs</pre>', set()),
}

# Une boîte de texte jamais dessinée (inline-block à transform: scale(0)) : WeasyPrint
# 70.0 échoue (KeyError dans tags.py) ; le correctif ne doit pas la passer sous silence.
NON_DESSINEE = ('<style>.s{display:inline-block;transform:scale(0)}</style>'
                '<p>Eins <span class="s">versteckt</span> zwei</p>')


def _res(o):
    return o.get_object() if isinstance(o, IndirectObject) else o


def _patchs_actifs():
    if not os.path.exists(TEMOIN):
        sys.exit(f'Témoin absent : {TEMOIN}. image/patch-weasyprint.sh n\'a pas posé les '
                 'correctifs SZH sur ce WeasyPrint.')
    actifs = [l.strip() for l in open(TEMOIN, encoding='utf-8') if l.strip()]
    inconnus = set(actifs) - set(VERIFS)
    if inconnus:
        sys.exit(f'Patch(s) posé(s) sans contrôle ici : {sorted(inconnus)}')
    return actifs


def _enfants(e):
    k = e.get('/K')
    if k is None:
        return []
    k = _res(k)
    return [_res(x) for x in k] if isinstance(k, ArrayObject) else [k]


def _noeuds(pdf):
    """Éléments de structure dans l'ordre du document, tels que pypdf les lit."""
    def parcourir(e):
        if not isinstance(e, DictionaryObject) or '/S' not in e:
            return
        yield e
        for c in _enfants(e):
            yield from parcourir(c)

    racine = PdfReader(pdf).trailer['/Root']['/StructTreeRoot'].get_object()
    for c in _enfants(racine):
        yield from parcourir(c)


def _elements(pdf):
    """Éléments de structure dans l'ordre du document : (S, A, ID, Alt)."""
    for e in _noeuds(pdf):
        a = _res(e['/A']) if '/A' in e else {}
        yield (str(e['/S']), a, str(e['/ID']) if '/ID' in e else None,
               str(e['/Alt']) if '/Alt' in e else None)


def _headers(elements):
    """Liste des /Headers des TD, dans l'ordre, en listes de chaînes."""
    return [[str(_res(h)) for h in _res(a.get('/Headers', []))]
            for s, a, _, _ in elements if s == '/TD']


def _images_peintes(pdf):
    total = 0
    for page in PdfReader(pdf).pages:
        xo = page['/Resources'].get('/XObject')
        if xo is not None:
            total += sum(1 for v in _res(xo).values() if _res(v).get('/Subtype') == '/Image')
    return total


def _marquage(pdf):
    """Par page : (MCID du flux, propriétés des /Artifact, pile de marquage de chaque
    opérateur de texte). Une pile est la liste des (tag, propriétés) englobants."""
    pages = []
    reader = PdfReader(pdf)
    for page in reader.pages:
        mcids, artefacts, textes, pile = [], [], [], []
        for operandes, op in ContentStream(page.get_contents(), reader).operations:
            if op in (b'BDC', b'BMC'):
                props = _res(operandes[1]) if op == b'BDC' else None
                props = props if isinstance(props, DictionaryObject) else {}
                pile.append((str(operandes[0]), props))
                if '/MCID' in props:
                    mcids.append(int(props['/MCID']))
                if str(operandes[0]) == '/Artifact':
                    artefacts.append(props)
            elif op == b'EMC':
                pile.pop()
            elif op in (b'TJ', b'Tj'):
                textes.append((list(pile), operandes[0]))
        pages.append((mcids, artefacts, textes))
    return pages


def _actual_text(pdf):
    """[ActualText, glyphes montrés dedans] de chaque contenu marqué qui en porte un."""
    spans = []
    for _, _, textes in _marquage(pdf):
        for pile, texte in textes:
            if pile and '/ActualText' in pile[-1][1]:
                if not spans or spans[-1][2] is not pile[-1][1]:
                    spans.append([str(pile[-1][1]['/ActualText']), 0, pile[-1][1]])
                chaines = texte if isinstance(texte, ArrayObject) else [texte]
                for c in chaines:
                    if isinstance(c, (bytes, str)):
                        octets = c.original_bytes if isinstance(c, TextStringObject) else c
                        spans[-1][1] += len(octets) // 2   # CID sur 2 octets
    return [s[:2] for s in spans]


def _mcid_rattaches(pdf):
    """{ numéro d'objet de la page : MCID cités par l'arbre de structure }."""
    reader = PdfReader(pdf)
    lies = {}

    def walk(e, pg):
        e = _res(e)
        if not isinstance(e, DictionaryObject):
            return
        pg = e.get('/Pg', pg)
        k = e.get('/K')
        kids = list(k) if isinstance(k, ArrayObject) else ([k] if k is not None else [])
        for kid in kids:
            ko = _res(kid)
            if isinstance(ko, (int, NumberObject)):
                lies.setdefault(pg.idnum, set()).add(int(ko))
            elif isinstance(ko, DictionaryObject) and ko.get('/Type') == '/MCR':
                lies.setdefault(ko.get('/Pg', pg).idnum, set()).add(int(ko['/MCID']))
            else:
                walk(kid, pg)
    walk(reader.trailer['/Root']['/StructTreeRoot'], None)
    return [lies.get(p.indirect_reference.idnum, set()) for p in reader.pages]


def _lignes(pdf):
    return '\n'.join(p.extract_text() for p in PdfReader(pdf).pages).split('\n')


def _verapdf(pdfs):
    """{ chemin : ensemble des clauses en échec, 'clause-test' }."""
    if not os.access(VERAPDF, os.X_OK):
        sys.exit(f'veraPDF introuvable : {VERAPDF} (VERAPDF / VERAPDF_JAVA)')
    env = dict(os.environ, JAVA_HOME=VERAPDF_JAVA)
    r = subprocess.run([VERAPDF, '--flavour', 'ua1', '--format', 'xml', *pdfs],
                       capture_output=True, env=env, check=False)
    if r.returncode not in (0, 1):
        sys.exit(f'veraPDF en panne (code {r.returncode}) : {r.stderr.decode()[:500]}')
    verdicts = {}
    for job in ET.fromstring(r.stdout).iter('job'):
        nom = job.find('item/name').text
        rapport = job.find('validationReport')
        if rapport is None:
            sys.exit(f'veraPDF n\'a pas jugé {nom}')
        verdicts[os.path.basename(nom)] = {
            f"{regle.get('clause')}-{regle.get('testNumber')}"
            for regle in rapport.iter('rule') if regle.get('status') == 'failed'}
    return verdicts


def _verifier_entetes(pdfs, erreurs):
    el = list(_elements(pdfs['a-colspan']))
    ids = [i for s, _, i, _ in el if s == '/TH']
    if _headers(el) != [[ids[0]], [ids[1], ids[2]], [ids[2]]]:
        erreurs.append(f'a-colspan : /Headers {_headers(el)} (th {ids})')

    el = list(_elements(pdfs['d-rowspan']))
    ids = [i for s, _, i, _ in el if s == '/TH']   # Wert, Note, Gruppe
    voulu = [[], [ids[2], ids[0]], [ids[2], ids[1]], [ids[2], ids[0]], [ids[2], ids[1]]]
    if _headers(el) != voulu:
        erreurs.append(f'd-rowspan : /Headers {_headers(el)}, attendu {voulu}')

    el = list(_elements(pdfs['c-headers']))
    ids = [i for s, _, i, _ in el if s == '/TH']
    voulu = [[ids[0]], [ids[2]], [ids[1], ids[2]]]
    if _headers(el) != voulu:
        erreurs.append(f'c-headers : /Headers {_headers(el)}, attendu {voulu}')

    # Le th en bloc n'est pas une cellule : pas d'/ID ; le tableau ordinaire est intact.
    el = list(_elements(pdfs['u-tableau-bloc']))
    ids = [i for s, _, i, _ in el if s == '/TH' and i is not None]
    if len(ids) != 2 or _headers(el) != [[ids[0]], [ids[1]]]:
        erreurs.append(f'u-tableau-bloc : /Headers {_headers(el)} (th {ids})')


def _verifier_decor(pdfs, erreurs):
    figures = [alt for s, _, _, alt in _elements(pdfs['e-decor']) if s == '/Figure']
    if figures != ['Porträt']:
        erreurs.append(f'e-decor : /Figure {figures}, attendu la seule image décrite')
    figures = [alt for s, _, _, alt in _elements(pdfs['e-decor-seul']) if s == '/Figure']
    if figures:
        erreurs.append(f'e-decor-seul : /Figure {figures} restée dans l\'arbre')
    if _images_peintes(pdfs['e-decor-seul']) < 1:
        erreurs.append('e-decor-seul : l\'image décorative n\'est plus peinte')
    figures = [alt for s, _, _, alt in _elements(pdfs['f-alt-vide-seul']) if s == '/Figure']
    if figures != [None]:
        erreurs.append(f'f-alt-vide-seul : /Figure {figures}, attendu une /Figure sans /Alt')
    annotations, rattachees = _annotations_de_lien(pdfs['v-decor-lien'])
    if len(annotations) != 2 or set(annotations) != rattachees or not all(
            annotations.values()):
        erreurs.append(f'v-decor-lien : annotations {annotations} (numéro : StructParent), '
                       f'rattachées à un /Link {sorted(rattachees)}, attendu 2, toutes '
                       'rattachées')


def _annotations_de_lien(pdf):
    """({ numéro d'annotation /Link : a un /StructParent }, numéros cités par un OBJR
    d'élément /Link)."""
    reader = PdfReader(pdf)
    annotations = {}
    for page in reader.pages:
        for a in page.get('/Annots', []):
            objet = _res(a)
            if objet.get('/Subtype') == '/Link':
                annotations[a.idnum] = '/StructParent' in objet
    rattachees = {k.raw_get('/Obj').idnum for e in _noeuds(pdf) if str(e['/S']) == '/Link'
                  for k in _enfants(e)
                  if isinstance(k, DictionaryObject) and k.get('/Type') == '/OBJR'}
    return annotations, rattachees


def _verifier_cesure(pdfs, erreurs):
    # Couche texte des fins de ligne : ce que ni veraPDF ni le rendu ne voient.
    spans = _actual_text(pdfs['h-cesure'])
    if len(spans) < 2 or any(s != [SHY, 1] for s in spans):
        erreurs.append(f'h-cesure : {spans}, attendu au moins 2 [U+00AD, 1 glyphe]')
    if _actual_text(pdfs['i-compose']):
        erreurs.append(f'i-compose : /ActualText hors césure {_actual_text(pdfs["i-compose"])}')
    # Les espaces de fin de ligne relèvent du 25 : ici, seul le trait du composé compte.
    voulu = ['Hess-', 'Klein', 'Hess-', 'Klein']
    if [l.rstrip(' ') for l in _lignes(pdfs['i-compose'])] != voulu:
        erreurs.append(f'i-compose : lignes {_lignes(pdfs["i-compose"])}, attendu {voulu}')


def _verifier_espace(pdfs, erreurs):
    # Le dessin de l'espace est dans le 20 : sans lui, ce patch ne produit rien.
    if 'i-compose' not in pdfs:
        erreurs.append(f'{ESPACE} posé sans {CESURE}, qui dessine l\'espace de fin de ligne')
        return
    if _actual_text(pdfs['j-espace']):
        erreurs.append(f'j-espace : /ActualText hors césure {_actual_text(pdfs["j-espace"])}')
    voulu = ['Hess-', 'Klein ', 'Hess-', 'Klein']
    if _lignes(pdfs['i-compose']) != voulu:
        erreurs.append(f'i-compose : lignes {_lignes(pdfs["i-compose"])}, attendu {voulu}')
    voulu = ['un ', 'deux ', 'trois', 'quatre ', 'cinq ', 'six', 'sept']
    if _lignes(pdfs['j-espace']) != voulu:
        erreurs.append(f'j-espace : lignes {_lignes(pdfs["j-espace"])}, attendu {voulu}')


def _verifier_marges(pdfs, erreurs):
    pdf = pdfs['k-marges']
    pages = _marquage(pdf)
    for n, ((mcids, artefacts, textes), lies) in enumerate(zip(pages, _mcid_rattaches(pdf))):
        orphelins = sorted(set(mcids) - lies)
        if orphelins:
            erreurs.append(f'k-marges p.{n + 1} : MCID rattachés à rien {orphelins}')
        pagination = sorted(
            (str(a.get('/Subtype')), [str(x) for x in a.get('/Attached', [])])
            for a in artefacts if a.get('/Type') == '/Pagination')
        voulu = [('/Footer', ['/Bottom']), ('/Header', ['/Top']), ('None', ['/Left'])]
        if pagination != voulu:
            erreurs.append(f'k-marges p.{n + 1} : artefacts de pagination {pagination}, '
                           f'attendu {voulu} (le pied à lien reste du contenu)')
        hors = [t for pile, t in textes if not pile]
        if hors:
            erreurs.append(f'k-marges p.{n + 1} : {len(hors)} texte(s) hors de tout marquage')
        en_marge = [t for pile, t in textes
                    if any(tag == '/Artifact' and p.get('/Type') == '/Pagination'
                           for tag, p in pile)]
        if len(en_marge) < 3:
            erreurs.append(f'k-marges p.{n + 1} : {len(en_marge)} texte(s) en artefact de '
                           'pagination, attendu 3 (en-tête, folio, côté)')
    if '/Link' not in [s for s, _, _, _ in _elements(pdf)]:
        erreurs.append('k-marges : le lien du pied n\'est plus un élément /Link')
    texte = '\n'.join(_lignes(pdf))
    for mot in ('En-tête courant', 'Côté', 'szh.ch'):
        if mot not in texte:
            erreurs.append(f'k-marges : « {mot} » n\'est plus extractible')


def _verifier_xmp(pdfs, erreurs):
    reader = PdfReader(pdfs['l-xmp-langue'])
    flux = reader.trailer['/Root']['/Metadata'].get_object().get_data()
    if flux.count(b'<rdf:RDF') != 1:
        erreurs.append(f'l-xmp-langue : {flux.count(b"<rdf:RDF")} rdf:RDF dans le XMP, '
                       'attendu 1')
    langues = reader.xmp_metadata.dc_language
    if langues != ['de']:
        erreurs.append(f'l-xmp-langue : dc:language {langues}, attendu [\'de\']')


def _pages_de(pdf, texte):
    """Numéros des pages dont le texte contient `texte`."""
    return [n for n, p in enumerate(PdfReader(pdf).pages, 1) if texte in p.extract_text()]


def _verifier_doublon(pdfs, erreurs):
    notes = _pages_de(pdfs['m-doublon'], 'Fussnote eins')
    if notes != [2]:
        erreurs.append(f'm-doublon : note en p. {notes}, attendu [2] (reportée une fois)')
    notes = _pages_de(pdfs['m-reportee-fin'], 'Letzte Fussnote')
    if len(notes) != 1:
        erreurs.append(f'm-reportee-fin : note en p. {notes}, attendu une seule page')


def _verifier_reportee(pdfs, erreurs):
    appel = _pages_de(pdfs['n-reportee'], 'Aufruf')
    notes = _pages_de(pdfs['n-reportee'], 'Fussnote eins')
    if appel != [1] or notes != [1]:
        erreurs.append(f'n-reportee : appel en p. {appel}, note en p. {notes}, attendu [1] '
                       'et [1]')
    if _pages_de(pdfs['n-reportee'], 'c1') != [2]:
        erreurs.append('n-reportee : le paragraphe « c » n\'est pas parti entier en p. 2')


def _verifier_langue(pdfs, erreurs):
    langues = [(str(e['/S']), str(e['/Lang'])) for e in _noeuds(pdfs['o-langue'])
               if '/Lang' in e]
    voulu = [('/Div', 'fr'), ('/BlockQuote', 'en'), ('/Span', 'en')]
    if langues != voulu:
        erreurs.append(f'o-langue : /Lang {langues}, attendu {voulu}')
    langues = [(str(e['/S']), str(e['/Lang'])) for e in _noeuds(pdfs['w-langue-invalide'])
               if '/Lang' in e]
    if langues != [('/Span', 'EN-gb')]:
        erreurs.append(f'w-langue-invalide : /Lang {langues}, attendu [(\'/Span\', '
                       '\'EN-gb\')]')


def _liens(pdf, roles=('/Link',)):
    """(rôle, /Contents des annotations rattachées, /Alt) des éléments de ces rôles."""
    liens = []
    for e in _noeuds(pdf):
        if str(e['/S']) not in roles:
            continue
        contents = [str(_res(k['/Obj']).get('/Contents')) for k in _enfants(e)
                    if isinstance(k, DictionaryObject) and k.get('/Type') == '/OBJR']
        liens.append((str(e['/S']), contents, str(e['/Alt']) if '/Alt' in e else None))
    return liens


def _verifier_liens(pdfs, erreurs):
    liens = [(c, a) for _, c, a in _liens(pdfs['p-liens'])]
    cc = 'https://creativecommons.org/licenses/by/4.0/'
    # Sans nom, la cible reste en /Contents, jamais en /Alt.
    voulu = [(['die Website'], None),
             (['ORCID von Anna Muster'], 'ORCID von Anna Muster'),
             (['Zurück zum Verweis 1'], 'Zurück zum Verweis 1'),
             (['Zum Ende'], 'Zum Ende'),
             ([cc], None),
             (['Zum Anfang zurück'], None)]
    if liens != voulu:
        erreurs.append(f'p-liens : (/Contents, /Alt) {liens}, attendu {voulu}')

    # /Contents des /Figure : annotation propre à l'image, que WeasyPrint range dans la
    # /Figure (veraPDF 7.18.5-1, déjà là sans les patchs).
    liens = _liens(pdfs['x-liens-images'], ('/Link', '/Figure'))
    a, b = 'https://www.szh.ch/a', 'https://www.szh.ch/b'
    voulu = [('/Link', [a], None), ('/Figure', [a], None),
             ('/Link', ['Logo'], 'Logo'), ('/Figure', ['Logo'], 'Logo')]
    if liens != voulu:
        erreurs.append(f'x-liens-images : (rôle, /Contents, /Alt) {liens}, attendu {voulu}')
    if b in str(liens):
        erreurs.append(f'x-liens-images : la cible {b} sert de nom alors que l\'image est '
                       'décrite')

    noms = [c[:1] for _, c, _ in _liens(pdfs['x-liens-textes'])][:2]
    if noms != [['Sichtbar'], ['Erster Zweiter']]:
        erreurs.append(f'x-liens-textes : /Contents {noms}, attendu [[\'Sichtbar\'], '
                       '[\'Erster Zweiter\']]')


def _glyphes_espace(reader, page):
    """Identifiants des glyphes que la ToUnicode des polices de la page lit U+0020."""
    espaces = set()
    for police in _res(page['/Resources']['/Font']).values():
        police = _res(police)
        if '/ToUnicode' not in police:
            continue
        cmap = _res(police['/ToUnicode']).get_data().decode('latin-1')
        for g, u in re.findall(r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', cmap):
            if u.lower() in ('0020', '00a0'):
                espaces.add(int(g, 16))
        for g1, g2, u in re.findall(
                r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', cmap):
            for k, g in enumerate(range(int(g1, 16), int(g2, 16) + 1)):
                if int(u, 16) + k in (0x20, 0xA0):
                    espaces.add(g)
    return espaces


def _espaces_du_tj(pdf):
    """(espaces dessinées, espaces précédées d'un décalage vers la droite) dans les TJ."""
    reader = PdfReader(pdf)
    dessinees = decalees = 0
    for page in reader.pages:
        espaces = _glyphes_espace(reader, page)
        for operandes, op in ContentStream(page.get_contents(), reader).operations:
            if op != b'TJ':
                continue
            precedent = None
            for x in operandes[0]:
                if isinstance(x, (bytes, str)):
                    octets = x.original_bytes if isinstance(x, TextStringObject) else x
                    octets = octets if isinstance(octets, bytes) else octets.encode('latin-1')
                    for i in range(0, len(octets), 2):
                        if int.from_bytes(octets[i:i + 2], 'big') in espaces:
                            dessinees += 1
                            # Un nombre négatif du TJ pousse vers la droite.
                            decalees += i == 0 and precedent is not None and precedent < -50
                    precedent = None
                else:
                    precedent = float(x)
    return dessinees, decalees


def _verifier_justifie(pdfs, erreurs):
    dessinees, decalees = _espaces_du_tj(pdfs['q-justifie'])
    if not dessinees or decalees:
        erreurs.append(f'q-justifie : {dessinees} espace(s) dessinée(s), dont {decalees} '
                       'au milieu de leur écart, attendu des espaces et aucune décalée')
    mots = ' '.join(' '.join(_lignes(pdfs['q-justifie'])).split())
    if mots != JUSTIFIE_TEXTE:
        erreurs.append(f'q-justifie : texte extrait {mots!r}')


def _verifier_auteurs(pdfs, erreurs):
    reader = PdfReader(pdfs['r-auteurs'])
    auteur = reader.metadata.get('/Author')
    if auteur != '; '.join(AUTEURS_NOMS):
        erreurs.append(f'r-auteurs : /Author {auteur!r}, attendu {"; ".join(AUTEURS_NOMS)!r}')
    createurs = reader.xmp_metadata.dc_creator
    if createurs != list(AUTEURS_NOMS):
        erreurs.append(f'r-auteurs : dc:creator {createurs}, attendu {list(AUTEURS_NOMS)}')


def _num(e):
    return e.indirect_reference.idnum


def _verifier_notes(pdfs, erreurs):
    pdf = pdfs['s-notes']
    notes = [e for e in _noeuds(pdf) if str(e['/S']) == '/Note']
    if len(notes) != 5:
        erreurs.append(f's-notes : {len(notes)} /Note, attendu 5')
    ids, reportees, parents = [], 0, []
    for n, note in enumerate(notes, 1):
        ids.append(str(note['/ID']) if '/ID' in note else None)
        parent = _res(note['/P'])
        parents.append(str(parent['/S']))
        freres = [k for k in _enfants(parent) if isinstance(k, DictionaryObject)]
        numeros = [_num(k) for k in freres]
        rang = numeros.index(_num(note)) if _num(note) in numeros else -1
        avant = freres[rang - 1] if rang > 0 else None
        if avant is None or str(avant.get('/S')) != '/Reference':
            erreurs.append(f's-notes : la note {n} ne suit pas un /Reference dans '
                           f'{parent["/S"]}')
        enfants = _enfants(note)
        if not enfants or str(enfants[0].get('/S')) != '/Lbl':
            erreurs.append(f's-notes : la note {n} ne commence pas par un /Lbl')
        reportees += _res(note['/Pg']).indirect_reference.idnum != (
            _res(parent['/Pg']).indirect_reference.idnum)
    if parents != ['/P', '/LBody', '/P', '/P', '/P']:
        erreurs.append(f's-notes : notes rangées sous {parents}, attendu leur paragraphe '
                       'ou leur /LBody')
    if None in ids or len(set(ids)) != len(ids):
        erreurs.append(f's-notes : /ID des notes {ids}, attendu tous présents et distincts')
    if reportees != 1:
        erreurs.append(f's-notes : {reportees} note(s) imprimée(s) sur une autre page que '
                       'leur appel, attendu 1 (la note quatre, reportée)')
    racine = PdfReader(pdf).trailer['/Root']['/StructTreeRoot'].get_object()
    noms = _res(_res(racine.get('/IDTree', {})).get('/Names', []))
    if not set(ids) <= {str(x) for x in noms[::2]}:
        erreurs.append(f's-notes : /IDTree {list(noms[::2])} ne cite pas les notes {ids}')

    # (rôle du parent, rôle de l'élément qui précède, rôles des enfants) de chaque /Note.
    voulu = {'s-notes-elements': [('/Document', '/H1', ['/Lbl', '/Span']),
                                  ('/Div', '/Reference', ['/Lbl', '/L']),
                                  ('/P', '/Reference', ['/Figure']),
                                  ('/Document', '/Table', ['/Lbl', '/Span'])],
             's-notes-liens': [('/P', '/Link', ['/Link']),
                               ('/P', '/Link', ['/Lbl', '/Span']),
                               ('/P', '/Link', ['/Lbl', '/Span'])]}
    for nom, attendu in voulu.items():
        obtenu = []
        for note in _noeuds(pdfs[nom]):
            if str(note['/S']) != '/Note':
                continue
            parent = _res(note['/P'])
            freres = [k for k in _enfants(parent) if isinstance(k, DictionaryObject) and
                      '/S' in k]
            numeros = [_num(k) for k in freres]
            rang = numeros.index(_num(note)) if _num(note) in numeros else 0
            avant = freres[rang - 1] if rang > 0 else {}
            obtenu.append((str(parent['/S']), str(avant.get('/S')),
                           [str(k.get('/S')) for k in _enfants(note)
                            if isinstance(k, DictionaryObject)]))
        if obtenu != attendu:
            erreurs.append(f'{nom} : /Note (parent, précédent, enfants) {obtenu}, attendu '
                           f'{attendu}')


def _verifier_listes(pdfs, erreurs):
    noeuds = list(_noeuds(pdfs['t-listes']))
    parents = [str(_res(e['/P'])['/S']) for e in noeuds if str(e['/S']) == '/L']
    voulu = ['/Document', '/LBody', '/Document', '/LBody', '/LBody', '/Document']
    if parents != voulu:
        erreurs.append(f't-listes : parents des /L {parents}, attendu {voulu}')
    items = [[str(k.get('/S')) for k in _enfants(e) if isinstance(k, DictionaryObject)]
             for e in noeuds if str(e['/S']) == '/LI']
    intrus = [i for i in items if set(i) - {'/Lbl', '/LBody'}]
    if intrus:
        erreurs.append(f't-listes : /LI qui contiennent autre chose que /Lbl et /LBody '
                       f'{intrus}')
    voulu = [['/Lbl', '/LBody'], ['/Lbl', '/LBody', '/LBody'], ['/Lbl', '/Lbl', '/LBody']]
    if items[-3:] != voulu:
        erreurs.append(f't-listes : /LI de la <dl> {items[-3:]}, attendu {voulu}')

    # Q01 à Q05 dans l'ordre : texte, em, texte, lien, texte.
    noeuds = list(_noeuds(pdfs['t-liste-en-ligne']))
    items = [[str(k.get('/S')) for k in _enfants(e) if isinstance(k, DictionaryObject)]
             for e in noeuds if str(e['/S']) in ('/LI', '/LBody')]
    voulu = [['/Lbl', '/LBody'], ['/Span', '/NonStruct', '/Span', '/Link', '/Span']]
    if items != voulu:
        erreurs.append(f't-liste-en-ligne : enfants du /LI et du /LBody {items}, attendu '
                       f'{voulu}')


def _mcid_de(e):
    """MCID cités directement par un élément de structure."""
    return [int(k) for k in _enfants(e) if isinstance(k, (int, NumberObject))]


def _propre(e):
    """Texte propre d'un bloc : un /Span qui ne cite que des MCID."""
    return str(e['/S']) == '/Span' and len(_mcid_de(e)) == len(_enfants(e))


def _verifier_mcid_lignes(pdfs, erreurs):
    # D'une ligne à l'autre, le 90 ne fusionne que derrière l'espace du 25 (dessinée par
    # le 20) ou un trait : posé sans eux, il ne réunit rien et ses cas échouent.
    if 'j-espace' not in pdfs or 'h-cesure' not in pdfs:
        erreurs.append('90-un-mcid-par-element : posé sans le 20 et le 25, dont il lit '
                       'l\'espace de fin de ligne et le trait de césure')
    for n, p in enumerate((e for e in _noeuds(pdfs['y-mcid-ordre']) if str(e['/S']) == '/P'),
                          1):
        enfants = [k for k in _enfants(p) if isinstance(k, DictionaryObject)]
        roles = [str(k['/S']) for k in enfants]
        if len(enfants) < 3 or not _propre(enfants[0]) or not _propre(enfants[-1]):
            erreurs.append(f'y-mcid-ordre : paragraphe {n}, enfants {roles}, attendu le '
                           'texte, l\'objet en ligne, puis le texte qui le suit')
    sauts = [sum(_propre(k) for k in _enfants(e) if isinstance(k, DictionaryObject))
             for e in _noeuds(pdfs['y-mcid-sauts']) if str(e['/S']) in ('/P', '/NonStruct')
             and any(isinstance(k, DictionaryObject) for k in _enfants(e))]
    if not sauts or sauts[0] != 3 or sum(sauts) < 6:
        erreurs.append(f'y-mcid-sauts : /Span de texte par bloc {sauts}, attendu un par '
                       'ligne (3 pour le <br>, 3 ou plus pour le pre)')
    try:
        HTML(string=ENTETE + NON_DESSINEE + PIED).write_pdf(pdf_variant='pdf/ua-1')
        erreurs.append('boîte de texte non dessinée : rendu sans erreur, attendu le '
                       'KeyError de WeasyPrint 70.0, qui la signale')
    except KeyError:
        pass

    pdf = pdfs['y-mcid-lignes']
    par_page = [len(mcids) for mcids, _, _ in _marquage(pdf)]
    if par_page != [1, 1]:
        erreurs.append(f'y-mcid-lignes : MCID par page {par_page}, attendu [1, 1]')
    paragraphes = [[(str(k['/S']), len(_mcid_de(k))) for k in _enfants(e)]
                   for e in _noeuds(pdf) if str(e['/S']) == '/P']
    if paragraphes != [[('/Span', 1)], [('/Span', 1)]]:
        erreurs.append(f'y-mcid-lignes : (rôle, MCID) des enfants de chaque /P '
                       f'{paragraphes}, attendu un seul /Span à un MCID par page')
    mots = ' '.join(' '.join(_lignes(pdf)).split())
    if mots != ' '.join(f'Wort{n}' for n in range(1, 17)):
        erreurs.append(f'y-mcid-lignes : texte extrait {mots!r}')

    paragraphe = next(e for e in _noeuds(pdfs['y-mcid-frontieres']) if str(e['/S']) == '/P')
    enfants = [k for k in _enfants(paragraphe) if isinstance(k, DictionaryObject)]
    # Texte du paragraphe : un /Span qui ne cite que des MCID ; le <span lang> est un
    # /Span qui contient un /Span.
    propres = [str(k['/S']) == '/Span' and len(_mcid_de(k)) == len(_enfants(k))
               for k in enfants]
    mcids = [len(_mcid_de(k)) for k, propre in zip(enfants, propres) if propre]
    roles = [str(k['/S']) for k in enfants]
    if mcids != [1, 1, 1, 1] or any(a and b for a, b in zip(propres, propres[1:])):
        erreurs.append(f'y-mcid-frontieres : enfants du /P {roles}, MCID du texte du '
                       f'paragraphe {mcids}, attendu quatre /Span à un MCID, séparés par '
                       'les éléments en ligne')
    if '/Link' not in roles or '/NonStruct' not in roles:
        erreurs.append(f'y-mcid-frontieres : enfants du /P {roles}, attendu le /NonStruct '
                       'de l\'em et le /Link')


VERIFS = {ENTETES: _verifier_entetes, DECOR: _verifier_decor, CESURE: _verifier_cesure,
          ESPACE: _verifier_espace, MARGES: _verifier_marges, XMP: _verifier_xmp,
          DOUBLON: _verifier_doublon, REPORTEE: _verifier_reportee,
          LANGUE: _verifier_langue, LIENS: _verifier_liens, JUSTIFIE: _verifier_justifie,
          AUTEURS: _verifier_auteurs, NOTES_BALISEES: _verifier_notes,
          LISTES: _verifier_listes, MCID_LIGNES: _verifier_mcid_lignes}


def main():
    actifs = _patchs_actifs()
    cas = {nom: v for nom, v in CAS.items() if v[0] in actifs}
    print(f'Correctifs posés : {", ".join(actifs) or "aucun"}')
    erreurs = []
    with tempfile.TemporaryDirectory() as d:
        # Un dossier en argument garde les PDF produits, pour les relire.
        d = sys.argv[1] if len(sys.argv) > 1 else d
        os.makedirs(d, exist_ok=True)
        Image.new('RGB', (40, 30), (200, 60, 40)).save(os.path.join(d, 'img.png'))
        pdfs = {}
        for nom, (_, corps, _) in cas.items():
            chemin = os.path.join(d, nom + '.pdf')
            try:
                HTML(string=ENTETE + corps + PIED, base_url=d + os.sep).write_pdf(
                    chemin, pdf_variant='pdf/ua-1')
            except Exception as exception:
                erreurs.append(f'{nom} : WeasyPrint échoue, {exception!r}')
                continue
            pdfs[nom] = chemin
        verdicts = _verapdf(list(pdfs.values())) if pdfs else {}

        for nom, (_, _, attendu) in cas.items():
            obtenu = verdicts.get(nom + '.pdf')
            if nom in pdfs and attendu is not None and obtenu != attendu:
                erreurs.append(f'{nom} : veraPDF en échec sur {sorted(obtenu or [])}, '
                               f'attendu {sorted(attendu)}')
        for patch in actifs:
            try:
                VERIFS[patch](pdfs, erreurs)
            except KeyError as exception:
                erreurs.append(f'{patch} : cas non produit {exception}')

    if erreurs:
        print('Correctifs WeasyPrint : ÉCHEC')
        for e in erreurs:
            print('  -', e)
        sys.exit(1)
    print(f'Correctifs WeasyPrint : {len(cas)} cas conformes à l\'attendu '
          f'({len(CAS) - len(cas)} cas de patchs désactivés non joués).')


if __name__ == '__main__':
    main()
