"""Lecteur d'exports de files.openparldata.ch : fichiers synthétiques, aucun réseau."""
import gzip
import io
import json
import os
import tempfile
import unittest

from parlement.sources import exports


def ecrire_gz(chemin, lignes):
    with gzip.open(chemin, 'wt', encoding='utf-8') as f:
        for d in lignes:
            f.write(json.dumps(d, ensure_ascii=False) + '\n')


def aff(corps='GE', ext='e1', id_=1, date='2025-03-01T10:00:00', **kw):
    d = {'body_key': corps, 'external_id': ext, 'id': id_, 'number': 'M 1', 'begin_date': date,
         'updated_at': '2026-01-01T00:00:00', 'type_harmonized_id': 2, 'title_de': None, 'title_fr': 'Titre',
         'title_it': None, 'title_rm': None, 'type_name_fr': 'Motion', 'type_name_de': '', 'url_external_fr': 'https://x/1'}
    d.update(kw)
    return d


class TestAplatir(unittest.TestCase):
    def test_les_champs_a_plat_redeviennent_des_dicts_de_langues(self):
        api = exports.aplatir_vers_api(aff(title_de='Titel', title_it=''))
        self.assertEqual(api['title'], {'de': 'Titel', 'fr': 'Titre'})
        self.assertEqual(api['type_name'], {'fr': 'Motion'})
        self.assertEqual(api['url_external'], {'fr': 'https://x/1'})
        self.assertNotIn('title_fr', api)
        self.assertEqual(api['number'], 'M 1')

    def test_un_groupe_vide_reste_un_dict_vide(self):
        api = exports.aplatir_vers_api({'title_de': '', 'x': 1})
        self.assertEqual(api['title'], {})


class TestLireAffaires(unittest.TestCase):
    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.chemin = os.path.join(self._t.name, 'affairs.ndjson.gz')

    def tearDown(self):
        self._t.cleanup()

    def test_forme_de_l_api_filtre_corps_et_depot(self):
        ecrire_gz(self.chemin, [aff('GE', 'a', 1), aff('VD', 'b', 2), aff('GE', 'c', 3, date='2023-01-01T00:00:00'),
                                aff('GE', 'd', 4, date=None)])
        r = list(exports.lire_affaires(self.chemin, {'GE'}, '2024-07-01'))
        self.assertEqual([a.external_id for a in r], ['a', 'd'])           # VD hors corps, c avant le dépôt, d sans date reste
        a = r[0]
        self.assertEqual((a.title, a.id_api, a.date_depot, a.url_externe), ('Titre', '1', '2025-03-01', 'https://x/1'))
        self.assertEqual(a.type_name, {'fr': 'Motion'})
        self.assertEqual(a.brut['title'], {'fr': 'Titre'})

    def test_titre_repli_fr_de_it_rm_et_espaces_de_bordure(self):
        ecrire_gz(self.chemin, [aff(title_fr='', title_de='  Deutsch  ', title_it='Italiano')])
        (a,) = list(exports.lire_affaires(self.chemin))
        self.assertEqual(a.title, 'Deutsch')

    def test_colonne_absente_casse_bruyamment(self):
        d = aff()
        del d['updated_at']
        ecrire_gz(self.chemin, [d])
        with self.assertRaises(exports.SchemaExport):
            list(exports.lire_affaires(self.chemin))

    def test_lecture_en_flux(self):
        ecrire_gz(self.chemin, [aff(ext=str(i), id_=i) for i in range(50)])
        gen = exports.lire_affaires(self.chemin)
        self.assertEqual(next(gen).external_id, '0')                         # un générateur, pas une liste


class TestDocumentsEtTextes(unittest.TestCase):
    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.rep = self._t.name

    def tearDown(self):
        self._t.cleanup()

    def test_documents_rattaches_aux_seules_affaires_demandees(self):
        chemin = os.path.join(self.rep, 'docs.ndjson.gz')
        ecrire_gz(chemin, [{'id': 1, 'affair_id': 10, 'name': 'a', 'text': 'x'}, {'id': 2, 'affair_id': 11, 'name': 'b', 'text': 'y'},
                           {'id': 3, 'affair_id': None, 'name': 'c', 'text': 'z'}])
        self.assertEqual([(a, d['id']) for a, d in exports.lire_documents(chemin, {10})], [(10, 1)])

    def test_textes_che_sans_balises_et_sans_titre_de_l_objet(self):
        chemin = os.path.join(self.rep, 'texts.ndjson.gz')
        ecrire_gz(chemin, [
            {'id': 1, 'affair_id': 10, 'type_fr': "Titre de l'objet", 'text_de': 'Titel', 'text_fr': 'Titre'},
            {'id': 2, 'affair_id': 10, 'type_fr': 'Texte déposé', 'text_de': '<p>Der <b>Rollstuhl</b></p>', 'text_fr': '<p>Le fauteuil</p>'},
            {'id': 3, 'affair_id': 99, 'type_fr': 'Texte déposé', 'text_de': 'autre'}])
        r = list(exports.lire_textes(chemin, {10}))
        self.assertEqual(len(r), 1)
        aid, doc = r[0]
        self.assertEqual((aid, doc['id'], doc['name']), (10, 'T2', 'Texte déposé'))
        self.assertEqual(doc['text'], 'Der Rollstuhl\nLe fauteuil')


class Reponse(io.BytesIO):
    pass


class TestTelechargeur(unittest.TestCase):
    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.rep = self._t.name
        self.vus, self.pauses = [], []
        self.temps = [0.0]

    def tearDown(self):
        self._t.cleanup()

    def fabrique(self, **kw):
        def ouvrir(url):
            self.vus.append(url)
            if url.endswith('absent.gz'):
                raise exports.FichierAbsent(url)
            return Reponse(b'contenu de ' + url.encode())
        return exports.Telechargeur(self.rep, delai=5.0, ouvrir=ouvrir, dormir=self.pauses.append,
                                    horloge=lambda: self.temps[0], **kw)

    def test_un_fichier_une_fois_et_cinq_secondes_entre_deux_fichiers(self):
        t = self.fabrique()
        a = t.telecharger('affairs.ndjson.gz')
        self.temps[0] = 1.0
        b = t.telecharger('docs/docs_JU.ndjson.gz')
        t.telecharger('affairs.ndjson.gz')                                   # déjà là : aucun nouvel appel
        self.assertEqual(len(self.vus), 2)
        self.assertEqual(self.pauses, [4.0])                                 # 5 s depuis la fin du premier, 1 s déjà écoulée
        self.assertTrue(os.path.exists(a) and os.path.exists(b))
        self.assertEqual(open(b, 'rb').read(), b'contenu de ' + (exports.BASE_URL + 'docs/docs_JU.ndjson.gz').encode())

    def test_suppression_apres_balayage_et_aucun_fichier_partiel(self):
        t = self.fabrique()
        a = t.telecharger('affairs.ndjson.gz')
        t.supprimer(a)
        self.assertEqual(os.listdir(self.rep), [])
        with self.assertRaises(exports.FichierAbsent):
            t.telecharger('docs/absent.gz')
        self.assertEqual([n for n in os.listdir(self.rep) if n.endswith('.part')], [])

    def test_aucune_requete_hors_de_l_hote_des_exports(self):
        t = self.fabrique()
        t.telecharger('affairs.ndjson.gz')
        self.assertTrue(all(u.startswith('https://files.openparldata.ch/exports/') for u in self.vus))
        self.assertNotIn('api.openparldata.ch', ''.join(self.vus))

    def test_l_en_tete_par_defaut_n_imite_pas_un_navigateur(self):
        import inspect
        src = inspect.getsource(exports._ouvrir_urllib)
        self.assertNotIn('User-Agent', src)
        self.assertNotIn('Mozilla', inspect.getsource(exports))


if __name__ == '__main__':
    unittest.main()
