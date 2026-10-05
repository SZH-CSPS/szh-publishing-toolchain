"""Commandes `estimer` et `tout` : sortie JSON sur stdout, contrat commun décrit dans docs/FORMAT-PROPOSITIONS.md.

`estimer` ne fait aucune requête. `tout` enchaîne moisson, criblage, texte, classement, liste et sauvegarde ;
l'échec d'un corps ou d'une brique figure dans le résumé et n'arrête pas les suivantes.
"""
import json
import math
import os
import sqlite3
import sys
import time

from . import classement, criblage, export_propositions, lexique, liste, moisson, purge, sauvegarde
from .reseau import Acces403, ArretDemande, BudgetEpuise, Reseau
from .stockage import Base

VERSION_CONTRAT = 1
NOM = 'parlement'


def _chemins(config):
    return {'base': config['stockage']['base'],
            'sauvegardes': config['sortie'].get('sauvegardes') or os.path.join(config['sortie']['dossier'], 'sauvegardes'),
            'sortie': config['sortie']['dossier']}


def estimer(config, base=None):
    """Plan sans réseau : étapes, requêtes prévues (majorant raisonné), durée à `delai` s la requête.

    `base` : l'état partagé chargé en mémoire (passe mensuelle) ; `budget` est alors le budget du mois, et aucun corps
    ne s'importe (l'import reste au poste de développement)."""
    ch = _chemins(config)
    lex = lexique.charger()
    partagee = base is not None
    delai = float(config['reseau'].get('delai', 2.0))
    budget = int(config['mensuelle'].get('budget', 800)) if partagee else int(config['reseau'].get('budget', 3000))
    limite = int(config['moisson']['limite'])
    base_presente = partagee or os.path.exists(ch['base'])
    derniere = None if partagee else sauvegarde.derniere(ch['sauvegardes'])
    avert = []
    corps_liste = moisson.corps_suivis(config)
    reperes, connus_par_corps, criblees, a_textes = {}, {}, set(), 0
    echecs = []
    if base_presente:
        b = base or Base(ch['base'])
        try:
            reperes = {r['body_key']: r['repere'] for r in b.c.execute('SELECT body_key, repere FROM corps')}
            connus_par_corps = b.compte_affaires_par_corps()
            criblees = {(r['terme'], r['langue']) for r in b.c.execute('SELECT terme, langue FROM criblages')}
            a_textes = b.c.execute(
                """SELECT COUNT(DISTINCT c.body_key || '/' || c.external_id) FROM candidats c
                   LEFT JOIN textes_recuperes t ON t.body_key=c.body_key AND t.external_id=c.external_id
                   WHERE t.external_id IS NULL""").fetchone()[0]
            echecs = b.corps_en_echec()
        finally:
            if not partagee:
                b.fermer()
        corps_liste = [c for c in echecs if c in corps_liste] + [c for c in corps_liste if c not in echecs]
    elif derniere:
        avert.append(f'base absente : reprise depuis la sauvegarde {os.path.basename(derniere)}')
    mixte = hybride(config)
    api_active = bool(config.get('mensuelle', {}).get('active', False))
    corps_plan, a_importer = [], []
    for c in corps_liste:
        if mixte and not reperes.get(c):
            req, source_c = 0, 'exports'          # jamais d'import de masse par l'API : les exports
            if not partagee:
                a_importer.append(c)
        elif reperes.get(c):
            req = 1 if (api_active or not mixte) else 0      # incrémentale : une page fraîche
            source_c = 'api'
        else:
            req = max(2, math.ceil(connus_par_corps.get(c, 1500) / limite))   # initiale : ~1 500 affaires/corps
            source_c = 'api'
        corps_plan.append({'corps': c, 'requetes': req, 'initiale': not reperes.get(c), 'source': source_c,
                           'reprise_apres_echec': c in echecs})
    n_moisson = sum(x['requetes'] for x in corps_plan)
    termes = [t for t in criblage.termes_de_recherche(lex) if t not in criblees]
    if mixte:      # recherche ciblée de la Confédération et documents des nouvelles candidates, seulement par la passe mensuelle
        n_cribl = len(termes) if (termes and api_active and reperes.get(config['moisson']['confederation'])) else 0
        n_textes = (a_textes or 80) if api_active else 0
    else:
        n_cribl = (len(termes) * 2 + 4) if termes else 0
        n_textes = a_textes if a_textes else (80 if termes else 0)
    total = n_moisson + n_cribl + n_textes
    return {
        'type': 'estimation', 'moissonneur': NOM, 'contrat': VERSION_CONTRAT,
        'pret': not avert or all('reprise depuis' in a for a in avert),
        'etapes': [
            {'id': 'moisson', 'libelle': 'Moisson des affaires par corps', 'corps': corps_plan,
             'requetes_prevues': n_moisson},
            *([{'id': 'import', 'libelle': "Import de base par les exports (files.openparldata.ch, aucune requête à l'API)",
                'corps': a_importer, 'requetes_api': 0, 'delai_s': float(config['exports'].get('delai', 5.0)),
                'fichiers': (1 + len(a_importer) + (1 if config['moisson']['confederation'] in a_importer else 0))
                if a_importer else 0}] if mixte else []),
            {'id': 'criblage', 'libelle': 'Recherche plein texte des termes d\'ancrage', 'termes': len(termes),
             'requetes_prevues': n_cribl},
            {'id': 'textes', 'libelle': 'Texte des candidats', 'requetes_prevues': n_textes},
            {'id': 'classement', 'libelle': 'Classement hors ligne', 'requetes_prevues': 0},
            {'id': 'sauvegarde', 'libelle': 'Sauvegarde compressée', 'requetes_prevues': 0}],
        'sources': ({'import': 'exports', 'mensuelle': 'api' if api_active else 'desactivee',
                     'budget_mensuel': int(config['mensuelle'].get('budget', 800))} if mixte
                    else {'import': 'api', 'mensuelle': 'api'}),
        'requetes_prevues': total, 'budget': budget, 'depasse_le_budget': total > budget,
        'delai_s': delai, 'duree_estimee_s': int(min(total, budget) * delai),
        'chemins': {'base': ch['base'], 'sauvegardes': ch['sauvegardes'], 'sortie': ch['sortie'],
                    'propositions': config['sortie']['propositions'], 'decisions': config['sortie'].get('decisions', '')},
        'base_presente': base_presente, 'derniere_sauvegarde': derniere, 'avertissements': avert}


def _ouvrir_base(config, emit):
    ch = _chemins(config)
    if not os.path.exists(ch['base']):
        derniere = sauvegarde.derniere(ch['sauvegardes'])
        if derniere:
            sauvegarde.restaurer(derniere, ch['base'])
            emit({'type': 'progression', 'etape': 'restauration', 'statut': 'ok',
                  'detail': f'base restaurée depuis {os.path.basename(derniere)}'})
    return Base(ch['base'])


def hybride(config):
    """Deux sources : import de base par les exports, passe mensuelle par l'API (sections [exports] et [mensuelle])."""
    return 'exports' in config and 'mensuelle' in config


def tout(config, emit, source=None, reseau=None, lex=None, aujourdhui=None, hors_ligne=False, telechargeur=None,
         ouvrir=None, publier=None, a_blanc=False, maintenant=None):
    """Enchaîne tout. Rend (resume, code de sortie : 0 ok, 1 ok avec échecs, 2 configuration, 3 interrompu).

    hors_ligne : aucune requête (ni moisson, ni criblage, ni textes) ; classement, propositions, purge et etat.json se
    rejouent sur la base telle qu'elle est.
    ouvrir : rend la base de la passe, l'état partagé chargé en mémoire (passe mensuelle) ; sans lui, le fichier `base`
    du poste de développement. publier(delta) : reçoit ce que la passe a appris, après chaque corps puis à la fin.
    Une passe sur l'état partagé n'importe rien, ne fait ni liste ni sauvegarde, et ne recalibre pas les crans.
    a_blanc : tout, sauf écrire le lot, etat.json et le journal, et purger. maintenant : horodatage ISO UTC du lot."""
    from .sources import openparldata
    from . import etat as etat_partage
    source = source or openparldata
    t0 = time.time()
    ch = _chemins(config)
    lex = lex or lexique.charger()
    partagee = ouvrir is not None
    try:
        base = ouvrir() if partagee else _ouvrir_base(config, emit)
    except etat_partage.EtatAbsent as e:
        return _bloquer(config, emit, f'état partagé absent : {e}')
    except (sqlite3.Error, OSError) as e:       # base impossible à ouvrir ou à créer : configuration invalide
        return _bloquer(config, emit, f"base « {ch['base']} » inutilisable : {type(e).__name__}: {e}")
    try:
        export_propositions.verdicts_exportes(config)
        export_propositions.arriere_a_relire_mois(config)
    except export_propositions.ConfigurationExport as e:
        base.fermer()
        return _bloquer(config, emit, str(e))
    if reseau is None:
        reseau = Reseau(dict(config['reseau']))
    reseau_courant = {'r': reseau}
    echecs_etapes, corps_echecs, interrompu = [], [], None
    res = {'nouvelles_affaires': 0, 'affaires_modifiees': 0}
    publie = {'avant': etat_partage.instantane(base) if (publier and not a_blanc) else None}

    def etape_ok(etape, **kw):
        emit({'type': 'progression', 'etape': etape, 'statut': 'ok', 'requetes': reseau_courant['r'].requetes, **kw})

    def etape_ko(etape, raison):
        echecs_etapes.append({'etape': etape, 'raison': raison})
        emit({'type': 'progression', 'etape': etape, 'statut': 'echec', 'raison': raison})

    def publier_delta(tables=etat_partage.PUBLIES_PAR_UNE_PASSE):
        if publie['avant'] is None:
            return
        try:
            apres = etat_partage.instantane(base, tables)
            avant = {t: publie['avant'].get(t, {}) for t in tables}
            delta = etat_partage.differentiel(avant, apres)
            if delta:
                publier(delta)
            publie['avant'].update(apres)
        except Exception as e:      # le lot et etat.json passent quand même ; l'échec est signalé
            echecs_etapes.append({'etape': 'journal', 'raison': f'{type(e).__name__}: {e}'})

    def progression_passe(obj):
        obj = dict(obj)
        point = obj.pop('point', False)
        emit({'type': 'progression', **obj, 'requetes': reseau_courant['r'].requetes})
        if point:          # un corps achevé : ses affaires nouvelles partent au journal, candidates comprises
            criblage.candidats_par_titre(config, base, lex)
            publier_delta(etat_partage.POINT)

    # 0. Mode hybride : les corps sans repère s'importent par les exports (fichiers statiques), au poste de développement
    # seulement ; l'API ne sert qu'à la passe mensuelle, et seulement si `[mensuelle] active`.
    mode_hybride = hybride(config)
    if mode_hybride and not hors_ligne and not partagee:
        sans_repere = [c for c in moisson.corps_suivis(config) if base.repere(c) is None]
        if sans_repere:
            try:
                from . import importer
                from .sources import exports
                tel = telechargeur or exports.Telechargeur(
                    config['exports'].get('dossier', 'donnees/exports'), base_url=config['exports'].get('base_url', exports.BASE_URL),
                    delai=float(config['exports'].get('delai', 5.0)))
                ri = importer.importer(config, base, tel, lex, corps=sans_repere, emit=lambda o: emit({'type': 'progression', **o}))
                res['nouvelles_affaires'] += sum(v.get('affaires', 0) for v in ri['corps'].values())
                etape_ok('import', fichiers=ri['fichiers'], corps=len(sans_repere))
            except Exception as e:
                etape_ko('import', f'{type(e).__name__}: {e}')
    if mode_hybride and not hors_ligne and config['mensuelle'].get('active', False):
        try:
            from . import passe_mensuelle
            reseau_m, _ = passe_mensuelle.reseau_mensuel(config, base, aujourdhui)
            reseau = reseau_courant['r'] = reseau_m
            rm = passe_mensuelle.passe(config, base, reseau_m, source, lex, aujourdhui, progression=progression_passe)
            for c, v in rm['corps'].items():
                res['nouvelles_affaires'] += v['nouvelles']
                res['affaires_modifiees'] += v.get('changees', 0)
            if rm['statut'] in ('plafond', 'arret'):
                interrompu = 'budget' if rm['statut'] == 'plafond' else 'arret'
                emit({'type': 'progression', 'etape': 'mensuelle', 'statut': interrompu, 'requetes': reseau.requetes})
            else:
                etape_ok('mensuelle', recherche=rm['recherche'], textes=rm['textes'], statut=rm['statut'])
        except Exception as e:
            etape_ko('mensuelle', f'{type(e).__name__}: {e}')

    # 1. Moisson par corps (mode historique, sans [exports] : API seule)
    ident = base.debuter_execution('tout')
    try:
        for c in ([] if (hors_ligne or mode_hybride) else moisson.corps_suivis(config, base)):
            try:
                statut, raison, comptes = moisson.moissonner_corps(config, base, reseau, source, c)
            except BudgetEpuise as e:
                interrompu = 'arret' if isinstance(e, ArretDemande) else 'budget'
                emit({'type': 'progression', 'etape': 'moisson', 'corps': c, 'statut': interrompu})
                break
            except Acces403:
                interrompu = '403'
                corps_echecs.append({'corps': c, 'raison': '403 : accès refusé'})
                emit({'type': 'progression', 'etape': 'moisson', 'corps': c, 'statut': 'echec', 'raison': '403'})
                break
            res['nouvelles_affaires'] += comptes['nouvelles']
            res['affaires_modifiees'] += comptes['changees']
            if statut != 'ok':
                corps_echecs.append({'corps': c, 'raison': raison})
            emit({'type': 'progression', 'etape': 'moisson', 'corps': c, 'statut': statut, 'raison': raison,
                  'nouvelles': comptes['nouvelles'], 'modifiees': comptes['changees'], 'requetes': reseau.requetes})
    except Exception as e:  # défaut inattendu de la brique : consigné, les étapes hors ligne continuent
        etape_ko('moisson', f'{type(e).__name__}: {e}')

    # 2. Criblage serveur (seulement si la moisson n'a pas été interrompue)
    if interrompu is None and not hors_ligne and not mode_hybride:
        try:
            criblage.verifier_accents(config, reseau, source)
            suivis = moisson.corps_suivis(config)
            rapport = criblage.cribler(config, base, reseau, source, lex, suivis=suivis)
            ko = [r for r in rapport if r['statut'] != 'ok']
            etape_ok('criblage', termes=len(rapport), termes_en_echec=len(ko))
            if ko:
                echecs_etapes.append({'etape': 'criblage', 'raison': f'{len(ko)} terme(s) en échec', 'termes': ko[:20]})
        except BudgetEpuise as e:
            interrompu = 'arret' if isinstance(e, ArretDemande) else 'budget'
            emit({'type': 'progression', 'etape': 'criblage', 'statut': interrompu})
        except Acces403:
            interrompu = '403'
            emit({'type': 'progression', 'etape': 'criblage', 'statut': 'echec', 'raison': '403'})
        except criblage.AccentsMutiles as e:
            etape_ko('criblage', f'accents mutilés : {e}')
        except Exception as e:
            etape_ko('criblage', f'{type(e).__name__}: {e}')

    # 3. Candidats par titre (hors ligne), texte des candidats
    try:
        n = criblage.candidats_par_titre(config, base, lex)
        etape_ok('titres', candidats_par_titre=n)
    except Exception as e:
        etape_ko('titres', f'{type(e).__name__}: {e}')
    if interrompu is None and not hors_ligne and not mode_hybride:
        try:
            tr = criblage.recuperer_textes(config, base, reseau, source)
            etape_ok('textes', textes=tr['faits'], echecs=len(tr['echecs']))
            if tr['echecs']:
                echecs_etapes.append({'etape': 'textes', 'raison': f"{len(tr['echecs'])} affaire(s) sans texte",
                                      'affaires': tr['echecs'][:20]})
        except BudgetEpuise as e:
            interrompu = 'arret' if isinstance(e, ArretDemande) else 'budget'
            emit({'type': 'progression', 'etape': 'textes', 'statut': interrompu})
        except Acces403:
            interrompu = '403'
        except Exception as e:
            etape_ko('textes', f'{type(e).__name__}: {e}')

    # 4. Classement, liste (hors ligne) ; la liste reste au poste de développement
    comptes = {}
    try:
        comptes = classement.classer_base(config, base, lex)
        etape_ok('classement', **{k.replace('-', '_'): v for k, v in comptes.items()})
    except Exception as e:
        etape_ko('classement', f'{type(e).__name__}: {e}')
    chemin_liste = ''
    if not partagee:
        try:
            chemin_liste, nl = liste.ecrire(config, base, '', ch['sortie'])
            etape_ok('liste', chemin=chemin_liste, lignes=nl)
        except Exception as e:
            etape_ko('liste', f'{type(e).__name__}: {e}')

    # 4b. Propositions (lot JSONL) : décisions relues d'abord, une cle décidée n'est jamais reproposée
    propositions_ecrites, lot, hors_lot_filtre, hors_lot_arriere = 0, '', 0, 0
    controle_noms = {'defauts': 0, 'lignes_avec_doute': 0}
    par_verdict = {'retenu': 0, 'a-relire': 0}
    ex = None
    try:
        ex = export_propositions.exporter(config, base, maintenant=maintenant, a_blanc=a_blanc)
        propositions_ecrites, lot, par_verdict = ex['ecrites'], ex['lot'] or '', ex['par_verdict']
        hors_lot_filtre, hors_lot_arriere = ex['hors_lot_filtre'], ex['hors_lot_arriere']
        controle_noms = ex['controle_noms']
        etape_ok('propositions', ecrites=propositions_ecrites, ecartees=len(ex['ecartees']), lot=lot, controle_noms=controle_noms)
        if controle_noms['defauts']:     # un nom d'auteur non coupé : la ligne ne part pas, l'exécution le dit
            etape_ko('controle-noms', f"{controle_noms['defauts']} ligne(s) retenue(s) hors lot : nom de personne non coupé")
    except Exception as e:
        etape_ko('propositions', f'{type(e).__name__}: {e}')

    # 4b2. Finesse : crans par langue, termes ; facultative ([export] finesse = true). Une passe sur l'état partagé
    # reprend les crans du poste de développement, même d'un trimestre passé.
    bloc_finesse = {}
    if (config.get('export') or {}).get('finesse'):
        try:
            from . import finesse
            jour = aujourdhui or time.strftime('%Y-%m-%d')
            figes = base.fige('crans') if partagee else None
            if figes and finesse.trimestre(figes.get('crans_calcules_le', '0000-00-00')) != finesse.trimestre(jour):
                echecs_etapes.append({'etape': 'finesse', 'raison': f"crans du {figes.get('crans_calcules_le')} : "
                                                                    'à recalculer au poste de développement'})
            figes = {k: v for k, v in figes.items() if k != 'version'} if figes else None
            chemin_figes = None if partagee else os.path.join(os.path.dirname(ch['base']) or '.', 'crans.json')
            bloc_finesse = finesse.etat(config, base, lex, jour, chemin_figes=chemin_figes, figes=figes)
            etape_ok('finesse', termes=len(bloc_finesse['termes']))
        except Exception as e:
            etape_ko('finesse', f'{type(e).__name__}: {e}')

    # 4c. Purge à six mois (lots et décisions) : une brique comme les autres, son échec n'arrête rien
    purge_fait = {'lots': [], 'decisions': []}
    if not a_blanc:
        try:
            pu = purge.purger(config, base, aujourdhui=aujourdhui)
            purge_fait = {'lots': pu['lots'], 'decisions': pu['decisions']}
            etape_ok('purge', lots=len(pu['lots']), decisions=len(pu['decisions']), echecs=len(pu['echecs']))
            if pu['echecs']:
                echecs_etapes.append({'etape': 'purge', 'raison': f"{len(pu['echecs'])} fichier(s) non effacé(s)",
                                      'fichiers': pu['echecs'][:20]})
        except Exception as e:
            etape_ko('purge', f'{type(e).__name__}: {e}')

    # 4d. Journal du poste : ce que la passe a appris, figé tant que les documents sont en mémoire
    if partagee and publie['avant'] is not None:
        try:
            etat_partage.finaliser(base, config, lex)
        except Exception as e:
            etape_ko('journal', f'{type(e).__name__}: {e}')
        publier_delta()

    # 5. Sauvegarde, au poste de développement seulement
    chemin_sauvegarde = ''
    ident_fin = 'ok' if not (corps_echecs or echecs_etapes or interrompu) else ('budget' if interrompu == 'budget' else 'echec')
    try:
        base.terminer_execution(ident, ident_fin, interrompu or '', reseau.requetes, res['nouvelles_affaires'])
        if not partagee and ch['sauvegardes']:
            chemin_sauvegarde = sauvegarde.sauvegarder(base, ch['sauvegardes'], date=aujourdhui)
            for extra in (chemin_liste,):
                if extra and os.path.exists(extra):
                    import shutil
                    shutil.copy2(extra, os.path.join(ch['sauvegardes'], os.path.basename(extra)))
            etape_ok('sauvegarde', chemin=chemin_sauvegarde)
    except Exception as e:
        etape_ko('sauvegarde', f'{type(e).__name__}: {e}')
    base.fermer()

    if a_blanc:
        lot, propositions_ecrites = (ex or {}).get('lot_prevu', ''), (ex or {}).get('prevues', 0)
    resume = {'type': 'resume', 'moissonneur': NOM, 'contrat': VERSION_CONTRAT,
              'nouvelles_affaires': res['nouvelles_affaires'], 'affaires_modifiees': res['affaires_modifiees'],
              'retenues': par_verdict['retenu'], 'a_relire': par_verdict['a-relire'],     # lignes du lot écrit
              'retenues_classement': comptes.get('retenu', 0), 'a_relire_classement': comptes.get('a-relire', 0),
              'ecartees': comptes.get('ecarte', 0), 'propositions_ecrites': propositions_ecrites, 'lot': lot, 'hors_lot_filtre': hors_lot_filtre,
              'hors_lot_arriere': hors_lot_arriere, 'controle_noms': controle_noms,
              'purge': purge_fait,
              'requetes': reseau.requetes, 'requetes_depuis_cache': reseau.depuis_cache,
              'sources_en_echec': [{'source': c['corps'], 'raison': c['raison']} for c in corps_echecs], 'etapes_en_echec': echecs_etapes, 'interrompu': interrompu,
              'sauvegarde': chemin_sauvegarde, 'liste': chemin_liste, 'base': '' if partagee else ch['base'],
              'duree_s': round(time.time() - t0, 1), 'derniere_moisson': export_propositions.utc_maintenant()}
    if a_blanc:
        resume['a_blanc'] = {'propositions': propositions_ecrites, 'lot': lot}
    else:
        try:
            resume['etat'] = ecrire_etat(config, dict(resume, finesse=bloc_finesse))
        except OSError as e:
            echecs_etapes.append({'etape': 'etat', 'raison': f'{type(e).__name__}: {e}'})
    emit(resume)
    code = 3 if interrompu else (1 if (corps_echecs or echecs_etapes) else 0)
    return resume, code


def _bloquer(config, emit, erreur):
    """Configuration invalide : résumé `interrompu: "configuration"`, etat.json, code 2. Aucune requête n'est partie.

    Si le dossier de `etat.json` est lui-même inaccessible, l'échec part sur stderr (le cockpit n'a alors que le code 2).
    """
    resume = {'type': 'resume', 'moissonneur': NOM, 'contrat': VERSION_CONTRAT, 'interrompu': 'configuration',
              'erreur': erreur, 'requetes': 0, 'sources_en_echec': [], 'etapes_en_echec': []}
    try:
        resume['etat'] = ecrire_etat(config, resume)
    except OSError as e:
        print(f"Arrêt : {erreur} ; etat.json non écrit ({type(e).__name__}: {e})", file=sys.stderr)
    emit(resume)
    return resume, 2


def ecrire_etat(config, resume):
    """`etat.json` à côté des lots : ce que le panneau Propositions affiche en tête de l'onglet. Écrit d'un coup."""
    dossier = config['sortie']['propositions']
    os.makedirs(dossier, exist_ok=True)
    etat = {'format': 'pronto-etat/1', 'moissonneur': NOM, 'contrat': VERSION_CONTRAT,
            'derniere_moisson': resume.get('derniere_moisson') or export_propositions.utc_maintenant(), 'duree_s': resume.get('duree_s'),
            'requetes': resume.get('requetes', 0), 'propositions_ecrites': resume.get('propositions_ecrites', 0),
            'hors_lot_filtre': resume.get('hors_lot_filtre', 0),
            'hors_lot_arriere': resume.get('hors_lot_arriere', 0),
            'controle_noms': resume.get('controle_noms', {'defauts': 0, 'lignes_avec_doute': 0}),
            **resume.get('finesse', {}),
            'purge': resume.get('purge', {'lots': [], 'decisions': []}),
            'lot': os.path.basename(resume.get('lot') or ''), 'nouvelles_affaires': resume.get('nouvelles_affaires', 0),
            'retenues': resume.get('retenues', 0), 'a_relire': resume.get('a_relire', 0),
            'retenues_classement': resume.get('retenues_classement', 0),
            'a_relire_classement': resume.get('a_relire_classement', 0),
            'sources_en_echec': resume.get('sources_en_echec', []), 'etapes_en_echec': resume.get('etapes_en_echec', []),
            'interrompu': resume.get('interrompu'), 'erreur': resume.get('erreur', '')}
    chemin = os.path.join(dossier, 'etat.json')
    tmp = chemin + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(etat, f, ensure_ascii=False, indent=2)
        f.write('\n')
    os.replace(tmp, chemin)
    return chemin


def recalculer_etat(config, lex=None, aujourdhui=None):
    """Recalcule la finesse de `etat.json` (crans, termes) sans toucher au lot ni à la table `propositions`.

    Relit `etat.json`, remplace seulement les champs de la finesse, réécrit d'un coup. Les crans figés d'une autre version de
    la note, ou d'un autre trimestre, sont recalculés ; sinon ils sont relus tels quels."""
    from . import finesse
    lex = lex or lexique.charger()
    ch = _chemins(config)
    chemin = os.path.join(config['sortie']['propositions'], 'etat.json')
    with open(chemin, encoding='utf-8') as f:
        etat = json.load(f)
    base = Base(ch['base'])
    try:
        figes = os.path.join(os.path.dirname(ch['base']) or '.', 'crans.json')
        bloc = finesse.etat(config, base, lex, aujourdhui or time.strftime('%Y-%m-%d'), chemin_figes=figes)
    finally:
        base.fermer()
    for cle in ('crans', 'crans_source', 'crans_calcules_le', 'crans_fenetre', 'cran_defaut', 'termes', 'rappel_sur'):
        etat.pop(cle, None)
    etat.update(bloc)
    tmp = chemin + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(etat, f, ensure_ascii=False, indent=2)
        f.write('\n')
    os.replace(tmp, chemin)
    return chemin
