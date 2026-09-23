#!/usr/bin/env python3
"""Tests du convertisseur pipeline/documentation-kirby.py, sans pandoc : les lecteurs
restreints (Kirby .txt, YAML liste simple/structurée), le tri des fiches et la conversion
bout en bout sur un petit dossier jetable. Le rendu HTML final (filtres Lua compris) est
couvert par test/documentation-kirby.test.js, qui a besoin de pandoc — pas ce fichier.

    py -3 test/documentation-kirby.test.py
    python3 -m unittest test.documentation-kirby.test    (nécessite un nom de module valide,
                                                            préférer l'appel direct ci-dessus)
"""
import importlib.util
import json
import os
import sys
import tempfile
import unittest

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHAMPS_JSON = os.path.join(RACINE, 'pipeline', 'kirby', 'champs-documentation.json')

# Le nom du fichier porte un tiret : pas un identifiant Python valide pour `import`, d'où le
# chargement par chemin (importlib), la façon usuelle de charger un module ainsi nommé.
_spec = importlib.util.spec_from_file_location(
    'documentation_kirby', os.path.join(RACINE, 'pipeline', 'documentation-kirby.py'))
dk = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(dk)


class LecteursRestreints(unittest.TestCase):
    def test_devisser_scalaire_guillemets_doubles(self):
        self.assertEqual(dk.devisser_scalaire('"Antwort \\"des\\" Rats"'), 'Antwort "des" Rats')

    def test_devisser_scalaire_guillemets_simples(self):
        self.assertEqual(dk.devisser_scalaire("'ce n''est pas vide'"), "ce n'est pas vide")

    def test_devisser_scalaire_nu(self):
        self.assertEqual(dk.devisser_scalaire('  ZH  '), 'ZH')

    def test_parse_yaml_liste_simple(self):
        self.assertEqual(dk.parse_yaml_liste_simple('\n- couverture.png\n'), 'couverture.png')

    def test_parse_yaml_liste_simple_absente(self):
        self.assertIsNone(dk.parse_yaml_liste_simple(''))
        self.assertIsNone(dk.parse_yaml_liste_simple(None))

    def test_parse_yaml_liste_structuree_deux_entrees(self):
        valeur = (
            '- \n'
            '  date: "2026-08-20"\n'
            '  genre: "prise-position"\n'
            '  libelle: "Antwort des Regierungsrates"\n'
            '  lien: "https://www.zh.ch/x"\n'
            '- \n'
            '  date: "2026-08-25"\n'
            '  genre: "decision"\n'
        )
        entrees = dk.parse_yaml_liste_structuree(valeur)
        self.assertEqual(len(entrees), 2)
        self.assertEqual(entrees[0]['genre'], 'prise-position')
        self.assertEqual(entrees[0]['lien'], 'https://www.zh.ch/x')
        self.assertNotIn('libelle', entrees[1])

    def test_parse_yaml_liste_structuree_vide(self):
        self.assertEqual(dk.parse_yaml_liste_structuree(''), [])
        self.assertEqual(dk.parse_yaml_liste_structuree(None), [])


class KirbyTxt(unittest.TestCase):
    def test_champ_simple_sur_une_ligne(self):
        champs = dk.parse_kirby_txt('Title: Mon titre\n\n----\n\nCanton: ZH\n')
        self.assertEqual(champs['Title'], 'Mon titre')
        self.assertEqual(champs['Canton'], 'ZH')

    def test_champ_multiligne(self):
        champs = dk.parse_kirby_txt('Descriptif:\n\nPremière ligne.\n\nDeuxième ligne.\n')
        self.assertEqual(champs['Descriptif'], 'Première ligne.\n\nDeuxième ligne.')

    def test_ligne_de_valeur_echappee(self):
        # Une valeur qui commence par « ---- » s'écrit « \---- » et se relit sans le \.
        champs = dk.parse_kirby_txt('Descriptif:\n\n\\---- pas un séparateur\nsuite normale\n')
        self.assertEqual(champs['Descriptif'], '---- pas un séparateur\nsuite normale')

    def test_kirby_key(self):
        self.assertEqual(dk.kirby_key('title'), 'Title')
        self.assertEqual(dk.kirby_key('dossier_references'), 'Dossier_references')
        self.assertEqual(dk.kirby_key('lien_libelle'), 'Lien_libelle')

    def test_champ_absent_du_bloc_ne_casse_rien(self):
        champs = dk.parse_kirby_txt('Title: Seul champ\n')
        self.assertEqual(champs, {'Title': 'Seul champ'})


class TriDesFiches(unittest.TestCase):
    def setUp(self):
        with open(CHAMPS_JSON, encoding='utf-8') as f:
            self.champs = json.load(f)

    def _fiche(self, type_, dossier, **kirby_fields):
        return {'prefixe': 0, 'dossier': dossier, 'type': type_, 'champs': kirby_fields}

    def test_intervention_ch_avant_les_autres_cantons(self):
        fiches = [
            self._fiche('intervention', 'zh-fiche', Canton='ZH', Title='Z'),
            self._fiche('intervention', 'ch-fiche', Canton='CH', Title='A'),
        ]
        ordre = dk.ordre_attendu(self.champs, fiches)
        self.assertEqual(ordre, ['ch-fiche', 'zh-fiche'])

    def test_intervention_meme_canton_trie_par_titre(self):
        fiches = [
            self._fiche('intervention', 'zh-b', Canton='ZH', Title='Motion zur Fruehfoerderung'),
            self._fiche('intervention', 'zh-a', Canton='ZH', Title='Anfrage betreffend'),
        ]
        ordre = dk.ordre_attendu(self.champs, fiches)
        self.assertEqual(ordre, ['zh-a', 'zh-b'])

    def test_horizon_trie_par_index_de_liste_portee(self):
        # listes.portee : international, national, regional, varia — pas alphabétique.
        fiches = [
            self._fiche('horizon', 'regional-fiche', Portee='regional', Title='R'),
            self._fiche('horizon', 'intl-fiche', Portee='international', Title='I'),
        ]
        ordre = dk.ordre_attendu(self.champs, fiches)
        self.assertEqual(ordre, ['intl-fiche', 'regional-fiche'])

    def test_ordre_des_types_suit_ordreTypes(self):
        fiches = [
            self._fiche('agenda', 'agenda-fiche', Debut='2026-01-01', Title='A'),
            self._fiche('livre', 'livre-fiche', Title='B'),
        ]
        ordre = dk.ordre_attendu(self.champs, fiches)
        self.assertEqual(ordre, ['livre-fiche', 'agenda-fiche'])


class ConversionBoutEnBout(unittest.TestCase):
    def setUp(self):
        self.dossier = tempfile.mkdtemp(prefix='szh-doc-kirby-')

    def tearDown(self):
        import shutil
        shutil.rmtree(self.dossier, ignore_errors=True)

    def _ecrire(self, chemin_relatif, contenu):
        chemin = os.path.join(self.dossier, chemin_relatif)
        os.makedirs(os.path.dirname(chemin), exist_ok=True)
        with open(chemin, 'w', encoding='utf-8') as f:
            f.write(contenu)

    def test_section_vide_omise(self):
        self._ecrire('essai.meta.yaml', 'type: documentation\nlang: fr\n')
        self._ecrire('documentation.fr.txt', 'Title: Essai\n')
        sortie = dk.convertir(self.dossier, CHAMPS_JSON)
        self.assertNotIn(':::', sortie)  # rien à composer : aucune section, aucune fiche

    def test_fiche_sans_uuid_retombe_sur_le_nom_du_dossier(self):
        self._ecrire('essai.meta.yaml', 'type: documentation\nlang: fr\n')
        self._ecrire('documentation.fr.txt', 'Title: Essai\n')
        self._ecrire('1_un-livre/livre.fr.txt',
                      'Title: Un livre\n\n----\n\nAuteurs: X\n\n----\n\nAnnee: 2026\n\n'
                      '----\n\nEditeur: Y\n\n----\n\nDescriptif: Z\n')
        sortie = dk.convertir(self.dossier, CHAMPS_JSON)
        self.assertIn('#1_un-livre', sortie)
        self.assertIn('title="Un livre"', sortie)
        self.assertNotIn('titre="', sortie)

    def test_langue_deduite_du_fichier_unique_si_meta_muette(self):
        # Pas de lang: dans la fiche : un seul documentation.<lang>.txt présent tranche.
        self._ecrire('essai.meta.yaml', 'type: documentation\n')
        self._ecrire('documentation.de.txt', 'Title: Nur Deutsch\n')
        sortie = dk.convertir(self.dossier, CHAMPS_JSON)
        # Rien à composer (aucune rubrique ni fiche), mais surtout : aucune erreur, et le
        # fichier de langue déduite a bien été lu (sys.exit ne se serait pas tû sinon).
        self.assertEqual(sortie, '\n')

    def test_langue_introuvable_sort_en_erreur(self):
        self._ecrire('essai.meta.yaml', 'type: documentation\n')
        self._ecrire('documentation.fr.txt', 'Title: Un\n')
        self._ecrire('documentation.de.txt', 'Title: Zwei\n')
        with self.assertRaises(SystemExit):
            dk.convertir(self.dossier, CHAMPS_JSON)


if __name__ == '__main__':
    unittest.main()
