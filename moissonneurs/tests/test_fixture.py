"""La fixture d'événements partagée avec le cockpit : produite par une passe factice, gardée à jour.

Pour la régénérer : PRONTO_FIXTURE_ECRIRE=1 python3 -B -m unittest tests.test_fixture
"""
import datetime
import io
import json
import os
import unittest

import evenements as ev
import moisson
from tests import outils

FIXTURE = os.path.join(outils.ICI, 'fixtures', 'passe-exemple.jsonl')
FIXE = datetime.datetime(2026, 11, 1, 6, 0, tzinfo=datetime.timezone.utc)


class Horloge:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        self.t += 7.5
        return self.t


def _p(etape, **kw):
    return {'ligne': {'type': 'progression', 'etape': etape, **kw}}


def scenarios():
    parlement = {
        'estimation': dict(outils.estimation('parlement', requetes=45, budget=800, delai_s=2.0)),
        'pas': [
            _p('moisson', corps='GE', statut='ok', raison='', nouvelles=3, modifiees=1, requetes=12),
            _p('moisson', corps='VD', statut='echec', raison='HTTPError: 500', nouvelles=0, modifiees=0,
               requetes=15),
            _p('moisson', corps='BE', statut='ok', raison='', nouvelles=2, modifiees=0, requetes=24),
            _p('criblage', statut='ok', requetes=36, termes=18, termes_en_echec=0),
            _p('textes', statut='ok', requetes=41, textes=6, echecs=0),
            _p('classement', statut='ok', requetes=41, retenu=4, a_relire=10, ecarte=120),
            _p('propositions', statut='ok', requetes=41, ecrites=14, ecartees=1, lot='2026-11-01-1.jsonl',
               controle_noms={'defauts': 0, 'lignes_avec_doute': 0}),
            _p('purge', statut='ok', requetes=41, lots=1, decisions=2, echecs=0),
            {'ligne': outils.resume('parlement', lot='2026-11-01-1.jsonl', propositions=14,
                                    echecs=[{'source': 'VD', 'raison': 'HTTPError: 500'}],
                                    purge={'lots': ['2026-04-01-1.jsonl'], 'decisions': ['a.json', 'b.json']})},
        ]}
    recherche = {
        'estimation': dict(outils.estimation('recherche', requetes=60, budget=3000, delai_s=3.0)),
        'code': 0,
        'pas': [
            _p('moisson', source='site:hfh', statut='ok', nouveaux=2, requetes=6),
            {'ligne': {'type': 'attente', 'source': 'site:phbern', 'hote': 'www.phbern.example', 'secondes': 120,
                       'motif': '429'}},
            _p('moisson', source='site:phbern', statut='ok', nouveaux=0, requetes=8),
            _p('moisson', source='site:phsg', statut='echec', raison='403'),
            {'ligne': {'type': 'avertissement', 'source': 'site:phsg', 'code': '403',
                       'message': "PH St. Gallen a refusé l’accès (403)"}},
            {'poser_arret': True},          # le bouton Arrêter du cockpit
            {'requete': True, 'ligne': {'type': 'progression', 'etape': 'moisson', 'source': 'skbf',
                                        'statut': 'ok', 'requetes': 30}},
        ],
        'sur_arret': [
            {'type': 'progression', 'etape': 'moisson', 'source': 'skbf', 'statut': 'arret', 'requetes': 9},
            {'type': 'progression', 'etape': 'propositions', 'statut': 'ok', 'ecrites': 2,
             'lot': '2026-11-01-1.jsonl'},
            {'type': 'progression', 'etape': 'purge', 'statut': 'ok', 'lots': 0, 'decisions': 0, 'echecs': 0},
            dict(outils.resume('recherche', lot='2026-11-01-1.jsonl', propositions=2, interrompu='arret', requetes=9,
                               echecs=[{'source': 'site:phsg', 'raison': '403'}]),
                 sources_desactivees=[{'source': 'site:phlu', 'depuis': '2026-10-04'}]),
        ]}
    return {'parlement': parlement, 'recherche': recherche}


def produire():
    a = outils.Arbre(scenarios())
    try:
        sortie = io.StringIO()
        code = moisson.principal(['mensuelle', *a.poste('poste-exemple', 'compte-exemple'),
                                  '--declencheur', 'cockpit', '--evenements', 'json'],
                                 sortie=sortie, entree=io.StringIO(), horloge=Horloge(),
                                 maintenant=lambda: FIXE, racine_code=a.code)
        return code, sortie.getvalue()
    finally:
        a.effacer()


class Fixture(unittest.TestCase):
    def test_a_jour(self):
        code, texte = produire()
        self.assertEqual(code, 3)
        if os.environ.get('PRONTO_FIXTURE_ECRIRE') == '1':
            os.makedirs(os.path.dirname(FIXTURE), exist_ok=True)
            with open(FIXTURE, 'w', encoding='utf-8', newline='\n') as f:
                f.write(texte)
        with open(FIXTURE, encoding='utf-8') as f:
            self.assertEqual(f.read(), texte, 'fixture périmée : la régénérer (voir l’en-tête du fichier)')

    def test_contenu(self):
        with open(FIXTURE, encoding='utf-8') as f:
            evts = [json.loads(l) for l in f]
        for e in evts:
            self.assertEqual(ev.valider(e), [], e)
        types = {e['type'] for e in evts}
        self.assertEqual(types, set(ev.TYPES) - {'refus'})
        self.assertEqual([(e['type'], e.get('etat')) for e in evts[:2]], [('creneau', 'pris'), ('debut', None)])
        self.assertEqual(evts[-2]['etat'], 'retire')
        self.assertEqual(evts[1]['budget_mois']['parlement']['plafond'], 800 - moisson.creneau.MARGE_REQUETES)
        self.assertEqual(len(outils.de_type(evts, 'attente')), 1)
        self.assertEqual(outils.de_type(evts, 'moissonneur_fin')[1]['sources_desactivees'], ['phlu'])
        self.assertEqual(evts[-1], {'format': ev.FORMAT, 'type': 'fin', 'code': 3, 'duree_s': evts[-1]['duree_s']})
        self.assertEqual(len(outils.de_type(evts, 'lot')), 2)
        self.assertIn('arret', [f['interrompu'] for f in outils.de_type(evts, 'moissonneur_fin')])


if __name__ == '__main__':
    unittest.main()
