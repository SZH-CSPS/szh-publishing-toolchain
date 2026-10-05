import os
import tempfile
import unittest

from parlement import decisions
from parlement.stockage import Base


class TestDecisions(unittest.TestCase):
    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.rep = self._t.name
        self.base = Base(':memory:')

    def tearDown(self):
        self.base.fermer()
        self._t.cleanup()

    def ecrire(self, cle, texte, sous=''):
        d = os.path.join(self.rep, sous)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, decisions.empreinte_cle(cle) + '.txt'), 'w', encoding='utf-8') as f:
            f.write(f'Cle: {cle}\n\n----\n\n' + texte)

    def test_empreinte_16_hex_stable(self):
        h = decisions.empreinte_cle('parlement:openparldata:ZH:1')
        self.assertEqual(h, decisions.empreinte_cle('parlement:openparldata:ZH:1'))
        self.assertRegex(h, r'^[0-9a-f]{16}$')
        self.assertNotEqual(h, decisions.empreinte_cle('parlement:openparldata:ZH:2'))

    def test_dossier_absent_ou_vide(self):
        self.assertEqual(decisions.lire(os.path.join(self.rep, 'nexiste-pas')), {})
        self.assertEqual(decisions.lire(self.rep), {})

    def test_lecture_par_cle_en_clair(self):
        self.ecrire('k:1', 'Decision: refuse\n\n----\n\nMotif: doublon\n\n----\n\nDate: 2026-10-02\n')
        self.ecrire('k:2', 'Decision: accepte\n\n----\n\nFiche: ' + 'A' * 16 + '\n')
        d = decisions.lire(self.rep)
        self.assertEqual((d['k:1']['decision'], d['k:1']['motif'], d['k:1']['date']), ('refuse', 'doublon', '2026-10-02'))
        self.assertEqual((d['k:2']['decision'], d['k:2']['fiche']), ('accepte', 'A' * 16))

    def test_lit_aussi_les_sous_dossiers(self):
        self.ecrire('k:1', 'Decision: refuse\n', sous='de')
        self.assertIn('k:1', decisions.lire(self.rep))

    def test_fichier_illisible_ou_sans_cle_ignore_sans_casser_le_reste(self):
        os.makedirs(self.rep, exist_ok=True)
        with open(os.path.join(self.rep, 'a.txt'), 'w', encoding='utf-8') as f:
            f.write('n importe quoi')
        with open(os.path.join(self.rep, 'b.txt'), 'wb') as f:
            f.write(b'\xff\xfe\x00')
        with open(os.path.join(self.rep, 'c.txt'), 'w', encoding='utf-8') as f:
            f.write('Decision: refuse\n')          # pas de Cle
        self.ecrire('k:2', 'Decision: refuse\n')
        self.assertEqual(list(decisions.lire(self.rep)), ['k:2'])

    def test_motif_hors_liste_devient_autre(self):
        self.ecrire('k:1', 'Decision: refuse\n\n----\n\nMotif: farfelu\n')
        self.assertEqual(decisions.lire(self.rep)['k:1']['motif'], 'autre')

    def test_decision_inconnue_ignoree(self):
        self.ecrire('k:1', 'Decision: peut-etre\n')
        self.assertEqual(decisions.lire(self.rep), {})

    def test_appliquer_garde_les_motifs_en_base_et_rend_les_cles(self):
        self.ecrire('k:1', 'Decision: refuse\n\n----\n\nMotif: hors-sujet\n')
        self.ecrire('k:9', 'Decision: refuse\n')                     # étrangère à nos affaires
        n = decisions.appliquer(self.rep, self.base)
        self.assertEqual(n, {'k:1', 'k:9'})
        r = self.base.c.execute("SELECT decision, motif FROM decisions WHERE cle='k:1'").fetchone()
        self.assertEqual((r['decision'], r['motif']), ('refuse', 'hors-sujet'))

    def test_bilan_pour_mesurer_la_precision(self):
        self.ecrire('k:1', 'Decision: refuse\n\n----\n\nMotif: hors-sujet\n')
        self.ecrire('k:2', 'Decision: refuse\n\n----\n\nMotif: hors-sujet\n')
        self.ecrire('k:3', 'Decision: accepte\n')
        decisions.appliquer(self.rep, self.base)
        self.assertEqual(decisions.bilan(self.base), {'accepte': 1, 'refuse': 2, 'motifs': {'hors-sujet': 2}})


if __name__ == '__main__':
    unittest.main()
