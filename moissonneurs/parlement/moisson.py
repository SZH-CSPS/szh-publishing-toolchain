"""Orchestration par corps : un canton qui échoue est journalisé, les autres continuent."""
from .reseau import Acces403, BudgetEpuise


def corps_suivis(config, base=None):
    """body_key à moissonner : Confédération, cantons, puis villes dont la clé est renseignée.

    Les corps dont la dernière exécution a échoué passent en tête : la moisson les reprend.
    """
    m = config['moisson']
    liste = [m['confederation']] + list(m['cantons'])
    liste += [v['cle'] for v in config.get('villes', {}).get('suivies', []) if v.get('cle')]
    if base is not None:
        echecs = [c for c in base.corps_en_echec() if c in liste]
        liste = echecs + [c for c in liste if c not in echecs]
    return liste


def moissonner_corps(config, base, reseau, source, corps, approfondir=False):
    """Moissonne un corps. Rend (statut, raison, comptes). Ne lève que Acces403 et BudgetEpuise."""
    ident = base.debuter_execution('moissonner', corps)
    avant = reseau.requetes
    comptes = {'nouvelles': 0, 'changees': 0, 'inchangees': 0}
    etat = {}
    repere_connu = base.repere(corps)
    repere = None if approfondir else repere_connu     # approfondir : moisson initiale rejouée (pages en cache)
    try:
        for affaire in source.moissonner(config, reseau, base.connus(corps), corps=corps,
                                         repere=repere, depuis=config['moisson']['depuis'], etat=etat):
            comptes[{'nouvelle': 'nouvelles', 'changee': 'changees',
                     'inchangee': 'inchangees'}[base.enregistrer_affaire(affaire)]] += 1
        if etat.get("max_updated") and etat["max_updated"] > (repere_connu or ""):
            base.poser_repere(corps, etat['max_updated'])
        base.terminer_execution(ident, 'ok', '', reseau.requetes - avant, comptes['nouvelles'])
        return 'ok', '', comptes
    except BudgetEpuise as e:
        base.terminer_execution(ident, 'budget', str(e), reseau.requetes - avant, comptes['nouvelles'])
        raise
    except Acces403 as e:
        base.terminer_execution(ident, 'echec', f'403 : {e}', reseau.requetes - avant, comptes['nouvelles'])
        raise
    except Exception as e:  # réseau, format inattendu : le corps échoue, pas la moisson
        raison = f'{type(e).__name__}: {e}'
        base.terminer_execution(ident, 'echec', raison, reseau.requetes - avant, comptes['nouvelles'])
        return 'echec', raison, comptes
    finally:
        base.commit()


def moissonner_tous(config, base, reseau, source, corps=None, approfondir=False):
    """Boucle sur les corps. Rend (rapport, arret) ; arret = None | 'budget' | '403'."""
    rapport = []
    for c in (corps or corps_suivis(config, base)):
        try:
            statut, raison, comptes = moissonner_corps(config, base, reseau, source, c, approfondir)
        except BudgetEpuise:
            rapport.append((c, 'budget', 'budget atteint', {}))
            return rapport, 'budget'
        except Acces403:
            rapport.append((c, 'echec', '403', {}))
            return rapport, '403'
        rapport.append((c, statut, raison, comptes))
    return rapport, None


def repere_depot(base, corps):
    """Plus grande date de dépôt connue en base pour ce corps (jamais updated_at, rafraîchi en bloc par la source)."""
    r = base.c.execute("""SELECT MAX(d) FROM (SELECT date_depot d FROM affaires WHERE body_key=? UNION ALL
                          SELECT date_depot FROM connues WHERE body_key=?) WHERE d != ''""", (corps, corps)).fetchone()
    return r[0] if r and r[0] else None


def moissonner_corps_depot(config, base, reseau, source, corps):
    """Passe mensuelle d'un corps, par date de dépôt (source.moissonner_depot). Rend (statut, raison, comptes).

    Les changements d'état des affaires déjà connues ne passent plus par l'API : le prochain `importer` (exports) les reprend,
    de même qu'une affaire enregistrée en retard avec un dépôt antérieur au repère."""
    ident = base.debuter_execution('moissonner', corps)
    avant = reseau.requetes
    comptes = {'nouvelles': 0, 'changees': 0, 'inchangees': 0, 'sans_date': 0, 'sans_date_plafonne': False, 'pages': 0}
    etat = {}
    try:
        for affaire in source.moissonner_depot(config, reseau, base.connus(corps), corps, repere_depot(base, corps), etat):
            if base.enregistrer_affaire(affaire) == 'nouvelle':
                comptes['nouvelles'] += 1
        comptes.update({k: etat.get(k, comptes[k]) for k in ('sans_date', 'sans_date_plafonne', 'pages')})
        base.terminer_execution(ident, 'ok', '', reseau.requetes - avant, comptes['nouvelles'])
        return 'ok', '', comptes
    except BudgetEpuise as e:
        base.terminer_execution(ident, 'budget', str(e), reseau.requetes - avant, comptes['nouvelles'])
        raise
    except Acces403 as e:
        base.terminer_execution(ident, 'echec', f'403 : {e}', reseau.requetes - avant, comptes['nouvelles'])
        raise
    except Exception as e:
        raison = f'{type(e).__name__}: {e}'
        base.terminer_execution(ident, 'echec', raison, reseau.requetes - avant, comptes['nouvelles'])
        return 'echec', raison, comptes
    finally:
        base.commit()
