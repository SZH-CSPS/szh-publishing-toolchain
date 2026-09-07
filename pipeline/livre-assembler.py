#!/usr/bin/env python3
# livre-assembler.py — assemble les fragments HTML des chapitres, les liminaires et le
# sommaire en un document, celui que WeasyPrint paginera.
#
#   python3 livre-assembler.py --meta buch.yaml --gabarit <g.html> --sortie <out.html>
#                              [--css <feuille>]... [--css-embed <feuille>]... <fragment>...
#
# --css lie la feuille (<link>) : la voie du PDF, où un chemin absolu ne pose pas de
# problème. --css-embed l'incorpore (<style>) : la voie du HTML web, qui doit rester un
# seul fichier ouvrable par file:// sans rien à côté — voir main() pour le détail.
#
# Pourquoi un assembleur, et pas une seule invocation de pandoc sur tous les chapitres.
# La règle de compilation fait `cd chapitres/<slug>` avant pandoc, pour que `media/` tombe
# juste — c'est ce qui permet à un chapitre d'être compilé exactement comme un article de
# revue, avec la même suite de filtres et le même gestionnaire de médias. Douze chapitres,
# ce sont douze dossiers courants différents : une seule invocation ne peut pas les avoir
# tous. On compile donc chapitre par chapitre, avec --embed-resources, et l'assemblage
# devient une opération de texte : chaque fragment est déjà autonome, images comprises en
# data: URI. Mesuré sur le banc : zéro chemin relatif survivant dans un fragment.
#
# Ce que ce script fait, et rien d'autre :
#   1. lit buch.yaml (analyseur plat maison — l'image WSL n'a pas PyYAML) ;
#   2. compose les liminaires que la machine sait écrire : demi-titre, impressum,
#      page de titre, sommaire ;
#   3. relève les titres des fragments pour bâtir le sommaire, avec des liens internes —
#      les numéros de page sont posés par WeasyPrint (target-counter), jamais ici ;
#   4. remplit le gabarit et écrit la sortie.
#
# ⚠ Ce script n'invente aucune métadonnée. Une clé absente de buch.yaml laisse le bloc
#   correspondant vide plutôt que d'écrire une valeur plausible : un ISBN inventé
#   s'imprimerait.

import html
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import szh_commun

# Analyseur YAML plat (une clé par ligne, listes en tirets, sous-blocs indentés d'un
# niveau) : voir szh_commun.lire_yaml(), dont couverture.py se sert aussi — une divergence
# entre les deux lecteurs serait un livre dont la couverture et l'intérieur se contredisent.
lire_yaml = szh_commun.lire_yaml


# --------------------------------------------------------------------------------------
# Sommaire : relevé des titres dans les fragments.
# --------------------------------------------------------------------------------------

RE_TITRE = re.compile(
    r'<h(?P<n>[1-3])\b[^>]*\bid="(?P<id>[^"]+)"[^>]*>(?P<txt>.*?)</h(?P=n)>',
    re.S | re.I)
RE_BALISE = re.compile(r'<[^>]+>')

# La couleur d'un chapitre est déjà dans son fragment : livre.mk (PALETTE_CHAPITRE) l'a
# posée en --c-chapitre sur la <section class="szh-chapitre"> qui l'enveloppe (voir
# templates/szh-livre-chapitre.html) — c'est ce qui peint la pastille et l'onglet de
# tranche sur la page d'ouverture. On la lit ici, on ne la recalcule pas : un chapitre, un
# seul calcul de sa couleur. Une liminaire ou la 4e de couverture n'a pas cette section et
# ne matche donc jamais — ses entrées de sommaire, s'il y en avait, resteraient sans
# couleur, ce qui est la bonne réponse : elles n'appartiennent à aucun chapitre.
RE_COULEUR_CHAPITRE = re.compile(
    r'<section\b[^>]*\bclass="[^"]*\bszh-chapitre\b[^"]*"[^>]*\bstyle="[^"]*--c-chapitre:\s*'
    r'([^;"]+)', re.S | re.I)


def couleur_du_fragment(fragment):
    """Rend la couleur du chapitre (« #RRGGBB ») si le fragment en porte une, sinon None."""
    m = RE_COULEUR_CHAPITRE.search(fragment)
    return m.group(1).strip() if m else None


def titres_du_fragment(fragment):
    """Rend [(niveau, ancre, texte, couleur)] pour h1..h3. Le texte est dépouillé de ses
    balises : « <span class="szh-num-section">2</span> Teilhabe » donne « 2 Teilhabe ».
    `couleur` est celle du CHAPITRE ENTIER (couleur_du_fragment) : un fragment est un seul
    chapitre, donc tous ses titres — le h1 d'ouverture comme ses h2/h3 internes — en
    partagent la même, exactement comme l'onglet de tranche les accompagne du premier au
    dernier paragraphe du chapitre."""
    couleur = couleur_du_fragment(fragment)
    trouves = []
    for m in RE_TITRE.finditer(fragment):
        txt = RE_BALISE.sub('', m.group('txt'))
        txt = re.sub(r'\s+', ' ', html.unescape(txt).strip())
        if txt:
            trouves.append((int(m.group('n')), m.group('id'), txt, couleur))
    return trouves


def sommaire_html(entrees, titre):
    """Le sommaire est une <ol> de liens internes. Le numéro de page est posé par
    target-counter() dans base.css : rien ici ne connaît la pagination, et c'est bien —
    un numéro écrit ici serait faux au premier paragraphe ajouté.

    Chaque entrée reçoit la couleur DE SON CHAPITRE en --c-chapitre, posée en style inline
    sur le <li> — la même variable, au même format, que celle que livre.mk pose sur la
    <section> du chapitre. C'est ce qui permet à livre/falc.css de peindre le repère de
    sommaire avec la règle qu'il porte déjà (`.szh-sommaire li::after { background:
    var(--c-chapitre, …) }`) : elle attendait cette variable, jamais posée avant ce
    correctif — d'où des repères tous à la couleur de repli, --c-falc-accent-defaut."""
    lignes = ['<section class="szh-sommaire" id="szh-sommaire">',
              '<h1>' + html.escape(titre) + '</h1>', '<ol>']
    for niveau, ancre, txt, couleur in entrees:
        style = (' style="--c-chapitre: %s"' % html.escape(couleur, quote=True)
                 if couleur else '')
        lignes.append('<li class="niveau-%d"%s><a href="#%s">%s</a></li>'
                      % (niveau, style, html.escape(ancre, quote=True), html.escape(txt)))
    lignes += ['</ol>', '</section>']
    return '\n'.join(lignes)


# --------------------------------------------------------------------------------------
# Liminaires composés par la machine.
# --------------------------------------------------------------------------------------

# Même table que CONJONCTION dans szh-livre-auteurs.lua : la conjonction avant le dernier nom.
CONJONCTION_AUTEURS = {'fr': ' et ', 'de': ' und ', 'it': ' e ', 'en': ' and '}


def _auteurs_ligne(meta, lang='fr'):
    """« Prénom Nom, Prénom Nom et Prénom Nom ». Rien de plus : le bloc auteurs détaillé
    (fonction, affiliation, ORCID) est l'affaire des chapitres."""
    noms = []
    for a in (meta.get('auteurs') or []):
        if isinstance(a, dict):
            n = ' '.join(x for x in (a.get('prenom'), a.get('nom')) if x)
            if n:
                noms.append(n)
        elif a:
            noms.append(str(a))
    if not noms:
        return ''
    if len(noms) == 1:
        return noms[0]
    conjonction = CONJONCTION_AUTEURS.get(lang, CONJONCTION_AUTEURS['fr'])
    return ', '.join(noms[:-1]) + conjonction + noms[-1]


def demi_titre(meta, lang='fr'):
    return ('<section class="szh-liminaire szh-demi-titre">'
            '<p class="szh-auteurs">%s</p>'
            '<p class="szh-titre">%s</p>'
            '<p class="szh-sous-titre">%s</p></section>'
            % (html.escape(_auteurs_ligne(meta, lang)),
               html.escape(str(meta.get('titre') or '')),
               html.escape(str(meta.get('sous-titre') or ''))))


def page_titre(meta, lang='fr'):
    return ('<section class="szh-liminaire szh-page-titre">'
            '<p class="szh-auteurs">%s</p>'
            '<p class="szh-titre">%s</p>'
            '<p class="szh-sous-titre">%s</p></section>'
            % (html.escape(_auteurs_ligne(meta, lang)),
               html.escape(str(meta.get('titre') or '')),
               html.escape(str(meta.get('sous-titre') or ''))))


# Les quatre raisons sociales de la fondation, dans l'ordre des livres publiés. Elles ne
# sont pas une métadonnée du livre : elles ne changent pas d'un ouvrage à l'autre.
FONDATION = [
    'Stiftung Schweizer Zentrum für Heil- und Sonderpädagogik (SZH) Bern',
    'Fondation Centre suisse de pédagogie spécialisée (CSPS) Berne',
    'Fondazione Centro svizzero di pedagogia specializzata (CSPS) Berna',
    'Fundaziun Center svizzer da pedagogia speciala (CSPS) Berna',
]

LICENCES = {
    'cc-by-nc-nd-4.0': 'Creative Commons CC BY-NC-ND 4.0 International',
    'cc-by-4.0':       'Creative Commons CC BY 4.0 International',
    'cc-by-sa-4.0':    'Creative Commons CC BY-SA 4.0 International',
    'cc-by-nc-4.0':    'Creative Commons CC BY-NC 4.0 International',
}

PHRASE_LICENCE = {
    'de': 'Dieses Werk ist lizenziert unter einer %s.',
    'fr': 'Cette œuvre est diffusée sous licence %s.',
    'it': "Quest'opera è distribuita con licenza %s.",
}

ETIQUETTES_ISBN = (('isbn-print', 'ISBN Print on demand'), ('isbn-ebook', 'ISBN E-Book'))

TITRES_SOMMAIRE = {'de': 'Inhaltsverzeichnis', 'fr': 'Sommaire', 'it': 'Indice'}


def impressum(meta):
    """L'ordre est celui des livres publiés : année et éditeur, la fondation, les ISBN, le
    DOI, la licence. Chaque ligne absente de buch.yaml disparaît — on n'imprime pas un ISBN
    qu'on n'a pas."""
    blocs = []
    if meta.get('annee'):
        blocs.append('© ' + html.escape(str(meta['annee'])))
    blocs.append('Edition SZH/CSPS')
    blocs.append('<br>'.join(html.escape(x) for x in FONDATION))
    for cle, etiquette in ETIQUETTES_ISBN:
        if meta.get(cle):
            blocs.append('%s: %s' % (etiquette, html.escape(str(meta[cle]))))
    if meta.get('doi'):
        blocs.append('https://doi.org/' + html.escape(str(meta['doi'])))
    lic = LICENCES.get(str(meta.get('licence') or ''))
    if lic:
        phrase = PHRASE_LICENCE.get(str(meta.get('lang')), PHRASE_LICENCE['fr'])
        blocs.append(phrase % html.escape(lic))
    corps = '\n'.join('<p>' + x + '</p>' for x in blocs)
    return '<section class="szh-liminaire szh-impressum">' + corps + '</section>'


# --------------------------------------------------------------------------------------
# Incorporation d'une feuille de style (--css-embed) : voir main() pour le pourquoi.
# --------------------------------------------------------------------------------------

RE_URL_CSS = re.compile(r'url\(\s*([\'"]?)([^\'")]+)\1\s*\)')


def _url_absolues(css_texte, css_chemin):
    """Réécrit les `url(...)` relatives d'une feuille (@font-face, url() d'image) en
    chemins absolus file://, résolus depuis le DOSSIER DE LA FEUILLE — pas depuis le
    document final. Indispensable ici et nulle part ailleurs : une feuille LIÉE (--css)
    garde ses url() relatives à SA PROPRE position, le navigateur les résout depuis elle ;
    une feuille INCORPORÉE dans un <style> voit ses url() résolues depuis le document qui
    la contient — socle.css écrit `url("../fonts/…")`, juste depuis styles/, faux depuis
    out/ une fois collé dans le HTML web. Une url() déjà absolue (http, https, data, file)
    traverse sans changement.

    ⚠ Le toolkit compile tantôt sous Windows, tantôt dans l'image WSL (voir Makefile,
    `wsl.exe -d SZH-Publishing`) : la MÊME feuille, sur le MÊME disque, y a deux visages
    (`C:\…` et `/mnt/c/…`). Le HTML web, lui, est ouvert depuis Windows (ce sont ses
    polices que file:// doit retrouver) : un chemin `/mnt/<lettre>/…` — celui que rendrait
    `os.path.abspath` lancé depuis WSL — est donc reconverti en `<LETTRE>:/…` avant de
    devenir une URI, sans quoi la police resterait introuvable une fois le HTML ouvert par
    un navigateur Windows natif (repli silencieux sur la police système : rien de cassé à
    l'écran, mais plus la police de la maison)."""
    dossier = os.path.dirname(os.path.abspath(css_chemin))
    m_wsl = re.match(r'^/mnt/([a-zA-Z])(/.*)$', dossier)
    if m_wsl:
        dossier = '%s:%s' % (m_wsl.group(1).upper(), m_wsl.group(2))

    def remplace(m):
        brut = m.group(2)
        if re.match(r'^(https?|data|file):', brut):
            return m.group(0)
        chemin_absolu = os.path.normpath(os.path.join(dossier, brut))
        uri = 'file:///' + chemin_absolu.replace('\\', '/').lstrip('/')
        return 'url("%s")' % uri

    return RE_URL_CSS.sub(remplace, css_texte)


# --------------------------------------------------------------------------------------
# Substitution des jetons du gabarit, jamais à l'intérieur d'un commentaire HTML de celui-ci.
#
# Un remplacement fait au ras du texte (`str.replace` sur le gabarit entier) matcherait
# aussi bien un jeton cité dans un commentaire de documentation du gabarit que celui que
# pandoc insère lui-même entre deux listes adjacentes de même type d'un fragment (pour
# qu'un outil qui relit le HTML ne les recolle pas en une seule) ; refermer ce commentaire
# par erreur fait alors passer tout ce qui suit pour du HTML réel avant la balise <html>,
# ce qui a déjà fait sortir un livre publié sans H1 dans son arbre de structure (PDF/UA-1
# non conforme), sans qu'un seul niveau de titre n'ait bougé dans le texte source.
#
# Le remède ne touche pas au commentaire — le nommer est légitime, c'est de la
# documentation — il rend le remplacement aveugle à ce qu'il y a dans un commentaire.
_RE_COMMENTAIRE = re.compile(r'(<!--.*?-->)', re.S)


def _remplacer_jetons(gabarit, remplacements):
    """Substitue les jetons du dict partout sauf dans un commentaire HTML du gabarit.

    `re.split` avec un groupe capturant rend une liste où les commentaires eux-mêmes
    alternent avec le texte qui les sépare : indices pairs = hors commentaire (à
    substituer), indices impairs = le commentaire tel quel (à laisser intact, jetons
    littéraux compris)."""
    morceaux = _RE_COMMENTAIRE.split(gabarit)
    for i in range(0, len(morceaux), 2):
        for cle, val in remplacements.items():
            morceaux[i] = morceaux[i].replace(cle, val)
    return ''.join(morceaux)


# --------------------------------------------------------------------------------------
# Métadonnées pandoc pour l'EPUB.
#
# Pourquoi ici et pas dans le Makefile : les tirer de buch.yaml à coups de `sed` demande une
# expression par clé, et une de plus pour la liste des auteur·e·s — qui est un bloc à tirets,
# donc hors de portée d'un sed d'une ligne. La première version l'a payé : elle sortait un
# EPUB sans ISBN, et avec un `dc:creator` codé en dur au nom de la personne qui l'avait
# écrite. Ce module lit déjà buch.yaml correctement ; il écrit donc le fichier que pandoc
# attend, et le Makefile ne fait que le lui passer.
#
# ⚠ Aucune clé n'est inventée. Un ISBN absent ne produit pas d'identifiant : pandoc en
#   fabriquera un urn:uuid, ce qui est la bonne réponse pour un fichier qui n'en a pas
#   encore — un identifiant faux serait pire qu'un identifiant provisoire.

def metadonnees_epub(meta):
    """Rend le texte d'un fichier de métadonnées YAML pour pandoc (--metadata-file)."""
    def guillemets(v):
        return '"' + str(v).replace('\\', '\\\\').replace('"', '\\"') + '"'

    lignes = []
    if meta.get('titre'):
        lignes.append('title: ' + guillemets(meta['titre']))
    if meta.get('sous-titre'):
        lignes.append('subtitle: ' + guillemets(meta['sous-titre']))
    lignes.append('lang: ' + guillemets(str(meta.get('lang') or 'fr')))

    # Les auteur·e·s de l'ouvrage. En ouvrage collectif la liste est vide, et c'est voulu :
    # les auteur·e·s y sont ceux des chapitres, et les hisser en dc:creator du volume
    # attribuerait le livre entier à la première personne de la liste.
    noms = []
    for a in (meta.get('auteurs') or []):
        if isinstance(a, dict):
            n = ' '.join(x for x in (a.get('prenom'), a.get('nom')) if x)
            if n:
                noms.append(n)
        elif a:
            noms.append(str(a))
    if noms:
        lignes.append('author:')
        for n in noms:
            lignes.append('- ' + guillemets(n))

    if meta.get('isbn-ebook'):
        lignes.append('identifier:')
        lignes.append('- scheme: ISBN-13')
        lignes.append('  text: ' + guillemets(meta['isbn-ebook']))
    if meta.get('annee'):
        lignes.append('date: ' + guillemets(meta['annee']))
    lic = LICENCES.get(str(meta.get('licence') or ''))
    if lic:
        lignes.append('rights: ' + guillemets(lic))
    if meta.get('collection'):
        serie = str(meta['collection'])
        if meta.get('tome'):
            serie += ', ' + str(meta['tome'])
        lignes.append('belongs-to-collection: ' + guillemets(serie))
    lignes.append('publisher: "Edition SZH/CSPS"')
    return chr(10).join(lignes) + chr(10)


def main(argv):
    """Les feuilles de style passées en --css sont LIÉES, pas incorporées : le fichier
    reste lisible pour qui débogue une coupure de page, et WeasyPrint lit un chemin
    absolu sans difficulté — c'est la voie du PDF (numérique et imprimeur) et du HTML de
    compilation. Les images, elles, sont déjà en data: URI dans chaque fragment.

    --css-embed fait l'inverse : la feuille est INCORPORÉE dans un <style>, pas liée. Il
    n'existe que pour le HTML web (livre-html-web) : « autonome » y est la promesse — un
    seul fichier qu'on partage ou qu'on ouvre par file:// sans rien à côté — et un <link>
    vers un chemin absolu du poste de compilation ne survivrait pas au voyage."""
    meta_p = gabarit_p = sortie_p = meta_epub = None
    # Dossier de sortie du livre (celui que livre.mk appelle $(OUT), toujours « out » sur ce
    # dépôt) : un argument plutôt qu'un chemin en dur, pour que la recherche des liminaires
    # écrits à la main (out/liminaires/<nom>.html) suive livre.mk si ce dossier changeait un
    # jour. SZH_OUT_LIVRE en repli, pour un appel hors Makefile (tests, essai à la main).
    out_dir = os.environ.get('SZH_OUT_LIVRE') or 'out'
    feuilles, feuilles_incorporees, fragments = [], [], []
    i = 1
    while i < len(argv):
        a = argv[i]
        if a == '--meta' and i + 1 < len(argv):
            meta_p = argv[i + 1]
            i += 2
        elif a == '--gabarit' and i + 1 < len(argv):
            gabarit_p = argv[i + 1]
            i += 2
        elif a == '--sortie' and i + 1 < len(argv):
            sortie_p = argv[i + 1]
            i += 2
        elif a == '--css' and i + 1 < len(argv):
            feuilles.append(argv[i + 1])
            i += 2
        elif a == '--metadonnees-epub' and i + 1 < len(argv):
            meta_epub = argv[i + 1]
            i += 2
        elif a == '--css-embed' and i + 1 < len(argv):
            feuilles_incorporees.append(argv[i + 1])
            i += 2
        elif a == '--out' and i + 1 < len(argv):
            out_dir = argv[i + 1]
            i += 2
        elif a.startswith('--'):
            print('[livre] option inconnue : ' + a, file=sys.stderr)
            return 2
        else:
            fragments.append(a)
            i += 1
    if not (meta_p and gabarit_p and sortie_p):
        print('usage: livre-assembler.py --meta buch.yaml --gabarit g.html '
              '--sortie out.html [--out dossier] [--css f.css]... '
              '[--css-embed f.css]... <fragment>...', file=sys.stderr)
        return 2

    meta = lire_yaml(meta_p)
    racine = os.path.dirname(os.path.abspath(meta_p))
    langue = str(meta.get('lang') or 'fr')

    corps, entrees = [], []
    for f in fragments:
        try:
            frag = open(f, encoding='utf-8').read()
        except OSError as e:
            print('[livre] fragment illisible : %s (%s)' % (f, e), file=sys.stderr)
            return 1
        entrees.extend(titres_du_fragment(frag))
        corps.append(frag)

    # Les liminaires, dans l'ordre déclaré. Un nom de fichier .md renvoie à la pièce écrite
    # à la main, compilée comme un chapitre ; les autres sont des mots-clés que la machine
    # compose à partir de buch.yaml.
    composeurs = {
        'demi-titre': lambda: demi_titre(meta, langue),
        'colophon':   lambda: impressum(meta),
        'impressum':  lambda: impressum(meta),
        'page-titre': lambda: page_titre(meta, langue),
        'sommaire':   lambda: sommaire_html(entrees,
                                            TITRES_SOMMAIRE.get(langue, 'Sommaire')),
    }
    tete = []
    for piece in (meta.get('liminaires') or []):
        piece = str(piece)
        if piece in composeurs:
            tete.append(composeurs[piece]())
        elif piece.endswith('.md'):
            f = os.path.join(racine, out_dir, 'liminaires', piece[:-3] + '.html')
            if os.path.exists(f):
                tete.append('<section class="szh-liminaire szh-romain">'
                            + open(f, encoding='utf-8').read() + '</section>')
            else:
                # Une pièce liminaire annoncée dans buch.yaml (`liminaires:`) mais jamais
                # compilée manquerait au livre sans un mot si on continuait : un simple
                # print sur stderr, suivi d'un retour 0, laissait partir un livre incomplet
                # en se donnant l'air d'avoir réussi. Ici, l'absence arrête l'assemblage.
                print('[livre-blocage] liminaire-introuvable | pièce « ' + piece + ' » | '
                      "La pièce liminaire « " + piece + " » est annoncée dans buch.yaml "
                      "(liminaires:) mais n'a pas été compilée : " + f + " est introuvable. "
                      "Vérifiez qu'elle existe dans liminaires/, puis relancez la "
                      'compilation. | [de] Das im buch.yaml angekündigte Vorsatzstück « '
                      + piece + ' » (liminaires:) wurde nicht kompiliert: ' + f
                      + ' fehlt. Prüfen Sie, ob es in liminaires/ liegt, und kompilieren '
                      'Sie danach neu.', file=sys.stderr)
                return 1
        else:
            print('[livre] liminaire inconnu, ignore : ' + piece, file=sys.stderr)

    try:
        gabarit = open(gabarit_p, encoding='utf-8').read()
    except OSError as e:
        print('[livre] gabarit illisible : %s (%s)' % (gabarit_p, e), file=sys.stderr)
        return 1

    liens = '\n'.join('  <link rel="stylesheet" href="%s" />' % html.escape(c, quote=True)
                      for c in feuilles)
    for c in feuilles_incorporees:
        try:
            contenu = open(c, encoding='utf-8').read()
        except OSError as e:
            print('[livre] feuille à incorporer illisible : %s (%s)' % (c, e),
                  file=sys.stderr)
            return 1
        contenu = _url_absolues(contenu, c)
        # </style> dans le contenu couperait la balise court : aucune feuille du toolkit
        # n'en contient (c'est du CSS), mais une locale future pourrait — le
        # remplacement est gratuit et évite un HTML cassé en silence.
        contenu = contenu.replace('</style>', '<\\/style>')
        liens += ('\n  <style>/* %s */\n%s\n</style>'
                  % (html.escape(os.path.basename(c)), contenu))
    remplacements = {
        '$lang$':          langue,
        '$titre$':         html.escape(str(meta.get('titre') or '')),
        '$sous-titre$':    html.escape(str(meta.get('sous-titre') or '')),
        '$auteurs$':       html.escape(_auteurs_ligne(meta, langue)),
        '$classe-format$': 'szh-a4' if str(meta.get('format')) == 'a4' else '',
        '$css$':           liens,
        '$liminaires$':    '\n'.join(tete),
        '$corps$':         '\n'.join(corps),
    }
    sortie = _remplacer_jetons(gabarit, remplacements)

    dossier = os.path.dirname(os.path.abspath(sortie_p))
    if dossier:
        os.makedirs(dossier, exist_ok=True)
    with open(sortie_p, 'w', encoding='utf-8') as fh:
        fh.write(sortie)
    if meta_epub:
        with open(meta_epub, 'w', encoding='utf-8') as fh:
            fh.write(metadonnees_epub(meta))

    print('[livre] %d chapitre(s), %d liminaire(s), %d entree(s) de sommaire'
          % (len(fragments), len(tete), len(entrees)), file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
