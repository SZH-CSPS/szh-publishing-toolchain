"""Titres fédéraux : « 21.498 n Iv.pa. <Nom>. <titre> » devient le titre seul ; l'abréviation indique le type.
Les noms de ces fixtures sont fictifs : le dépôt n'accueille aucun nom réel."""
import json
import unittest

from parlement import correspondances as corr, export_propositions as ep
from parlement.tests.test_propositions import TestPropositions, aff

CAS = [
    # (titre brut, titre attendu, jeton)
    ('21.498 n Iv.pa. Duval. Mettre en oeuvre le rapport d’évaluation relatif aux expertises médicales de l’AI',
     'Mettre en oeuvre le rapport d’évaluation relatif aux expertises médicales de l’AI', 'initiative-parlementaire'),
    ('21.498 n Pa.Iv. Duval. Umsetzung des Berichtes zur Evaluation der medizinischen Begutachtung in der IV',
     'Umsetzung des Berichtes zur Evaluation der medizinischen Begutachtung in der IV', 'initiative-parlementaire'),
    ('21.470 n Iv. Pa. Duval. La violazione delle condizioni di lavoro obbligatorie costituisce concorrenza sleale',
     'La violazione delle condizioni di lavoro obbligatorie costituisce concorrenza sleale', 'initiative-parlementaire'),
    ('18.455 n Iv. pa. Martin Léa. Accorder la qualité de personne exerçant une activité lucrative indépendante',
     'Accorder la qualité de personne exerçant une activité lucrative indépendante', 'initiative-parlementaire'),
    ('18.455 n Pa. Iv. Martin Léa. Selbstständigkeit ermöglichen, Parteiwillen berücksichtigen',
     'Selbstständigkeit ermöglichen, Parteiwillen berücksichtigen', 'initiative-parlementaire'),
    ("22.405 n Iv. pa. CER-N. Introduction d'une réserve climatique pour les vins suisses",
     "Introduction d'une réserve climatique pour les vins suisses", 'initiative-parlementaire'),
    ("23.325 é Iv. ct. ZH. Assouplissement temporaire des heures d'ouverture des magasins",
     "Assouplissement temporaire des heures d'ouverture des magasins", 'initiative-cantonale'),
    ('23.325 s Kt. Iv. ZH. Zeitlich befristete Flexibilisierung der Ladenöffnungszeiten',
     'Zeitlich befristete Flexibilisierung der Ladenöffnungszeiten', 'initiative-cantonale'),
    ('23.325 s Iv. ct. ZH. Flessibilizzazione temporanea degli orari di apertura dei negozi',
     'Flessibilizzazione temporanea degli orari di apertura dei negozi', 'initiative-cantonale'),
    ('22.3001 n Mo. Dupont. Réduire le délai de traitement', 'Réduire le délai de traitement', 'motion'),
    ('22.3002 s Po. Dupont Anne. Prüfung eines Registers', 'Prüfung eines Registers', 'postulat'),
    ('22.3003 n Ip. Dupont. Quali misure contro la carenza?', 'Quali misure contro la carenza?', 'interpellation'),
    ('22.3004 n Fra. Dupont. Où en est la mise en oeuvre ?', 'Où en est la mise en oeuvre ?', 'question'),
    ('26.7001 Fragestunde. Wie steht es um die Umsetzung?', 'Wie steht es um die Umsetzung?', 'question'),
    ('20.445 n Inscrire le cyberharcèlement dans le code pénal', 'Inscrire le cyberharcèlement dans le code pénal', None),
    ('20.445 n Cyberbullismo. Una nuova fattispecie penale', 'Cyberbullismo. Una nuova fattispecie penale', None),
    ("25.434 Diritti d'autore. Per una gestione trasparente dei diritti", "Diritti d'autore. Per una gestione trasparente dei diritti", None),
]
INTACTS = ['Motion 22.3546 délibérément ignorée. Le Conseil fédéral décide seul', 'Interpellation - Reifenabrieb raus aus unseren Gewässern',
           'Quelle école voulons-nous ? Les modifications du statut enseignant', '2024 Budget des routes', '24 heures pour les enfants',
           'Umsetzung der Motion 24.4259, « Friedensforum »']


class TestTitreFederal(unittest.TestCase):
    def test_chaque_forme_donne_le_titre_seul_et_le_type(self):
        for brut, propre, jeton in CAS:
            self.assertEqual(corr.titre_federal(brut), (propre, jeton), brut)

    def test_le_nom_de_l_auteur_ne_reste_jamais(self):
        for brut, _, _ in CAS:
            propre = corr.titre_federal(brut)[0]
            for nom in ('Duval', 'Martin Léa', 'Dupont', 'Dupont Anne'):
                self.assertNotIn(nom, propre, brut)

    def test_un_titre_ordinaire_ne_change_pas(self):
        for t in INTACTS:
            self.assertEqual(corr.titre_federal(t), (t, None), t)

    def test_chaque_abreviation_de_l_indice_de_type(self):
        for ab, jeton in (('Iv.pa.', 'initiative-parlementaire'), ('Pa.Iv.', 'initiative-parlementaire'),
                          ('Iv. ct.', 'initiative-cantonale'), ('Mo.', 'motion'), ('Po.', 'postulat'), ('Ip.', 'interpellation'),
                          ('Fra.', 'question')):
            self.assertEqual(corr.titre_federal(f'22.100 n {ab} Dupont. Un titre')[1], jeton, ab)
        self.assertEqual(corr.titre_federal('22.100 Fragestunde. Un titre')[1], 'question')


class TestDansLeLot(unittest.TestCase):
    setUp, tearDown, ajouter, lot = (TestPropositions.setUp, TestPropositions.tearDown, TestPropositions.ajouter,
                                     TestPropositions.lot)

    def test_titres_et_valeurs_sans_nom_ni_numero_et_type_depuis_l_abreviation(self):
        titres = {'fr': '21.498 n Iv.pa. Duval. Mettre en oeuvre le rapport', 'de': '21.498 n Pa.Iv. Duval. Umsetzung des Berichtes',
                  'it': '21.498 n Iv.pa. Duval. Attuare il rapporto'}
        a = aff('CHE', 'p1', ' / '.join(titres.values()), number='21.498', harm=5, tn={'de': 'Vernehmlassung'}, brut={'title': titres})
        self.ajouter(a)
        mono = {'fr': '22.405 n Iv. pa. Duval. Titre seul'}
        self.ajouter(aff('CHE', 'p2', mono['fr'], number='22.405', harm=5, tn={'de': 'Vernehmlassung'}, brut={'title': mono}))
        lot = {p['cle'].rsplit(':', 1)[1]: p for p in self.lot(ep.exporter(self.cfg, self.base))}
        multi = lot['p1']
        self.assertEqual(multi['titres']['fr'], 'Mettre en oeuvre le rapport')
        self.assertEqual(multi['titres']['de'], 'Umsetzung des Berichtes')
        self.assertEqual(multi['valeurs']['categorie'], 'initiative-parlementaire')
        self.assertNotIn('correspondance-incertaine', [d['code'] for d in multi['doutes']])
        seul = lot['p2']
        self.assertEqual(seul['valeurs']['title'], 'Titre seul')
        for ligne in lot.values():
            texte = json.dumps(ligne, ensure_ascii=False)
            self.assertNotIn('Duval', texte)                              # ni titres, ni valeurs, ni brut
            self.assertNotIn('Iv.pa.', texte)
            self.assertNotIn('21.498 n', texte)

    def test_un_autre_corps_garde_son_titre_et_son_type(self):
        self.ajouter(aff('ZH', 'z1', '22.405 Titre zurichois. Suite', number='1', brut={'title': '22.405 Titre zurichois. Suite'}))
        (p,) = self.lot(ep.exporter(self.cfg, self.base))
        self.assertEqual(p['valeurs']['title'], '22.405 Titre zurichois. Suite')


class TestReferenceCitee(unittest.TestCase):
    def test_la_reference_federale_citee_perd_son_nom(self):
        t = 'Kommission X; 21.498 n Pa. Iv. Duval. Umsetzung des Berichtes; Vernehmlassung'
        self.assertEqual(corr.sans_reference_federale(t), 'Kommission X; Umsetzung des Berichtes; Vernehmlassung')
        self.assertEqual(corr.sans_reference_federale('Avis; 21.498 n Iv. pa. Martin Léa. Le titre ; fin'), 'Avis; Le titre ; fin')

    def test_un_titre_sans_reference_ne_change_pas(self):
        for t in ('Rapport 2024 sur le budget', 'Motion 22.3546 ignorée. Le Conseil décide', '21.498 Titre sans abréviation'):
            self.assertEqual(corr.sans_reference_federale(t), t)

    def test_dans_le_lot_d_un_autre_corps(self):
        t = 'Kommission X; 21.498 n Pa. Iv. Duval. Umsetzung des Berichtes; Vernehmlassung'
        self.ajouter(aff('BS', 'b1', t, number='P1', brut={'title': {'de': t}}))
        (p,) = self.lot(ep.exporter(self.cfg, self.base))
        self.assertNotIn('Duval', json.dumps(p, ensure_ascii=False))


TestReferenceCitee.setUp, TestReferenceCitee.tearDown, TestReferenceCitee.ajouter, TestReferenceCitee.lot = (
    TestPropositions.setUp, TestPropositions.tearDown, TestPropositions.ajouter, TestPropositions.lot)


class TestTypeParlementGenerique(unittest.TestCase):
    """L'API ne donnait aucun type harmonisé à « Objet du Parlement » ; l'export lui met 6 (Wahl) : il redevient inconnu."""
    def test_objet_du_parlement_n_est_plus_une_election(self):
        for lib in ('Geschäft des Parlaments', 'Objet du Parlement', 'Oggetto del Parlamento'):
            t = corr.type_effectif('CHE', '24.064', {'de': lib}, 6)
            self.assertIsNone(t.get('ecarte'), lib)
            self.assertNotEqual(t.get('harm'), 6, lib)

    def test_une_vraie_election_reste_exclue(self):
        t = corr.type_effectif('LU', '1', {'de': 'Wahl'}, 6)
        self.assertEqual(t.get('harm'), 6)


if __name__ == '__main__':
    unittest.main()
