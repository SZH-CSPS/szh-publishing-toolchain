#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Pont typographique du nettoyeur de manuscrit (voir docs/ARCHITECTURE-nettoyeur-manuscrit.md).
# normaliser_paragraphes() construit un AST pandoc depuis les fragments Word, l'envoie en un
# seul appel au filtre pipeline/filters/szh-typographie.lua, puis réinjecte le texte
# normalisé dans les fragments d'origine en gardant leur mise en forme. Les règles
# typographiques vivent dans le filtre, pas ici.
#
# Le module n'importe pas Fragment ni Paragraphe : il en utilise la forme
# (Fragment(texte, image, forme, lien, source, note), Paragraphe(style, niveau_declare,
# niveau_retenu, fragments, liste, alignement, retrait, source)) et recrée ses objets par
# type(x)(...).
#
# Un fragment qui porte une image ou un appel de note (`note`, lu par getattr) est opaque :
# il n'est pas envoyé au filtre et reprend sa place tel quel.
#
# Pièges :
# - le JSON passé par un pipe à pandoc dans la WSL ressort en UTF-8 propre (seul
#   `wsl -l -v` parle UTF-16) ;
# - un AST construit à la main ne passe pas par l'extension « smart » de pandoc : `--` tapé
#   tel quel n'est pas converti, alors qu'un vrai cadratin l'est par le filtre ;
# - les guillemets courbes de Word deviennent des chevrons dans le filtre ; les guillemets
#   droits non appariés sont signalés (code C2). Aucun nœud Quoted n'est donc construit ici.
#
# Le filtre a toujours raison sur le contenu. Ce module vérifie seulement deux invariants :
# le texte envoyé est bien la concaténation des fragments d'origine, et le texte réinjecté
# reproduit exactement le texte rendu par le filtre.

import difflib
import json
import os
import subprocess
import time

# Une distribution WSL froide peut mettre plusieurs secondes à répondre. Un délai dépassé
# vaut indisponibilité de pandoc : repli, sans exception qui remonte.
DELAI_SECONDES = 90


class _EchecReconstruction(Exception):
    """La réinjection d'une unité de texte viole un des deux invariants (voir l'en-tête).
    Capturée au niveau du paragraphe : tout le paragraphe ressort intact."""


class _PandocIndisponible(Exception):
    """wsl.exe, la distribution ou pandoc n'a pas répondu. Capturée au niveau du lot : tous
    les paragraphes ressortent inchangés."""


def _construire_inlines(texte):
    """Un paragraphe pandoc en Str/Space. Découpe sur l'espace ASCII seulement : les autres
    espaces (insécable, fine) restent dans le Str, comme pandoc le fait lui-même.
    _a_plat() est l'inverse exact, espaces multiples compris."""
    mots = texte.split(' ')
    inlines = []
    for i, mot in enumerate(mots):
        if i > 0:
            inlines.append({'t': 'Space'})
        if mot != '':
            inlines.append({'t': 'Str', 'c': mot})
    return inlines


def _a_plat(inlines):
    """L'inverse de _construire_inlines, appliqué à ce que le filtre a rendu. Lève sur tout
    inline autre que Str, Space ou SoftBreak plutôt que de deviner ce qu'il représente."""
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
    """Lance pandoc avec le filtre de typographie (ce script tourne dans la WSL, où pandoc
    est sur le PATH). Rend le subprocess.CompletedProcess."""
    chemin_filtre_natif = os.path.join(racine_depot, 'pipeline', 'filters', 'szh-typographie.lua')
    commande = ['pandoc', '-f', 'json', '-t', 'json', '-M', 'lang=%s' % langue,
                '--lua-filter', chemin_filtre_natif]
    try:
        return subprocess.run(commande, input=entree_json, capture_output=True,
                               timeout=DELAI_SECONDES)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise _PandocIndisponible('pandoc injoignable : %s' % e)


def _appeler_pandoc(textes, langue, racine_depot):
    """Un seul appel pandoc pour tout le lot, pour ne payer le démarrage qu'une fois.

    `textes` : liste ordonnée de chaînes (corps) ou de couples (texte, niveau). Un niveau de
    1 à 6 part en Header, pour que le filtre applique ses règles de titre (A4 majuscules
    accentuées, L2 mots outils). Rend (textes_normalises, avertissements), ces derniers
    étant les lignes `[typo-avertissement]` lues sur stderr. Lève _PandocIndisponible si
    pandoc ne répond pas ; l'appelant décide du repli."""
    blocs_envoyes = []
    for t in textes:
        texte, niveau = (t, 0) if isinstance(t, str) else t
        inlines = _construire_inlines(texte)
        if niveau and 1 <= niveau <= 6:
            blocs_envoyes.append({'t': 'Header', 'c': [niveau, ['', [], []], inlines]})
        else:
            blocs_envoyes.append({'t': 'Para', 'c': inlines})
    doc = {
        'pandoc-api-version': [1, 23, 1],
        'meta': {},
        'blocks': blocs_envoyes,
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
        textes_normalises = [_a_plat(b['c'][2] if b.get('t') == 'Header' else b.get('c', []))
                             for b in blocs]
    except _EchecReconstruction as e:
        # Un inline imprévu dans la réponse est une anomalie de l'outillage : tout le lot
        # repart inchangé plutôt qu'à moitié.
        raise _PandocIndisponible(str(e))

    avertissements = [ligne for ligne in r.stderr.decode('utf-8', 'replace').splitlines()
                       if ligne.startswith('[typo-avertissement]')]
    return textes_normalises, avertissements


def _voisin_gauche(index_fragment, i1):
    """Index du fragment dont hérite un caractère inséré à la position i1 : son voisin de
    gauche, ou le premier fragment pour une insertion en tête. None seulement sans
    fragment."""
    if i1 > 0:
        return index_fragment[i1 - 1]
    if index_fragment:
        return index_fragment[0]
    return None


def _reconstruire_unite(fragments_texte, texte_envoye, texte_normalise):
    """Réinjecte `texte_normalise` dans `fragments_texte` (fragments de texte consécutifs
    d'un paragraphe). Rend une nouvelle liste de fragments qui couvre exactement
    `texte_normalise`, chacun gardant la forme et le lien de son fragment d'origine.

    Lève _EchecReconstruction si `texte_envoye` ne correspond plus aux fragments (garde
    d'entrée) ou si le résultat ne reproduit pas `texte_normalise` (garde de sortie)."""
    texte_origine = ''.join(f.texte for f in fragments_texte)
    if texte_origine != texte_envoye:
        raise _EchecReconstruction(
            "le texte des fragments d'origine (%r) ne correspond plus au texte envoyé au "
            "filtre (%r)" % (texte_origine, texte_envoye))

    if texte_origine == texte_normalise:
        return list(fragments_texte)

    # Pour chaque caractère d'origine, l'index du fragment qui l'a fourni.
    index_fragment = []
    for idx, f in enumerate(fragments_texte):
        index_fragment.extend([idx] * len(f.texte))

    matcher = difflib.SequenceMatcher(None, texte_origine, texte_normalise, autojunk=False)

    # segments : (caractère, index du fragment d'origine) dans l'ordre du texte normalisé.
    # 'replace' et 'insert' posent le texte du filtre ; 'delete' ne pose rien.
    segments = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == 'equal':
            for k in range(i2 - i1):
                segments.append((texte_normalise[j1 + k], index_fragment[i1 + k]))
            continue

        ajoute = texte_normalise[j1:j2]   # '' si tag == 'delete'
        if not ajoute:
            continue

        origine_idx = _voisin_gauche(index_fragment, i1)
        if origine_idx is None:
            # Impossible en pratique (seuls les textes non vides partent à pandoc) ; on
            # abandonne plutôt que d'inventer une forme.
            raise _EchecReconstruction('caractère ajouté sans fragment d’origine disponible')
        for c in ajoute:
            segments.append((c, origine_idx))

    # Garde de sortie. Les opcodes couvrent déjà tout texte_normalise ; on le vérifie
    # quand même.
    texte_reconstruit = ''.join(c for c, _ in segments)
    if texte_reconstruit != texte_normalise:
        raise _EchecReconstruction(
            'la reconstruction (%r) ne reproduit pas le texte rendu par le filtre (%r)'
            % (texte_reconstruit, texte_normalise))

    # Regroupe les segments consécutifs issus du même fragment d'origine (et non de même
    # forme), pour garder le lien avec `source`, l'index du w:r d'origine.
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
    """Un fragment de même classe, forme, lien, source et note que `original`, avec
    `caracteres` pour texte."""
    return type(original)(''.join(caracteres), None, original.forme, original.lien,
                           original.source, note=getattr(original, 'note', None))


def _partitionner(fragments):
    """Découpe les fragments d'un paragraphe en unités : ('opaque', fragment) pour une image
    ou un appel de note, réinséré tel quel, et ('texte', [fragments]) pour une suite
    maximale de fragments de texte. Une image ou une note coupe le texte : la typographie ne
    traite pas ses deux côtés comme contigus."""
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

    `paragraphes` : liste de Paragraphe-like. `langue` : 'fr' ou 'de', passée en
    `-M lang=`. `racine_depot` : racine du dépôt, où se trouve le filtre.

    `traces` : lignes pour le rapport (appel pandoc ou repli). `abandons` :
    {'source', 'motif'} pour chaque paragraphe dont la réinjection a échoué et qui ressort
    intact. `avertissements` : lignes brutes `[typo-avertissement]`, découpées ensuite par
    manuscrit_regles._reprendre_avertissements_typo. `statut` : 'appliquee' si pandoc a
    répondu, 'repli' s'il était indisponible.
    """
    traces = []
    abandons = []

    # Toutes les unités de texte de tous les paragraphes, à plat, pour un seul appel pandoc.
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
                continue
            plan.append((ip, iu))
            # Un intertitre part en Header pour recevoir aussi les règles de titre.
            textes_a_envoyer.append((texte, min(getattr(p, 'niveau_retenu', 0) or 0, 6)))

    if not textes_a_envoyer:
        traces.append('manuscrit-typo : aucun texte à normaliser dans ce lot.')
        return list(paragraphes), traces, abandons, [], 'appliquee'

    debut = time.perf_counter()
    try:
        textes_normalises, avertissements = _appeler_pandoc(textes_a_envoyer, langue,
                                                              racine_depot)
    except _PandocIndisponible as e:
        # Repli : aucun paragraphe n'est touché. Ce n'est pas un abandon de paragraphe, d'où
        # `abandons` vide.
        traces.append(
            'manuscrit-typo : repli sans typographie (pandoc/wsl indisponible) — %s' % e)
        return list(paragraphes), traces, abandons, [], 'repli'
    duree_ms = (time.perf_counter() - debut) * 1000
    traces.append('manuscrit-typo : %d unité(s) normalisée(s) via pandoc en %.1f ms.'
                   % (len(textes_a_envoyer), duree_ms))

    # Texte envoyé et texte normalisé par (paragraphe, unité) ; le premier sert à la garde
    # d'entrée de _reconstruire_unite.
    envoye_par_cle = {}
    normalise_par_cle = {}
    for (ip, iu), (texte_env, _niveau), texte_norm in zip(plan, textes_a_envoyer,
                                                          textes_normalises):
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
                    # Texte vide, non envoyé à pandoc.
                    nouveaux_fragments.extend(contenu)
                    continue
                texte_env = envoye_par_cle[(ip, iu)]
                nouveaux_fragments.extend(_reconstruire_unite(contenu, texte_env, texte_norm))
        except _EchecReconstruction as e:
            abandons.append({'source': p.source, 'motif': str(e)})
            resultat.append(p)  # intact plutôt que reconstruit à moitié
            continue
        resultat.append(type(p)(p.style, p.niveau_declare, p.niveau_retenu, nouveaux_fragments,
                                 p.liste, p.alignement, p.retrait, p.source))

    if abandons:
        traces.append('manuscrit-typo : %d paragraphe(s) abandonné(s), rendu(s) intact(s).'
                       % len(abandons))

    return resultat, traces, abandons, avertissements, 'appliquee'


def normaliser_textes(textes, langue, racine_depot):
    """Le même pont pour les champs de l'en-tête (titre, sous-titre, résumé, mots-clés,
    fonction et institution des auteurs), que le nettoyeur écrit dans les tableaux du
    gabarit. `textes` : chaînes ou couples (texte, niveau), comme pour _appeler_pandoc.
    Rend (textes_normalises, traces, avertissements, statut) ; en repli, textes inchangés et
    statut 'repli'."""
    a_envoyer = [(i, t) for i, t in enumerate(textes)
                 if (t if isinstance(t, str) else t[0]).strip()]
    resultat = [t if isinstance(t, str) else t[0] for t in textes]
    if not a_envoyer:
        return resultat, [], [], 'appliquee'
    try:
        normalises, avertissements = _appeler_pandoc([t for _, t in a_envoyer], langue,
                                                     racine_depot)
    except _PandocIndisponible as e:
        return (resultat, ['manuscrit-typo : en-tête sans typographie (pandoc/wsl '
                           'indisponible) — %s' % e], [], 'repli')
    for (i, _), n in zip(a_envoyer, normalises):
        resultat[i] = n
    return (resultat, ['manuscrit-typo : %d champ(s) d’en-tête normalisé(s) (langue=%s).'
                       % (len(a_envoyer), langue)], avertissements, 'appliquee')
