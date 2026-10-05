"""Comportement de bout en bout de cli.py, hors réseau (source factice injectée dans
sys.modules). Couvre : idempotence, filtre, amorçage depuis une bibliothèque factice.
Les lots de propositions sont éprouvés dans test_propositions.py."""
import os
import shutil
import sys
import tempfile
import types
import unittest
from types import SimpleNamespace

from recherche import cli
from recherche import db
from recherche.modele import Projet
from recherche.tests import outils

CONFIG_FILTRE = {
    'institutions_toujours': ['Interkantonale Hochschule für Heilpädagogik', 'HfH'],
    'mots': ['wohlbefinden', 'handicap', 'autis'],
}


def _config(tmp):
    return {
        'base': os.path.join(tmp, 'donnees', 'base.sqlite'),
        'cache': os.path.join(tmp, 'donnees', 'cache'),
        'sortie': os.path.join(tmp, 'sortie'),
        'bibliotheque': os.path.join(tmp, 'bibliotheque'),
        'langue_par_defaut': 'de',
        'delai': 0,
        'filtre': CONFIG_FILTRE,
        'sources': {'faux': {'actif': True}},
    }


def _injecter_source(nom, projets_par_appel):
    """Enregistre recherche.sources.<nom> dans sys.modules ; moissonner() rend, à chaque appel,
    la prochaine liste de projets_par_appel (pour simuler des moissons successives)."""
    compteur = {'n': 0}

    def moissonner(config, reseau, connus):
        i = min(compteur['n'], len(projets_par_appel) - 1)
        compteur['n'] += 1
        yield from projets_par_appel[i]

    module = types.ModuleType('recherche.sources.' + nom)
    module.moissonner = moissonner
    sys.modules['recherche.sources.' + nom] = module
    return module


class TestCliBoutEnBout(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.config = _config(self.tmp)
        self.con = db.connecter(self.config['base'])
        self.addCleanup(self.con.close)
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.addCleanup(sys.modules.pop, 'recherche.sources.faux', None)

    def _moissonner(self, args=None):
        args = args or SimpleNamespace(source='faux', site=None)
        return cli.cmd_moissonner(self.config, self.con, args)

    def test_idempotence_deuxieme_moisson_zero_nouveau(self):
        projet = Projet(source='faux', source_id='1', url='https://exemple.ch/1',
                        title='Étude Wohlbefinden des enfants', institutions='', debut='2025-01')
        _injecter_source('faux', [[projet], [projet]])  # même projet rendu deux fois

        code1 = self._moissonner()
        self.assertEqual(code1, 0)
        lignes = db.lister(self.con, source='faux')
        self.assertEqual(len(lignes), 1)
        self.assertEqual(lignes[0]['statut'], 'nouveau')  # matche le mot « wohlbefinden »
        premiere_vue_1 = lignes[0]['premiere_vue']

        code2 = self._moissonner()
        self.assertEqual(code2, 0)
        lignes2 = db.lister(self.con, source='faux')
        self.assertEqual(len(lignes2), 1)  # toujours une seule ligne : jamais recréée
        self.assertEqual(lignes2[0]['premiere_vue'], premiere_vue_1)  # premiere_vue inchangée

    def test_hors_sujet_si_aucun_critere_ne_matche(self):
        projet = Projet(source='faux', source_id='2', url='https://exemple.ch/2',
                        title='Sujet quelconque sans rapport', institutions='Université X')
        _injecter_source('faux', [[projet]])
        self._moissonner()
        lignes = db.lister(self.con, source='faux')
        self.assertEqual(lignes[0]['statut'], 'hors-sujet')

    def test_amorcer_depuis_bibliotheque_factice(self):
        # bibliothèque factice avec un titre différent du projet moissonné (comme en réalité
        # entre FNS et fiche existante), plus un titre nettement plus éloigné (probable, pas sûr).
        biblio = self.config['bibliotheque']
        outils.ecrire_fiche(biblio, 'beurteilung', 'de', {
            'title': 'Lesefreude und Wohlbefinden im Zauberwald (Assessment for wellbeing - Fiktiv)',
            'uuid': 'U1', 'institutions': 'PHSG', 'lien': 'https://www.hochschule-musterstadt.example/projet'})
        outils.ecrire_fiche(biblio, 'autre', 'de', {
            'title': 'Un tout autre projet sans rapport aucun', 'uuid': 'U2', 'lien': 'https://exemple.ch/autre'})

        p_sur = Projet(source='faux', source_id='10', url='https://data.snf.ch/grants/grant/10',
                        title='Assessment for wellbeing', institutions='HfH')
        p_sans_rapport = Projet(source='faux', source_id='11', url='https://exemple.ch/11',
                                 title='Étude sur le handicap moteur', institutions='')
        _injecter_source('faux', [[p_sur, p_sans_rapport]])
        self._moissonner()

        code = cli.cmd_amorcer(self.config, self.con, SimpleNamespace())
        self.assertEqual(code, 0)

        lignes = {l['source_id']: l for l in db.lister(self.con, source='faux')}
        self.assertEqual(lignes['10']['statut'], 'existant')  # rapprochement sûr
        self.assertEqual(lignes['11']['statut'], 'nouveau')  # aucun rapport : inchangé


if __name__ == '__main__':
    unittest.main()
