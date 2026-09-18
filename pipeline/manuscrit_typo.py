#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# manuscrit_typo.py — le pont typographique du nettoyeur de manuscrit (§6 de
# outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md). Une seule fonction publique,
# normaliser_paragraphes(), qui NE RÉÉCRIT PAS la typographie de la maison : elle construit
# un AST pandoc depuis les fragments Word de chaque paragraphe, l'envoie une seule fois (pour
# tout le document) au filtre pipeline/filters/szh-typographie.lua dans la WSL, puis
# réinjecte le texte normalisé dans les fragments d'origine sans perdre leur mise en forme.
#
# Ce module ne connaît RIEN des décisions (titres, formatage à retirer, blocs figure/tableau
# — tout ça vit dans manuscrit_modele.py, jamais ici) et n'importe PAS les classes Fragment /
# Paragraphe : il travaille en duck-typing contre les signatures exactes du §4 du contrat
# (Fragment(texte, image, forme, lien, source), Paragraphe(style, niveau_declare,
# niveau_retenu, fragments, liste, alignement, retrait, source)) et reconstruit ses objets de
# sortie par `type(paragraphe)(...)` / `type(fragment)(...)` — la classe réelle n'a donc
# jamais besoin d'exister au moment où CE fichier est écrit ; elle doit seulement exister
# À L'EXÉCUTION, avec cette forme.
#
# ── Ce qui a été mesuré avant d'écrire une ligne (18.09.2026, WSL SZH-Publishing) ──────────
#
# 1. Piper des octets JSON à travers `wsl.exe -d SZH-Publishing -- pandoc ...` (arguments en
#    tableau, jamais `-e bash -lc`) rend un flux UTF-8 PARFAITEMENT PROPRE — vérifié octet
#    par octet (l'insécable U+00A0 ressort en \xc2\xa0, sans troncature ni ré-encodage). La
#    mise en garde du contrat sur « la sortie de wsl.exe n'est pas de l'UTF-8 propre » se
#    vérifie sur `wsl -l -v` (une commande native Windows qui parle UTF-16), PAS sur la
#    sortie d'un programme Linux relayée telle quelle par un pipe : ce n'est pas la même
#    situation, et ce module n'a pas besoin de filtrer le flux.
#
# 2. En revanche l'exemple « `--` devenu insécable + demi-cadratin » du contrat vient de
#    pandoc LUI-MÊME (l'extension « smart » du lecteur Markdown, qui convertit `--` en tiret
#    demi-cadratin AVANT même que szh-typographie.lua ne voie le document) — pas du filtre.
#    Un AST construit à la main (comme ici, en `-f json`, sans jamais passer par le lecteur
#    Markdown) NE bénéficie PAS de cette conversion : un double tiret ASCII tapé tel quel
#    dans Word reste tel quel. Ce que le filtre traite bien LUI-MÊME, vérifié séparément : un
#    vrai tiret cadratin (U+2014, ce que l'autocorrection de Word pose réellement) devient
#    insécable + demi-cadratin. La différence ne se voit que sur `--` littéral, un cas rare
#    dans un manuscrit Word réel — signalé à Robin, pas corrigé ici en silence : ce serait
#    réinventer un bout de l'extension « smart » de pandoc en Python.
#
# 3. Les guillemets droits (") non appariés ne sont PAS convertis par le filtre — il le dit
#    lui-même (code C2, « rien ne dit lequel ouvre et lequel ferme ») — alors que des
#    guillemets COURBES (le résultat le plus courant de l'autocorrection Word, “ ”) sont bien
#    reconnus et deviennent des chevrons. Ce module n'a pas besoin de construire de noeud
#    Quoted pandoc : les guillemets courbes suffisent, et les droits sont un cas signalé par
#    le filtre lui-même, pas une régression d'ici.

import difflib
import json
import os
import subprocess
import time

# ---------------------------------------------------------------------------------------
# Ce qui compte comme un caractère « typographique » : LA décision qui protège contre une
# perte de contenu silencieuse. Un écart de réinjection (caractère perdu ou ajouté) n'est
# toléré QUE s'il ne porte que sur des caractères de cette liste — tout le reste déclenche
# l'abandon du paragraphe (voir _EchecReconstruction). Chaque entrée correspond à une règle
# nommée de szh-typographie.lua ou à sa forme source (celle que Word peut déjà porter avant
# le passage du filtre) :
#   - l'espace ordinaire ' '            : les règles d'espacement (A2/A3, T1, E1, E3...) en
#                                          ajoutent et en retirent constamment ;
#   - l'insécable U+00A0 et la fine insécable U+202F : posées par presque toutes les règles ;
#   - le demi-cadratin U+2013 (posé, T2/dashes) et le cadratin U+2014 (ce qu'il remplace,
#     l'autocorrection Word en pose un vrai) ;
#   - l'apostrophe typographique U+2019 (posée, A1) et l'apostrophe droite ASCII "'" (ce
#     qu'elle remplace) ;
#   - les points de suspension U+2026 (posés) et le point ASCII '.' (trois d'entre eux,
#     source de la conversion) ;
#   - le pour-mille U+2030 (posé, E3) ;
#   - les chevrons français « » et simples ‹ › (posés, A2/A3) ;
#   - les guillemets droits ASCII '"' et courbes U+201C/U+201D (ce qu'ils remplacent — les
#     droits peuvent aussi rester tels quels, signalés par le filtre, jamais perdus) ;
#   - le tiret ASCII '-' (source d'un double tiret, voir le point 2 ci-dessus : le filtre ne
#     le transforme pas lui-même, mais un caractère qui ne bouge jamais ne casse rien à
#     tolérer dans cette liste).
# ---------------------------------------------------------------------------------------
CARACTERES_TYPOGRAPHIQUES = frozenset(
    ' '
    '\u00a0\u202f'
    '\u2013\u2014'
    '\u2019\''
    '\u2026.'
    '\u2030'
    '\u00ab\u00bb\u2039\u203a'
    '"\u201c\u201d'
    '-'
)

# Distro WSL du pipeline — la même que lib/wsl.js et test/js/gardes.js. Ne JAMAIS diverger :
# c'est elle, et elle seule, qui est maintenue chaude par la tâche planifiée de bootstrap.ps1.
DISTRO = 'SZH-Publishing'

# Délai généreux : un lot de paragraphes reste un appel unique, mais une distro froide (pas
# encore préchauffée) peut prendre plusieurs secondes à répondre. Un délai qui expire est
# traité comme une indisponibilité de pandoc (repli), jamais comme une exception qui remonte.
DELAI_SECONDES = 90


class _EchecReconstruction(Exception):
    """Interne : lève quand la réinjection caractère par caractère d'UNE unité de texte a
    perdu ou ajouté un caractère non typographique. Capturée à l'échelle du PARAGRAPHE
    entier — un seul échec dans une de ses unités (séparées par une image, voir plus bas)
    abandonne tout le paragraphe, jamais seulement le fragment fautif."""


class _PandocIndisponible(Exception):
    """Interne : lève quand l'outillage externe (wsl.exe, la distro, pandoc) n'a pas pu
    répondre. Capturée à l'échelle du LOT ENTIER : c'est le repli obligatoire du contrat,
    tous les paragraphes ressortent inchangés."""


def _chemin_wsl_exe():
    """Même détection que lib/wsl.js : le wsl.exe de System32 d'abord (jamais un éventuel
    autre wsl.exe du PATH), sinon celui du PATH."""
    systeme = os.path.join(os.environ.get('WINDIR', 'C:\\Windows'), 'System32', 'wsl.exe')
    try:
        if os.path.exists(systeme):
            return systeme
    except OSError:
        pass
    return 'wsl.exe'


def _chemin_pour_wsl(wsl_exe, chemin_windows):
    """Convertit un chemin Windows en chemin WSL via `wslpath -a`, comme documenté au §6 du
    contrat — jamais un `/mnt/c/...` posé en dur : le point de montage n'est pas garanti
    identique sur tous les postes.

    ⚠ Mesuré le 18.09.2026, absent du §10 du contrat : wsl.exe AVALE les antislashs d'un
    argument passé en tableau (subprocess.run([...])), sans message d'erreur — 'C:\\Users\\x'
    devient 'C:Usersx' de l'autre côté, et wslpath échoue sur un chemin qui n'existe pas.
    Rien à voir avec le piège déjà connu de l'encodage de sortie : ici c'est l'ENTRÉE que
    wsl.exe mutile, avant même que la commande ne s'exécute côté Linux. Windows accepte le
    slash comme séparateur aussi bien que l'antislash ; le convertir ICI, avant l'appel,
    contourne le problème sans toucher au fond."""
    chemin_windows = chemin_windows.replace('\\', '/')
    try:
        r = subprocess.run([wsl_exe, '-d', DISTRO, '--', 'wslpath', '-a', chemin_windows],
                            capture_output=True, timeout=DELAI_SECONDES)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise _PandocIndisponible('wslpath injoignable : %s' % e)
    if r.returncode != 0:
        raise _PandocIndisponible(
            'wslpath a échoué (%d) : %s' % (r.returncode, r.stderr.decode('utf-8', 'replace')))
    return r.stdout.decode('utf-8').strip()


def _construire_inlines(texte):
    """Un paragraphe pandoc en Str/Space, construits à la main (§6 : « un AST pandoc construit
    à la main depuis les fragments »). Découpe sur l'espace ASCII SEULEMENT : les autres
    espaces (insécable, fine...) restent le contenu d'un Str, exactement comme le rend pandoc
    lui-même (constaté : "p. 5" ressort comme un seul Str, espace ordinaire compris, sur un
    texte qui contient l'abréviation « p. »). L'opération est son propre inverse par
    construction (`_a_plat` rejoint avec des espaces simples), donc aucune information n'est
    perdue même sur des espaces multiples, en tête ou en fin de texte."""
    mots = texte.split(' ')
    inlines = []
    for i, mot in enumerate(mots):
        if i > 0:
            inlines.append({'t': 'Space'})
        if mot != '':
            inlines.append({'t': 'Str', 'c': mot})
    return inlines


def _a_plat(inlines):
    """L'inverse de _construire_inlines, appliqué à ce que le filtre a rendu. Lève si un
    type d'inline imprévu apparaît (le filtre ne doit produire, sur une entrée qui ne
    contient jamais de Quoted ni de code, que du Str/Space/SoftBreak) : mieux vaut abandonner
    la reconstruction que de deviner ce qu'un noeud inconnu représente."""
    morceaux = []
    for el in inlines:
        t = el.get('t')
        if t == 'Str':
            morceaux.append(el['c'])
        elif t in ('Space', 'SoftBreak'):
            morceaux.append(' ')
        else:
            raise _EchecReconstruction('type d\u2019inline pandoc imprévu : %s' % t)
    return ''.join(morceaux)


def _appeler_pandoc(textes, langue, racine_depot):
    """Un seul appel pandoc pour TOUT le lot (le coût de démarrage ne se paie qu'une fois,
    §6 du contrat). `textes` est la liste ordonnée des unités à normaliser (une par run de
    fragments texte ininterrompu par une image) ; rend la liste des textes normalisés dans
    le même ordre. Lève _PandocIndisponible pour tout ce qui empêche une réponse — c'est
    l'appelant qui décide du repli, jamais cette fonction."""
    wsl_exe = _chemin_wsl_exe()
    chemin_filtre = os.path.join(racine_depot, 'pipeline', 'filters', 'szh-typographie.lua')
    filtre_wsl = _chemin_pour_wsl(wsl_exe, chemin_filtre)

    doc = {
        'pandoc-api-version': [1, 23, 1],
        'meta': {},
        'blocks': [{'t': 'Para', 'c': _construire_inlines(t)} for t in textes],
    }
    entree = json.dumps(doc).encode('utf-8')

    try:
        r = subprocess.run(
            [wsl_exe, '-d', DISTRO, '--', 'pandoc', '-f', 'json', '-t', 'json',
             '-M', 'lang=%s' % langue, '--lua-filter', filtre_wsl],
            input=entree, capture_output=True, timeout=DELAI_SECONDES)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise _PandocIndisponible('pandoc injoignable via wsl.exe : %s' % e)
    if r.returncode != 0:
        raise _PandocIndisponible(
            'pandoc a échoué (%d) : %s' % (r.returncode, r.stderr.decode('utf-8', 'replace')))

    try:
        sortie = json.loads(r.stdout.decode('utf-8'))
    except (UnicodeDecodeError, ValueError) as e:
        raise _PandocIndisponible('sortie pandoc illisible : %s' % e)

    blocs = sortie.get('blocks', [])
    if len(blocs) != len(textes):
        raise _PandocIndisponible(
            'pandoc a rendu %d bloc(s) pour %d envoyé(s)' % (len(blocs), len(textes)))
    try:
        return [_a_plat(b.get('c', [])) for b in blocs]
    except _EchecReconstruction as e:
        # Un type d'inline imprévu au niveau du LOT ENTIER (pas d'une unité isolée) est une
        # anomalie de l'outillage, pas d'un paragraphe précis : traité comme une
        # indisponibilité, pour que le lot entier reparte inchangé plutôt qu'à moitié.
        raise _PandocIndisponible(str(e))


def _voisin_gauche(index_fragment, i1):
    """Le fragment d'origine dont hérite un caractère INSÉRÉ, per le contrat : « un caractère
    inséré prend celui de son voisin de gauche ». i1 est la position (dans le texte d'origine
    de l'unité) où l'insertion se produit ; sans voisin de gauche (insertion en tout début de
    texte), on retombe sur le tout premier fragment de l'unité plutôt que sur rien — un choix
    arbitraire mais stable, jamais laissé à None tant qu'il existe au moins un fragment."""
    if i1 > 0:
        return index_fragment[i1 - 1]
    if index_fragment:
        return index_fragment[0]
    return None


def _reconstruire_unite(fragments_texte, texte_normalise):
    """Réinjecte `texte_normalise` dans `fragments_texte` (une liste de Fragment-like, tous à
    image=None, run consécutif au sein d'un paragraphe). Rend une nouvelle liste de fragments
    couvrant EXACTEMENT `texte_normalise`, chacun héritant du `forme`/`lien` de son fragment
    d'origine. Lève _EchecReconstruction si un caractère non typographique a été perdu ou
    ajouté — c'est le garde-fou du §6, non négociable."""
    texte_origine = ''.join(f.texte for f in fragments_texte)

    if texte_origine == texte_normalise:
        # Rien n'a changé : pas la peine de repasser par le diff, et surtout pas de risque
        # de reconstruire différemment un texte que le filtre n'a pas touché.
        return list(fragments_texte)

    # La carte : chaque caractère de texte_origine pointe vers l'index (dans
    # fragments_texte) du fragment qui l'a fourni.
    index_fragment = []
    for idx, f in enumerate(fragments_texte):
        index_fragment.extend([idx] * len(f.texte))

    matcher = difflib.SequenceMatcher(None, texte_origine, texte_normalise, autojunk=False)

    # segments : liste de (caractère, index_fragment_origine) dans l'ordre du texte NORMALISÉ.
    segments = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == 'equal':
            for k in range(i2 - i1):
                segments.append((texte_normalise[j1 + k], index_fragment[i1 + k]))
            continue

        perdu = texte_origine[i1:i2]      # '' si tag == 'insert'
        ajoute = texte_normalise[j1:j2]   # '' si tag == 'delete'
        if any(c not in CARACTERES_TYPOGRAPHIQUES for c in perdu) \
                or any(c not in CARACTERES_TYPOGRAPHIQUES for c in ajoute):
            raise _EchecReconstruction(
                'segment non reconstructible : perdu=%r ajoute=%r' % (perdu, ajoute))

        if not ajoute:
            continue  # 'delete' pur : les caractères perdus ne réapparaissent nulle part.

        origine_idx = _voisin_gauche(index_fragment, i1)
        if origine_idx is None:
            # Ne peut arriver que si fragments_texte est vide, donc texte_origine == '' -
            # exclu en amont (seuls les runs non vides sont envoyes a pandoc). Garde par
            # prudence : mieux vaut abandonner que d'inventer une forme neutre.
            raise _EchecReconstruction('caractère ajouté sans fragment d\u2019origine disponible')
        for c in ajoute:
            segments.append((c, origine_idx))

    # Regroupe les segments consécutifs de MÊME fragment d'origine en un seul nouveau
    # fragment — jamais par égalité de forme, pour garder la correspondance avec le
    # `source` (index du w:r) que porte le fragment d'origine, utile aux révisions natives
    # futures (§4, §12 du contrat).
    resultat = []
    courant_idx = None
    courant_chars = []
    for c, idx in segments:
        if idx != courant_idx:
            if courant_chars:
                resultat.append(_fragment_depuis(fragments_texte[courant_idx], courant_chars))
            courant_idx = idx
            courant_chars = [c]
        else:
            courant_chars.append(c)
    if courant_chars:
        resultat.append(_fragment_depuis(fragments_texte[courant_idx], courant_chars))
    return resultat


def _fragment_depuis(original, caracteres):
    """Un nouveau fragment texte, même classe et même forme/lien/source que `original`,
    portant `caracteres` comme texte. `type(original)(...)` plutôt qu'un import de Fragment :
    voir l'en-tête du fichier — ce module ne dépend jamais de l'existence du module qui
    définit la classe réelle, seulement de sa signature."""
    return type(original)(''.join(caracteres), None, original.forme, original.lien,
                           original.source)


def _partitionner(fragments):
    """Découpe la liste de fragments d'un paragraphe en unités : soit ('image', fragment)
    pour un fragment qui porte une image (jamais touché ici), soit ('texte', [fragments...])
    pour un run maximal de fragments consécutifs SANS image. Une image coupe le fil du texte
    : la typographie ne doit jamais faire comme si le texte de part et d'autre se touchait."""
    unites = []
    courant = []
    for f in fragments:
        if f.image is not None:
            if courant:
                unites.append(('texte', courant))
                courant = []
            unites.append(('image', f))
        else:
            courant.append(f)
    if courant:
        unites.append(('texte', courant))
    return unites


def normaliser_paragraphes(paragraphes, langue, racine_depot):
    """Rend (paragraphes_normalises, traces, abandons).

    `paragraphes` : liste de Paragraphe-like (§4 du contrat). `langue` : 'fr' ou 'de', passée
    telle quelle en `-M lang=`. `racine_depot` : chemin Windows de la racine du dépôt, pour
    retrouver pipeline/filters/szh-typographie.lua quel que soit l'endroit où le toolkit est
    déployé.

    `traces` : liste de chaînes, pour le rapport — au moins une ligne sur l'appel pandoc
    (nombre d'unités, durée) ou sur le repli. `abandons` : liste de dicts
    {'source': paragraphe.source, 'motif': str} — un par paragraphe dont la réinjection a
    échoué et qui ressort donc identique à l'entrée.
    """
    traces = []
    abandons = []

    # Un paragraphe peut contenir plusieurs unités de texte (coupées par des images). On
    # bâtit la liste à plat de toutes les unités de TOUS les paragraphes, pour ne faire
    # qu'UN SEUL appel pandoc quel que soit le nombre de paragraphes (§6 du contrat).
    plan = []  # (index_paragraphe, index_unite_dans_le_paragraphe)
    textes_a_envoyer = []
    unites_par_paragraphe = []  # même longueur que `paragraphes`

    for ip, p in enumerate(paragraphes):
        unites = _partitionner(p.fragments)
        unites_par_paragraphe.append(unites)
        for iu, (nature, contenu) in enumerate(unites):
            if nature != 'texte':
                continue
            texte = ''.join(f.texte for f in contenu)
            if texte == '':
                continue  # rien à envoyer à pandoc pour un run de texte vide
            plan.append((ip, iu))
            textes_a_envoyer.append(texte)

    if not textes_a_envoyer:
        traces.append('manuscrit-typo : aucun texte à normaliser dans ce lot.')
        return list(paragraphes), traces, abandons

    debut = time.perf_counter()
    try:
        textes_normalises = _appeler_pandoc(textes_a_envoyer, langue, racine_depot)
    except _PandocIndisponible as e:
        # Repli obligatoire (§6) : AUCUN paragraphe n'est touché, une seule trace explique
        # pourquoi. On ne renseigne jamais `abandons` ici — ce n'est pas un échec de
        # reconstruction paragraphe par paragraphe, c'est l'outillage entier qui a manqué.
        traces.append(
            'manuscrit-typo : repli sans typographie (pandoc/wsl indisponible) — %s' % e)
        return list(paragraphes), traces, abandons
    duree_ms = (time.perf_counter() - debut) * 1000
    traces.append('manuscrit-typo : %d unité(s) normalisée(s) via pandoc en %.1f ms.'
                   % (len(textes_a_envoyer), duree_ms))

    # texte normalisé par (index_paragraphe, index_unite)
    normalise_par_cle = {}
    for (ip, iu), texte_norm in zip(plan, textes_normalises):
        normalise_par_cle[(ip, iu)] = texte_norm

    resultat = []
    for ip, p in enumerate(paragraphes):
        unites = unites_par_paragraphe[ip]
        try:
            nouveaux_fragments = []
            for iu, (nature, contenu) in enumerate(unites):
                if nature == 'image':
                    nouveaux_fragments.append(contenu)
                    continue
                texte_norm = normalise_par_cle.get((ip, iu))
                if texte_norm is None:
                    # Run de texte vide, jamais envoyé à pandoc : rien à reconstruire.
                    nouveaux_fragments.extend(contenu)
                    continue
                nouveaux_fragments.extend(_reconstruire_unite(contenu, texte_norm))
        except _EchecReconstruction as e:
            abandons.append({'source': p.source, 'motif': str(e)})
            resultat.append(p)  # intact, jamais un texte reconstruit à moitié
            continue
        resultat.append(type(p)(p.style, p.niveau_declare, p.niveau_retenu, nouveaux_fragments,
                                 p.liste, p.alignement, p.retrait, p.source))

    if abandons:
        traces.append('manuscrit-typo : %d paragraphe(s) abandonné(s), rendu(s) intact(s).'
                       % len(abandons))

    return resultat, traces, abandons
