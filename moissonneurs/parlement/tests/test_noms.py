"""Contrôle indépendant des noms de personnes : doute `personne-nommee`, ligne retenue pour un nom d'auteur non coupé.
Tous les noms sont fictifs ; SUJETS fixe ce que le contrôle permanent doit toujours signaler."""
import json
import unittest

from parlement import export_propositions as ep, noms
from parlement.tests.test_propositions import TestPropositions, aff

CTX = noms.Contexte(blanche={'kanton', 'schule', 'motion', 'eingabe', 'rede', 'über', 'anlage', 'zur', 'salle', 'biblioteca', 'stiftung',
                             'unzulässiges', 'konstrukt', 'einreisesperre', 'ausweisung', 'aufführung', 'schiffbau', 'verwandlung',
                             'umsteigen', 'haltestelle', 'breite', 'zentrales', 'standortmodell', 'logopädie', 'freizügigkeitsgeldern',
                             'auffangeinrichtung', 'barrierefreie', 'kommunikation', 'schaltern'}, dure=set())

# noms-sujets de titres (noms fictifs, formes relevées dans la base) : chacun doit être signalé, dans la langue du titre
SUJETS = [
    ('de', 'Unzulässiges Konstrukt von Peter Muster bei seinem Chalet zur Steuerumgehung'),
    ('de', 'Einreisesperre und Ausweisung von Ali Beispiel'),
    ('de', 'Aufführung im Schiffbau «Die Verwandlung» von Franz Muster'),
    ('de', 'Stiftung gegründet von Hans Keller für Kinder mit Behinderung'),
    ('de', 'Veranstaltung zu Ehren von Anna Dubois im Stadthaus'),
    ('fr', 'Salle polyvalente fondée par Marc Dupuis pour les enfants du quartier'),
    ('fr', 'Pointages demandés par Toni Muster, ancien conseiller national, président de la commission'),
    ('fr', 'Rue en hommage à Jean Beispiel dans la commune de Lausanne'),
    ('fr', 'Inauguration de la place de feu Hans Keller dans le quartier'),
    ('it', 'Biblioteca fondata da Luca Bernasconi per i giovani del quartiere'),
    ('it', 'Scuola in memoria di Anna Dubois nel comune di Lugano'),
    ('it', 'Contributo per il progetto di Marco Bianchi nel quartiere'),
]
SANS_NOM = [
    'Umsteigen an der Haltestelle Breite für Rollstuhlfahrende', 'Zentrales Standortmodell Logopädie',
    'Anlage von Freizügigkeitsgeldern der Auffangeinrichtung', 'Barrierefreie Kommunikation an öffentlichen Schaltern',
    'Eingabe zur Sache im Kanton', 'Salle polyvalente pour les enfants du quartier',
    'Wieso ist dem Regierungsrat der Komfort der Velofahrer wichtiger als die Gesundheit der Passagiere?',
    'Décision pour l’Association de la Station d’Epuration de Sierre dans le cadre de son extension',
]


class TestDetecteur(unittest.TestCase):
    def test_masque_ne_laisse_aucun_nom_en_clair(self):
        self.assertEqual(noms.masque('Hans Keller'), 'H*** K***')
        self.assertEqual(noms.masque('Odile de Musterhof'), 'O*** de M***')

    def test_marqueur_fort_est_un_defaut(self):
        d, p = noms.analyser(['Eingabe Unterzeichner Piet Muster zur Sache'], CTX)
        self.assertEqual((d, p), (['Piet Muster'], []))

    def test_chaque_nom_sujet_connu_est_signale(self):
        """Le contrôle permanent échoue si un nom-sujet du jeu de test n'est plus signalé."""
        for langue, titre in SUJETS:
            with self.subTest(titre=titre):
                self.assertEqual(noms.langue_probable(titre), langue)
                d, p = noms.analyser([titre], CTX)
                self.assertEqual(d, [])
                self.assertEqual(len(p), 1, (titre, p))

    def test_un_titre_sans_nom_ne_donne_rien(self):
        for titre in SANS_NOM:
            with self.subTest(titre=titre):
                self.assertEqual(noms.analyser([titre], CTX), ([], []))

    def test_liste_blanche_et_titre_en_majuscules(self):
        self.assertEqual(noms.analyser(['Kanton Schule'], CTX), ([], []))
        self.assertEqual(noms.analyser(['HANS KELLER ET ANNA DUBOIS'], CTX), ([], []))

    def test_liste_blanche_tiree_des_titres(self):
        c = noms.contexte_de(['Salle Lausanne'] * 6 + ['Rue des écoles', 'Marc Dupuis'], lambda t: t, seuil=6)
        self.assertIn('salle', c.blanche)
        self.assertIn('écoles', c.blanche)      # un mot qui apparaît en minuscules est un nom commun
        self.assertNotIn('dupuis', c.blanche)
        self.assertNotIn('salle', c.dure)       # la liste dure ne garde que les mots très fréquents
        d = noms.contexte_de(['Salle Lausanne'] * 40, lambda t: t)
        self.assertIn('salle', d.dure)

    def test_signaux_forts_percent_la_liste_blanche_et_le_faible_non(self):
        ctx = noms.Contexte(blanche={'piazza', 'remo', 'scuola'}, dure=set())
        # « Piazza » est un mot commun, mais après « fondata da » le nom est signalé
        self.assertEqual(noms.analyser(['Scuola fondata da Remo Piazza a Villa'], ctx)[1], ['Remo Piazza'])
        # après une simple préposition, la liste blanche protège
        self.assertEqual(noms.analyser(['Scuola di Remo Piazza'], ctx), ([], []))

    def test_une_paire_capitalisee_sans_signal_n_est_pas_signalee(self):
        self.assertEqual(noms.analyser(['Spinning Tales pendant les Kunsttage Basel'], noms.Contexte(set(), set())), ([], []))

    def test_fonction_avant_ou_apres(self):
        ctx = noms.Contexte(set(), set())
        self.assertEqual(noms.analyser(['Stadtrat Piet Muster; Rücktritt'], ctx)[1], ['Piet Muster'])
        self.assertEqual(noms.analyser(['Pointages demandés pour Piet Muster, ancien conseiller national, président'], ctx)[1], ['Piet Muster'])


class TestDansLeLot(unittest.TestCase):
    setUp, tearDown, ajouter, lot = (TestPropositions.setUp, TestPropositions.tearDown, TestPropositions.ajouter,
                                     TestPropositions.lot)

    def test_doute_pose_nom_masque_et_titre_sans_nom_sans_doute(self):
        self.ajouter(aff('VD', 'a2', 'Salle polyvalente fondée par Marc Dupuis pour les enfants du quartier', number='2'))
        self.ajouter(aff('VD', 'a3', 'Salle polyvalente pour les enfants du quartier', number='3'))
        lot = {p['cle'].rsplit(':', 1)[1]: p for p in self.lot(ep.exporter(self.cfg, self.base))}
        dp = [d for d in lot['a2']['doutes'] if d['code'] == 'personne-nommee']
        self.assertEqual(len(dp), 1)
        self.assertEqual(dp[0]['champ'], 'title')
        self.assertEqual(dp[0]['detail'], 'nom de personne possible dans le titre : M*** D***')
        self.assertNotIn('suggestion', dp[0])
        for d in lot['a2']['doutes']:
            self.assertNotIn('Dupuis', d['detail'])
        self.assertEqual([d for d in lot['a3']['doutes'] if d['code'] == 'personne-nommee'], [])

    def test_nom_d_auteur_non_coupe_retient_la_ligne(self):
        self.ajouter(aff('ZG', 'b1', 'Eingabe Unterzeichner Piet Muster zur Sache', number='1'))
        self.ajouter(aff('ZG', 'b2', 'Schulen im Kanton Zug', number='2'))
        res = ep.exporter(self.cfg, self.base)
        self.assertEqual([p['cle'].rsplit(':', 1)[1] for p in self.lot(res)], ['b2'])
        self.assertEqual(res['controle_noms']['defauts'], 1)
        raison = [r for _, r in res['ecartees'] if r.startswith(ep.RAISON_NOM)]
        self.assertEqual(raison, [ep.RAISON_NOM + ' : P*** M***'])
        self.assertNotIn('Muster', json.dumps(res['ecartees'], ensure_ascii=False))


if __name__ == '__main__':
    unittest.main()
