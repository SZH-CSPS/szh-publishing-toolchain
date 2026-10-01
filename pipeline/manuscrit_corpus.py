#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# manuscrit_corpus.py — la construction des corpus que la CLI du nettoyeur donne aux moteurs :
# bibliographie, paragraphes de contexte (corps, en-tête, cellules, notes), images, tableaux,
# numéros de notes, noms de bibliographie. Il parle modèle riche (manuscrit_modele), pas Word.
# Déplacé tel quel depuis manuscrit-nettoyer.py ; la CLI en ré-exporte les noms.

import os
import re
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import manuscrit_modele as mm
import manuscrit_gabarit as mg
import manuscrit_noms as mn
import pronto_modele


# ---------------------------------------------------------------------------------
# Parcours du modèle riche — à toute profondeur (cellules de tableau comprises), pour les
# images/tableaux du rapport et pour la typographie ; UNIQUEMENT le premier niveau pour les
# paragraphes que voit le moteur de règles (même périmètre que
# manuscrit_modele.taille_dominante() / classer_titres()).

def _parcourir_blocs(blocs):
    """Rend chaque Paragraphe et chaque Tableau, à toute profondeur (corps + cellules)."""
    for bloc in blocs:
        yield bloc
        if isinstance(bloc, mm.Tableau):
            for rangee in bloc.rangees:
                for cellule in rangee:
                    for sous in _parcourir_blocs(cellule.blocs):
                        yield sous


def _collecter_images(document):
    """Une entrée par image trouvée à toute profondeur, avec sa source (celle de l'Image
    elle-même si le lecteur l'a posée, sinon celle du paragraphe qui la porte)."""
    images = []
    for bloc in _parcourir_blocs(document.blocs):
        if not isinstance(bloc, mm.Paragraphe):
            continue
        for f in bloc.fragments:
            if f.image is not None:
                img = f.image
                source = img.source if img.source is not None else bloc.source
                images.append({'nom': img.nom, 'source': source, 'alt': img.alt,
                                'largeur_px': img.largeur_px, 'hauteur_px': img.hauteur_px,
                                'objet': id(img)})
    # Le texte alternatif TAPÉ sous « Texte alternatif : » (clés saisies à la main, ou bloc
    # déjà au gabarit) va sur la première image de sa figure — c'est ainsi que l'écriture le
    # posera (manuscrit_gabarit.blocs_figure) et que l'import le relira. Sans cette reprise,
    # l'image était jugée « sans texte alternatif » alors que l'autrice en avait écrit un.
    saisis = {}
    for bloc in mg.blocs_figure(document):
        alt = (bloc.champs.get('alt') or '').strip()
        if bloc.nature == 'figure' and alt and bloc.rangees:
            saisis[id(bloc.rangees[0][0])] = alt
    for i in images:
        if not (i['alt'] or '').strip() and i['objet'] in saisis:
            i['alt'] = saisis[i['objet']]
    return images


def _collecter_tableaux(document):
    tableaux = []
    for bloc in _parcourir_blocs(document.blocs):
        if isinstance(bloc, mm.Tableau):
            fusion = any(c.colspan > 1 or c.rowspan > 1
                         for rangee in bloc.rangees for c in rangee)
            tableaux.append({'fusion': fusion, 'source': bloc.source})
    return tableaux


# ---------------------------------------------------------------------------------
# Paragraphes de cellule et de note pour Vale (point 1 de la consigne de branchement) — Vale
# doit VOIR ce texte (une forme épicène dans un tableau ou une note n'est pas moins fautive),
# mais ni l'un ni l'autre n'est ANCRABLE : `correspondance` de manuscrit_gabarit.ecrire() ne
# porte que les <w:p> de PREMIER NIVEAU qu'elle écrit elle-même (§7 ter du contrat, mesuré en
# lisant _convertir_niveau_racine()) — jamais un <w:p> de cellule (sa `source` n'est qu'une
# position LOCALE au conteneur, §4 : « pas de chemin complet ») ni le <w:p> d'une note. Y
# recopier une `source` non ancrable risquerait pire qu'une alerte perdue : une COLLISION
# silencieuse avec un indice de premier niveau sans rapport (une cellule à la position locale
# 3 « ancrée » par erreur sur le 4e paragraphe du corps). `source=None` est donc le seul choix
# sûr ici ; manuscrit_annoter.annoter() la classe alors normalement dans `non_ancrees`.

def _paragraphes_cellules_pour_vale(blocs):
    resultat = []
    for bloc in blocs:
        if not isinstance(bloc, mm.Tableau):
            continue
        for rangee in bloc.rangees:
            for cellule in rangee:
                for sous in cellule.blocs:
                    if isinstance(sous, mm.Paragraphe):
                        texte = sous.texte()
                        if texte.strip():
                            resultat.append({'texte': texte, 'source': None, 'role': ''})
                    elif isinstance(sous, mm.Tableau):
                        resultat.extend(_paragraphes_cellules_pour_vale([sous]))
    return resultat


def _paragraphe_source_appelant_note(document, note_id):
    """Le `source` du paragraphe qui APPELLE cette note (un Fragment dont `.note ==
    note_id`) — seulement s'il est de PREMIER NIVEAU, le seul espace que `correspondance`
    sait ancrer (voir ci-dessus) : None si l'appel vient d'une cellule, ou si aucun appelant
    n'est trouvé (ne devrait pas arriver — document.notes ne porte que des notes déjà APPELÉES,
    les orphelines sont filtrées par le lecteur, §4 du contrat)."""
    for bloc in document.blocs:
        if isinstance(bloc, mm.Paragraphe) and any(f.note == note_id for f in bloc.fragments):
            return bloc.source
    return None


def _numeros_notes(document):
    """{note_id: numero} — le numéro de SORTIE (1, 2, 3… dans l'ordre d'appel du corps,
    cellules de tableau comprises) que `manuscrit_gabarit._RegistreNotes` donnera à chaque
    note APPELÉE, recalculé ICI en lecture seule sur le modèle riche, AVANT l'écriture du
    gabarit (§7 ter du contrat, point « traçabilité note -> appel ») : c'est le numéro que
    Word affichera, et c'est lui que manuscrit_annoter.py cherche dans
    `<w:footnoteReference w:id="…">` du paragraphe de sortie. Même ordre de parcours que
    l'écrivain (`_parcourir_blocs`, premier niveau + cellules, dans l'ordre) et même règle
    (« ordre de PREMIÈRE rencontre ») — voir manuscrit_gabarit.py, lu en lecture seule,
    jamais modifié (hors des fichiers autorisés pour ce lot)."""
    numeros = {}
    for bloc in _parcourir_blocs(document.blocs):
        if not isinstance(bloc, mm.Paragraphe):
            continue
        for f in bloc.fragments:
            if f.note is not None and f.note not in numeros:
                numeros[f.note] = len(numeros) + 1
    return numeros


# Décalage hors de portée de tout Paragraphe.source réel (un index de <w:p>/<w:tbl> du corps,
# toujours largement < 1 000 000 sur un article réel) : un paragraphe de note reçoit un
# `source` SYNTHÉTIQUE négatif, jamais ancrable tel quel — voir _paragraphes_notes_pour_vale().
_DECALAGE_SOURCE_SYNTHETIQUE_NOTE = 1_000_000


def _paragraphes_notes_pour_vale(document, numeros_notes):
    """(paragraphes, correspondance_notes) — `paragraphes` : même forme qu'avant (texte/
    source/role) mais `source` porte, pour un paragraphe de NOTE, un identifiant SYNTHÉTIQUE
    (voir _DECALAGE_SOURCE_SYNTHETIQUE_NOTE), jamais un vrai `Paragraphe.source` : Vale ne
    fait que recopier ce `source` dans `para` de chaque alerte qu'il rend (manuscrit_vale.
    _convertir_alerte() : `'para': index.get(ligne_num)`), sans rien savoir de plus sur son
    origine. `correspondance_notes[synthetique] = {'note_id', 'para', 'numero'}` permet à
    _marquer_notes_dans_alertes(), APRÈS le passage par Vale, de retrouver le paragraphe RÉEL
    du corps qui porte l'appel (c'est lui que manuscrit_annoter.py doit ancrer, §7 ter du
    contrat) et le numéro de note écrit. Un identifiant synthétique DISTINCT par note (jamais
    partagé) : deux notes appelées depuis le MÊME paragraphe de corps restent distinguables."""
    resultat = []
    correspondance_notes = {}
    for note_id, contenu in (document.notes or {}).items():
        para = _paragraphe_source_appelant_note(document, note_id)
        numero = numeros_notes.get(note_id)
        # Ni l'appelant (hors premier niveau) ni le numéro (note jamais appelée, ne devrait
        # pas arriver, §4 du contrat) ne sont garantis : sans les deux, `source=None` reste le
        # seul choix sûr (comme avant ce lot) — jamais un ancrage à moitié construit.
        synthetique = (-(_DECALAGE_SOURCE_SYNTHETIQUE_NOTE + note_id)
                       if para is not None and numero is not None else None)
        for bloc in (contenu or []):
            if isinstance(bloc, mm.Paragraphe):
                texte = bloc.texte()
                if texte.strip():
                    resultat.append({'texte': texte, 'source': synthetique, 'role': ''})
            elif isinstance(bloc, mm.Tableau):
                # Rare (un tableau dans une note) mais possible : mêmes cellules, jamais
                # ancrables non plus.
                resultat.extend(_paragraphes_cellules_pour_vale([bloc]))
        if synthetique is not None:
            correspondance_notes[synthetique] = {'note_id': note_id, 'para': para, 'numero': numero}
    return resultat, correspondance_notes


def _marquer_notes_dans_alertes(alertes, correspondance_notes):
    """Pour chaque alerte dont `para` est un identifiant SYNTHÉTIQUE de note (voir
    _paragraphes_notes_pour_vale ci-dessus) : remplace `para` par le paragraphe RÉEL qui porte
    l'appel et ajoute `note_id`/`note_numero` — les deux champs que manuscrit_annoter.py lit
    pour ancrer sur le mot qui précède l'appel (ou écrire une révision DANS la note, §7 ter du
    contrat) plutôt que sur le paragraphe de corps entier. Mute et rend la MÊME liste (mêmes
    dicts que le reste de la CLI, jamais une copie)."""
    for a in alertes:
        info = correspondance_notes.get(a.get('para'))
        if info is None:
            continue
        a['note_id'] = info['note_id']
        a['note_numero'] = info['numero']
        a['para'] = info['para']
    return alertes


# ---------------------------------------------------------------------------------
# Noms de bibliographie, AVANT l'en-tête (§6.1 du contrat de lot D, CONTRAT-noms.md —
# ⚠ tranché par le superviseur le 22.09.2026, à ne pas rouvrir) : _construire_bibliographie()
# ci-dessous tourne APRÈS l'en-tête (elle dépend de son retrait du corps) et ne peut donc pas
# fournir `noms_biblio` à temps pour me.extraire_entete(). Cette passe-ci est délibérément
# LÉGÈRE et INDÉPENDANTE : elle ne décide d'AUCUNE étendue de bibliographie (ne déplace, ne
# duplique jamais _construire_bibliographie()), elle ne fait que récolter des jetons de noms
# de famille certifiés par la forme APA (« Nom, P. »), sur tout le document, avant tout
# retrait.

def _plier_jeton_biblio(jeton):
    """Pliage minimal (NFD, accents retirés, minuscule, ponctuation de bord retirée) — même
    principe que manuscrit_noms._plier() (privée, non importable telle quelle depuis ce
    fichier), sans avoir besoin d'être bit-identique : manuscrit_noms._signal_biblio() replie
    de toute façon chaque jeton de `noms_biblio` à la réception (voir son code) — cette
    fonction-ci n'a donc besoin que d'être RAISONNABLE, jamais canonique."""
    t = unicodedata.normalize('NFD', (jeton or '').strip().lower())
    t = ''.join(c for c in t if not unicodedata.combining(c))
    return t.strip('.,;:!?()[]{}«»“”‘’\'"-')


def _noms_de_bibliographie(document):
    """Ensemble de jetons pliés (§6.1) : le dernier jeton non-particule de chaque nom, plus
    le nom entier — jamais une étendue, jamais une exception. Repéré par
    dm.ressemble_a_une_reference() (mn.dm, le docx-meta.py déjà chargé par manuscrit_noms.py
    — ≥ 25 signes, un millésime, une initiale : vérifié en la relisant, une ligne d'en-tête
    comme « Marie Dupont, Université de Genève » n'a pas d'année, elle ne passe pas ce
    filtre) ; ce qui précède la PREMIÈRE virgule, s'il est capitalisé et sans chiffre, est un
    nom de famille certifié par la forme APA (« Wood de Wilde, H. » -> « wood de wilde »)."""
    jetons = set()
    for bloc in document.blocs:
        if not isinstance(bloc, mm.Paragraphe):
            continue
        texte = bloc.texte().strip()
        if not texte or not mn.dm.ressemble_a_une_reference(texte):
            continue
        avant_virgule = texte.split(',', 1)[0].strip()
        if not avant_virgule or any(c.isdigit() for c in avant_virgule):
            continue
        if not avant_virgule[0].isupper():
            continue
        mots = avant_virgule.split()
        dernier_non_particule = None
        for mot in reversed(mots):
            if _plier_jeton_biblio(mot) not in mn.PARTICULES:
                dernier_non_particule = mot
                break
        if dernier_non_particule:
            jetons.add(_plier_jeton_biblio(dernier_non_particule))
        jetons.add(_plier_jeton_biblio(avant_virgule))
    return jetons


# ---------------------------------------------------------------------------------
# Bibliographie — voir le point 1 de l'en-tête : mêmes briques PUBLIQUES que
# pronto_modele.etendue_biblio(), jamais une seconde liste de titres.

def _est_titre_biblio(texte, lexique):
    # « 3 Literatur (gemäss Redaktionsrichtlinien) » (29.09.2026) : sans ce retrait, la
    # bibliographie passait pour du Lauftext et « & » y était remplacé par « und ».
    texte = pronto_modele.sans_complement_titre(texte)
    plat = pronto_modele.RE_NUM_TITRE_BIBLIO.sub('', pronto_modele.aplatir(texte))
    if plat in lexique:
        return True
    for prefixe in pronto_modele.PREFIXES_TITRE_BIBLIO:
        if plat.startswith(prefixe) and plat[len(prefixe):] in lexique:
            return True
    return False


def _indice_titre_biblio(document, lexique):
    """L'indice, dans document.blocs, du DERNIER paragraphe de titre reconnu comme titre de
    bibliographie — None si aucun. « Dernier » : la bibliographie est normalement la toute
    dernière section (même raison que pronto_modele.etendue_biblio)."""
    indice = None
    for i, bloc in enumerate(document.blocs):
        if not isinstance(bloc, mm.Paragraphe) or bloc.niveau_retenu not in (1, 2, 3):
            continue
        texte = bloc.texte().strip()
        if texte and _est_titre_biblio(texte, lexique):
            indice = i
    return indice


RE_ANNEE_BIBLIO = re.compile(r'((?:19|20)\d{2})')


def _entree_biblio(paragraphe):
    """Extraction minimale (nom, année) pour APA.OrdreAlphabetiqueBiblio — voir le point 2 de
    l'en-tête : nb_auteurs reste TOUJOURS 0, jamais deviné."""
    texte = paragraphe.texte().strip()
    m = RE_ANNEE_BIBLIO.search(texte)
    annee = int(m.group(1)) if m else None
    nom = None
    virgule = texte.find(',')
    if 0 < virgule <= 60:
        nom = texte[:virgule].strip()
    elif m:
        nom = texte[:m.start()].strip(' (').rstrip('.,') or None
    return {'texte': texte, 'source': paragraphe.source, 'nom': nom, 'annee': annee,
            'nb_auteurs': 0}


def _construire_bibliographie(document):
    """(sources_biblio, entrees) : `sources_biblio` = l'ensemble des Paragraphe.source qui
    appartiennent à la bibliographie (titre compris, pour le compte de signes du §7 —
    « références bibliographiques compris ») ; `entrees` = une par référence, hors le titre
    lui-même."""
    lexique = pronto_modele.lire_titres_bib()
    indice_titre = _indice_titre_biblio(document, lexique)
    if indice_titre is None:
        return set(), []
    sources = set()
    entrees = []
    for i in range(indice_titre, len(document.blocs)):
        bloc = document.blocs[i]
        if isinstance(bloc, mm.Tableau):
            break
        if not isinstance(bloc, mm.Paragraphe):
            continue
        sources.add(bloc.source)
        if i == indice_titre:
            continue
        if bloc.texte().strip():
            entrees.append(_entree_biblio(bloc))
    return sources, entrees


# ---------------------------------------------------------------------------------
# Rôle des paragraphes — voir le point 1 de l'en-tête : deux cas seulement, '' sinon.
#
# Révision du 19.09.2026 (§5.5) : le repli « premier bloc du document = titre » ne vaut plus
# qu'en CAS A. En cas B, le titre est désormais retiré du corps par
# manuscrit_entete.extraire_entete() AVANT cette fonction — le premier bloc restant n'est
# alors qu'un paragraphe de corps ordinaire (ou un intertitre), jamais LE titre de l'article ;
# le rôle 'titre' de cas B vient exclusivement de _paragraphes_entete_contexte() ci-dessous.

def _construire_paragraphes_contexte(document, sources_biblio, gabarit):
    paras = [b for b in document.blocs if isinstance(b, mm.Paragraphe)]
    premier_bloc = document.blocs[0] if document.blocs else None
    resultat = []
    for p in paras:
        if p.source in sources_biblio:
            role = 'bibliographie'
        elif gabarit == 'A' and p is premier_bloc and p.niveau_retenu > 0:
            role = 'titre'
        else:
            role = ''
        resultat.append({'source': p.source, 'texte': p.texte(), 'role': role,
                          'niveau_retenu': p.niveau_retenu})
    return resultat


# ---------------------------------------------------------------------------------
# En-tête (§5.5) — cas B seulement. Les paragraphes que manuscrit_entete.extraire_entete() a
# retirés du corps sont remis dans le contexte des règles, avec leur rôle : c'est ce dont
# Forme.LongueurResume/LongueurTitre ont besoin pour juger (ils lisent contexte['paragraphes'],
# jamais l'EnTete elle-même). 'doi'/'ligne_revue' n'appartiennent pas au vocabulaire de rôle
# que manuscrit_regles.py reconnaît (voir son en-tête) : ces deux-là ne sont donc jamais
# ajoutés ici — ils restent simplement absents du corps, sans qu'aucune règle les juge.
ROLES_ENTETE_POUR_REGLES = ('titre', 'sous_titre', 'resume', 'mots_cles', 'auteurs')


def _paragraphes_entete_contexte(document, indices_consommes):
    """Appelée AVANT le retrait des indices de document.blocs — elle a besoin des
    paragraphes encore en place pour lire leur texte."""
    resultat = []
    for i, role in indices_consommes.items():
        if role not in ROLES_ENTETE_POUR_REGLES:
            continue
        bloc = document.blocs[i]
        if not isinstance(bloc, mm.Paragraphe):
            continue
        resultat.append({'source': bloc.source, 'texte': bloc.texte(), 'role': role,
                          'niveau_retenu': 0})
    return resultat
