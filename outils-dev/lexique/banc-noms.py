#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Banc de mesure du signal `lexique` de pipeline/manuscrit_noms.py, sur la base d'auteurs
# du poste. Sert à choisir la taille du lexique du dépôt (voir
# docs/ARCHITECTURE-nettoyeur-manuscrit.md).
#
# Chaque fiche de C:\ProgramData\SZH\auteurs.json a un prénom et un nom dans deux champs :
# l'ordre réel est connu. Le banc recolle « Prénom Nom », interroge
# manuscrit_noms._signal_lexique() et compare la réponse à l'ordre réel.
#
# La fiche jugée est d'abord retirée de la base (ses deux jetons décrémentés d'une unité),
# sinon elle se reconnaîtrait elle-même (leave-one-out). Le lexique du dépôt n'est pas
# retiré : c'est son apport qu'on mesure.
#
# Quatre colonnes, exclusives :
#   tranché juste — le signal rend ORDRE_DIRECT, l'ordre réel de la fiche.
#   à l'envers    — le signal rend ORDRE_INVERSE : une réponse fausse.
#   indécis       — score_direct == score_inverse et tous deux > 0 : la base connaît les deux
#                   jetons des deux côtés, elle ne peut pas départager.
#   muet          — score_direct == score_inverse == 0 : la base ne connaît ni l'un ni l'autre.
# « indécis » et « muet » ont le même effet (le signal se tait) mais des causes opposées ;
# un lexique plus grand fait passer des fiches de « muet » à « indécis ».
#
# Limite : le banc juge des fiches isolées. Il ne voit pas la propagation
# (manuscrit_noms.trancher_groupe()), par laquelle un segment tranché impose son ordre aux
# autres segments du document. Il sous-estime donc le gain d'un lexique plus grand, et aussi
# le coût d'une inversion, qui peut retourner un article entier. C'est un outil de
# comparaison entre tailles de lexique : une taille ne s'adopte que si elle n'augmente pas
# la colonne « à l'envers ».
#
# Bibliothèque standard seule.
#
#   python3 banc-noms.py                                  (lexique du dépôt tel qu'il est)
#   python3 banc-noms.py --sans-lexique                   (témoin : base OJS seule)
#   python3 banc-noms.py --noms tmp/p15000.txt --prenoms tmp/pre8000.txt
#   python3 banc-noms.py --exemples 15                    (les fiches de la colonne « à l'envers »)
#   python3 banc-noms.py --tsv                            (une ligne par palier, pour un tableur)

import importlib.util
import os
import sys

RACINE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LEXIQUE_DEFAUT = os.path.join(RACINE, 'pipeline', 'lexique')


def _charger_module_a_tiret(chemin, nom_module):
    """Charge un module de pipeline/ par son chemin, sans ajouter pipeline/ à sys.path."""
    spec = importlib.util.spec_from_file_location(nom_module, chemin)
    module = importlib.util.module_from_spec(spec)
    sys.modules[nom_module] = module
    spec.loader.exec_module(module)
    return module


mn = _charger_module_a_tiret(
    os.path.join(RACINE, 'pipeline', 'manuscrit_noms.py'), 'szh_manuscrit_noms_pour_banc')


# Les fichiers que BaseNoms.charger() lit en production, lus dans manuscrit_noms.
FICHIERS_PRODUCTION = [(nom, cote) for nom, cote, _ in mn.FICHIERS_LEXIQUE]


# ---------------------------------------------------------------------------------
# La base, montée avec les chargeurs de production.
#
# BaseNoms.charger() fixe la liste des fichiers de lexique ; le banc veut en essayer
# d'autres. Il appelle donc _charger_base_auteurs() et _charger_fichier_lexique() et
# remplit une BaseNoms avec le résultat : pliage, filtres et règles restent ceux de la
# production.

def monter_base(chemin_auteurs, fichiers_noms, fichiers_prenoms):
    """(base, prenoms, noms, n_fiches_ojs). `prenoms` et `noms` sont les dictionnaires de la
    base elle-même : le leave-one-out les modifie au lieu de recharger la base par fiche."""
    prenoms, noms = {}, {}
    n_fiches, _ = mn._charger_base_auteurs(chemin_auteurs, prenoms, noms)
    for chemin in fichiers_noms:
        mn._charger_fichier_lexique(os.path.dirname(chemin) or '.',
                                    os.path.basename(chemin), noms)
    for chemin in fichiers_prenoms:
        mn._charger_fichier_lexique(os.path.dirname(chemin) or '.',
                                    os.path.basename(chemin), prenoms)
    base = mn.BaseNoms()
    base._prenoms, base._noms = prenoms, noms
    base.sources = ['banc']          # non vide : c'est `disponible` qui compte pour le signal.
    base.disponible = True
    return base, prenoms, noms, (n_fiches or 0)


def fiches_jugeables(chemin_auteurs):
    """[(prenom_brut, nom_brut), ...] : les fiches que _charger_base_auteurs() retient, dans
    le même ordre et avec les mêmes règles (bruit institutionnel, champ vide). Une fiche
    absente de la base ne doit pas être jugée : le leave-one-out retirerait des jetons jamais
    ajoutés."""
    import json
    try:
        with open(chemin_auteurs, encoding='utf-8') as f:
            donnees = json.load(f)
    except (OSError, ValueError, UnicodeDecodeError):
        return []
    fiches = donnees.get('auteurs') if isinstance(donnees, dict) else None
    if not isinstance(fiches, list):
        return []
    sortie = []
    for fiche in fiches:
        if not isinstance(fiche, dict):
            continue
        nom = (fiche.get('nom') or '').strip()
        prenom = (fiche.get('prenom') or '').strip()
        if mn._bruit_fiche(nom) or mn._bruit_fiche(prenom):
            continue
        if not nom or not prenom:
            continue
        sortie.append((prenom, nom))
    return sortie


# ---------------------------------------------------------------------------------
# Le leave-one-out proprement dit.

def _retirer(dico, jeton):
    """Décrémente un poids et retire la clé à zéro (une clé à 0 fausserait la taille de la
    base affichée dans le rapport). Rend le poids d'avant, pour le remettre tel quel."""
    n = dico.get(jeton, 0)
    if n <= 1:
        dico.pop(jeton, None)
    else:
        dico[jeton] = n - 1
    return n


def _remettre(dico, jeton, n):
    if n:
        dico[jeton] = n


def mesurer(chemin_auteurs, fichiers_noms, fichiers_prenoms):
    """{'juste','envers','indecis','muet','total','exemples_envers','taille_prenoms',
    'taille_noms','fiches_ojs'} — un passage complet du banc."""
    base, prenoms, noms, n_ojs = monter_base(chemin_auteurs, fichiers_noms, fichiers_prenoms)
    taille_prenoms, taille_noms = len(prenoms), len(noms)
    compte = {'juste': 0, 'envers': 0, 'indecis': 0, 'muet': 0}
    exemples_envers = []

    for prenom_brut, nom_brut in fiches_jugeables(chemin_auteurs):
        # Le segment en ordre direct. Les règles de manuscrit_noms (premier et dernier jeton
        # non-particule) retrouvent les deux jetons utiles de « Anne-Françoise de Chambrier ».
        jetons = prenom_brut.split() + nom_brut.split()
        if len(jetons) < 2:
            # Garde : les deux champs sont non vides.
            compte['muet'] += 1
            continue

        # Retrait de la fiche : les jetons que _charger_base_auteurs() a ajoutés, calculés
        # sur chaque champ séparément (candidat_debut du prénom, candidat_fin du nom).
        j_prenom = mn._candidat_debut(prenom_brut.split())
        j_nom = mn._candidat_fin(nom_brut.split())
        poids_prenom = _retirer(prenoms, j_prenom) if j_prenom else 0
        poids_nom = _retirer(noms, j_nom) if j_nom else 0
        try:
            ordre, _, _ = mn._signal_lexique(jetons, base)
            if ordre == mn.ORDRE_DIRECT:
                compte['juste'] += 1
            elif ordre == mn.ORDRE_INVERSE:
                compte['envers'] += 1
                exemples_envers.append((prenom_brut, nom_brut,
                                        mn._candidat_debut(jetons), mn._candidat_fin(jetons)))
            else:
                # Muet ou indécis : le signal rend (None, 0, '') dans les deux cas. Les scores,
                # recalculés avec la formule de _signal_lexique, les distinguent.
                tete, queue = mn._candidat_debut(jetons), mn._candidat_fin(jetons)
                connus = (base.poids_prenom(tete) + base.poids_nom(queue)
                          + base.poids_nom(tete) + base.poids_prenom(queue))
                compte['indecis' if connus else 'muet'] += 1
        finally:
            if j_prenom:
                _remettre(prenoms, j_prenom, poids_prenom)
            if j_nom:
                _remettre(noms, j_nom, poids_nom)

    compte['total'] = sum(compte[c] for c in ('juste', 'envers', 'indecis', 'muet'))
    compte['exemples_envers'] = exemples_envers
    compte['taille_prenoms'] = taille_prenoms
    compte['taille_noms'] = taille_noms
    compte['fiches_ojs'] = n_ojs
    return compte


# ---------------------------------------------------------------------------------
# Rapport.

def _pc(n, total):
    return (100.0 * n / total) if total else 0.0


def ligne_table(libelle, r):
    t = r['total']
    return '| %-42s | %4d (%4.1f %%) | %3d (%4.1f %%) | %3d (%4.1f %%) | %4d (%4.1f %%) |' % (
        libelle,
        r['juste'], _pc(r['juste'], t), r['envers'], _pc(r['envers'], t),
        r['indecis'], _pc(r['indecis'], t), r['muet'], _pc(r['muet'], t))


ENTETE_TABLE = ('| %-42s | %-14s | %-13s | %-13s | %-14s |'
                % ('', 'tranché juste', 'à l\'envers', 'indécis', 'muet'))
SEPARE_TABLE = '|' + '-' * 44 + '|' + '-' * 16 + '|' + '-' * 15 + '|' + '-' * 15 + '|' + '-' * 16 + '|'


def _usage():
    print(__doc__ or '', end='')
    print('usage : banc-noms.py [--auteurs CHEMIN] [--noms FICHIER]* [--prenoms FICHIER]*')
    print('                     [--sans-lexique] [--exemples N] [--tsv] [--libelle TEXTE]')
    return 2


def main(argv):
    chemin_auteurs = None
    fichiers_noms, fichiers_prenoms = [], []
    sans_lexique = False
    n_exemples = 0
    tsv = False
    libelle = None

    i = 0
    while i < len(argv):
        a = argv[i]
        if a == '--auteurs' and i + 1 < len(argv):
            chemin_auteurs = argv[i + 1]; i += 2
        elif a == '--noms' and i + 1 < len(argv):
            fichiers_noms.append(argv[i + 1]); i += 2
        elif a == '--prenoms' and i + 1 < len(argv):
            fichiers_prenoms.append(argv[i + 1]); i += 2
        elif a == '--sans-lexique':
            sans_lexique = True; i += 1
        elif a == '--exemples' and i + 1 < len(argv):
            n_exemples = int(argv[i + 1]); i += 2
        elif a == '--tsv':
            tsv = True; i += 1
        elif a == '--libelle' and i + 1 < len(argv):
            libelle = argv[i + 1]; i += 2
        elif a in ('-h', '--aide', '--help'):
            return _usage()
        else:
            print('option inconnue : %s' % a)
            return _usage()

    # Sans --noms, --prenoms ni --sans-lexique : les fichiers que BaseNoms.charger() lit en
    # production.
    if not sans_lexique and not fichiers_noms and not fichiers_prenoms:
        for nom_fichier, cible in FICHIERS_PRODUCTION:
            chemin_fichier = os.path.join(LEXIQUE_DEFAUT, nom_fichier)
            if os.path.isfile(chemin_fichier):
                (fichiers_noms if cible == 'noms' else fichiers_prenoms).append(chemin_fichier)

    # _resoudre_chemin_base_auteurs() ne vérifie pas qu'un chemin explicite existe. Un
    # --auteurs mal tapé donnerait une table fausse : ici, une base absente est une erreur.
    chemin = mn._resoudre_chemin_base_auteurs(chemin_auteurs)
    if chemin and not os.path.isfile(chemin):
        chemin = None
    if not chemin:
        print('base d\'auteurs introuvable (C:\\ProgramData\\SZH\\auteurs.json ou --auteurs).')
        print('Elle se moissonne toute seule au lancement de l\'application (contrat, '
              '§5.5 quinquies) : aucun banc n\'est possible sans elle.')
        return 1

    r = mesurer(chemin, fichiers_noms, fichiers_prenoms)
    if not r['total']:
        print('aucune fiche jugeable dans %s' % chemin)
        return 1

    nom_ligne = libelle or ('base OJS seule (témoin)' if not fichiers_noms and not fichiers_prenoms
                            else '+ ' + ', '.join(os.path.basename(f) for f in
                                                  fichiers_noms + fichiers_prenoms))
    if tsv:
        print('%s\t%d\t%d\t%d\t%d\t%d\t%d\t%d' % (
            nom_ligne, r['total'], r['juste'], r['envers'], r['indecis'], r['muet'],
            r['taille_prenoms'], r['taille_noms']))
        return 0

    print('base : %s (%d fiche(s) retenue(s))' % (chemin, r['fiches_ojs']))
    print('lexique : %d jeton(s) de prénom, %d jeton(s) de nom, tout compris'
          % (r['taille_prenoms'], r['taille_noms']))
    print('fiches jugées en leave-one-out : %d' % r['total'])
    print()
    print(ENTETE_TABLE)
    print(SEPARE_TABLE)
    print(ligne_table(nom_ligne, r))
    print()
    if n_exemples and r['exemples_envers']:
        print('les %d première(s) fiche(s) de la colonne « à l\'envers » (sur %d) :'
              % (min(n_exemples, len(r['exemples_envers'])), r['envers']))
        for prenom, nom, tete, queue in r['exemples_envers'][:n_exemples]:
            print('  « %s %s »  ->  le lexique croit « %s » prénom et « %s » nom'
                  % (prenom, nom, queue, tete))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
