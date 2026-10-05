"""Orchestration de moisson.py contre de faux moissonneurs, en sous-processus."""
import datetime
import io
import json
import os
import signal
import unittest

import creneau
import evenements as ev
import moisson
from tests import outils
from tests.outils import Arbre, de_type, evenements, option, scenario_simple


def mois_courant():
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m')


def ecrire_compteur(a, m, cle, n, mois=None):
    d = a.chemin(m, '_partage', 'requetes', mois or mois_courant())
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, cle + '.json'), 'w', encoding='utf-8') as f:
        json.dump({'format': 'pronto-requetes/1', 'mois': mois or mois_courant(), 'requetes': n,
                   'maj': '2026-11-01T06:00:00Z'}, f)


def lire_compteur(a, m, cle):
    with open(a.chemin(m, '_partage', 'requetes', mois_courant(), cle + '.json'), encoding='utf-8') as f:
        return json.load(f)


class AvecArbre(unittest.TestCase):
    def arbre(self, scenarios, **kw):
        a = Arbre(scenarios, **kw)
        self.addCleanup(a.effacer)
        return a

    def json_pur(self, stdout):
        for l in stdout.splitlines():
            e = json.loads(l)
            self.assertEqual(ev.valider(e), [], e)
        return evenements(stdout)


class Orchestration(AvecArbre):
    def test_deux_moissonneurs_l_un_apres_l_autre(self):
        a = self.arbre({'parlement': scenario_simple('parlement'), 'recherche': scenario_simple('recherche')})
        p = a.lancer('mensuelle', *a.poste(), '--evenements', 'json')
        self.assertEqual(p.returncode, 0, p.stderr)
        evts = self.json_pur(p.stdout)
        self.assertEqual([e['etat'] for e in de_type(evts, 'creneau')], ['pris', 'retire'])
        debut, = de_type(evts, 'debut')
        self.assertEqual(debut['moissonneurs'], ['parlement', 'recherche'])
        self.assertEqual(debut['estimation']['recherche'], {'requetes': 20, 'delai_s': 2.0, 'budget': 800})
        self.assertEqual(debut['budget_mois']['parlement'],
                         {'budget': 800, 'marge': creneau.MARGE_REQUETES, 'somme': 0,
                          'plafond': 800 - creneau.MARGE_REQUETES})
        self.assertIs(debut['racine_test'], False)
        self.assertEqual(evts[-1]['type'], 'fin')
        fins = de_type(evts, 'moissonneur_fin')
        self.assertEqual([f['moissonneur'] for f in fins], ['parlement', 'recherche'])
        self.assertEqual([l['chemin'] for l in de_type(evts, 'lot')],
                         ['parlement/2026-11-01-1.jsonl', 'recherche/2026-11-01-1.jsonl'])
        ordre = [e['moissonneur'] for e in evts if e['type'] == 'etape']
        self.assertEqual(ordre, sorted(ordre))
        self.assertEqual(a.creneaux(), [])

    def test_options_transmises(self):
        a = self.arbre({'recherche': scenario_simple('recherche')})
        p = a.lancer('tout', 'recherche', *a.poste('Poste A', 'Compte.B'), '--a-blanc', '--racine-test')
        self.assertEqual(p.returncode, 0, p.stderr)
        argv = a.argv_enfant('recherche')
        self.assertEqual(argv[0], 'tout')
        self.assertIn('--a-blanc', argv)
        self.assertNotIn('--hors-ligne', argv)
        self.assertEqual(option(argv, '--racine'), a.racine)
        self.assertEqual(option(argv, '--poste'), 'Poste A')
        self.assertEqual(option(argv, '--compte'), 'Compte.B')
        self.assertEqual(option(argv, '--plafond'), str(800 - creneau.MARGE_REQUETES))
        arret, cache = option(argv, '--arret'), option(argv, '--cache')
        self.assertEqual(os.path.dirname(arret), os.path.dirname(cache))
        self.assertTrue(arret.startswith(moisson.DOSSIER_LOCAL))
        self.assertFalse(os.path.exists(os.path.dirname(arret)))       # le dossier de passe est jetable
        evts = evenements(p.stdout)
        self.assertEqual(de_type(evts, 'lot'), [])                       # à blanc : aucun lot déposé
        self.assertIs(de_type(evts, 'debut')[0]['racine_test'], True)

    def test_hors_ligne_sans_plafond_ni_compteur(self):
        a = self.arbre({'recherche': scenario_simple('recherche')})
        ecrire_compteur(a, 'recherche', 'poste-b__compte-b', 10_000)        # épuisé, mais hors ligne
        p = a.lancer('tout', 'recherche', *a.poste(), '--hors-ligne')
        self.assertEqual(p.returncode, 0, p.stdout)
        argv = a.argv_enfant('recherche')
        self.assertIn('--hors-ligne', argv)
        self.assertNotIn('--plafond', argv)
        self.assertEqual(os.listdir(a.chemin('recherche', '_partage', 'requetes', mois_courant())),
                         ['poste-b__compte-b.json'])

    def test_seulement(self):
        a = self.arbre({'parlement': scenario_simple('parlement'), 'recherche': scenario_simple('recherche')})
        p = a.lancer('mensuelle', '--seulement', 'recherche', *a.poste())
        self.assertEqual(de_type(evenements(p.stdout), 'debut')[0]['moissonneurs'], ['recherche'])
        self.assertFalse(os.path.exists(a.chemin('parlement', 'argv.json')))

    def test_stderr_de_l_enfant_hors_de_stdout(self):
        sc = scenario_simple('recherche')
        sc['stderr'] = 'trace de diagnostic\n'
        a = self.arbre({'recherche': sc})
        p = a.lancer('tout', 'recherche', *a.poste())
        self.assertNotIn('trace de diagnostic', p.stdout + p.stderr)
        self.json_pur(p.stdout)

    def test_estimation_illisible_ne_bloque_pas(self):
        sc = scenario_simple('recherche')
        sc['estimation'] = 'pas une estimation'
        a = self.arbre({'recherche': sc})
        p = a.lancer('tout', 'recherche', *a.poste())
        evts = self.json_pur(p.stdout)
        self.assertEqual(de_type(evts, 'debut')[0]['estimation']['recherche'],
                         {'requetes': None, 'delai_s': None, 'budget': None})
        self.assertTrue(de_type(evts, 'avertissement'))
        self.assertEqual(p.returncode, 0)


class Refus(AvecArbre):
    def test_racine_absente(self):
        a = self.arbre({}, moissons=False)
        p = a.lancer('mensuelle', *a.poste())
        self.assertEqual(p.returncode, 2)
        e, = evenements(p.stdout)
        self.assertEqual((e['type'], e['raison']), ('refus', 'racine-absente'))

    def test_options_obligatoires(self):
        a = self.arbre({'recherche': scenario_simple('recherche')})
        for manque in ('--racine', '--poste', '--compte'):
            with self.subTest(manque):
                args = a.poste()
                i = args.index(manque)
                del args[i:i + 2]
                p = a.lancer('mensuelle', *args)
                self.assertEqual(p.returncode, 2)
                e, = evenements(p.stdout)
                self.assertEqual((e['type'], e['raison']), ('refus', 'config-invalide'))
                self.assertIn(manque, e['detail'])
        self.assertFalse(os.path.exists(a.chemin('recherche', 'argv.json')))

    def test_nom_inconnu(self):
        a = self.arbre({})
        p = a.lancer('tout', 'meteo', *a.poste())
        self.assertEqual(p.returncode, 2)
        e, = evenements(p.stdout)
        self.assertEqual((e['type'], e['raison']), ('refus', 'config-invalide'))

    def test_creneau_vivant_d_un_autre_poste(self):
        a = self.arbre({'recherche': scenario_simple('recherche')})
        maintenant = datetime.datetime.now(datetime.timezone.utc)
        autre = {'format': 'pronto-creneau/1', 'poste': 'poste-b', 'compte': 'compte-b',
                 'debut': creneau.iso(maintenant), 'echeance': creneau.iso(maintenant + datetime.timedelta(hours=1)),
                 'battement': creneau.iso(maintenant), 'declencheur': 'cockpit', 'moissonneurs': ['parlement']}
        os.makedirs(a.chemin('_Creneau'))
        with open(a.chemin('_Creneau', 'poste-b__compte-b.json'), 'w', encoding='utf-8') as f:
            json.dump(autre, f)
        p = a.lancer('mensuelle', *a.poste())
        self.assertEqual(p.returncode, 4)
        evts = self.json_pur(p.stdout)
        self.assertEqual([e['type'] for e in evts], ['creneau', 'refus'])
        c, r = evts
        self.assertEqual((c['etat'], c['poste'], c['compte'], c['debut']),
                         ('refuse', 'poste-b', 'compte-b', autre['debut']))
        self.assertEqual(r['raison'], 'deja-en-cours')
        self.assertIn('poste-b', r['detail'])
        self.assertEqual(a.creneaux(), ['poste-b__compte-b.json'])
        self.assertFalse(os.path.exists(a.chemin('recherche', 'argv.json')))

    def test_creneau_perime_repris(self):
        a = self.arbre({'recherche': scenario_simple('recherche')})
        vieux = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=16)
        os.makedirs(a.chemin('_Creneau'))
        with open(a.chemin('_Creneau', 'poste-b__compte-b.json'), 'w', encoding='utf-8') as f:
            json.dump({'format': 'pronto-creneau/1', 'poste': 'poste-b', 'compte': 'compte-b',
                       'debut': creneau.iso(vieux), 'echeance': creneau.iso(vieux + datetime.timedelta(hours=5)),
                       'battement': creneau.iso(vieux), 'declencheur': 'cli', 'moissonneurs': []}, f)
        p = a.lancer('tout', 'recherche', *a.poste())
        self.assertEqual(p.returncode, 0, p.stdout)
        evts = self.json_pur(p.stdout)
        self.assertEqual([e['etat'] for e in de_type(evts, 'creneau')], ['repris-perime', 'pris', 'retire'])
        self.assertEqual(de_type(evts, 'creneau')[0]['poste'], 'poste-b')


class Budget(AvecArbre):
    def test_refus_au_dessus_de_budget_moins_marge(self):
        a = self.arbre({'recherche': scenario_simple('recherche')})
        ecrire_compteur(a, 'recherche', 'poste-b__compte-b', 800 - creneau.MARGE_REQUETES + 1)
        p = a.lancer('tout', 'recherche', *a.poste())
        self.assertEqual(p.returncode, 4)
        e, = evenements(p.stdout)
        self.assertEqual((e['type'], e['raison']), ('refus', 'budget-epuise'))
        self.assertEqual(a.creneaux(), [])

    def test_juste_a_la_limite_refuse(self):
        # À budget − marge tout juste, le plafond de la passe vaut 0 : il n'y a plus rien à moissonner.
        a = self.arbre({'recherche': scenario_simple('recherche')})
        ecrire_compteur(a, 'recherche', 'poste-b__compte-b', 800 - creneau.MARGE_REQUETES)
        p = a.lancer('tout', 'recherche', *a.poste())
        self.assertEqual(p.returncode, 4)
        self.assertEqual([e['raison'] for e in de_type(evenements(p.stdout), 'refus')], ['budget-epuise'])
        self.assertFalse(os.path.exists(a.chemin('recherche', 'argv.json')))

    def test_une_requete_sous_la_limite_passe(self):
        a = self.arbre({'recherche': scenario_simple('recherche')})
        ecrire_compteur(a, 'recherche', 'poste-b__compte-b', 800 - creneau.MARGE_REQUETES - 1)
        p = a.lancer('tout', 'recherche', *a.poste())
        self.assertEqual(de_type(evenements(p.stdout), 'refus'), [])
        self.assertEqual(option(a.argv_enfant('recherche'), '--plafond'), '1')

    def test_un_epuise_parmi_d_autres_est_saute(self):
        a = self.arbre({'parlement': scenario_simple('parlement'), 'recherche': scenario_simple('recherche')})
        ecrire_compteur(a, 'parlement', 'poste-b__compte-b', 800)
        p = a.lancer('mensuelle', *a.poste())
        self.assertEqual(p.returncode, 0, p.stdout)
        evts = self.json_pur(p.stdout)
        self.assertEqual(de_type(evts, 'debut')[0]['moissonneurs'], ['recherche'])
        self.assertTrue(any('parlement' in e['message'] and 'budget' in e['message']
                            for e in de_type(evts, 'avertissement')))
        self.assertFalse(os.path.exists(a.chemin('parlement', 'argv.json')))

    def test_plafond_local_et_arret_net(self):
        nom = 'parlement'
        pas = [{'requete': True, 'ligne': {'type': 'progression', 'etape': 'moisson', 'corps': f'C{i}',
                                           'statut': 'ok', 'requetes': i}} for i in range(1, 61)]
        sc = {'estimation': outils.estimation(nom, requetes=60), 'pas': pas + [{'ligne': outils.resume(nom)}],
              'sur_plafond': [{'type': 'progression', 'etape': 'moisson', 'corps': 'C51', 'statut': 'budget',
                               'requetes': '$faites'},
                              dict(outils.resume(nom, interrompu='budget'), requetes='$faites')]}
        a = self.arbre({nom: sc})
        ecrire_compteur(a, nom, 'poste-b__compte-b', 690)
        ecrire_compteur(a, nom, 'poste-a__compte-a', 10)
        ecrire_compteur(a, nom, 'poste-c__compte-c', 500, mois='2000-01')        # un autre mois ne compte pas
        p = a.lancer('tout', nom, *a.poste())
        self.assertEqual(p.returncode, 3, p.stdout)
        plafond = 800 - creneau.MARGE_REQUETES - 700
        self.assertEqual(option(a.argv_enfant(nom), '--plafond'), str(plafond))
        evts = self.json_pur(p.stdout)
        self.assertEqual(de_type(evts, 'debut')[0]['budget_mois'][nom]['somme'], 700)
        self.assertEqual(max(e['requetes'] for e in de_type(evts, 'etape')), plafond)
        f, = de_type(evts, 'moissonneur_fin')
        self.assertEqual(f['interrompu'], 'budget')
        compteur = lire_compteur(a, nom, 'poste-a__compte-a')
        self.assertEqual((compteur['format'], compteur['requetes']), ('pronto-requetes/1', 10 + plafond))

    def test_compteur_ecrit_en_fin_avec_les_requetes_reelles(self):
        nom = 'recherche'
        sc = {'estimation': outils.estimation(nom),
              'pas': [{'ligne': {'type': 'progression', 'etape': 'moisson', 'source': 'hfh', 'statut': 'ok',
                                 'requetes': 3}},
                      {'ligne': {'type': 'progression', 'etape': 'moisson', 'source': 'skbf', 'statut': 'echec',
                                 'raison': 'URLError', 'requetes': 7}},
                      {'ligne': outils.resume(nom, interrompu='403', requetes=9)}], 'code': 3}
        a = self.arbre({nom: sc})
        p = a.lancer('tout', nom, *a.poste())
        self.assertEqual(p.returncode, 3)
        self.assertEqual(lire_compteur(a, nom, 'poste-a__compte-a')['requetes'], 9)


class Absent(AvecArbre):
    def test_moissonneur_absent_ne_plante_pas(self):
        a = self.arbre({'recherche': scenario_simple('recherche')})
        p = a.lancer('mensuelle', *a.poste())
        self.assertEqual(p.returncode, 0, p.stderr)
        evts = self.json_pur(p.stdout)
        self.assertEqual(de_type(evts, 'debut')[0]['moissonneurs'], ['recherche'])
        self.assertTrue(any('parlement' in e['message'] for e in de_type(evts, 'avertissement')))
        self.assertEqual([f['moissonneur'] for f in de_type(evts, 'moissonneur_fin')], ['recherche'])


class CodeLePlusGrave(AvecArbre):
    def test_combinaisons(self):
        for codes, attendu in (((0, 3), 3), ((3, 2), 2), ((1, 3), 3), ((2, 0), 2), ((0, 0), 0), ((1, 0), 1)):
            with self.subTest(codes=codes):
                a = self.arbre({'parlement': scenario_simple('parlement', code=codes[0]),
                                'recherche': scenario_simple('recherche', code=codes[1])})
                p = a.lancer('mensuelle', *a.poste())
                self.assertEqual(p.returncode, attendu, p.stdout)
                evts = evenements(p.stdout)
                self.assertEqual(evts[-1]['code'], attendu)
                self.assertEqual([f['code'] for f in de_type(evts, 'moissonneur_fin')], list(codes))

    def test_enfant_qui_plante_sans_resume(self):
        sc = scenario_simple('recherche', code=1)
        sc['pas'] = [{'brut': 'Traceback (most recent call last):'}]
        sc['stderr'] = 'ligne ancienne\n' * 200 + 'ZeroDivisionError: division by zero\n'
        a = self.arbre({'recherche': sc})
        p = a.lancer('tout', 'recherche', *a.poste())
        self.assertEqual(p.returncode, 5)
        evts = self.json_pur(p.stdout)
        messages = [e['message'] for e in de_type(evts, 'avertissement')]
        self.assertTrue(any('Traceback' in m for m in messages))
        queue = [m for m in messages if 'ZeroDivisionError' in m]
        self.assertEqual(len(queue), 1)
        self.assertLess(len(queue[0]), 1200)
        f, = de_type(evts, 'moissonneur_fin')
        self.assertEqual((f['code'], f['plantage']), (1, True))
        self.assertEqual(evts[-1]['code'], 5)
        self.assertEqual(a.creneaux(), [])


class SortieJson(AvecArbre):
    def test_stdout_ne_porte_que_des_evenements_valides(self):
        a = self.arbre({'parlement': scenario_simple('parlement', code=3), 'recherche': scenario_simple('recherche')})
        p = a.lancer('mensuelle', *a.poste(), '--evenements', 'json')
        self.json_pur(p.stdout)
        self.assertEqual(p.stderr, '')

    def test_json_par_defaut_hors_tty(self):
        a = self.arbre({'recherche': scenario_simple('recherche')})
        p = a.lancer('tout', 'recherche', *a.poste())
        self.json_pur(p.stdout)

    def test_console_sur_demande(self):
        a = self.arbre({'recherche': scenario_simple('recherche')})
        p = a.lancer('tout', 'recherche', *a.poste(), '--evenements', 'console')
        self.assertIn('Bilan', p.stdout)
        self.assertNotIn('"format"', p.stdout)


@unittest.skipUnless(os.name == 'posix', 'signaux POSIX absents')
class Arret(AvecArbre):
    def scenario(self):
        nom = 'recherche'
        return {'estimation': outils.estimation(nom),
                'pas': [{'requete': True, 'ligne': {'type': 'progression', 'etape': 'moisson', 'source': 'hfh',
                                                    'statut': 'ok', 'requetes': 4}},
                        {'pret': True, 'attendre_arret': 10},
                        {'requete': True, 'ligne': {'type': 'progression', 'etape': 'moisson', 'source': 'skbf',
                                                    'statut': 'ok', 'requetes': 9}},
                        {'ligne': outils.resume(nom)}],
                'sur_arret': [{'type': 'progression', 'etape': 'moisson', 'source': 'skbf', 'statut': 'arret',
                               'requetes': 4},
                              outils.resume(nom, lot='2026-11-01-1.jsonl', propositions=1, interrompu='arret')]}

    def test_sigint_pose_la_demande_et_rend_3(self):
        a = self.arbre({'recherche': self.scenario()})
        p = a.ouvrir('tout', 'recherche', *a.poste(), '--evenements', 'json')
        self.assertTrue(a.attendre(a.chemin('recherche', 'pret')))
        arret = option(a.argv_enfant('recherche'), '--arret')
        p.send_signal(signal.SIGINT)
        sortie, erreur = p.communicate(timeout=30)
        self.assertEqual(p.returncode, 3, erreur)
        evts = self.json_pur(sortie)
        self.assertTrue(any('arrêt demandé' in e['message'] for e in de_type(evts, 'avertissement')))
        f, = de_type(evts, 'moissonneur_fin')
        self.assertEqual((f['code'], f['interrompu']), (3, 'arret'))
        self.assertEqual(de_type(evts, 'lot')[0]['propositions'], 1)
        self.assertEqual((evts[-1]['type'], evts[-1]['code']), ('fin', 3))
        self.assertFalse(os.path.exists(arret))
        self.assertEqual(a.creneaux(), [])

    def test_second_sigint_tue_l_enfant(self):
        sc = {'estimation': outils.estimation('recherche'), 'pas': [{'pret': True, 'dormir': 60}]}
        a = self.arbre({'recherche': sc})
        p = a.ouvrir('tout', 'recherche', *a.poste(), '--evenements', 'json')
        self.assertTrue(a.attendre(a.chemin('recherche', 'pret')))
        arret = option(a.argv_enfant('recherche'), '--arret')
        p.send_signal(signal.SIGINT)
        self.assertTrue(a.attendre(arret))
        p.send_signal(signal.SIGINT)
        sortie, _ = p.communicate(timeout=20)
        self.assertEqual(p.returncode, 3)
        evts = self.json_pur(sortie)
        f, = de_type(evts, 'moissonneur_fin')
        self.assertEqual(f['interrompu'], 'arret')
        self.assertEqual(evts[-1]['type'], 'fin')
        self.assertFalse(os.path.exists(arret))
        self.assertEqual(a.creneaux(), [])

    def test_arret_saute_les_moissonneurs_suivants(self):
        sc = scenario_simple('parlement')
        sc['pas'].insert(0, {'poser_arret': True})       # le bouton Arrêter du cockpit
        a = self.arbre({'parlement': sc, 'recherche': scenario_simple('recherche')})
        p = a.lancer('mensuelle', *a.poste())
        evts = evenements(p.stdout)
        self.assertFalse(os.path.exists(a.chemin('recherche', 'argv.json')))
        self.assertTrue(any('recherche' in e['message'] for e in de_type(evts, 'avertissement')))
        self.assertEqual(p.returncode, 3)


class Coutures(AvecArbre):
    """Le créneau, l'état partagé et le journal passent par des fonctions remplaçables."""

    def principal(self, a, *args, entree=None, sortie=None):
        sortie = sortie or io.StringIO()
        code = moisson.principal(list(args), sortie=sortie, entree=entree or io.StringIO(), racine_code=a.code)
        return code, sortie.getvalue()

    def remplacer(self, nom, valeur):
        ancien = getattr(moisson, nom)
        setattr(moisson, nom, valeur)
        self.addCleanup(setattr, moisson, nom, ancien)

    def test_creneau_retire_apres_une_exception(self):
        a = self.arbre({'recherche': scenario_simple('recherche')})

        def panne(*x, **k):
            raise RuntimeError('panne simulée')
        self.remplacer('lancer_enfant', panne)
        code, texte = self.principal(a, 'tout', 'recherche', *a.poste(), '--evenements', 'json')
        self.assertEqual(code, 5)
        self.assertEqual(a.creneaux(), [])
        evts = evenements(texte)
        self.assertTrue(any('panne simulée' in e['message'] for e in de_type(evts, 'avertissement')))
        self.assertEqual([e['type'] for e in evts[-2:]], ['creneau', 'fin'])

    def test_etat_absent(self):
        a = self.arbre({'recherche': scenario_simple('recherche')}, sans_socle=('recherche',))
        code, texte = self.principal(a, 'tout', 'recherche', *a.poste(), '--evenements', 'json')
        self.assertEqual(code, 2)
        evts = evenements(texte)
        self.assertEqual([e['type'] for e in evts], ['refus'])
        self.assertEqual(evts[0]['raison'], 'etat-absent')
        self.assertEqual(a.creneaux(), [])
        self.assertFalse(os.path.exists(a.chemin('recherche', 'argv.json')))

    def test_etat_absent_pour_un_seul_moissonneur(self):
        a = self.arbre({'parlement': scenario_simple('parlement'), 'recherche': scenario_simple('recherche')},
                       sans_socle=('parlement',))
        code, texte = self.principal(a, 'mensuelle', *a.poste(), '--evenements', 'json')
        self.assertEqual(code, 0)
        evts = evenements(texte)
        self.assertEqual(de_type(evts, 'debut')[0]['moissonneurs'], ['recherche'])
        self.assertTrue(any('parlement' in e['message'] and 'état partagé' in e['message']
                            for e in de_type(evts, 'avertissement')))
        self.assertFalse(os.path.exists(a.chemin('parlement', 'argv.json')))

    def test_la_passe_n_ecrit_que_son_compteur(self):
        # Le socle ne s'écrit que depuis le poste de développement : moisson.py n'y touche jamais.
        a = self.arbre({'parlement': scenario_simple('parlement'), 'recherche': scenario_simple('recherche')})
        with open(a.socle('recherche'), encoding='utf-8') as f:
            avant = f.read()
        code, _ = self.principal(a, 'mensuelle', *a.poste(), '--evenements', 'json')
        self.assertEqual(code, 0)
        for m in ('parlement', 'recherche'):
            with self.subTest(moissonneur=m):
                self.assertEqual(sorted(os.listdir(a.chemin(m, '_partage'))), ['requetes', 'socle.json'])
                self.assertEqual(os.listdir(a.chemin(m, '_partage', 'requetes', mois_courant())),
                                 ['poste-a__compte-a.json'])
        with open(a.socle('recherche'), encoding='utf-8') as f:
            self.assertEqual(f.read(), avant)
        self.assertEqual(a.creneaux(), [])

    def test_raccourci_attend_entree_en_console(self):
        a = self.arbre({'recherche': scenario_simple('recherche')})
        entree = io.StringIO('\nreste\n')
        code, texte = self.principal(a, 'mensuelle', *a.poste(), '--declencheur', 'raccourci',
                                     '--evenements', 'console', entree=entree)
        self.assertEqual(code, 0)
        self.assertIn('Entrée', texte)
        self.assertEqual(entree.read(), 'reste\n')

    def test_cli_n_attend_pas(self):
        a = self.arbre({'recherche': scenario_simple('recherche')})
        entree = io.StringIO('\n')
        self.principal(a, 'mensuelle', *a.poste(), '--evenements', 'console', entree=entree)
        self.assertEqual(entree.read(), '\n')

    def test_declencheur_dans_debut(self):
        a = self.arbre({'recherche': scenario_simple('recherche')})
        code, texte = self.principal(a, 'mensuelle', *a.poste(), '--declencheur', 'cockpit',
                                     '--evenements', 'json')
        self.assertEqual(de_type(evenements(texte), 'debut')[0]['declencheur'], 'cockpit')


class CheminLocal(unittest.TestCase):
    def test_conversion_pure(self):
        self.assertEqual(moisson.chemin_local('C:\\A\\b c'), '/mnt/c/A/b c')
        self.assertEqual(moisson.chemin_local('D:/x/y'), '/mnt/d/x/y')
        self.assertEqual(moisson.chemin_local('/deja/posix'), '/deja/posix')


if __name__ == '__main__':
    unittest.main()
