#!/usr/bin/env python3
# Lit pipeline/vale/lexique/orthographe-rectifiee.csv (la SOURCE DE VÉRITÉ, une paire
# traditionnelle/rectifiée par ligne) et écrit, de façon idempotente (même entrée -> mêmes
# octets), une règle Vale `substitution` PAR CATÉGORIE dans
# pipeline/vale/styles/CSPS/Orthographe/Rectifiee-<Categorie>.yml.
#
# stdlib seule (csv + re), comme outils-dev/lexique/generer-lexique.py, dont ce script
# reprend le patron (en-tête « généré », nettoyage des anciens fichiers avant réécriture,
# tri des paires pour une sortie stable indépendante de l'ordre du CSV).
#
# Niveau des règles : `warning` pour TOUTES les catégories, sans exception — décision de la
# rédaction du 21.09.2026 : la Revue écrit en orthographe rectifiée (pas en traditionnelle),
# une graphie traditionnelle rencontrée est donc une faute résiduelle à corriger, jamais une
# simple suggestion à vérifier. `action: replace` (donc `action='fix'` côté manuscrit_vale.py)
# pour que la correction parte en révision Word que la rédaction accepte d'un clic (§7 ter du
# contrat) — jamais une correction silencieuse.
#
# La majuscule initiale : Vale (`ignorecase: false`, choisi pour ne JAMAIS renvoyer une
# suggestion à la mauvaise casse — voir le LISEZMOI) ne fait AUCUN pliage de casse. Une paire
# self CSV « événement;évènement » ne lève donc rien sur « Événement » en tête de phrase, mesuré
# en vrai (vale 3.22.0, essai isolé) : sans une seconde paire à majuscule initiale, la moitié
# des occurrences en tête de phrase échapperait au contrôle. D'où une SECONDE paire, générée
# automatiquement ici (jamais dans le CSV, qui ne porte qu'une ligne par mot) dès que le
# premier caractère de la forme traditionnelle est une lettre bas-de-casse.
import csv
import re
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parents[2]
CSV_DEFAUT = RACINE / 'pipeline' / 'vale' / 'lexique' / 'orthographe-rectifiee.csv'
STYLES_DEFAUT = RACINE / 'pipeline' / 'vale' / 'styles' / 'CSPS' / 'Orthographe'

ENTETE_YAML_GENERE = (
    "# généré par outils-dev/lexique/generer-orthographe.py depuis pipeline/vale/lexique/"
    "orthographe-rectifiee.csv — NE PAS ÉDITER À LA MAIN, corriger le CSV puis régénérer.\n"
)

# Nom de fichier par catégorie du CSV (colonne `categorie`) -> reste du nom
# `Rectifiee-<Nom>.yml`, et la citation qui va dans le commentaire d'en-tête de chaque
# fichier (section Wikipédia précise, comme demandé pour la famille TraitUnion).
CATEGORIES = {
    'circonflexe': ('Circonflexe',
        "accent circonflexe sur i/u supprimé (Wikipédia : Rectifications orthographiques du "
        "français en 1990, §Accent circonflexe). Exceptions JAMAIS mécanisées ici (absentes du "
        "CSV, donc jamais touchées par cette règle) : dû (masculin singulier seul), mûr, sûr, "
        "jeûne, et le verbe croître (bare, sans préfixe — accroître/décroître, eux, perdent "
        "l'accent) ; formes du passé simple/subjonctif imparfait (nous fûmes, qu'il fût...) ; "
        "noms propres (Nîmes, Benoît)."),
    'grave': ('Grave',
        "accent aigu remplacé par un accent grave (Wikipédia : Rectifications orthographiques "
        "du français en 1990, §Accent grave). Limité ici aux noms/adjectifs (événement, "
        "réglementaire...) — jamais aux formes conjuguées de type « je cèderai » (accord "
        "verbal, hors mécanisable sans lookaround)."),
    'trema': ('Trema',
        "tréma déplacé sur la voyelle réellement prononcée (Wikipédia : Rectifications "
        "orthographiques du français en 1990, §Tréma)."),
    'numeraux': ('Numeraux',
        "trait d'union entre TOUS les éléments d'un numéral composé, y compris autour de "
        "« et » (Wikipédia : Rectifications orthographiques du français en 1990, §Traits "
        "d'union dans les numéraux) — classé ici, pas dans la famille TraitUnion, décision du "
        "brief du 21.09.2026 : c'est la rectification de 1990 qui change la règle, pas l'usage "
        "traditionnel déjà en vigueur."),
    'soudure': ('Soudure',
        "soudure de mots composés usuels (Wikipédia : Rectifications orthographiques du "
        "français en 1990, §Soudure de mots composés)."),
    'olle_otte': ('OlleOtte',
        "simplification -olle -> -ole et -otter -> -oter (Wikipédia : Rectifications "
        "orthographiques du français en 1990, §Mots en -olle et verbes en -otter). Exceptions "
        "JAMAIS mécanisées (absentes du CSV) : colle, folle, molle."),
    'eler_eter': ('ElerEter',
        "verbes en -eler/-eter réguliers, accent grave + consonne simple, sur le modèle de "
        "peler/acheter (Wikipédia : Rectifications orthographiques du français en 1990, "
        "§Verbes en -eler et -eter). Exceptions JAMAIS mécanisées (absentes du CSV) : appeler, "
        "jeter et leurs dérivés (dont interpeler), qui gardent le doublement traditionnel."),
    'pluriel_composes': ('PlurielComposes',
        "pluriel régulier des noms composés verbe/préposition + nom (Wikipédia : "
        "Rectifications orthographiques du français en 1990, §Pluriel des noms composés). "
        "Limité à des phrases COMPLÈTES déterminant + composé (« des après-midi » ...) : "
        "le pluriel dépend de savoir si le groupe est employé au pluriel, une question "
        "syntaxique que Vale ne sait pas trancher sans le déterminant capturé dans le motif "
        "lui-même — jamais une règle productive sur le composé seul."),
    'emprunts': ('Emprunts',
        "pluriel des mots empruntés francisé (Wikipédia : Rectifications orthographiques du "
        "français en 1990, §Mots empruntés)."),
}


def lire_csv(chemin):
    if not chemin.exists():
        return []
    with open(chemin, encoding='utf-8', newline='') as f:
        return list(csv.DictReader(f, delimiter=';'))


def _yaml_str(valeur):
    v = valeur.replace('\\', '\\\\').replace('"', '\\"')
    return '"' + v + '"'


# ⚠ Mesuré en vrai (vale 3.22.0, 21.09.2026) : dans une chaîne YAML entre GUILLEMETS DOUBLES,
# `\b` (UN antislash) est un échappement reconnu (le caractère « retour arrière », U+0008), pas
# un antislash littéral suivi d'un `b` — un motif TAPÉ À LA MAIN comme `"\bévénement\b"` ne lève
# donc JAMAIS rien, silencieusement. `_yaml_str()` ci-dessus double l'antislash (« \\b »)
# précisément pour écrire la bonne chaîne malgré ça, et ÇA MARCHE (revérifié : un fichier généré
# avec `_yaml_str()` sur les motifs, guillemets doubles compris, lève bien les alertes) — ce
# n'est donc pas un défaut de `_yaml_str()` lui-même. `_yaml_regex_str()` (guillemets SIMPLES)
# reste préféré ici : les guillemets simples YAML ne connaissent AUCUN échappement (sauf `''`
# pour un guillemet simple littéral), un motif qui les utilise est WYSIWYG à l'ŒIL, jamais
# retraité — c'est la même convention que `pipeline/vale/styles/CSPS/Epicene/
# FormesContractees.yml` (tokens entre guillemets simples), choisie ici pour éviter tout risque
# lors d'une correction manuelle future de ce générateur, même si le doublage de `_yaml_str()`
# fonctionne correctement quand le CODE le fait pour vous. Ce n'est PAS un piège RE2 : RE2 gère
# très bien un `\b` collé à une lettre accentuée (« île », « événement » — mesuré).
def _yaml_regex_str(motif):
    return "'" + motif.replace("'", "''") + "'"


def _majuscule_initiale(mot):
    return mot[:1].upper() + mot[1:]


# Mots dont la forme À MAJUSCULE INITIALE collisionne avec un nom propre/titre RÉEL, mesuré
# sur le corpus publié (92 articles fr, 21.09.2026) : « Maître » comme titre professionnel/
# académique (« Maître d'enseignement », bloc d'autrices et auteurs) et « Boîte » comme nom
# propre d'outil (« La Boîte », projet cité par son nom). La forme bas-de-casse (« maître »,
# « boîte »ployée comme nom commun ordinaire) reste couverte normalement — seule la paire à
# MAJUSCULE INITIALE est supprimée pour ces mots, jamais la paire de base. Décision documentée
# ici plutôt que dans le CSV (pas de colonne dédiée pour un cas aussi rare) : si ce piège
# touche un troisième mot, faire une vraie colonne `sans_majuscule` au lieu d'agrandir cette
# liste sans fin.
SANS_PAIRE_MAJUSCULE = {'maître', 'boîte'}


def construire_paires(lignes_categorie):
    """[(motif_regex, remplacement), ...] triées, une paire de base par ligne du CSV, plus
    une paire à majuscule initiale quand la forme traditionnelle commence par une lettre
    bas-de-casse (voir l'en-tête : mesuré, `ignorecase: false` ne plie aucune casse) — sauf
    pour SANS_PAIRE_MAJUSCULE (voir juste au-dessus)."""
    paires = {}
    for row in lignes_categorie:
        trad = (row.get('traditionnelle') or '').strip()
        rect = (row.get('rectifiee') or '').strip()
        if not trad or not rect:
            continue
        motif = r'\b' + re.escape(trad) + r'\b'
        paires[motif] = rect
        premiere = trad[:1]
        if (trad.lower() not in SANS_PAIRE_MAJUSCULE and premiere.isalpha()
                and premiere == premiere.lower() and premiere != premiere.upper()):
            trad_maj = _majuscule_initiale(trad)
            rect_maj = _majuscule_initiale(rect)
            motif_maj = r'\b' + re.escape(trad_maj) + r'\b'
            paires[motif_maj] = rect_maj
    return sorted(paires.items())


def construire_yaml(categorie_csv, lignes_categorie):
    nom_fichier, citation = CATEGORIES[categorie_csv]
    paires = construire_paires(lignes_categorie)
    lignes_yaml = [ENTETE_YAML_GENERE]
    lignes_yaml.append('# Orthographe rectifiée (1990) : ' + citation + '\n')
    lignes_yaml.append(
        '# Décision de la rédaction (21.09.2026) : la Revue écrit en orthographe rectifiée, '
        'pas en traditionnelle -- une graphie traditionnelle rencontrée ici est une faute '
        'résiduelle, jamais une politique à trancher. `warning`, jamais `suggestion`.\n')
    lignes_yaml.append('extends: substitution\n')
    lignes_yaml.append(
        'message: "Orthographe rectifiée (recommandation de la rédaction, 21.09.2026) : %s '
        'au lieu de %s."\n')
    lignes_yaml.append('level: warning\n')
    lignes_yaml.append('ignorecase: false\n')
    lignes_yaml.append('action:\n  name: replace\n')
    lignes_yaml.append('swap:\n')
    if not paires:
        lignes_yaml.append('  # aucune paire pour cette catégorie dans le CSV actuel\n')
    for motif, remplacement in paires:
        lignes_yaml.append('  {}: {}\n'.format(_yaml_regex_str(motif), _yaml_str(remplacement)))
    return ''.join(lignes_yaml)


def main():
    import argparse
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--csv', default=str(CSV_DEFAUT),
                     help='chemin de orthographe-rectifiee.csv (test : un mini-CSV isolé)')
    ap.add_argument('--styles-dir', default=str(STYLES_DEFAUT),
                     help='dossier pipeline/vale/styles/CSPS/Orthographe (test : une copie isolée)')
    args = ap.parse_args()

    chemin_csv = Path(args.csv)
    styles_dir = Path(args.styles_dir)
    styles_dir.mkdir(parents=True, exist_ok=True)

    lignes = lire_csv(chemin_csv)
    par_categorie = {}
    inconnues = set()
    for row in lignes:
        cat = (row.get('categorie') or '').strip()
        if cat not in CATEGORIES:
            inconnues.add(cat)
            continue
        par_categorie.setdefault(cat, []).append(row)

    # Idempotence même si une catégorie disparaît d'une exécution à l'autre : on repart d'un
    # dossier nettoyé de tout ancien Rectifiee-*.yml avant de réécrire (même principe que
    # generer-lexique.py pour Sigle-*.yml).
    for f in styles_dir.glob('Rectifiee-*.yml'):
        f.unlink()

    for cat, (nom_fichier, _citation) in CATEGORIES.items():
        contenu = construire_yaml(cat, par_categorie.get(cat, []))
        (styles_dir / 'Rectifiee-{}.yml'.format(nom_fichier)).write_text(
            contenu, encoding='utf-8', newline='\n')

    if inconnues:
        print('catégories du CSV inconnues du générateur (ignorées) : ' + ', '.join(sorted(inconnues)),
              file=sys.stderr)


if __name__ == '__main__':
    main()
