"""Commandes du moissonneur : python3 -B -m recherche <commande> [options], lancé depuis moissonneurs/. Voir LISEZMOI.md.

Sur la sortie standard, seulement des lignes JSON ; tout message pour une personne part sur la sortie d'erreur.
"""
import argparse
import json
import os
import re
import sys
import tomllib

import creneau
import partage

from . import db, decisions, etat, moisson, propositions, tout
from .moisson import _termine  # noqa: F401  (éprouvé par tests/test_filtre.py)
from .reseau import Reseau

REGLAGES = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'reglages.toml')
NOM = 'recherche'
# Sources hors de la passe mensuelle : le FNS lit un export téléchargé à la main, sur le poste de dev seulement.
HORS_PASSE = ('snf',)

# Options exigées par commande. Sans `--base`, `tout` travaille sur l'état partagé chargé en mémoire.
REQUIS = {
    'tout': ('racine', 'poste', 'compte'),
    'estimer': ('racine',),
    'moissonner': ('base', 'cache'),
    'lister': ('base',),
    'amorcer': ('base', 'racine'),
    'exporter': ('base', 'racine'),
    'migrer': ('base', 'racine'),
    'decisions': ('base', 'racine'),
    'ignorer': ('base',),
    'retablir': ('base',),
    'reactiver': ('base',),
}


def dire(*morceaux):
    print(*morceaux, file=sys.stderr)


def chemin_local(chemin, racine):
    """Chemin utilisable ici : `C:\\…` devient `/mnt/c/…` dans la WSL ; un chemin relatif part de `racine`."""
    if not chemin:
        return chemin
    m = re.match(r'^([A-Za-z]):[\\/](.*)$', chemin)
    if m and os.name != 'nt':
        return '/mnt/' + m.group(1).lower() + '/' + m.group(2).replace('\\', '/')
    if m or os.path.isabs(chemin):
        return chemin
    return os.path.join(racine, chemin)


def construire_config(args, reglages=REGLAGES):
    """reglages.toml, plus les chemins tirés de la ligne de commande. `--racine` est le dossier _NewsUndActu : lots
    et etat.json dans _Moissons/recherche/, décisions dans _Moissons/_Decisions/, bibliothèque dans Fiches/."""
    with open(reglages, 'rb') as f:
        config = tomllib.load(f)
    ici = os.getcwd()
    racine = chemin_local(args.racine or '', ici)
    config.update({
        '_racine': racine,
        'base': chemin_local(args.base or '', ici),
        'cache': chemin_local(args.cache or '', ici),
        'arret': chemin_local(args.arret or '', ici),
        'propositions': os.path.join(racine, '_Moissons', NOM) if racine else '',
        'decisions': os.path.join(racine, '_Moissons', '_Decisions') if racine else '',
        'bibliotheque': os.path.join(racine, 'Fiches') if racine else '',
    })
    if getattr(args, 'vers', None):
        config['propositions'] = os.path.abspath(args.vers)
    config['plafond'] = args.plafond
    sources = config.get('sources', {})
    if args.fichier_snf and 'snf' in sources:
        sources['snf']['fichier_local'] = chemin_local(args.fichier_snf, ici)
    choisies = ([s.strip() for s in args.sources.split(',') if s.strip()] if args.sources
                else [n for n in sources if n not in HORS_PASSE])
    for nom, section in sources.items():
        section['actif'] = bool(section.get('actif', True)) and nom in choisies
    return config


def emit_json(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + '\n')
    sys.stdout.flush()


def cmd_moissonner(config, con, args):
    noms = [args.source] if args.source else moisson.sources_actives(config)
    erreurs = False
    compteurs = {}  # source -> {statut: n}
    reseau = Reseau(config, fichier_arret=config.get('arret'), urls_refusees=db.urls_refusees(con))

    for nom in noms:
        compteurs.setdefault(nom, {})
        reseau.source = nom
        try:
            compteurs[nom] = moisson.moissonner_source(config, con, reseau, nom, site=args.site)
        except Exception as e:      # ce qui a déjà été lu reste en base
            dire(f"erreur pendant le moissonnage de « {nom} » : {type(e).__name__}: {e}")
            erreurs = True

    dire('Nouveaux par source et par statut :')
    for nom, statuts in compteurs.items():
        if not statuts:
            dire(f'  {nom} : rien de nouveau')
            continue
        detail = ', '.join(f'{s}={n}' for s, n in sorted(statuts.items()))
        dire(f'  {nom} : {detail}')

    return 1 if erreurs else 0


def cmd_lister(config, con, args):
    lignes = db.lister(con, statut=args.statut, source=args.source)
    if not lignes:
        dire('(rien)')
        return 0
    dire(f"{'id':>5}  {'source':<10}  {'debut':<10}  {'statut':<10}  {'titre':<50}  pertinence")
    for l in lignes:
        titre = (l['title'] or '')[:50]
        dire(f"{l['id']:>5}  {l['source']:<10}  {(l['debut'] or ''):<10}  "
             f"{l['statut']:<10}  {titre:<50}  {l['pertinence'] or ''}")
    return 0


def cmd_amorcer(config, con, args):
    """Passe en `existant` les projets `nouveau` déjà en fiche dans la bibliothèque (lien, puis titre rapproché)."""
    index = propositions.index_bibliotheque(config['bibliotheque'])
    surs, probables = [], []
    for ligne in db.lister(con, statut='nouveau'):
        fiche, niveau = db.chercher_dans_index(index, ligne['cle'], ligne['url'])
        if niveau:
            (surs if niveau == 'sur' else probables).append((ligne, fiche))
    for ligne, _ in surs:
        db.changer_statut(con, ligne['id'], 'existant')
    con.commit()
    dire(f'{len(surs)} rapprochement(s) sûr(s) -> existant :')
    for ligne, fiche in surs:
        dire(f"  #{ligne['id']:<5} {ligne['title']!r} -> {fiche['slug']}")
    dire(f'{len(probables)} rapprochement(s) probable(s) (statut inchangé ; l\'export les marque `doublon` probable) :')
    for ligne, fiche in probables:
        dire(f"  #{ligne['id']:<5} {ligne['title']!r} ~ {fiche['title']!r} ({fiche['slug']})")
    return 0


def cmd_exporter(config, con, args):
    """Écrit un lot de propositions des projets `nouveau` (aucun lot s'il n'y a rien)."""
    r = propositions.exporter(config, con)
    dire(f"{r['ecrites']} proposition(s) dans {r['lot'] or '(aucun lot : rien à proposer)'}")
    dire(f"par source : {r['par_source']} ; par verdict : {r['par_verdict']}")
    dire(f"doutes : {r['doutes']}")
    dire(f"déjà en bibliothèque : {r['existants']} ; rattachés à une proposition : {r['rattaches']} ; "
         f"décidés : {r['decidees']} ; migration : {r['migration']}")
    for cle, raison in r['ecartees']:
        dire(f'  écartée {cle} : {raison}')
    return 0


def cmd_migrer(config, con, args):
    """Migration des bases d'avant les propositions : `exporte` absents de la bibliothèque -> `nouveau`."""
    dire(db.migrer_exportes(con, propositions.index_bibliotheque(config['bibliotheque'])))
    return 0


def cmd_decisions(config, con, args):
    """Relit les décisions de la rédaction et affiche le bilan des motifs."""
    decisions.appliquer(config.get('decisions'), con)
    dire(decisions.bilan(con))
    return 0


def cmd_estimer(config, con, args):
    emit_json(tout.estimer(config))
    return 0


def cmd_tout(config, con, args):
    ouvrir = publier = borne = None
    if not args.base:      # la passe mensuelle : l'état partagé, chargé en mémoire, puis publié en différentiel
        racine, poste = config['_racine'], partage.cle_poste(args.poste, args.compte)

        def ouvrir():
            return etat.charger_etat(racine)

        def publier(delta):
            etat.publier_journal(racine, poste, delta)
        if not args.hors_ligne:
            borne = partage.budget_partage(racine, NOM, args.poste, args.compte, int(config.get('budget', 0) or 0),
                                           creneau.MARGE_REQUETES, args.plafond)
    _, code = tout.tout(config, emit_json, hors_ligne=args.hors_ligne, a_blanc=args.a_blanc, ouvrir=ouvrir,
                        publier=publier, borne=borne)
    return code


def cmd_ignorer(config, con, args):
    for i in args.ids:
        if db.par_id(con, i) is None:
            dire(f'#{i} introuvable')
            continue
        db.changer_statut(con, i, 'ignore')
    con.commit()
    return 0


def cmd_retablir(config, con, args):
    for i in args.ids:
        if db.par_id(con, i) is None:
            dire(f'#{i} introuvable')
            continue
        db.changer_statut(con, i, 'nouveau')
    con.commit()
    return 0


def cmd_reactiver(config, con, args):
    """Réactive une source désactivée après deux passes en 403 (site:phsg, skbf…), ou une page refusée (son adresse)."""
    if not db.reactiver(con, args.cible):
        dire(f'{args.cible} : ni source désactivée ni page refusée')
        return 1
    con.commit()
    dire(f'{args.cible} réactivé')
    return 0


def construire_analyseur():
    commun = argparse.ArgumentParser(add_help=False)
    commun.add_argument('--racine', help='dossier _NewsUndActu de la racine active')
    commun.add_argument('--poste', help='nom du poste qui moissonne')
    commun.add_argument('--compte', help='compte qui moissonne')
    commun.add_argument('--arret', help='fichier local de demande d\'arrêt, vu avant chaque requête')
    commun.add_argument('--cache', help='dossier local du cache HTTP')
    commun.add_argument('--plafond', type=int, help='requêtes au plus pour cette exécution (interrompu « budget »)')
    commun.add_argument('--sources', help='sources à moissonner, séparées par des virgules (défaut : toutes sauf snf)')
    commun.add_argument('--base', help='base SQLite locale (poste de dev) à la place de l\'état partagé')
    commun.add_argument('--fichier-snf', help='export FNS téléchargé à la main (poste de dev)')

    p = argparse.ArgumentParser(prog='python3 -B -m recherche',
                                description='Moissonneur de projets de recherche (veille CSPS)')
    sous = p.add_subparsers(dest='commande', required=True)

    sp = sous.add_parser('moissonner', parents=[commun], help='interroge les sources, filtre, enregistre')
    sp.add_argument('--source', help='une seule source (snf, skbf, sites)')
    sp.add_argument('--site', help='un seul site (pour --source sites)')
    sp.set_defaults(func=cmd_moissonner)

    sp = sous.add_parser('lister', parents=[commun], help='tableau des projets en base')
    sp.add_argument('--statut', choices=db.STATUTS)
    sp.add_argument('--source')
    sp.set_defaults(func=cmd_lister)

    sp = sous.add_parser('amorcer', parents=[commun], help='rapproche avec la bibliothèque existante')
    sp.set_defaults(func=cmd_amorcer)

    sp = sous.add_parser('exporter', parents=[commun], help='écrit un lot de propositions des projets nouveaux')
    sp.add_argument('--vers', help='dossier des lots (défaut : _Moissons/recherche/ de la racine)')
    sp.set_defaults(func=cmd_exporter)

    sp = sous.add_parser('migrer', parents=[commun],
                         help='repasse en nouveau les anciens « exporte » absents de la bibliothèque')
    sp.set_defaults(func=cmd_migrer)

    sp = sous.add_parser('decisions', parents=[commun], help='relit les décisions de la rédaction, bilan des motifs')
    sp.set_defaults(func=cmd_decisions)

    sp = sous.add_parser('estimer', parents=[commun],
                         help='plan de la prochaine exécution, en JSON, sans requête ni écriture')
    sp.set_defaults(func=cmd_estimer, sans_base=True)

    sp = sous.add_parser('tout', parents=[commun], help='moisson, lot, purge et etat.json ; une ligne JSON par évènement')
    sp.add_argument('--hors-ligne', action='store_true', help='aucune source appelée : lot, purge et etat.json seulement')
    sp.add_argument('--a-blanc', action='store_true',
                    help='tout, sauf écrire le lot, etat.json et le journal, et purger ; le résumé dit ce qui aurait été fait')
    sp.set_defaults(func=cmd_tout, sans_base=True)

    sp = sous.add_parser('ignorer', parents=[commun], help='marque des projets comme ignorés')
    sp.add_argument('ids', type=int, nargs='+')
    sp.set_defaults(func=cmd_ignorer)

    sp = sous.add_parser('retablir', parents=[commun], help='remet des projets en statut nouveau')
    sp.add_argument('ids', type=int, nargs='+')
    sp.set_defaults(func=cmd_retablir)

    sp = sous.add_parser('reactiver', parents=[commun],
                         help='réactive une source désactivée (site:phsg, skbf…) ou une page refusée (son adresse)')
    sp.add_argument('cible')
    sp.set_defaults(func=cmd_reactiver)

    return p


def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass  # flux déjà remplacés (tests) ou plateforme qui ne le permet pas

    analyseur = construire_analyseur()
    args = analyseur.parse_args(argv)
    manquants = [o for o in REQUIS[args.commande] if not getattr(args, o)]
    if args.commande == 'tout' and not args.hors_ligne and not args.cache:
        manquants.append('cache')
    if manquants:
        dire(f"{args.commande} : option(s) manquante(s) : {', '.join('--' + o for o in manquants)}")
        return 2
    try:
        config = construire_config(args)
    except Exception as e:
        dire(f'réglages illisibles : {e}')
        return 2
    if config['_racine'] and not os.path.isdir(config['_racine']):
        dire(f"racine absente : {config['_racine']}")
        return 2

    if getattr(args, 'sans_base', False):     # estimer n'écrit rien ; tout ouvre la base lui-même
        return args.func(config, None, args)
    con = db.connecter(config['base'])
    try:
        return args.func(config, con, args)
    except propositions.ConfigurationInvalide as e:
        dire(f'configuration invalide : {e}')
        return 2
    finally:
        con.close()
