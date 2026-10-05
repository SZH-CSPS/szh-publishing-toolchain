"""Import de base par les exports : fichiers synthétiques servis par un téléchargeur factice, aucun réseau."""
import gzip
import io
import json
import os
import tempfile
import unittest

from parlement import importer, lexique
from parlement.sources import exports
from parlement.stockage import Base
from parlement.tests.outils_test import config_test


def gz(lignes):
    tampon = io.BytesIO()
    with gzip.GzipFile(fileobj=tampon, mode='wb') as f:
        for d in lignes:
            f.write((json.dumps(d, ensure_ascii=False) + '\n').encode('utf-8'))
    return tampon.getvalue()


def aff(corps, ext, id_, titre, date='2025-03-01T00:00:00', maj='2026-01-01T00:00:00'):
    return {'body_key': corps, 'external_id': ext, 'id': id_, 'number': f'N{id_}', 'begin_date': date, 'updated_at': maj,
            'type_harmonized_id': 2, 'title_de': None, 'title_fr': titre, 'title_it': None, 'title_rm': None,
            'type_name_fr': 'Motion', 'url_external_fr': f'https://x/{id_}'}


FICHIERS = {
    'affairs.ndjson.gz': gz([
        aff('GE', 'a1', 1, 'Motion pour les élèves handicapés', maj='2026-02-01T00:00:00'),
        aff('GE', 'a2', 2, 'Budget routier', maj='2026-03-01T00:00:00'),
        aff('GE', 'a3', 3, 'Entretien des routes'),
        aff('VD', 'v1', 4, 'Ancienne motion handicap', date='2023-01-01T00:00:00'),
        aff('ZH', 'z1', 9, 'Hors périmètre handicap'),
        aff('CHE', 'c1', 5, 'Titre neutre'),
    ]),
    'docs/docs_GE.ndjson.gz': gz([
        {'id': 100, 'affair_id': 1, 'name': 'doc1', 'text': 'Texte sans terme.', 'url': 'u1', 'url_oparl': 'o1', 'language': ''},
        {'id': 101, 'affair_id': 1, 'name': 'doc1b', 'text': 'Autre pièce.', 'url': '', 'url_oparl': '', 'language': ''},
        {'id': 102, 'affair_id': 2, 'name': 'doc2', 'text': 'Un usager en Rollstuhl a besoin de rampes.', 'url': '',
         'url_oparl': '', 'language': ''},
        {'id': 103, 'affair_id': 3, 'name': 'doc3', 'text': 'Goudron et trottoirs.', 'url': '', 'url_oparl': '', 'language': ''},
        {'id': 104, 'affair_id': None, 'name': 'orphelin', 'text': 'Rollstuhl', 'url': '', 'url_oparl': '', 'language': ''}]),
    'texts/texts_CHE.ndjson.gz': gz([
        {'id': 7, 'affair_id': 5, 'type_fr': 'Texte déposé', 'text_de': '<p>Kinder mit Autismus</p>', 'text_fr': None},
        {'id': 8, 'affair_id': 5, 'type_fr': "Titre de l'objet", 'text_de': 'Autismus', 'text_fr': None}]),
}


class Fond(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lex = lexique.charger()

    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.rep = self._t.name
        self.cfg = config_test(self.rep)
        self.cfg['moisson']['depuis'] = '2024-07-01'
        self.cfg['classement'] = {'ecole_generale': False, 'themes_elargis': False}
        self.base = Base(':memory:')
        self.vus = []

        def ouvrir(url):
            rel = url[len(exports.BASE_URL):]
            self.vus.append(rel)
            if rel not in FICHIERS:
                raise exports.FichierAbsent(url)
            return io.BytesIO(FICHIERS[rel])
        self.tel = exports.Telechargeur(os.path.join(self.rep, 'dl'), delai=0, ouvrir=ouvrir, dormir=lambda s: None)

    def tearDown(self):
        self.base.fermer()
        self._t.cleanup()

    def lancer(self, **kw):
        return importer.importer(self.cfg, self.base, self.tel, self.lex, **kw)

    def un(self, sql, *p):
        return [tuple(r) for r in self.base.c.execute(sql, p)]


class TestImport(Fond):
    def test_affaires_du_perimetre_seulement_et_reperes(self):
        self.lancer()
        self.assertEqual(self.un('SELECT body_key, external_id FROM affaires ORDER BY 1, 2'),
                         [('CHE', 'c1'), ('GE', 'a1'), ('GE', 'a2'), ('GE', 'a3')])   # VD avant dépôt, ZH hors corps
        self.assertEqual(self.base.repere('GE'), '2026-03-01T00:00:00')
        self.assertEqual(self.un('SELECT nb_affaires FROM corps WHERE body_key=?', 'GE'), [(3,)])

    def test_candidates_par_le_titre_par_le_texte_et_par_texts_che(self):
        self.lancer()
        cand = {(r[0], r[1]) for r in self.un('SELECT external_id, terme FROM candidats')}
        self.assertEqual({e for e, _ in cand}, {'a1', 'a2', 'c1'})                # a3 : aucun terme, aucun titre
        self.assertIn(('a1', '(titre)'), cand)
        self.assertIn(('a2', 'Rollstuhl'), cand)
        self.assertTrue(any(e == 'c1' and t.lower().startswith('autis') for e, t in cand))

    def test_documents_des_seules_candidates_et_texte_marque_recupere(self):
        self.lancer()
        docs = self.un('SELECT body_key, id_api, doc_id FROM documents ORDER BY 1, 2, 3')
        self.assertEqual(docs, [('CHE', '5', 'T7'), ('GE', '1', '100'), ('GE', '1', '101'), ('GE', '2', '102')])
        self.assertEqual(self.un('SELECT external_id FROM textes_recuperes ORDER BY 1'), [('a1',), ('a2',), ('c1',)])
        self.assertEqual(self.un("SELECT texte, url, url_oparl FROM documents WHERE doc_id='100'"),
                         [('Texte sans terme.', 'u1', 'o1')])
        self.assertEqual(self.un("SELECT texte FROM documents WHERE doc_id='T7'"), [('Kinder mit Autismus',)])   # sans balises

    def test_extraits_de_recherche_ecrits_dans_le_brut(self):
        self.lancer()
        self.assertTrue(any('Rollstuhl' in e for e in self.base.extraits_recherche('GE', 'a2')))
        self.assertEqual(self.base.extraits_recherche('GE', 'a3'), [])

    def test_les_termes_sont_marques_cribles_et_les_fichiers_supprimes(self):
        self.lancer()
        self.assertGreater(self.un('SELECT COUNT(*) FROM criblages')[0][0], 200)
        self.assertEqual([n for n in os.listdir(self.tel.dossier) if n.endswith('.gz')], [])

    def test_un_fichier_documents_absent_n_arrete_pas_l_import(self):
        r = self.lancer(corps=['CHE'])
        self.assertTrue(r['corps']['CHE'].get('sans_fichier_documents'))
        self.assertEqual(self.un('SELECT doc_id FROM documents'), [('T7',)])

    def test_aucune_requete_hors_des_exports_et_chaque_fichier_une_fois(self):
        self.lancer()
        self.assertEqual(sorted(set(self.vus)), sorted(['affairs.ndjson.gz', 'docs/docs_GE.ndjson.gz',
                                                       'docs/docs_CHE.ndjson.gz', 'texts/texts_CHE.ndjson.gz']))
        self.assertEqual(len(self.vus), len(set(self.vus)))

    def test_le_classement_lit_les_donnees_importees(self):
        from parlement import classement
        self.lancer()
        comptes = classement.classer_base(self.cfg, self.base, self.lex)
        self.assertGreaterEqual(comptes['retenu'], 1)                          # a1 : « handicapés » au titre


if __name__ == '__main__':
    unittest.main()
