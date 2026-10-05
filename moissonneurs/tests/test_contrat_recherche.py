"""Les lignes que la recherche émet vraiment (recherche.tout) passent toutes par le traducteur de moisson.py : aucune
n'y devient « ligne non reconnue », et chaque événement obtenu respecte pronto-moisson/1. Hors réseau."""
import json
import os
import shutil
import sys
import tempfile
import types
import unittest

import evenements as ev
from recherche import db, tout
from recherche.modele import Projet
from recherche.reseau import Acces403
from recherche.tests import outils as outils_recherche

JOUR = '2026-10-04'


def projet(i):
    return Projet(source='faux', source_id=str(i), url=f'https://exemple.ch/{i}', title='Autismus in der Schule',
                  langue='de', institutions='Universität Musterstadt', debut='2025', fin='2027',
                  descriptif='Ein Projekt.')


class ReseauFactice:
    def __init__(self, signaler):
        self.requetes, self.details, self.signaler = 0, {}, signaler


def injecter(nom, comportement):
    module = types.ModuleType('recherche.sources.' + nom)

    def moissonner(config, reseau, connus):
        if isinstance(comportement, BaseException):
            raise comportement
        yield from comportement(reseau)

    module.moissonner = moissonner
    sys.modules['recherche.sources.' + nom] = module


class ContratRecherche(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        noms = ('lue', 'attente', 'pages', 'refus', 'coupee')
        for nom in noms:
            self.addCleanup(sys.modules.pop, 'recherche.sources.' + nom, None)
        self.config = outils_recherche.config(self.tmp, sources={n: {'actif': True} for n in noms})
        os.makedirs(os.path.join(self.config['bibliotheque'], 'forschung'))

        def lue(reseau):
            reseau.requetes += 3
            return [projet(1)]

        def attente(reseau):
            reseau.signaler({'type': 'attente', 'source': reseau.source, 'hote': 'www.exemple.ch', 'secondes': 40,
                             'motif': '429'})
            return []

        def pages(reseau):
            reseau.details[reseau.source] = {'demandes': 4, 'refus': ['https://exemple.ch/r'],
                                             'reussies': ['https://exemple.ch/a', 'https://exemple.ch/b']}
            return []

        injecter('lue', lue)
        injecter('attente', attente)
        injecter('pages', pages)
        injecter('refus', Acces403('https://exemple.ch/plan.xml : 403'))
        injecter('coupee', RuntimeError('page cassée'))
        con = db.connecter(self.config['base'])
        db.noter_source(con, 'desactivee', True, JOUR)
        db.noter_source(con, 'desactivee', True, JOUR)
        con.commit()
        con.close()
        self.config['sources']['desactivee'] = {'actif': True}

    def lignes(self):
        sortie = []

        def emit(obj):
            sortie.append(json.dumps(obj, ensure_ascii=False))
        reseau = ReseauFactice(emit)
        _, code = tout.tout(self.config, emit, aujourdhui=JOUR, reseau=reseau)
        return sortie, code

    def test_tout_est_traduit(self):
        lignes, code = self.lignes()
        self.assertEqual(code, 1)
        t = ev.Traducteur('recherche', {'requetes': 20, 'delai_s': 3.0, 'budget': 2950})
        evts = [e for l in lignes for e in t.ligne(l)]
        evts += t.terminer(code)
        for e in evts:
            self.assertEqual(ev.valider(e), [], e)
            self.assertNotIn('ligne non reconnue', e.get('message', ''), e)
        messages = [e['message'] for e in evts if e['type'] == 'avertissement']
        self.assertIn("refus a refusé l’accès (403)", messages)
        self.assertIn("une page de pages refuse l’accès (403)", messages)
        self.assertTrue(any(m.startswith('desactivee est désactivée depuis le 04.10.2026') for m in messages))
        self.assertTrue(any('coupee' in m and 'page cassée' in m for m in messages))
        self.assertEqual([e['secondes'] for e in evts if e['type'] == 'attente'], [40])
        self.assertEqual([e['chemin'] for e in evts if e['type'] == 'lot'], ['recherche/2026-10-04-1.jsonl'])
        fin, = [e for e in evts if e['type'] == 'moissonneur_fin']
        self.assertEqual(fin['sources_desactivees'], ['desactivee'])
        self.assertEqual({s['source'] for s in fin['sources_en_echec']}, {'refus', 'coupee'})
        self.assertFalse(fin['plantage'])


if __name__ == '__main__':
    unittest.main()
