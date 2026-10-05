"""`estimer` (sans requête ni écriture) et `tout` (moisson source par source, lot, purge, etat.json) : une ligne JSON par
évènement. Une source en échec ou en 403 n'arrête pas les autres ; le plafond et la demande d'arrêt arrêtent la moisson."""
import datetime
import json
import os
import sqlite3
import sys
import time

import commun

from . import db, etat, moisson, propositions, purge
from .reseau import Acces403, ArretDemande, BudgetEpuise, Reseau, afflux

VERSION_CONTRAT = 1
NOM = 'recherche'

# Majorants raisonnés des requêtes d'une moisson ordinaire (base déjà remplie), par source : un site à plan =
# robots.txt, l'index et ses pages, et les pages nouvelles ; HEP Vaud = la page d'accueil, une page par unité et les
# pages nouvelles ; la SKBF = ses pages de liste depuis `depuis` et les détails nouveaux.
REQUETES_SKBF = 25
REQUETES_SITE = 25
REQUETES_HEPVD = 21


def _chemin_snf(config):
    section = config.get('sources', {}).get('snf', {})
    chemin = section.get('fichier_local') or ''
    if chemin and not os.path.isabs(chemin):
        chemin = os.path.join(config.get('_racine', ''), chemin)
    return chemin


def _prevues(config, nom, avert):
    if nom == 'snf':
        chemin = _chemin_snf(config)
        if chemin and os.path.isfile(chemin):
            return 0
        avert.append("export FNS absent : la source snf échouera (le robots.txt de data.snf.ch interdit de le télécharger)")
        return 1
    if nom == 'skbf':
        return REQUETES_SKBF
    if nom == 'sites':
        from .sources import sites
        total = 0
        for site in config.get('sources', {}).get('sites', {}).get('liste', []):
            s = sites.SITES.get(site)
            if s and s.get('actif'):
                total += REQUETES_HEPVD if s['decouverte'] == 'cascade_html' else REQUETES_SITE
        return total
    return 0


def estimer(config):
    """Plan sans réseau ni écriture : étapes, requêtes prévues, durée à `delai` s la requête."""
    avert, pret = [], True
    try:
        propositions.verifier_config(config)
    except propositions.ConfigurationInvalide as e:
        pret = False
        avert.append(str(e))
    if not os.path.isdir(os.path.join(config.get('bibliotheque') or '', 'forschung')):
        pret = False
        avert.append('bibliothèque introuvable : le dédoublonnage est impossible, rien ne doit partir')
    etapes = [{'id': 'moisson', 'source': nom, 'requetes_prevues': _prevues(config, nom, avert)}
              for nom in moisson.sources_actives(config)]
    etapes += [{'id': 'propositions', 'requetes_prevues': 0}, {'id': 'purge', 'requetes_prevues': 0}]
    total = sum(e['requetes_prevues'] for e in etapes)
    budget = int(config.get('budget', 0) or 0)
    delai = float(config.get('delai', 0) or 0)
    return {'type': 'estimation', 'moissonneur': NOM, 'contrat': VERSION_CONTRAT, 'pret': pret, 'etapes': etapes,
            'requetes': total, 'requetes_prevues': total, 'budget': budget,
            'depasse_le_budget': bool(budget) and total > budget,
            'delai_s': delai, 'duree_estimee_s': int(min(total, budget or total) * delai),
            'chemins': {'propositions': config.get('propositions', ''), 'decisions': config.get('decisions', ''),
                        'base': config.get('base', ''), 'bibliotheque': config.get('bibliotheque', ''),
                        'fichier_snf': _chemin_snf(config)},
            'avertissements': avert}


def _date_lisible(iso):
    try:
        return datetime.date.fromisoformat(iso).strftime('%d.%m.%Y')
    except ValueError:
        return iso


def tout(config, emit, aujourdhui=None, hors_ligne=False, reseau=None, a_blanc=False, ouvrir=None, publier=None,
         borne=None):
    """Moisson, lot, purge, etat.json. Rend (résumé, code : 0 ok, 1 échecs signalés, 2 configuration, 3 interrompu).

    hors_ligne : aucune source n'est appelée ; le lot, la purge et etat.json se font sur la base telle qu'elle est.
    a_blanc : tout, sauf écrire le lot, etat.json et le journal, et purger ; le résumé dit ce qui aurait été fait.
    ouvrir : rend la base de la passe (défaut : le fichier `base`). publier(delta) : reçoit ce que la passe a appris,
    après chaque source puis à la fin."""
    t0 = time.time()
    jour = aujourdhui or datetime.date.today().isoformat()
    try:
        propositions.verifier_config(config)
        if not ouvrir and not str(config.get('base') or '').strip():
            raise propositions.ConfigurationInvalide('base : chemin vide')
        con = ouvrir() if ouvrir else db.connecter(config['base'])
    except (propositions.ConfigurationInvalide, etat.EtatAbsent, sqlite3.Error, OSError) as e:
        return _bloquer(config, emit, f'{type(e).__name__}: {e}')
    if reseau is None and not hors_ligne:
        reseau = Reseau(config, fichier_arret=config.get('arret'), signaler=emit, urls_refusees=db.urls_refusees(con),
                        borne=borne)
    sources_echec, etapes_echec, interrompu, nouveaux = [], [], None, {}
    tentees, en_403, desactivees_resume = [], [], []
    publie = {'avant': etat.instantane(con) if publier else None}

    def requetes():
        return getattr(reseau, 'requetes', 0) if reseau is not None else 0

    def publier_delta():
        if not publier or a_blanc:
            return
        try:
            delta = etat.differentiel(con, publie['avant'])
            if delta:
                publier(delta)
            publie['avant'] = etat.instantane(con)
        except Exception as e:      # le lot et etat.json passent quand même ; l'échec est signalé
            etapes_echec.append({'etape': 'journal', 'raison': f'{type(e).__name__}: {e}'})

    def noter_pages(unite):
        bilan = getattr(reseau, 'details', {}).get(unite)
        if not bilan:
            return
        for url in dict.fromkeys(bilan['refus']):
            emit({'type': 'avertissement', 'source': unite, 'code': '403-page', 'url': url,
                  'message': f"une page de {moisson.libelle(unite)} refuse l’accès (403)"})
        db.noter_urls(con, unite, bilan['refus'], bilan['reussies'], jour)

    try:
        desactivees = db.sources_desactivees(con)
        for unite, module, site in ([] if hors_ligne else moisson.unites(config)):
            if unite in desactivees:
                depuis = desactivees[unite]
                desactivees_resume.append({'source': unite, 'depuis': depuis})
                emit({'type': 'avertissement', 'source': unite, 'code': 'desactivee', 'depuis': depuis,
                      'message': f'{moisson.libelle(unite)} est désactivée depuis le {_date_lisible(depuis)} : '
                                 'réactivation en dev'})
                continue
            tentees.append(unite)
            if reseau is not None:
                reseau.source = unite
            try:
                nouveaux[unite] = moisson.moissonner_source(config, con, reseau, module, site=site)
                if afflux(getattr(reseau, 'details', {}).get(unite)):
                    raise Acces403(f'{unite} : plus de la moitié des pages de détail refusées')
            except BudgetEpuise:
                interrompu = 'budget'
                emit({'type': 'progression', 'etape': 'moisson', 'source': unite, 'statut': 'budget',
                      'requetes': requetes()})
                break
            except ArretDemande:
                interrompu = 'arret'
                emit({'type': 'progression', 'etape': 'moisson', 'source': unite, 'statut': 'arret',
                      'requetes': requetes()})
                break
            except Acces403 as e:       # cette source s'arrête pour la passe ; les autres continuent
                en_403.append(unite)
                sources_echec.append({'source': unite, 'raison': '403'})
                emit({'type': 'progression', 'etape': 'moisson', 'source': unite, 'statut': 'echec', 'raison': '403'})
                emit({'type': 'avertissement', 'source': unite, 'code': '403',
                      'message': f"{moisson.libelle(unite)} a refusé l’accès (403)"})
                print(f'{unite} : {e}', file=sys.stderr)
                db.noter_source(con, unite, True, jour)
                continue
            except Exception as e:      # une source en échec n'arrête jamais les autres
                sources_echec.append({'source': unite, 'raison': f'{type(e).__name__}: {e}'})
                emit({'type': 'progression', 'etape': 'moisson', 'source': unite, 'statut': 'echec',
                      'raison': f'{type(e).__name__}: {e}'})
                continue
            else:
                db.noter_source(con, unite, False, jour)
            finally:
                noter_pages(unite)
                con.commit()
                publier_delta()
            emit({'type': 'progression', 'etape': 'moisson', 'source': unite, 'statut': 'ok',
                  'nouveaux': nouveaux[unite], 'requetes': requetes()})
        if tentees and len(en_403) == len(tentees) and interrompu is None:
            interrompu = '403'

        ex = None
        try:
            maintenant = (aujourdhui + propositions.utc_maintenant()[10:]) if aujourdhui else None
            ex = propositions.exporter(config, con, maintenant=maintenant, a_blanc=a_blanc)
            emit({'type': 'progression', 'etape': 'propositions', 'statut': 'ok', 'ecrites': ex['ecrites'],
                  'lot': os.path.basename(ex['lot'] or '')})
        except Exception as e:
            etapes_echec.append({'etape': 'propositions', 'raison': f'{type(e).__name__}: {e}'})
            emit({'type': 'progression', 'etape': 'propositions', 'statut': 'echec', 'raison': f'{type(e).__name__}: {e}'})

        purge_faite, purge_prevue = {'lots': [], 'decisions': []}, None
        try:
            pu = purge.purger(config, con, aujourdhui=aujourdhui, a_blanc=a_blanc)
            if a_blanc:
                purge_prevue = {'lots': pu['lots'], 'decisions': pu['decisions']}
            else:
                purge_faite = {'lots': pu['lots'], 'decisions': pu['decisions']}
            emit({'type': 'progression', 'etape': 'purge', 'statut': 'ok', 'lots': len(purge_faite['lots']),
                  'decisions': len(purge_faite['decisions']), 'echecs': len(pu['echecs'])})
            if pu['echecs']:
                etapes_echec.append({'etape': 'purge', 'raison': f"{len(pu['echecs'])} fichier(s) non effacé(s)"})
        except Exception as e:
            etapes_echec.append({'etape': 'purge', 'raison': f'{type(e).__name__}: {e}'})
            emit({'type': 'progression', 'etape': 'purge', 'statut': 'echec', 'raison': f'{type(e).__name__}: {e}'})
        publier_delta()
    finally:
        con.close()

    resume = {'type': 'resume', 'moissonneur': NOM, 'contrat': VERSION_CONTRAT,
              'derniere_moisson': propositions.utc_maintenant(), 'duree_s': round(time.time() - t0, 1),
              'requetes': requetes(), 'propositions_ecrites': ex['ecrites'] if ex else 0,
              'lot': os.path.basename(ex['lot'] or '') if ex else '', 'sources_en_echec': sources_echec,
              'interrompu': interrompu, 'erreur': '', 'purge': purge_faite,
              'nouveaux': nouveaux, 'retenues': ex['par_verdict']['retenu'] if ex else 0,
              'a_relire': ex['par_verdict']['a-relire'] if ex else 0, 'existants': ex['existants'] if ex else 0,
              'decidees': ex['decidees'] if ex else 0, 'etapes_en_echec': etapes_echec,
              'sources_desactivees': desactivees_resume}
    if a_blanc:
        resume['a_blanc'] = {'propositions': ex['prevues'] if ex else 0, 'lot': ex['lot_prevu'] if ex else '',
                             'purge': purge_prevue or {'lots': [], 'decisions': []}}
    else:
        try:
            resume['etat'] = ecrire_etat(config, resume)
        except OSError as e:
            etapes_echec.append({'etape': 'etat', 'raison': f'{type(e).__name__}: {e}'})
            print(f'etat.json non écrit : {type(e).__name__}: {e}', file=sys.stderr)
    emit(resume)
    code = 3 if interrompu else (1 if (sources_echec or etapes_echec) else 0)
    return resume, code


def _bloquer(config, emit, erreur):
    """Configuration invalide : rien n'est parti ; etat.json le dit s'il peut s'écrire, sinon la sortie d'erreur."""
    resume = {'type': 'resume', 'moissonneur': NOM, 'contrat': VERSION_CONTRAT,
              'derniere_moisson': propositions.utc_maintenant(), 'duree_s': 0, 'requetes': 0, 'propositions_ecrites': 0,
              'lot': '', 'sources_en_echec': [], 'interrompu': 'configuration', 'erreur': erreur,
              'purge': {'lots': [], 'decisions': []}}
    try:
        resume['etat'] = ecrire_etat(config, resume)
    except (OSError, KeyError, TypeError) as e:
        print(f'Arrêt : {erreur} ; etat.json non écrit ({type(e).__name__}: {e})', file=sys.stderr)
    emit(resume)
    return resume, 2


CHAMPS_ETAT = ('derniere_moisson', 'duree_s', 'requetes', 'propositions_ecrites', 'lot', 'sources_en_echec',
               'interrompu', 'erreur', 'purge', 'nouveaux', 'retenues', 'a_relire', 'existants', 'decidees',
               'etapes_en_echec', 'sources_desactivees')


def ecrire_etat(config, resume):
    """etat.json (`pronto-etat/1`) à côté des lots, écrit d'un coup. Ni `crans` ni `cran_defaut` : pas de score ici."""
    etat_json = {'format': 'pronto-etat/1', 'moissonneur': NOM, 'contrat': VERSION_CONTRAT}
    etat_json.update({c: resume[c] for c in CHAMPS_ETAT if c in resume})
    return commun.ecrire_etat(config['propositions'], etat_json)
