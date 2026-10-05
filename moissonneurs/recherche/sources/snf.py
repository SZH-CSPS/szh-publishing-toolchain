"""Fonds national suisse (data.snf.ch), sur le poste de dev seulement : lit en flux grants_with_abstracts.csv, téléchargé
à la main. Aucune colonne à nom de personne n'est lue, et `Institute` perd ses noms possibles."""
import csv
import html
import os
import re
import unicodedata

from ..modele import Projet
from ..nettoyage import retirer_balisage
from .. import filtre as filtre_module, personnes

URL_CSV = 'https://data.snf.ch/datasets/grants_with_abstracts.csv'
URL_GRANT = 'https://data.snf.ch/grants/grant/{}'


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

    with open(chemin_csv, encoding='utf-8-sig', newline='') as f:
        lecteur = csv.DictReader(f, delimiter=';')
        for ligne in lecteur:
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
