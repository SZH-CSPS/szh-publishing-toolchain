"""Commandes du moissonneur : python3 -B -m parlement <commande> [options], lancé depuis moissonneurs/. Voir LISEZMOI.md.

`tout` et `estimer` servent la passe mensuelle (état partagé chargé en mémoire) ; avec `--base`, le poste de
développement travaille sur sa base SQLite. Sur la sortie standard, seulement des lignes JSON.
"""
import argparse
import datetime
import json
import os
import re
import sys
import tomllib

import creneau
import partage

from . import classement, etat, lexique, liste, sauvegarde, tout
from .reseau import Acces403
from .stockage import Base

ICI = os.path.dirname(os.path.abspath(__file__))
REGLAGES = os.path.join(ICI, 'reglages.toml')
# Le contrat des champs, livré avec le toolkit à côté de moissonneurs/.
CONTRAT = os.path.join(os.path.dirname(os.path.dirname(ICI)), 'pipeline', 'kirby', 'champs-documentation.json')
NOM = 'parlement'

REQUIS = {
    'tout': ('racine', 'poste', 'compte'),
    'estimer': ('racine',),
    'importer': ('base',),
    'classer': ('base',),
    'lister': ('base',),
    'absorber': ('base', 'racine'),
    'publier': ('base', 'racine', 'poste', 'compte'),
    'sauvegarder': ('base',),
}


def dire(*morceaux):
    print(*morceaux, file=sys.stderr)


def emit_json(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + '\n')
    sys.stdout.flush()


def chemin_local(chemin):
    """`C:\\…` devient `/mnt/c/…` dans la WSL ; un chemin relatif devient absolu."""
    if not chemin:
        return chemin
    m = re.match(r'^([A-Za-z]):[\\/](.*)$', chemin)
    if m and os.name != 'nt':
        return '/mnt/' + m.group(1).lower() + '/' + m.group(2).replace('\\', '/')
    return chemin if (m or os.path.isabs(chemin)) else os.path.abspath(chemin)


def construire_config(args, reglages=REGLAGES):
    """reglages.toml, plus les chemins tirés de la ligne de commande, dans la forme que les briques attendent."""
    with open(reglages, 'rb') as f:
        cfg = tomllib.load(f)
    racine = chemin_local(args.racine or '')
    base = chemin_local(getattr(args, 'base', None) or '')
    cache = chemin_local(getattr(args, 'cache', None) or '')
    local = os.path.dirname(base) if base else (cache or os.path.join('/tmp', 'pronto-moisson', 'parlement'))
    cfg['_racine'] = racine
    cfg['reseau'].update({'cache': cache, 'journal': os.path.join(cache, 'requetes.jsonl') if cache else '',
                          'arret': chemin_local(getattr(args, 'arret', None) or '')})
    cfg['stockage'] = {'base': base or ':memory:'}
    cfg['sortie'] = {'dossier': local, 'sauvegardes': os.path.join(local, 'sauvegardes') if base else '',
                     'propositions': os.path.join(racine, '_Moissons', NOM) if racine else os.path.join(local, NOM),
                     'decisions': os.path.join(racine, '_Moissons', '_Decisions') if racine else ''}
    cfg['bibliotheque'] = {'fiches': os.path.join(racine, 'Fiches') if racine else '', 'contrat': CONTRAT}
    cfg.setdefault('exports', {})['dossier'] = os.path.join(local, 'exports')
    cfg.setdefault('mensuelle', {})['plafond'] = getattr(args, 'plafond', None)
    if base:        # au poste de développement, l'API ne sert jamais : seule la passe mensuelle compte son budget
        cfg['mensuelle']['active'] = False
    return cfg


def cmd_tout(cfg, args):
    ouvrir = publier = None
    if not args.base:      # la passe mensuelle : l'état partagé, chargé en mémoire, puis publié au journal du poste
        racine, poste = cfg['_racine'], partage.cle_poste(args.poste, args.compte)

        def ouvrir():
            return etat.charger(racine)

        def publier(delta):
            etat.publier_journal(racine, poste, delta)
    _, code = tout.tout(cfg, emit_json, hors_ligne=args.hors_ligne, a_blanc=args.a_blanc, ouvrir=ouvrir,
                        publier=publier)
    return code


def cmd_estimer(cfg, args):
    base = None
    if not args.base:
        try:
            base = etat.charger(cfg['_racine'])
        except etat.EtatAbsent as e:
            plan = tout.estimer(cfg)
            plan.update(pret=False, avertissements=plan['avertissements'] + [f'état partagé absent : {e}'])
            emit_json(plan)
            return 0
    try:
        emit_json(tout.estimer(cfg, base=base))
    finally:
        if base is not None:
            base.fermer()
    return 0


def cmd_importer(cfg, args):
    """Import de base par les exports de files.openparldata.ch : aucune requête vers l'API."""
    from . import importer
    from .sources import exports
    e = cfg['exports']
    tel = exports.Telechargeur(e['dossier'], base_url=e.get('base_url', exports.BASE_URL), delai=float(e.get('delai', 5.0)))
    base = Base(cfg['stockage']['base'])
    try:
        resume = importer.importer(cfg, base, tel, lexique.charger(), depuis=args.depuis, corps=args.corps or None,
                                   emit=emit_json)
        dire('candidates par le titre :', resume['candidates_titre'])
    finally:
        base.fermer()
    emit_json({'type': 'import', 'fichiers': tel.fichiers, 'octets': tel.octets, 'corps': resume['corps']})
    return 0


def cmd_classer(cfg, args):
    base = Base(cfg['stockage']['base'])
    try:
        dire(classement.classer_base(cfg, base, lexique.charger()))
    finally:
        base.fermer()
    return 0


def cmd_lister(cfg, args):
    base = Base(cfg['stockage']['base'])
    try:
        chemin, n = liste.ecrire(cfg, base, args.mois or '')
    finally:
        base.fermer()
    dire(chemin, n, 'ligne(s)')
    return 0


def cmd_absorber(cfg, args):
    """Relit l'état partagé dans la base du poste de dev : à faire avant toute opération lourde."""
    base = Base(cfg['stockage']['base'])
    try:
        _, journaux, reprises = etat.absorber(base, cfg['_racine'])
    finally:
        base.fermer()
    emit_json({'type': 'absorption', 'journaux': len(journaux), 'lignes': reprises})
    return 0


def cmd_publier(cfg, args):
    """Publie le socle : relit le partagé, fige ce que la passe mensuelle ne peut pas recalculer, écrit sous créneau."""
    racine = cfg['_racine']
    c = creneau.Creneau(creneau.DossierCreneau(os.path.join(racine, '_Moissons', creneau.DOSSIER)), args.poste,
                        args.compte, 'cli', [NOM], attente_s=args.attente_creneau)
    try:
        annonce = c.prendre()
    except creneau.Occupe as o:
        dire(f"créneau tenu par {o.autre.get('poste')} ({o.autre.get('compte')}) depuis {o.autre.get('debut')}")
        return 4
    base = Base(cfg['stockage']['base'])
    try:
        try:
            etat.absorber(base, racine)
        except etat.EtatAbsent:
            dire('aucun socle publié : premier socle')
        lex = lexique.charger()
        jour = datetime.date.today().isoformat()
        etat.figer(base, cfg, lex)
        etat.figer_valeurs(base, cfg, lex, jour, chemin_crans=os.path.join(os.path.dirname(cfg['stockage']['base']),
                                                                         'crans.json'))
        tables = etat.tables_du_socle(base)
        chemin = partage.publier_socle(racine, NOM, args.poste, args.compte, tables, etat.absorbes(base), annonce)
    finally:
        base.fermer()
        c.retirer()
    emit_json({'type': 'socle', 'chemin': chemin, 'octets': os.path.getsize(chemin),
               'tables': {t: len(l) for t, l in tables.items()}})
    return 0


def cmd_sauvegarder(cfg, args):
    base = Base(cfg['stockage']['base'])
    try:
        dire(sauvegarde.sauvegarder(base, cfg['sortie']['sauvegardes']))
    finally:
        base.fermer()
    return 0


def construire_analyseur():
    commun = argparse.ArgumentParser(add_help=False)
    commun.add_argument('--racine', help='dossier _NewsUndActu de la racine active')
    commun.add_argument('--poste', help='nom du poste qui moissonne')
    commun.add_argument('--compte', help='compte qui moissonne')
    commun.add_argument('--arret', help="fichier local de demande d'arrêt, vu avant chaque requête")
    commun.add_argument('--cache', help='dossier local du cache HTTP')
    commun.add_argument('--plafond', type=int, help='requêtes au plus pour cette exécution (interrompu « budget »)')
    commun.add_argument('--base', help="base SQLite locale (poste de développement) à la place de l'état partagé")

    p = argparse.ArgumentParser(prog='python3 -B -m parlement',
                                description='Moissonneur des interventions parlementaires (OpenParlData.ch)')
    sous = p.add_subparsers(dest='commande', required=True)
    sp = sous.add_parser('tout', parents=[commun], help='moisson, lot, purge et etat.json ; une ligne JSON par évènement')
    sp.add_argument('--hors-ligne', action='store_true', help='aucune requête : lot, purge et etat.json seulement')
    sp.add_argument('--a-blanc', action='store_true',
                    help='tout, sauf écrire le lot, etat.json et le journal, et purger ; le résumé dit ce qui aurait été fait')
    sp.set_defaults(func=cmd_tout)
    sp = sous.add_parser('estimer', parents=[commun], help='plan de la prochaine passe, en JSON, sans requête ni écriture')
    sp.set_defaults(func=cmd_estimer)
    sp = sous.add_parser('importer', parents=[commun], help="poste de dev : import par les exports (aucune requête à l'API)")
    sp.add_argument('--corps', nargs='*', help='limiter à ces body_key')
    sp.add_argument('--depuis', help='date de dépôt minimale (défaut : [moisson] depuis)')
    sp.set_defaults(func=cmd_importer)
    sp = sous.add_parser('classer', parents=[commun], help='poste de dev : reclasse toutes les candidates')
    sp.set_defaults(func=cmd_classer)
    sp = sous.add_parser('lister', parents=[commun], help='poste de dev : liste Markdown')
    sp.add_argument('--mois', help='AAAA-MM (date de dépôt)')
    sp.set_defaults(func=cmd_lister)
    sp = sous.add_parser('absorber', parents=[commun], help="poste de dev : relit l'état partagé dans la base")
    sp.set_defaults(func=cmd_absorber)
    sp = sous.add_parser('publier', parents=[commun], help='poste de dev : publie le socle, sous créneau')
    sp.add_argument('--attente-creneau', type=float, default=creneau.ATTENTE_S)
    sp.set_defaults(func=cmd_publier)
    sp = sous.add_parser('sauvegarder', parents=[commun], help='poste de dev : sauvegarde compressée de la base')
    sp.set_defaults(func=cmd_sauvegarder)
    return p


def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass  # flux déjà remplacés (tests) ou plateforme qui ne le permet pas
    args = construire_analyseur().parse_args(argv)
    for absent in ('hors_ligne', 'a_blanc'):
        setattr(args, absent, getattr(args, absent, False))
    manquants = [o for o in REQUIS[args.commande] if not getattr(args, o)]
    if args.commande == 'tout' and not args.hors_ligne and not args.cache:
        manquants.append('cache')
    if manquants:
        dire(f"{args.commande} : option(s) manquante(s) : {', '.join('--' + o for o in manquants)}")
        return 2
    try:
        cfg = construire_config(args)
    except Exception as e:
        dire(f'réglages illisibles : {e}')
        return 2
    if cfg['_racine'] and not os.path.isdir(cfg['_racine']):
        dire(f"racine absente : {cfg['_racine']}")
        return 2
    try:
        return args.func(cfg, args)
    except Acces403 as e:
        dire('Arrêt : le serveur répond 403 ;', e)
        return 3
