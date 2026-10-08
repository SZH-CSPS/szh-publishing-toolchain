#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Construit, à partir du modèle riche (manuscrit_modele), ce que la CLI du nettoyeur donne
# aux moteurs : bibliographie, paragraphes de contexte (corps, en-tête, cellules, notes),
# images, tableaux, numéros de notes, noms de bibliographie. La CLI en ré-exporte les noms.

import os
import re
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import manuscrit_modele as mm
import manuscrit_gabarit as mg
import manuscrit_noms as mn
import pronto_modele
import heritage_meta


# ---------------------------------------------------------------------------------
# Parcours du modèle riche. Images, tableaux et typographie se parcourent à toute
# profondeur (cellules comprises) ; le moteur de règles ne voit que le premier niveau, comme
# manuscrit_modele.taille_dominante() et classer_titres().

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
    # Le texte alternatif saisi sous « Texte alternatif : » va sur la première image de sa
    # figure, comme à l'écriture (manuscrit_gabarit.blocs_figure). Sinon l'image passerait
    # pour « sans texte alternatif ».
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
# Paragraphes de cellule et de note pour Vale. Vale doit voir ce texte, mais il n'est pas
# ancrable : la `correspondance` de manuscrit_gabarit.ecrire() ne couvre que les <w:p> de
# premier niveau. La `source` d'une cellule n'est qu'une position locale à son conteneur ;
# la recopier ferait ancrer l'alerte sur un paragraphe du corps sans rapport. D'où
# `source=None` : manuscrit_annoter.annoter() classe alors l'alerte dans `non_ancrees`.

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
    """Le `source` du paragraphe de premier niveau qui appelle cette note, seul niveau que
    `correspondance` sait ancrer. None si l'appel vient d'une cellule ou si aucun appelant
    n'est trouvé (le lecteur filtre déjà les notes orphelines)."""
    for bloc in document.blocs:
        if isinstance(bloc, mm.Paragraphe) and any(f.note == note_id for f in bloc.fragments):
            return bloc.source
    return None


def _numeros_notes(document):
    """{note_id: numero} : le numéro que `manuscrit_gabarit._RegistreNotes` donnera à chaque
    note appelée (1, 2, 3… dans l'ordre de première rencontre, cellules comprises), calculé
    avant l'écriture du gabarit. C'est ce numéro que manuscrit_annoter.py cherche dans
    `<w:footnoteReference w:id="…">`. Le parcours doit rester celui de l'écrivain."""
    numeros = {}
    for bloc in _parcourir_blocs(document.blocs):
        if not isinstance(bloc, mm.Paragraphe):
            continue
        for f in bloc.fragments:
            if f.note is not None and f.note not in numeros:
                numeros[f.note] = len(numeros) + 1
    return numeros


# Un paragraphe de note reçoit un `source` synthétique négatif, hors de portée de tout
# index réel de <w:p>/<w:tbl> du corps (voir _paragraphes_notes_pour_vale()).
_DECALAGE_SOURCE_SYNTHETIQUE_NOTE = 1_000_000


def _paragraphes_notes_pour_vale(document, numeros_notes):
    """Rend (paragraphes, correspondance_notes). Chaque paragraphe a la forme
    {texte, source, role} ; pour une note, `source` est un identifiant synthétique, que Vale
    recopie tel quel dans le `para` de ses alertes.
    `correspondance_notes[synthetique] = {'note_id', 'para', 'numero'}` permet ensuite à
    _marquer_notes_dans_alertes() de retrouver le paragraphe du corps qui porte l'appel et le
    numéro de la note. L'identifiant est propre à chaque note, pour distinguer deux notes
    appelées depuis le même paragraphe."""
    resultat = []
    correspondance_notes = {}
    for note_id, contenu in (document.notes or {}).items():
        para = _paragraphe_source_appelant_note(document, note_id)
        numero = numeros_notes.get(note_id)
        # Sans appelant de premier niveau ou sans numéro, la note reste non ancrable.
        synthetique = (-(_DECALAGE_SOURCE_SYNTHETIQUE_NOTE + note_id)
                       if para is not None and numero is not None else None)
        for bloc in (contenu or []):
            if isinstance(bloc, mm.Paragraphe):
                texte = bloc.texte()
                if texte.strip():
                    resultat.append({'texte': texte, 'source': synthetique, 'role': ''})
            elif isinstance(bloc, mm.Tableau):
                # Tableau dans une note : cellules non ancrables.
                resultat.extend(_paragraphes_cellules_pour_vale([bloc]))
        if synthetique is not None:
            correspondance_notes[synthetique] = {'note_id': note_id, 'para': para, 'numero': numero}
    return resultat, correspondance_notes


def _marquer_notes_dans_alertes(alertes, correspondance_notes):
    """Pour chaque alerte dont `para` est un identifiant synthétique de note, remplace `para`
    par le paragraphe qui porte l'appel et ajoute `note_id` et `note_numero`.
    manuscrit_annoter.py s'en sert pour ancrer sur le mot qui précède l'appel, ou pour écrire
    une révision dans la note. Modifie la liste en place et la rend."""
    for a in alertes:
        info = correspondance_notes.get(a.get('para'))
        if info is None:
            continue
        a['note_id'] = info['note_id']
        a['note_numero'] = info['numero']
        a['para'] = info['para']
    return alertes


# ---------------------------------------------------------------------------------
# Noms de bibliographie, récoltés avant la lecture de l'en-tête. _construire_bibliographie()
# tourne après l'en-tête et arriverait trop tard pour me.extraire_entete(). Cette passe ne
# délimite pas la bibliographie : elle récolte, sur tout le document, les noms de famille
# que la forme APA « Nom, P. » certifie.

def _plier_jeton_biblio(jeton):
    """Pliage minimal : accents retirés, minuscules, ponctuation de bord retirée. Il n'a pas
    à égaler manuscrit_noms._plier() : manuscrit_noms._signal_biblio() replie chaque jeton à
    la réception."""
    t = unicodedata.normalize('NFD', (jeton or '').strip().lower())
    t = ''.join(c for c in t if not unicodedata.combining(c))
    return t.strip('.,;:!?()[]{}«»“”‘’\'"-')


def _noms_de_bibliographie(document):
    """Ensemble de jetons pliés : pour chaque nom, le dernier mot qui n'est pas une
    particule, plus le nom entier. Une référence est repérée par
    heritage_meta.ressemble_a_une_reference() (25 signes au moins, une année, une initiale),
    ce qui écarte une ligne d'en-tête comme « Marie Dupont, Université de Genève ». Ce qui
    précède la première virgule, s'il commence par une majuscule et n'a pas de chiffre, est
    un nom de famille (« Wood de Wilde, H. » → « wood de wilde »)."""
    jetons = set()
    for bloc in document.blocs:
        if not isinstance(bloc, mm.Paragraphe):
            continue
        texte = bloc.texte().strip()
        if not texte or not heritage_meta.ressemble_a_une_reference(texte):
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
# Bibliographie : mêmes fonctions que pronto_modele.etendue_biblio(), même liste de titres.

def _indice_titre_biblio(document, lexique):
    """L'indice, dans document.blocs, du dernier titre reconnu comme titre de bibliographie,
    ou None. Le dernier, car la bibliographie est normalement la dernière section."""
    indice = None
    for i, bloc in enumerate(document.blocs):
        if not isinstance(bloc, mm.Paragraphe) or bloc.niveau_retenu not in (1, 2, 3):
            continue
        texte = bloc.texte().strip()
        # Complément toléré : « 3 Literatur (gemäss Redaktionsrichtlinien) » est un titre de
        # bibliographie ; sinon ses références seraient traitées comme du texte courant.
        if texte and pronto_modele.titre_est_biblio(texte, lexique, tolerer_complement=True):
            indice = i
    return indice


RE_ANNEE_BIBLIO = re.compile(r'((?:19|20)\d{2})')


def _entree_biblio(paragraphe):
    """Extraction minimale (nom, année) pour APA.OrdreAlphabetiqueBiblio. nb_auteurs vaut
    toujours 0 : il n'est pas deviné."""
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
    """Rend (sources_biblio, entrees). `sources_biblio` : les Paragraphe.source de la
    bibliographie, titre compris (le compte de signes inclut les références). `entrees` :
    une par référence, sans le titre."""
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
# Rôle des paragraphes : 'bibliographie', 'titre' ou ''.
# Le premier bloc ne vaut titre qu'en cas A. En cas B, manuscrit_entete.extraire_entete() a
# déjà retiré le titre du corps, et le rôle 'titre' vient de _paragraphes_entete_contexte().

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
# En-tête, cas B seulement. Les paragraphes que manuscrit_entete.extraire_entete() a retirés
# du corps reviennent dans le contexte des règles avec leur rôle : Forme.LongueurResume et
# Forme.LongueurTitre les lisent dans contexte['paragraphes']. Le DOI et la ligne de revue
# n'ont pas de rôle dans manuscrit_regles.py et ne sont pas ajoutés.
ROLES_ENTETE_POUR_REGLES = ('titre', 'sous_titre', 'resume', 'mots_cles', 'auteurs')


def _paragraphes_entete_contexte(document, indices_consommes):
    """À appeler avant le retrait des indices de document.blocs, dont elle lit le texte."""
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
