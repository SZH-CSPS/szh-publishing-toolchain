#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# banc-noms.py — le banc de mesure du signal `lexique` de pipeline/manuscrit_noms.py, en
# LEAVE-ONE-OUT sur la base d'auteurs réelle du poste. Contrat :
# outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md, §5.5 ter (la table qu'il porte est produite
# par ce script) et §5.5 quater (le lexique du dépôt, ce que ce banc sert à dimensionner).
#
# La table du §5.5 ter existait avant ce script, produite par un bout de code ad hoc jamais
# committé (22.09.2026). Le remettre au propre était le premier livrable du brief
# outils-dev/BRIEF-lexique-noms-elargi.md : sans banc réutilisable, aucun palier de lexique ne
# peut être ni proposé ni refusé sur des chiffres.
#
# ---------------------------------------------------------------------------------
# CE QUE LE BANC MESURE
#
# Chaque fiche de C:\ProgramData\SZH\auteurs.json porte un prénom et un nom dans DEUX CHAMPS
# DISTINCTS : l'ordre y est structurel, jamais deviné. On peut donc recoller « Prénom Nom »
# en ordre DIRECT, poser la question à manuscrit_noms._signal_lexique() et savoir si sa
# réponse est juste — la seule vérité terrain disponible sans annoter un corpus à la main.
#
# LEAVE-ONE-OUT : la fiche jugée est RETIRÉE de la base avant d'être jugée (son jeton de
# prénom et son jeton de nom décrémentés d'une unité, un poids tombé à zéro valant absence).
# Sans cela chaque fiche se reconnaîtrait elle-même et le banc rendrait ~100 % de succès sans
# rien mesurer du tout. Le lexique du dépôt (noms-famille.txt et ses semblables), lui, n'est
# PAS retiré : il ne vient pas de la base d'auteurs, et c'est précisément son apport qu'on
# veut lire dans la colonne « tranché juste ».
#
# Quatre colonnes, exclusives :
#   tranché juste — le signal rend ORDRE_DIRECT, l'ordre réel de la fiche.
#   à l'envers    — le signal rend ORDRE_INVERSE : une réponse FAUSSE, pas un silence.
#   indécis       — score_direct == score_inverse et tous deux > 0 : la base connaît les deux
#                   jetons des deux côtés, elle ne peut pas départager.
#   muet          — score_direct == score_inverse == 0 : la base ne connaît ni l'un ni l'autre.
# « indécis » et « muet » ont le même effet aval (le signal se tait, la convention prénom-nom
# s'applique) mais des causes opposées, et c'est l'élargissement du lexique qui fait passer des
# fiches de l'un à l'autre : les séparer est tout l'intérêt du banc.
#
# ---------------------------------------------------------------------------------
# ⚠ LA LIMITE DE CE BANC, À CITER PARTOUT OÙ SA TABLE EST CITÉE
#
# Il juge des fiches ISOLÉES, une par une. Il ne voit donc RIEN de la propagation
# (manuscrit_noms.trancher_groupe(), §5.5 ter du contrat), par laquelle un seul segment
# tranché impose son ordre à tous les segments restés en `defaut` du même document.
# Conséquence dans les deux sens :
#   - il SOUS-ESTIME le gain d'un lexique élargi : en conditions réelles il suffit qu'UN
#     segment d'un article soit tranché pour que tout l'article bascule dans le bon ordre ;
#   - il SOUS-ESTIME le coût d'une inversion : une inversion tranchée à tort ne reste pas
#     locale, elle se propage et peut retourner un article entier.
# Ce n'est donc jamais une mesure de ce que vit un manuscrit. C'est un banc de COMPARAISON
# ENTRE PALIERS de lexique, et rien de plus. La deuxième conséquence est la raison du critère
# d'acceptation asymétrique du brief : un palier ne s'adopte que s'il n'augmente pas la
# colonne « à l'envers », même quand il fait gagner beaucoup de « tranché juste ».
#
# ---------------------------------------------------------------------------------
# stdlib seule, comme tout outils-dev/lexique/. CLI à tiret analysée à la main (cohérence avec
# generer-noms.py et moissonner-ojs.py du même dossier).
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
    """manuscrit_noms.py porte un tiret BAS et s'importerait normalement — mais il vit dans
    pipeline/, pas ici, et il charge lui-même docx-meta.py par chemin relatif à SON dossier.
    Le charger par chemin (plutôt qu'un sys.path.insert) évite d'ajouter pipeline/ au chemin
    d'import de ce script, où il ferait de l'ombre à d'autres modules."""
    spec = importlib.util.spec_from_file_location(nom_module, chemin)
    module = importlib.util.module_from_spec(spec)
    sys.modules[nom_module] = module
    spec.loader.exec_module(module)
    return module


mn = _charger_module_a_tiret(
    os.path.join(RACINE, 'pipeline', 'manuscrit_noms.py'), 'szh_manuscrit_noms_pour_banc')


# Les fichiers que BaseNoms.charger() lit en production, repris de manuscrit_noms lui-même —
# jamais recopiés ici : le banc doit mesurer ce qui tourne, pas ce qu'on croit qui tourne.
FICHIERS_PRODUCTION = [(nom, cote) for nom, cote, _ in mn.FICHIERS_LEXIQUE]


# ---------------------------------------------------------------------------------
# La base, montée à la main À PARTIR DES CHARGEURS DE PRODUCTION.
#
# On n'appelle pas BaseNoms.charger() : elle fixe la liste des fichiers de lexique (celle de
# FICHIERS_LEXIQUE), et tout l'objet de ce banc est d'en essayer d'autres. On réemploie
# donc ses DEUX chargeurs tels quels — _charger_base_auteurs() et _charger_fichier_lexique() —
# puis on remplit une BaseNoms avec le résultat. Aucun pliage, aucun filtre de bruit, aucune
# règle de candidat n'est réécrite ici : si la production change d'avis sur l'un d'eux, le banc
# change d'avis en même temps. C'est la seule façon qu'une mesure ait encore un sens six mois
# plus tard.

def monter_base(chemin_auteurs, fichiers_noms, fichiers_prenoms):
    """(base, prenoms, noms, n_fiches_ojs) — `prenoms` et `noms` sont les dictionnaires VIVANTS
    de la base : c'est en les modifiant que le leave-one-out retire une fiche, sans jamais
    remonter une base entière par fiche (1152 rechargements d'un fichier de 300 Ko plus des deux
    index publics : plusieurs minutes, contre une fraction de seconde pour la décrémentation)."""
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
    """[(prenom_brut, nom_brut), ...] — exactement les fiches que _charger_base_auteurs() a
    RETENUES, dans le même ordre et sous les mêmes règles (bruit institutionnel, champ vide).
    Le filtre est réappliqué ici plutôt que déduit : une fiche qui n'a pas nourri la base ne
    doit pas non plus être jugée par le banc, sans quoi les deux populations divergent et le
    leave-one-out décrémente des jetons qui n'ont jamais été ajoutés.

    Mesuré le 22.09.2026 sur C:\\ProgramData\\SZH\\auteurs.json : 1157 fiches au fichier,
    1155 jugeables — 2 fiches perdues, non par le filtre de bruit (dont les 4 fiches
    documentées au §5.5 ter tombent aussi) mais par un champ vide. C'est le 1155 de la table
    du contrat."""
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
    """Décrémente un poids, et RETIRE la clé quand il tombe à zéro : BaseNoms.poids_*() teste
    `> 0`, mais un jeton à 0 laissé en place fausserait tout comptage ultérieur du dictionnaire
    (la taille de la base, affichée en tête de rapport). Rend le poids retiré, pour le
    remettre exactement tel quel."""
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
        # Le segment tel qu'un manuscrit l'écrirait en ordre DIRECT. `split()` sur les deux
        # champs : « Anne-Françoise » + « de Chambrier » -> 3 jetons, et ce sont les règles de
        # candidat de manuscrit_noms (tête = premier jeton non-particule, queue = dernier
        # jeton non-particule) qui retrouvent les deux jetons utiles — jamais ce banc.
        jetons = prenom_brut.split() + nom_brut.split()
        if len(jetons) < 2:
            # Ne peut pas arriver (les deux champs sont non vides), gardé par principe : le
            # banc ne doit jamais poser à un signal une question mal formée.
            compte['muet'] += 1
            continue

        # Retrait de la fiche. Les jetons retirés sont ceux que _charger_base_auteurs() avait
        # AJOUTÉS — donc calculés sur chaque champ SÉPARÉMENT (candidat_debut du prénom,
        # candidat_fin du nom), et non sur le segment recollé.
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
                # Muet ou indécis : la distinction n'est pas dans la réponse du signal (il rend
                # (None, 0, '') dans les deux cas), elle est dans les scores. Recalculés ici
                # avec la MÊME formule que _signal_lexique — trois lignes, le seul endroit du
                # banc qui redise quelque chose de la production, et le contrat les écrit
                # noir sur blanc (§5.5 ter).
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

    # Sans --noms ni --prenoms ni --sans-lexique : EXACTEMENT ce que BaseNoms.charger() lit en
    # production, pas un sous-ensemble. La liste est reprise de manuscrit_noms lui-même plutôt
    # que recopiée : un quatrième fichier ajouté là-bas entre ici sans que personne y pense, et
    # le banc ne peut pas se mettre à mesurer, en silence, autre chose que ce qui tourne.
    if not sans_lexique and not fichiers_noms and not fichiers_prenoms:
        for nom_fichier, cible in FICHIERS_PRODUCTION:
            chemin_fichier = os.path.join(LEXIQUE_DEFAUT, nom_fichier)
            if os.path.isfile(chemin_fichier):
                (fichiers_noms if cible == 'noms' else fichiers_prenoms).append(chemin_fichier)

    # _resoudre_chemin_base_auteurs() rend TEL QUEL un chemin explicite, sans vérifier qu'il
    # existe : c'est correct pour la production (un chemin absent y vaut « pas de base », et
    # le chargeur se tait), mais pour un banc c'est un piège. Un --auteurs mal tapé rendrait
    # une table complète et parfaitement fausse, où chaque colonne raconte l'absence de base
    # plutôt qu'un palier. Ici, l'absence est une ERREUR, jamais un silence.
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
