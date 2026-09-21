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
# (Fragment(texte, image, forme, lien, source, note), Paragraphe(style, niveau_declare,
# niveau_retenu, fragments, liste, alignement, retrait, source)) et reconstruit ses objets de
# sortie par `type(paragraphe)(...)` / `type(fragment)(...)` — la classe réelle n'a donc
# jamais besoin d'exister au moment où CE fichier est écrit ; elle doit seulement exister
# À L'EXÉCUTION, avec cette forme.
#
# `Fragment.note` (int|None, `texte == ''` quand rempli, §4 du contrat) porte l'appel de note
# (w:footnoteReference/w:endnoteReference). Un fragment à note est une unité OPAQUE, au même
# titre qu'une image : jamais envoyé au filtre, réinséré tel quel à sa place (voir
# _partitionner, _fragment_depuis). Lu via `getattr(..., 'note', None)`, jamais un accès
# direct `f.note` : un Fragment-like plus ancien qui ne le porterait pas encore ne doit pas
# lever `AttributeError` ici.
#
# Mesures qui gouvernent ce module :
#
# - Piper des octets JSON à travers `wsl.exe -d SZH-Publishing -- pandoc ...` (arguments en
#   tableau, jamais `-e bash -lc`) rend un flux UTF-8 parfaitement propre — vérifié octet par
#   octet. La mise en garde du contrat sur « la sortie de wsl.exe n'est pas de l'UTF-8 propre »
#   vaut pour `wsl -l -v` (UTF-16), pas pour un programme Linux relayé tel quel par un pipe.
# - `--` littéral ne devient PAS insécable + demi-cadratin : cette conversion vient de
#   l'extension « smart » du lecteur Markdown de pandoc, jamais atteinte par un AST construit
#   à la main (`-f json`). Un vrai cadratin (U+2014, ce que pose l'autocorrection Word) DEVIENT
#   bien insécable + demi-cadratin — le filtre le traite lui-même. La différence ne se voit
#   que sur `--` tapé tel quel, un cas rare : signalé, pas réimplémenté en Python.
# - Les guillemets droits non appariés ne sont pas convertis (le filtre le dit, code C2) ;
#   les guillemets courbes de l'autocorrection Word le sont, en chevrons — ce module n'a donc
#   jamais besoin de construire de nœud Quoted pandoc.

import difflib
import json
import os
import subprocess
import sys
import time

# ---------------------------------------------------------------------------------------
# Révision du 19.09.2026 : l'ancien garde-fou comparait chaque caractère perdu/ajouté par la
# réinjection à une liste blanche « typographique », et abandonnait le paragraphe dès qu'un
# caractère en sortait. Mesuré sur lot-A : 4 paragraphes sur 845 abandonnés À TORT, parce que
# le filtre corrigeait du contenu réel que la liste ne connaissait pas (A -> À en début de
# phrase, 3ème -> 3e, une espace fine U+2009 -> l'insécable fine U+202F, une apostrophe
# courbe ouvrante U+2018 -> un chevron simple U+2039). Le filtre a raison dans les quatre
# cas — ce pont n'a pas à le rejuger.
#
# Le vrai invariant, désormais le SEUL : le texte réinjecté dans les fragments doit être
# identique, caractère pour caractère, au texte que le filtre a rendu (vérifié explicitement
# dans _reconstruire_unite, jamais supposé) ; et le texte envoyé au filtre pour cette unité
# doit rester identique à la concaténation des fragments d'origine entre les deux passes. Les
# deux échecs restent réels mais deviennent des bugs de CE module, jamais un verdict sur une
# correction du filtre.
# ---------------------------------------------------------------------------------------

DISTRO = 'SZH-Publishing'

# Délai généreux : un lot de paragraphes reste un appel unique, mais une distro froide (pas
# encore préchauffée) peut prendre plusieurs secondes à répondre. Un délai qui expire est
# traité comme une indisponibilité de pandoc (repli), jamais comme une exception qui remonte.
DELAI_SECONDES = 90


class _EchecReconstruction(Exception):
    """Interne : lève quand la réinjection d'UNE unité de texte ne peut pas garantir les deux
    invariants du §6 (révision du 19.09.2026) : le texte des fragments d'origine ne correspond
    plus à celui envoyé au filtre, ou le texte reconstruit ne reproduit pas EXACTEMENT celui
    que le filtre a rendu. Capturée à l'échelle du PARAGRAPHE entier — un seul échec dans une
    de ses unités (séparées par une image, voir plus bas) abandonne tout le paragraphe, jamais
    seulement le fragment fautif. Ce n'est plus jamais un jugement sur LE CONTENU d'une
    correction du filtre — seulement un bug de reconstruction, de CE module."""


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


def _executer_pandoc(entree_json, langue, racine_depot):
    """LA fonction qui décide comment joindre pandoc — une seule fois, testée dans les deux
    branches. Sous Linux (`sys.platform != 'win32'` : c'est le cas en production, le lanceur
    exécute cette CLI DANS la WSL via `wsl -d SZH-Publishing -e python3 ...`), pandoc est déjà
    sur le PATH : l'appeler directement, avec le chemin Linux natif du filtre, sans wslpath ni
    wsl.exe — ces deux-là n'existent PAS dans la distro, et un `wsl.exe` introuvable n'y lève
    AUCUNE exception (`FileNotFoundError` sur un nom qui ressemble à un exécutable ordinaire),
    il déclenche un repli silencieux. Mesuré : 845 paragraphes sur 845 rendus inchangés, code
    de sortie 0, avant ce correctif. Sous Windows (le poste de développement), rien ne change :
    `wsl.exe` + `wslpath -a`, comme avant. Rend l'objet `subprocess.CompletedProcess`."""
    chemin_filtre_natif = os.path.join(racine_depot, 'pipeline', 'filters', 'szh-typographie.lua')
    if sys.platform != 'win32':
        commande = ['pandoc', '-f', 'json', '-t', 'json', '-M', 'lang=%s' % langue,
                    '--lua-filter', chemin_filtre_natif]
    else:
        wsl_exe = _chemin_wsl_exe()
        filtre_wsl = _chemin_pour_wsl(wsl_exe, chemin_filtre_natif)
        commande = [wsl_exe, '-d', DISTRO, '--', 'pandoc', '-f', 'json', '-t', 'json',
                    '-M', 'lang=%s' % langue, '--lua-filter', filtre_wsl]
    try:
        return subprocess.run(commande, input=entree_json, capture_output=True,
                               timeout=DELAI_SECONDES)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise _PandocIndisponible('pandoc injoignable (%s) : %s'
                                   % ('direct' if sys.platform != 'win32' else 'via wsl.exe', e))


def _appeler_pandoc(textes, langue, racine_depot):
    """Un seul appel pandoc pour TOUT le lot (le coût de démarrage ne se paie qu'une fois,
    §6 du contrat). `textes` est la liste ordonnée des unités à normaliser (une par run de
    fragments texte ininterrompu par une image) ; rend `(textes_normalises, avertissements)` —
    la liste des textes normalisés dans le même ordre, et les lignes brutes
    `[typo-avertissement]` que le filtre a émises sur stderr (révision du 19.09.2026 : lues
    aussi sur un appel RÉUSSI, plus seulement sur l'échec — avant, elles étaient capturées puis
    jetées en silence sur un succès). Lève _PandocIndisponible pour tout ce qui empêche une
    réponse — c'est l'appelant qui décide du repli, jamais cette fonction."""
    doc = {
        'pandoc-api-version': [1, 23, 1],
        'meta': {},
        'blocks': [{'t': 'Para', 'c': _construire_inlines(t)} for t in textes],
    }
    entree = json.dumps(doc).encode('utf-8')

    r = _executer_pandoc(entree, langue, racine_depot)
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
        textes_normalises = [_a_plat(b.get('c', [])) for b in blocs]
    except _EchecReconstruction as e:
        # Un type d'inline imprévu au niveau du LOT ENTIER (pas d'une unité isolée) est une
        # anomalie de l'outillage, pas d'un paragraphe précis : traité comme une
        # indisponibilité, pour que le lot entier reparte inchangé plutôt qu'à moitié.
        raise _PandocIndisponible(str(e))

    avertissements = [ligne for ligne in r.stderr.decode('utf-8', 'replace').splitlines()
                       if ligne.startswith('[typo-avertissement]')]
    return textes_normalises, avertissements


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


def _reconstruire_unite(fragments_texte, texte_envoye, texte_normalise):
    """Réinjecte `texte_normalise` dans `fragments_texte` (une liste de Fragment-like, tous à
    image=None, run consécutif au sein d'un paragraphe). Rend une nouvelle liste de fragments
    couvrant EXACTEMENT `texte_normalise`, chacun héritant du `forme`/`lien` de son fragment
    d'origine.

    Révision du 19.09.2026 : le filtre est la vérité, ce module ne juge plus SES corrections
    (voir la note en tête de fichier). _EchecReconstruction ne protège donc plus contre « un
    caractère typographique inattendu » — seulement contre les deux façons dont CE module
    pourrait trahir le texte : `texte_envoye` (ce qui a vraiment été soumis au filtre pour
    cette unité) qui ne correspondrait plus à `fragments_texte` (garde d'entrée), ou une
    reconstruction qui ne reproduirait pas `texte_normalise` caractère pour caractère (garde
    de sortie, l'invariant du §6)."""
    texte_origine = ''.join(f.texte for f in fragments_texte)
    if texte_origine != texte_envoye:
        raise _EchecReconstruction(
            "le texte des fragments d'origine (%r) ne correspond plus au texte envoyé au "
            "filtre (%r)" % (texte_origine, texte_envoye))

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
    # Le filtre a toujours raison : un 'replace'/'insert' pose le caractère du filtre, un
    # 'delete' pur ne réinjecte plus rien — sans plus jamais juger CE que le filtre a changé.
    segments = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == 'equal':
            for k in range(i2 - i1):
                segments.append((texte_normalise[j1 + k], index_fragment[i1 + k]))
            continue

        ajoute = texte_normalise[j1:j2]   # '' si tag == 'delete'
        if not ajoute:
            continue  # 'delete' pur : les caractères perdus ne réapparaissent nulle part.

        origine_idx = _voisin_gauche(index_fragment, i1)
        if origine_idx is None:
            # Ne peut arriver que si fragments_texte est vide, donc texte_origine == '' -
            # exclu en amont (seuls les runs non vides sont envoyés à pandoc). Garde par
            # prudence : mieux vaut abandonner que d'inventer une forme neutre.
            raise _EchecReconstruction('caractère ajouté sans fragment d’origine disponible')
        for c in ajoute:
            segments.append((c, origine_idx))

    # Garde de sortie (l'invariant du §6) : le texte assemblé DOIT reproduire exactement
    # celui rendu par le filtre. Mathématiquement garanti par construction ci-dessus (les
    # opcodes de SequenceMatcher couvrent tout `texte_normalise` sans trou ni recouvrement) —
    # vérifié quand même, explicitement : un filet de sécurité ne vaut rien s'il est supposé.
    texte_reconstruit = ''.join(c for c, _ in segments)
    if texte_reconstruit != texte_normalise:
        raise _EchecReconstruction(
            'la reconstruction (%r) ne reproduit pas le texte rendu par le filtre (%r)'
            % (texte_reconstruit, texte_normalise))

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
    définit la classe réelle, seulement de sa signature.

    Révision du 19.09.2026 : recopie aussi `note` (via `getattr`, jamais un accès direct — voir
    l'en-tête). `original` est toujours un fragment de TEXTE ici (un fragment à note est opaque,
    voir _partitionner : il ne traverse jamais _fragment_depuis), donc `note` vaut déjà None en
    pratique — recopié quand même explicitement plutôt que supposé : un filet, pas une devinette."""
    return type(original)(''.join(caracteres), None, original.forme, original.lien,
                           original.source, note=getattr(original, 'note', None))


def _partitionner(fragments):
    """Découpe la liste de fragments d'un paragraphe en unités : soit ('opaque', fragment) pour
    un fragment qui porte une image OU une note (jamais touché ici, réinséré tel quel à sa
    place), soit ('texte', [fragments...]) pour un run maximal de fragments consécutifs SANS
    image ni note. Une image ou une note coupe le fil du texte : la typographie ne doit jamais
    faire comme si le texte de part et d'autre se touchait.

    Révision du 19.09.2026 (§4 du contrat) : un fragment à note (`getattr(f, 'note', None) is
    not None`) est désormais traité comme une image — avant cette révision, il retombait dans
    le run de texte courant, `_partitionner` ne sachant rien de `note` : mesuré sur
    2-fin-de-document_Article_RSPS.docx, 11 notes sur 12 disparaissaient (le lecteur en rend 12,
    la sortie n'en portait plus qu'1)."""
    unites = []
    courant = []
    for f in fragments:
        if f.image is not None or getattr(f, 'note', None) is not None:
            if courant:
                unites.append(('texte', courant))
                courant = []
            unites.append(('opaque', f))
        else:
            courant.append(f)
    if courant:
        unites.append(('texte', courant))
    return unites


def normaliser_paragraphes(paragraphes, langue, racine_depot):
    """Rend (paragraphes_normalises, traces, abandons, avertissements, statut).

    `paragraphes` : liste de Paragraphe-like (§4 du contrat). `langue` : 'fr' ou 'de', passée
    telle quelle en `-M lang=`. `racine_depot` : chemin de la racine du dépôt (Windows ou
    Linux selon sys.platform, voir _executer_pandoc), pour retrouver
    pipeline/filters/szh-typographie.lua quel que soit l'endroit où le toolkit est déployé.

    `traces` : liste de chaînes, pour le rapport — au moins une ligne sur l'appel pandoc
    (nombre d'unités, durée) ou sur le repli. `abandons` : liste de dicts
    {'source': paragraphe.source, 'motif': str} — un par paragraphe dont la réinjection a
    échoué et qui ressort donc identique à l'entrée (§6, révision du 19.09.2026 : n'arrive
    plus que sur un bug de CE module, jamais sur une correction du filtre qu'on aurait
    jugée). `avertissements` : lignes brutes `[typo-avertissement]` lues sur stderr d'un
    appel pandoc RÉUSSI — à redécouper par manuscrit_regles._reprendre_avertissements_typo,
    jamais ici. `statut` : 'appliquee' si pandoc a répondu (même sans rien à normaliser),
    'repli' si l'outillage était indisponible — destiné à la ligne stdout de la CLI, jamais
    un jugement sur le contenu du document.
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
        return list(paragraphes), traces, abandons, [], 'appliquee'

    debut = time.perf_counter()
    try:
        textes_normalises, avertissements = _appeler_pandoc(textes_a_envoyer, langue,
                                                              racine_depot)
    except _PandocIndisponible as e:
        # Repli obligatoire (§6) : AUCUN paragraphe n'est touché, une seule trace explique
        # pourquoi. On ne renseigne jamais `abandons` ici — ce n'est pas un échec de
        # reconstruction paragraphe par paragraphe, c'est l'outillage entier qui a manqué.
        traces.append(
            'manuscrit-typo : repli sans typographie (pandoc/wsl indisponible) — %s' % e)
        return list(paragraphes), traces, abandons, [], 'repli'
    duree_ms = (time.perf_counter() - debut) * 1000
    traces.append('manuscrit-typo : %d unité(s) normalisée(s) via pandoc en %.1f ms.'
                   % (len(textes_a_envoyer), duree_ms))

    # texte envoyé / texte normalisé, par (index_paragraphe, index_unite) — les DEUX clés
    # sont nécessaires désormais : _reconstruire_unite vérifie que l'un n'a pas divergé du
    # fragment d'origine entre les deux passes (garde d'entrée du §6).
    envoye_par_cle = {}
    normalise_par_cle = {}
    for (ip, iu), texte_env, texte_norm in zip(plan, textes_a_envoyer, textes_normalises):
        envoye_par_cle[(ip, iu)] = texte_env
        normalise_par_cle[(ip, iu)] = texte_norm

    resultat = []
    for ip, p in enumerate(paragraphes):
        unites = unites_par_paragraphe[ip]
        try:
            nouveaux_fragments = []
            for iu, (nature, contenu) in enumerate(unites):
                if nature == 'opaque':
                    nouveaux_fragments.append(contenu)
                    continue
                texte_norm = normalise_par_cle.get((ip, iu))
                if texte_norm is None:
                    # Run de texte vide, jamais envoyé à pandoc : rien à reconstruire.
                    nouveaux_fragments.extend(contenu)
                    continue
                texte_env = envoye_par_cle[(ip, iu)]
                nouveaux_fragments.extend(_reconstruire_unite(contenu, texte_env, texte_norm))
        except _EchecReconstruction as e:
            abandons.append({'source': p.source, 'motif': str(e)})
            resultat.append(p)  # intact, jamais un texte reconstruit à moitié
            continue
        resultat.append(type(p)(p.style, p.niveau_declare, p.niveau_retenu, nouveaux_fragments,
                                 p.liste, p.alignement, p.retrait, p.source))

    if abandons:
        traces.append('manuscrit-typo : %d paragraphe(s) abandonné(s), rendu(s) intact(s).'
                       % len(abandons))

    return resultat, traces, abandons, avertissements, 'appliquee'
