"""Fonds national suisse (data.snf.ch), sur le poste de dev seulement : lit en flux grants_with_abstracts.csv, téléchargé
à la main. Aucune colonne à nom de personne n'est lue, et `Institute` perd ses noms possibles."""
import csv
import datetime
import html
import os
import re
import unicodedata

from ..modele import Projet
from ..nettoyage import retirer_balisage
from .. import filtre as filtre_module, personnes

URL_CSV = 'https://data.snf.ch/datasets/grants_with_abstracts.csv'
URL_GRANT = 'https://data.snf.ch/grants/grant/{}'

# Les seules colonnes lues. Aucune ne porte un nom de personne : ResponsibleApplicantName n'y est pas (figé par un test).
COLONNES_LUES = ('GrantNumber', 'Title', 'TitleEnglish', 'ResearchInstitution', 'Institute', 'MainDiscipline',
                 'AllDisciplines', 'EffectiveGrantStartDate', 'EffectiveGrantEndDate', 'State', 'Keywords',
                 'CallDecisionYear', 'CallEndDate', 'Abstract', 'LaySummary_De', 'LaySummary_Fr', 'LaySummary_En',
                 'LaySummary_It')
# Exigées à l'import : ce que `moissonner` lit, et les résumés qui distinguent l'export « with abstracts » de grants.csv.
RESUMES = ('Abstract', 'LaySummary_De', 'LaySummary_Fr', 'LaySummary_En')
COLONNES_EXIGEES = ('GrantNumber', 'Title', 'TitleEnglish', 'ResearchInstitution', 'Institute', 'MainDiscipline',
                    'AllDisciplines', 'EffectiveGrantStartDate', 'EffectiveGrantEndDate', 'State') + RESUMES
# Un export plus petit est tronqué (le vrai : 430 Mo, 91 000 subsides en 2026).
TAILLE_MIN = 50_000_000
LIGNES_MIN = 10_000
PART_ILLISIBLES = 0.01


class FichierInvalide(Exception):
    """Ce fichier n'est pas l'export FNS attendu ; le message se montre tel quel."""


def _ouvrir(chemin):
    # BOM facultatif ; un octet invalide devient U+FFFD et rend sa ligne illisible, sans arrêter la lecture.
    return open(chemin, encoding='utf-8-sig', errors='replace', newline='')


def controler_entete(chemin):
    """Taille et en-tête, sans lire le reste. Rend la liste des colonnes, ou lève FichierInvalide."""
    if not os.path.isfile(chemin):
        raise FichierInvalide(f'fichier introuvable : {chemin}')
    taille = os.path.getsize(chemin)
    if taille < TAILLE_MIN:
        raise FichierInvalide(f'fichier trop petit ({taille // 1_000_000} Mo, au moins {TAILLE_MIN // 1_000_000} '
                              'attendus) : le téléchargement est sans doute incomplet')
    with _ouvrir(chemin) as f:
        entete = f.readline().rstrip('\r\n')
    if ';' not in entete:
        raise FichierInvalide("ce fichier n’est pas l’export FNS attendu : les colonnes ne sont pas séparées par « ; »")
    colonnes = next(csv.reader([entete], delimiter=';'))
    manquantes = [c for c in COLONNES_EXIGEES if c not in colonnes]
    if manquantes and set(manquantes) <= set(RESUMES):
        raise FichierInvalide('c’est l’export sans résumés (grants.csv) : téléchargez « Grants with abstracts »')
    if manquantes:
        raise FichierInvalide("ce fichier n’est pas l’export FNS attendu : colonnes manquantes : " + ', '.join(manquantes))
    return colonnes


def lignes(chemin, bilan=None):
    """Les lignes lisibles de l'export, réduites aux COLONNES_LUES, en flux. `bilan` (dict) reçoit `lignes` et
    `illisibles` : une ligne au mauvais nombre de champs, sans numéro de subside ou à l'octet invalide."""
    bilan = bilan if bilan is not None else {}
    bilan.update(lignes=0, illisibles=0)
    with _ouvrir(chemin) as f:
        for brute in csv.DictReader(f, delimiter=';'):
            bilan['lignes'] += 1
            ligne = {c: brute.get(c) for c in COLONNES_LUES if c in brute}
            if (None in brute or any(v is None for v in brute.values())
                    or not (ligne.get('GrantNumber') or '').strip() or any('�' in (v or '') for v in ligne.values())):
                bilan['illisibles'] += 1
                continue
            yield ligne


def controler(chemin):
    """Lecture complète avant l'import : {taille, mtime, lignes, illisibles, max_call_end, appels}, ou FichierInvalide
    (en-tête, taille, moins de LIGNES_MIN lignes, plus de PART_ILLISIBLES de lignes illisibles)."""
    controler_entete(chemin)
    bilan, appels = {}, {}
    for ligne in lignes(chemin, bilan):
        mois = _date(ligne.get('CallEndDate'))[:7]
        if len(mois) == 7:
            appels[mois] = appels.get(mois, 0) + 1
    if bilan['lignes'] < LIGNES_MIN:
        raise FichierInvalide(f"{bilan['lignes']} lignes seulement (au moins {LIGNES_MIN} attendues) : "
                              'le téléchargement est sans doute incomplet')
    if bilan['illisibles'] > PART_ILLISIBLES * bilan['lignes']:
        raise FichierInvalide(f"{bilan['illisibles']} lignes illisibles sur {bilan['lignes']} : fichier abîmé, "
                              'téléchargez-le à nouveau')
    stat = os.stat(chemin)
    return {'taille': stat.st_size,
            'mtime': datetime.datetime.fromtimestamp(stat.st_mtime, datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'lignes': bilan['lignes'], 'illisibles': bilan['illisibles'],
            'max_call_end': max(appels, default=''), 'appels': dict(sorted(appels.items()))}


# Le FNS suffixe l'institution de son sigle (« Pädagogische Hochschule Zürich – PHZH »),
# séparé par un tiret entouré d'espaces (cadratin le plus souvent, parfois un tiret simple).
# Le sigle lui-même peut contenir un tiret interne (« SUPSI-DFA », « HEP-BEJUNE ») : on ne
# coupe donc pas sur le premier tiret venu, seulement sur un tiret entouré d'espaces.
RE_SUFFIXE_ABBR = re.compile(r'\s+[‐-―-]\s+[\w.\-]{1,20}$')

# Mots vides simples pour deviner la langue d'un titre (de/fr/it) quand TitleEnglish diffère
# du titre original (donc le titre n'est pas déjà en anglais).
MOTS_VIDES = {
    'de': {'und', 'der', 'die', 'das', 'von', 'zur', 'zum', 'im', 'in', 'fur', 'bei', 'auf',
           'mit', 'eine', 'ein', 'des', 'ab', 'als', 'wie', 'nach', 'bis'},
    'fr': {'et', 'de', 'la', 'le', 'des', 'du', 'une', 'un', 'les', 'dans', 'pour', 'sur',
           'chez', 'entre', 'chez', 'au', 'aux'},
    'it': {'e', 'della', 'del', 'per', 'con', 'delle', 'dei', 'nella', 'nel', 'tra', 'alla'},
}


def _normaliser(texte):
    s = unicodedata.normalize('NFD', str(texte or '').lower())
    return ''.join(c for c in s if not unicodedata.combining(c))


def _deviner_langue(titre, titre_anglais):
    """de/fr/en/it, ou '' si indécidable. TitleEnglish identique (ou absent) => déjà en anglais."""
    titre = (titre or '').strip()
    titre_anglais = (titre_anglais or '').strip()
    if not titre_anglais or _normaliser(titre_anglais) == _normaliser(titre):
        return 'en'
    jetons = set(re.findall(r'[a-z]+', _normaliser(titre)))
    scores = {langue: len(jetons & mots) for langue, mots in MOTS_VIDES.items()}
    meilleure = max(scores, key=scores.get)
    if scores[meilleure] == 0:
        return ''
    return meilleure


def _nettoyer_institution(nom):
    """Retire le suffixe abréviatif final (« – PHZH », « - HfH »...) que le FNS ajoute."""
    return RE_SUFFIXE_ABBR.sub('', str(nom or '').strip()).strip()


def _date(valeur_iso):
    """« 2025-01-01T00:00:00Z » -> « 2025-01-01 »."""
    valeur = str(valeur_iso or '').strip()
    return valeur[:10] if valeur else ''


def _descriptif(ligne, langue):
    """Résumé vulgarisé dans la langue du titre si possible, sinon la première langue
    disponible parmi de/en/fr/it, sinon l'Abstract scientifique. Entités HTML décodées."""
    ordre = []
    if langue:
        ordre.append(langue)
    for l in ('de', 'en', 'fr', 'it'):
        if l not in ordre:
            ordre.append(l)
    colonnes = {'de': 'LaySummary_De', 'en': 'LaySummary_En',
                'fr': 'LaySummary_Fr', 'it': 'LaySummary_It'}
    for l in ordre:
        v = (ligne.get(colonnes[l]) or '').strip()
        if v:
            return _paragraphes(retirer_balisage(html.unescape(v)))
    v = (ligne.get('Abstract') or '').strip()
    return _paragraphes(retirer_balisage(html.unescape(v))) if v else ''


# Le FNS colle ses paragraphes sans espace (« verbessern.Die Studien ») : on les rouvre. Au
# moins trois minuscules avant le point, pour épargner « z.B. » et les sigles.
RE_PARAGRAPHE_COLLE = re.compile(r'([a-zäöüàéèç]{3})\.([A-ZÄÖÜÀÉÈ][a-zäöüàéèç])')


def _paragraphes(texte):
    return RE_PARAGRAPHE_COLLE.sub(r'\1.\n\n\2', texte)


def _discipline_toujours(discipline, disciplines_config):
    """Le domaine FNS toujours examiné : comparaison souple (sous-chaîne dans un sens ou
    l'autre), la taxonomie FNS ayant changé de libellés au fil du temps."""
    d = _normaliser(discipline)
    for cfg in disciplines_config:
        c = _normaliser(cfg)
        if c and (c in d or d in c):
            return True
    return False


def _code_discipline(toutes, prefixes):
    """AllDisciplines (« 10500/30721/30911 ») : un projet interdisciplinaire (« SSH + LS »)
    garde son code sciences de l'éducation (105xx) parmi les autres."""
    codes = [c.strip() for c in str(toutes or '').split('/')]
    return any(c.startswith(p) for c in codes for p in prefixes if p)


def moissonner(config, reseau, connus):
    depuis = config.get('depuis', '')
    disciplines_config = config.get('disciplines', [])
    codes_config = config.get('codes_disciplines', [])
    config_filtre = config['_global']['filtre']
    dossier_cache = config['_global']['cache']

    # Le robots.txt de data.snf.ch interdit tout (Disallow: /) : reseau.py refuse donc le
    # téléchargement. `fichier_local` lit à la place un export téléchargé à la main.
    chemin_csv = config.get('fichier_local') or ''
    if not chemin_csv:
        chemin_csv = os.path.join(dossier_cache, 'snf', 'grants_with_abstracts.csv')
        reseau.telecharger(URL_CSV, chemin_csv)
    elif not os.path.isabs(chemin_csv):
        chemin_csv = os.path.join(config['_global']['_racine'], chemin_csv)
    if not os.path.isfile(chemin_csv):
        raise FileNotFoundError('export FNS introuvable : ' + chemin_csv
                                + ' (télécharger ' + URL_CSV + ' à la main, voir LISEZMOI.md)')

    for ligne in lignes(chemin_csv):
        debut = _date(ligne.get('EffectiveGrantStartDate'))
        if depuis and debut and debut < depuis:
            continue  # trivialement hors fenêtre

        numero = (ligne.get('GrantNumber') or '').strip()
        if not numero:
            continue

        titre = (ligne.get('Title') or '').strip()
        langue = _deviner_langue(titre, ligne.get('TitleEnglish'))
        descriptif = _descriptif(ligne, langue)
        institutions = _nettoyer_institution(ligne.get('ResearchInstitution'))

        projet = Projet(
            source='snf',
            source_id=numero,
            url=URL_GRANT.format(numero),
            title=titre,
            langue=langue,
            institutions=institutions,
            debut=debut,
            fin=_date(ligne.get('EffectiveGrantEndDate')),
            descriptif=descriptif,
            date_source=(ligne.get('CallDecisionYear') or '').strip(),
            extra={
                'main_discipline': ligne.get('MainDiscipline', ''),
                'institute': personnes.retirer_noms(ligne.get('Institute')),
                'state': ligne.get('State', ''),
                'keywords': ligne.get('Keywords', ''),
            },
        )
        if not projet.extra['institute']:
            del projet.extra['institute']     # rien d'utile hors des noms retirés

        # Hors des domaines de `disciplines`, le résumé n'est pas lu : un « accessible » en
        # physique ou un « impair » en biologie ne doit pas faire entrer le subside.
        avec_resume = (_discipline_toujours(ligne.get('MainDiscipline', ''), disciplines_config)
                       or _code_discipline(ligne.get('AllDisciplines', ''), codes_config))
        if not filtre_module.pertinence(projet, config_filtre, avec_descriptif=avec_resume):
            continue
        projet.extra['resume_lu'] = avec_resume

        yield projet
