#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Contrôles de sortie du nettoyeur : vérifie qu'aucun mot ni aucune image du manuscrit ne
# s'est perdu dans le .docx écrit, et que le .docx annoté reste un XML bien formé.
# La CLI lit `_capture_suspendue` pour taire ses constats d'import pendant la relecture.

import io
import os
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import manuscrit_docx as md
import manuscrit_modele as mm
from manuscrit_corpus import _parcourir_blocs

_capture_suspendue = False


# ---------------------------------------------------------------------------------
# Contrôle « rien ne se perd » : compare les mots et les images du manuscrit à ceux du .docx
# écrit, relu comme n'importe quel manuscrit. On compte des mots et non des signes, car la
# typographie change des espaces et des guillemets mais pas les mots. L'en-tête reconnu est
# relu dans les tableaux du gabarit ; seules quelques étiquettes (« Résumé », « Mots-clés »…)
# disparaissent réellement.
# Seuils : PERTE_ALERTE produit une alerte `error` (le document est écrit, à vérifier) ;
# PERTE_REFUS refuse la sortie, pour qu'un document mutilé ne soit pas importé par mégarde.

RE_MOT = re.compile(r'\w{2,}', re.UNICODE)
PERTE_MOTS_MIN = 10          # en deçà, ce sont les étiquettes d’en-tête retirées
PERTE_ALERTE = 0.05          # 5 % des mots du manuscrit
PERTE_REFUS = 0.5            # la moitié


def _mots_et_images(document):
    """(Counter des mots en minuscules, nombre d'images) du document entier : corps et
    cellules à toute profondeur, notes comprises."""
    from collections import Counter
    mots = Counter()
    n_images = 0

    def creuser(blocs):
        nonlocal n_images
        for bloc in _parcourir_blocs(blocs):
            if isinstance(bloc, mm.Paragraphe):
                mots.update(RE_MOT.findall(unicodedata.normalize('NFC', bloc.texte()).casefold()))
                n_images += sum(1 for f in bloc.fragments if f.image is not None)

    creuser(document.blocs)
    for blocs_note in (document.notes or {}).values():
        creuser(blocs_note)
    return mots, n_images


def _ecartes_par_entete(document, entete, indices_entete):
    """Ce que la reconnaissance de l'en-tête met de côté faute de place dans le gabarit : le
    DOI, la ligne de citation de la revue, les résumés dans une autre langue que celle du
    produit, et les photos des fiches d'autrices en tableau. Cette perte connue est retirée de
    l'étalon et signalée à part par `Nettoyage.ContenuEcarte`, pour que l'alerte de perte ne
    se déclenche pas sur presque chaque manuscrit.
    Rend {'mots': Counter, 'images': int, 'elements': [(fr, de), ...]}."""
    from collections import Counter
    mots = Counter()
    elements = []
    if entete is not None:
        def ajouter(texte, fr, de):
            texte = (texte or '').strip()
            if texte:
                mots.update(RE_MOT.findall(unicodedata.normalize('NFC', texte).casefold()))
                elements.append((fr, de))
        ajouter(entete.doi, 'le DOI', 'die DOI')
        ajouter(entete.ligne_revue, 'la ligne de citation de la revue', 'die Zitierzeile der Zeitschrift')
        for langue, texte in sorted((entete.resumes_autres or {}).items()):
            ajouter(texte, 'le résumé (%s)' % langue, 'die Zusammenfassung (%s)' % langue)
    # Seules les images d'une fiche d'autrice en tableau comptent comme photos écartées. Une
    # image d'un paragraphe consommé par l'en-tête compte comme perdue : c'est le signe que
    # l'en-tête a avalé du corps de texte.
    images = 0
    for idx in indices_entete or {}:
        if 0 <= idx < len(document.blocs) and isinstance(document.blocs[idx], mm.Tableau):
            for bloc in _parcourir_blocs([document.blocs[idx]]):
                if isinstance(bloc, mm.Paragraphe):
                    images += sum(1 for f in bloc.fragments if f.image is not None)
    if images:
        elements.append(('%d photo(s) des autrices et auteurs' % images,
                         '%d Foto(s) der Autorinnen und Autoren' % images))
    return {'mots': mots, 'images': images, 'elements': elements}


def _controler_perte(entree, chemin_sortie, langue, ecartes=None):
    """Rend (alerte ou None, mesure). Compare `entree` (_mots_et_images() du manuscrit, pris
    avant tout traitement) au .docx écrit, relu par le lecteur du nettoyeur. `ecartes`
    (_ecartes_par_entete) est retiré de l'étalon."""
    mots_in, images_in = entree
    if ecartes:
        mots_in = mots_in - ecartes['mots']
        images_in = max(images_in - ecartes['images'], 0)
    # La relecture referait les constats du lecteur, déjà émis sur le manuscrit : on les tait.
    global _capture_suspendue
    stderr, journal = sys.stderr, os.environ.pop('SZH_IMPORT_LOG', None)
    try:
        sys.stderr = io.StringIO()
        _capture_suspendue = True
        relu = md.lire(chemin_sortie)
    except Exception as e:
        relu = e
    finally:
        _capture_suspendue = False
        sys.stderr = stderr
        if journal is not None:
            os.environ['SZH_IMPORT_LOG'] = journal
    try:
        if isinstance(relu, Exception):
            raise relu
        mots_out, images_out = _mots_et_images(relu)
    except Exception as e:                         # relecture impossible : on le dit
        return ({'rule': 'Nettoyage.ControleImpossible', 'severity': 'warning',
                 'action': 'report', 'para': None, 'span': None, 'found': None,
                 'suggested': None,
                 'message': ("Le document écrit n’a pas pu être relu pour vérifier qu’aucun "
                             "contenu ne s’est perdu (%s)." % e) if langue == 'fr' else
                            ("Das geschriebene Dokument konnte nicht erneut gelesen werden, um "
                             "zu prüfen, dass kein Inhalt verloren ging (%s)." % e)},
                {'controle': 'impossible'})
    total = sum(mots_in.values())
    manquants = {m: n - mots_out.get(m, 0) for m, n in mots_in.items() if n > mots_out.get(m, 0)}
    n_manquants = sum(manquants.values())
    taux = (n_manquants / total) if total else 0.0
    mesure = {'mots_entree': total, 'mots_sortie': sum(mots_out.values()),
              'mots_manquants': n_manquants, 'taux_perte': round(taux, 4),
              'images_entree': images_in, 'images_sortie': images_out,
              'exemples_manquants': sorted(manquants, key=lambda m: -manquants[m])[:15],
              'ecartes_par_entete': ({'mots': sum(ecartes['mots'].values()),
                                      'images': ecartes['images'],
                                      'elements': [fr for fr, _ in ecartes['elements']]}
                                     if ecartes else None)}
    perte_mots = n_manquants >= PERTE_MOTS_MIN and taux >= PERTE_ALERTE
    perte_images = images_out < images_in
    if not (perte_mots or perte_images):
        return None, mesure
    mesure['refus'] = taux >= PERTE_REFUS
    exemples = ', '.join(mesure['exemples_manquants'][:8])
    if langue == 'fr':
        message = ("Le document nettoyé a perdu du contenu du manuscrit\u00a0: %d mot(s) sur %d "
                   "(%.0f %%)%s, %d image(s) sur %d retrouvée(s). %s"
                   % (n_manquants, total, taux * 100,
                      (' — par exemple : %s' % exemples) if exemples else '',
                      images_out, images_in,
                      "Il n’a pas été livré\u00a0: signalez ce manuscrit à la maintenance."
                      if mesure['refus'] else
                      "Comparez-le au manuscrit avant de l’utiliser, et signalez ce "
                      "manuscrit à la maintenance."))
    else:
        message = ("Das bereinigte Dokument hat Inhalt des Manuskripts verloren: %d von %d "
                   "Wörtern (%.0f %%)%s, %d von %d Bildern wiedergefunden. %s"
                   % (n_manquants, total, taux * 100,
                      (' — zum Beispiel: %s' % exemples) if exemples else '',
                      images_out, images_in,
                      'Es wurde nicht ausgeliefert: melden Sie dieses Manuskript der Wartung.'
                      if mesure['refus'] else
                      'Vergleichen Sie es vor der Verwendung mit dem Manuskript und melden '
                      'Sie dieses Manuskript der Wartung.'))
    return ({'rule': 'Nettoyage.ContenuPerdu', 'severity': 'error', 'action': 'report',
             'para': None, 'span': None, 'found': None, 'suggested': None,
             'message': message}, mesure)


def _valider_docx_bien_forme(chemin):
    """Lève une exception si une partie .xml/.rels du .docx annoté n'est pas un XML bien
    formé. L'appelant restaure alors la version d'avant l'annotation, plutôt que de livrer
    un .docx corrompu en apparence réussi."""
    with zipfile.ZipFile(chemin) as z:
        for nom in z.namelist():
            if nom.endswith('.xml') or nom.endswith('.rels'):
                ET.fromstring(z.read(nom))
