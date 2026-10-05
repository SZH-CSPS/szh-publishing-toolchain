"""Moisson d'une source : appel du module, filtre, statut, enregistrement. Partagé par `moissonner` et `tout`."""
import datetime
import importlib

from . import db, filtre


def charger_source(nom):
    """Import de recherche.sources.<nom>. Lève une exception claire si la source n'existe pas."""
    return importlib.import_module('recherche.sources.' + nom)


def config_source(config, nom):
    section = dict(config.get('sources', {}).get(nom, {}))
    section['_global'] = config
    return section


def sources_actives(config):
    return [n for n, s in config.get('sources', {}).items() if s.get('actif', True)]


# Nom lisible d'une source, pour les avertissements que la rédaction voit.
LIBELLES = {'snf': 'FNS', 'skbf': 'SKBF-CSRE'}


def libelle(unite):
    if unite.startswith('site:'):
        from .sources import sites
        return sites.SITES.get(unite[5:], {}).get('libelle') or unite[5:]
    return LIBELLES.get(unite, unite)


def unites(config):
    """[(unité, module, site)] des sources actives : un site par unité pour `sites`, sinon le module lui-même.

    L'unité est ce qu'un 403 arrête et ce qu'une désactivation retire."""
    sortie = []
    for nom in sources_actives(config):
        if nom != 'sites':
            sortie.append((nom, nom, None))
            continue
        from .sources import sites
        for site in config['sources']['sites'].get('liste', []):
            if sites.SITES.get(site, {}).get('actif'):
                sortie.append(('site:' + site, 'sites', site))
    return sortie


def _verdict_pertinence(projet, config_filtre):
    # Une source qui a déjà filtré sans lire le résumé (FNS hors domaines) le dit en extra.
    return filtre.pertinence(projet, config_filtre, avec_descriptif=projet.extra.get('resume_lu', True))


def _termine(projet):
    """Fin passée : ce n'est plus une « recherche en cours ». La SKBF enregistre souvent un
    projet des années après son début, parfois une fois fini."""
    fin = (projet.fin or '').strip()
    if not fin:
        return False
    aujourd_hui = datetime.date.today().isoformat()
    return fin < aujourd_hui[:len(fin)]


def moissonner_source(config, con, reseau, nom, site=None):
    """Moissonne une source et enregistre ce qu'elle rend. Rend {statut: nombre de nouveaux}.

    Les exceptions de la source remontent (l'appelant décide : message, échec signalé, arrêt sur 403 ou budget) ;
    ce qui a déjà été lu reste en base."""
    module = charger_source(nom)
    section = config_source(config, nom)
    if site and nom == 'sites':
        section['liste'] = [site]
    connus = db.connus_prefixe(con, 'site:') if nom == 'sites' else db.connus(con, nom)
    compteurs = {}
    try:
        for i, projet in enumerate(module.moissonner(section, reseau, connus), 1):
            if i % 20 == 0:
                con.commit()  # une moisson interrompue garde ce qu'elle a déjà lu
            verdict = _verdict_pertinence(projet, config['filtre'])
            statut = 'nouveau' if verdict else 'hors-sujet'
            if verdict and _termine(projet):
                statut = 'termine'
            _, est_nouveau = db.enregistrer(con, projet, statut, verdict)
            if est_nouveau:
                compteurs[statut] = compteurs.get(statut, 0) + 1
    finally:
        con.commit()
    return compteurs
