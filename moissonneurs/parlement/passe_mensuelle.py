"""Passe mensuelle incrémentale par l'API /v1/, depuis le repère de chaque corps.

L'import de base passe par les exports (`importer.py`) ; l'API ne sert qu'à rattraper le mois : pages de liste par corps
jusqu'au repère, recherche ciblée des termes pour la Confédération depuis son repère, documents des nouvelles
candidates. Délai de 2 s entre deux requêtes, budget de 800 requêtes PAR MOIS (compté sur toutes les passes du mois),
arrêt net au plafond, reprise au repère à la passe suivante. Aucun corps sans repère n'est moissonné par l'API : les
corps jamais importés (les villes notamment) ne passent jamais en masse par /v1/.
"""
import time

from . import criblage, moisson
from .reseau import ArretDemande, BudgetEpuise, Reseau

BUDGET_MENSUEL = 800
DELAI = 2.0


def mois_de(aujourdhui=None):
    return (aujourdhui or time.strftime('%Y-%m-%d'))[:7]


def requetes_du_mois(base, mois):
    r = base.c.execute("SELECT COALESCE(SUM(requetes), 0) FROM executions WHERE commande='mensuelle' AND debut LIKE ?",
                       (mois + '%',)).fetchone()
    return int(r[0])


def reseau_mensuel(config, base, aujourdhui=None, plafond_execution=None, **kw):
    """(Reseau, requêtes restantes ce mois-ci). Requêtes anonymes (aucun User-Agent), délai de 2 s.

    plafond_execution borne cette seule exécution (essai) ; ce qu'elle dépense compte dans le mois. Dans une passe
    lancée par moisson.py, `[mensuelle] plafond` vient de --plafond : le budget du mois est sommé sur tous les postes.
    """
    m = config.get('mensuelle', {})
    plafond = int(m.get('budget', BUDGET_MENSUEL))
    if m.get('plafond') is not None:
        restant = max(int(m['plafond']), 0)
    else:
        restant = max(plafond - requetes_du_mois(base, mois_de(aujourdhui)), 0)
    cfg = dict(config['reseau'])
    cfg['delai'] = float(m.get('delai', DELAI))
    cfg['budget'] = restant if plafond_execution is None else min(restant, int(plafond_execution))
    return Reseau(cfg, **kw), restant


def ordre_des_corps(config, base):
    """Du plus petit corps au plus gros (nombre d'affaires en base) : un essai borné touche plusieurs corps, pas seulement la tête CHE."""
    n = base.compte_affaires_par_corps()
    return sorted(moisson.corps_suivis(config, base), key=lambda c: (n.get(c, 0), c))


def passe(config, base, reseau, source, lex, aujourdhui=None, corps=None, progression=None):
    """Une passe. Rend {statut, requetes, corps, sans_repere, sans_date, recherche, textes}. `corps` : essai sur ces corps seuls (ni recherche ni textes).

    `statut` vaut `ok`, `plafond` (budget) ou `arret` (demande d'arrêt). `progression(objet)` reçoit une ligne par corps, par
    terme cherché et par texte récupéré, avec les requêtes faites ; celle d'un corps porte `point` (l'appelant peut y
    publier ce qui est acquis)."""
    progression = progression or (lambda objet: None)
    mois = mois_de(aujourdhui)
    rapport = {'statut': 'ok', 'requetes': 0, 'corps': {}, 'sans_repere': [], 'sans_date': 0, 'recherche': 0, 'textes': 0}
    if reseau.budget <= 0:
        rapport['statut'] = 'plafond'
        return rapport
    ident = base.debuter_execution('mensuelle')
    avant = reseau.requetes
    nouveautes = 0
    try:
        for c in (corps or ordre_des_corps(config, base)):
            if base.repere(c) is None:
                rapport['sans_repere'].append(c)
                continue
            statut, raison, comptes = moisson.moissonner_corps_depot(config, base, reseau, source, c)
            rapport['corps'][c] = {'statut': statut, 'nouvelles': comptes['nouvelles'], 'pages': comptes['pages'],
                                   'sans_date': comptes['sans_date'], 'sans_date_plafonne': comptes['sans_date_plafonne']}
            nouveautes += comptes['nouvelles']
            rapport['sans_date'] += comptes['sans_date']
            progression({'etape': 'moisson', 'corps': c, 'statut': statut, 'nouvelles': comptes['nouvelles'],
                         'requetes': reseau.requetes - avant, 'point': True})
        if corps:                                  # essai borné : ni recherche de la Confédération ni textes
            return rapport
        che = config['moisson']['confederation']
        repere_che = moisson.repere_depot(base, che) or base.repere(che)
        if repere_che and base.repere(che):
            debut_mois = mois + '-01'
            faits = {(r['terme'], r['langue']) for r in base.c.execute(
                'SELECT terme, langue FROM criblages WHERE fait_le >= ?', (debut_mois,))}
            a_faire = [t for t in criblage.termes_de_recherche(lex) if t not in faits]
            lignes = criblage.cribler(config, base, reseau, source, lex, termes=a_faire, rejouer=True, suivis=[che],
                                      depuis=repere_che[:10], cache=False,
                                      progression=lambda l: progression({'etape': 'recherche', 'source': f"{l['terme']} ({l['langue']})",
                                                                         'statut': 'ok', 'requetes': reseau.requetes - avant}))
            rapport['recherche'] = len(lignes)
        criblage.candidats_par_titre(config, base, lex)
        rapport['textes'] = criblage.recuperer_textes(config, base, reseau, source, progression=lambda x: progression(
            {'etape': 'textes', 'statut': 'ok', 'requetes': reseau.requetes - avant}))['faits']
    except BudgetEpuise as e:
        rapport['statut'] = 'arret' if isinstance(e, ArretDemande) else 'plafond'   # arrêt net ; reprise au repère
    finally:
        rapport['requetes'] = reseau.requetes - avant
        base.terminer_execution(ident, 'ok' if rapport['statut'] == 'ok' else 'budget', '', rapport['requetes'], nouveautes)
        base.commit()
    return rapport


def compteur(config, base, aujourdhui=None):
    """Requêtes du mois face au budget, et les dernières exécutions de la passe (contrôle du poste de développement)."""
    mois = mois_de(aujourdhui)
    budget = int(config.get('mensuelle', {}).get('budget', BUDGET_MENSUEL))
    n = requetes_du_mois(base, mois)
    dernieres = [{'debut': r['debut'], 'requetes': r['requetes'], 'statut': r['statut']} for r in base.c.execute(
        "SELECT debut, requetes, statut FROM executions WHERE commande='mensuelle' ORDER BY debut DESC LIMIT 5")]
    return {'mois': mois, 'requetes': n, 'budget': budget, 'restant': max(budget - n, 0), 'dernieres': dernieres}
