"""Jeu de référence : les interventions déjà publiées par la Zeitschrift, appariées aux affaires moissonnées.

Lecture seule de la bibliothèque de production. Sert à mesurer le rappel et au dédoublonnage.
"""
import re

from . import classement, kirby
from .lexique import normaliser


def lire_reference(racine_fiches):
    """[{'canton', 'numero', 'title', 'lien', 'date', 'categorie', 'langue', 'uuid', 'slug'}]."""
    sortie = []
    for slug, langue, c in kirby.fiches_existantes(racine_fiches):
        sortie.append({'slug': slug, 'langue': langue, 'canton': (c.get('canton') or '').strip(),
                       'numero': (c.get('numero') or '').strip(), 'title': (c.get('title') or '').strip(),
                       'lien': (c.get('lien') or '').strip(), 'date': (c.get('date') or '').strip(),
                       'categorie': (c.get('categorie') or '').strip(), 'uuid': (c.get('uuid') or '').strip(),
                       'source': (c.get('source') or '').strip()})
    return sortie


def cle_numero(n):
    """Forme de comparaison d'un numéro d'affaire : sans espaces, tirets ni casse (« 25.356 » = « 25 356 »)."""
    return re.sub(r'[\s\-_/]+', '', str(n or '')).lower()


def cle_titre(t):
    return re.sub(r'[^a-z0-9]+', ' ', normaliser(t)).strip()


def corps_de_canton(canton, config):
    """Corps OpenParlData d'un code canton du contrat (CH -> CHE)."""
    if canton == 'CH':
        return config['moisson']['confederation']
    return canton


def apparier(refs, base, config):
    """[(référence, affaire de la base | None, méthode)] : numéro + corps d'abord, puis titre + corps, puis lien."""
    par_numero, par_titre, par_lien = {}, {}, {}
    for r in base.c.execute('SELECT * FROM affaires'):
        a = dict(r)
        par_numero.setdefault((a['body_key'], cle_numero(a['number'])), a)
        par_titre.setdefault((a['body_key'], cle_titre(a['title'])), a)
        for u in (a['url_externe'], a['url_oparl']):
            if u:
                par_lien.setdefault(u.strip().lower(), a)
    sortie = []
    for ref in refs:
        corps = corps_de_canton(ref['canton'], config)
        a = par_numero.get((corps, cle_numero(ref['numero']))) if ref['numero'] else None
        methode = 'numero' if a else ''
        if not a:
            a = par_titre.get((corps, cle_titre(ref['title'])))
            methode = 'titre' if a else ''
        if not a and ref['lien']:
            a = par_lien.get(ref['lien'].lower())
            methode = 'lien' if a else ''
        sortie.append((ref, a, methode))
    return sortie


def rappel_titres_seuls(refs, lex, ecole_generale=False):
    """Rappel du lexique sur les seuls titres de référence : (retenus ou à relire, total, [manquées]).

    Hors ligne et sans base : mesure ce que le lexique reconnaît d'un titre, pas ce que fait le pipeline.
    """
    ok, manquees = 0, []
    for ref in refs:
        a = {'body_key': ref['canton'], 'number': ref['numero'], 'title': ref['title'], 'type_name': {},
             'type_harmonized_id': None}
        res = classement.classer(lex, a, '', candidat=False, ecole_generale=ecole_generale)
        if res.verdict in ('retenu', 'a-relire'):
            ok += 1
        else:
            manquees.append(ref)
    return ok, len(refs), manquees


def rappel_pipeline(refs, base, config):
    """Rappel du pipeline complet sur la base : lignes {ref, statut, verdict, methode, explication}."""
    lignes = []
    for ref, a, methode in apparier(refs, base, config):
        if a is None:
            lignes.append({'ref': ref, 'statut': 'absente de la base', 'verdict': '', 'methode': '',
                           'explication': 'non moissonnée : absente de l\'API, retard d\'ingestion, hors date ou corps non suivi'})
            continue
        v = base.c.execute('SELECT verdict, raison FROM verdicts WHERE body_key=? AND external_id=?',
                           (a['body_key'], a['external_id'])).fetchone()
        if v is None:
            lignes.append({'ref': ref, 'statut': 'trouvée, jamais candidate', 'verdict': '', 'methode': methode,
                           'explication': 'ni la recherche serveur ni le titre ne portent d\'ancrage : lexique'})
        else:
            lignes.append({'ref': ref, 'statut': 'classée', 'verdict': v['verdict'], 'methode': methode,
                           'explication': v['raison']})
    ok = sum(1 for l in lignes if l['verdict'] in ('retenu', 'a-relire'))
    return ok, len(lignes), lignes
