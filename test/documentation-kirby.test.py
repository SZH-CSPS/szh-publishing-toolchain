#!/usr/bin/env python3
"""Tests du convertisseur pipeline/documentation-kirby.py, sans pandoc : les lecteurs
restreints (Kirby .txt, YAML liste simple/structurée), le tri des fiches et la conversion
bout en bout sur un petit dossier jetable. Le rendu HTML final (filtres Lua compris) est
couvert par test/documentation-kirby.test.js, qui a besoin de pandoc — pas ce fichier.

    py -3 test/documentation-kirby.test.py
    python3 -m unittest test.documentation-kirby.test    (nécessite un nom de module valide,
                                                            préférer l'appel direct ci-dessus)
"""
import contextlib
import importlib.util
import io
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
        # Numéro + bibliothèque complets (docs/FORMAT-DOCUMENTATION-KIRBY.md) : la fiche
        # vit sous <racine>/_NewsUndActu/Fiches/<slug>/, plus dans l'article — même sans
        # Uuid, identifiant_fiche() retombe sur le nom du dossier DE LA FICHE (le slug),
        # jamais sur celui de l'article.
        self._ecrire('ausgabe.yaml', 'id: sansuuidtest01\n')
        self._ecrire('articles/essai/essai.meta.yaml', 'type: documentation\nlang: fr\n')
        self._ecrire('articles/essai/documentation.fr.txt', 'Title: Essai\n')
        racine = os.path.join(self.dossier, 'racine')
        self._ecrire(
            os.path.relpath(os.path.join(racine, '_NewsUndActu', 'Fiches', 'buecher',
                                          'un-livre', 'livre.fr.txt'), self.dossier),
            'Title: Un livre\n\n----\n\nAusgabe: sansuuidtest01\n\n----\n\nOrdre: 1\n\n'
            '----\n\nAuteurs: X\n\n----\n\nAnnee: 2026\n\n----\n\nEditeur: Y\n\n'
            '----\n\nDescriptif: Z\n')
        sortie = dk.convertir(os.path.join(self.dossier, 'articles', 'essai'), CHAMPS_JSON,
                               racine_news=racine)
        self.assertIn('#un-livre', sortie)
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


# ── Racine de la bibliothèque _NewsUndActu (docs/FORMAT-DOCUMENTATION-KIRBY.md) ─────────

class RacineNews(unittest.TestCase):
    def setUp(self):
        self.dossier = tempfile.mkdtemp(prefix='szh-doc-racine-')

    def tearDown(self):
        import shutil
        shutil.rmtree(self.dossier, ignore_errors=True)

    def _numero(self, *segments):
        chemin = os.path.join(self.dossier, *segments)
        os.makedirs(chemin, exist_ok=True)
        with open(os.path.join(chemin, 'ausgabe.yaml'), 'w', encoding='utf-8') as f:
            f.write('id: peuimporte000001\n')
        return chemin

    def test_trouver_dossier_numero_remonte_depuis_larticle(self):
        numero = self._numero('Revue', '2026-02')
        article = os.path.join(numero, 'articles', 'essai')
        os.makedirs(article, exist_ok=True)
        self.assertEqual(dk.trouver_dossier_numero(article), numero)

    def test_trouver_dossier_numero_absent_rend_none(self):
        article = os.path.join(self.dossier, 'articles', 'essai')
        os.makedirs(article, exist_ok=True)
        self.assertIsNone(dk.trouver_dossier_numero(article))

    def test_racine_sous_revue_numero_en_cours(self):
        numero = self._numero('Revue', '2026-02')
        self.assertEqual(dk.trouver_racine_news(numero), self.dossier)

    def test_racine_sous_zeitschrift_numero_en_cours(self):
        numero = self._numero('Zeitschrift', '2026-02')
        self.assertEqual(dk.trouver_racine_news(numero), self.dossier)

    def test_racine_sous_archive_un_cran_plus_bas(self):
        numero = self._numero('_Archive', 'Revue', '2025-09')
        self.assertEqual(dk.trouver_racine_news(numero), self.dossier)

    def test_racine_indecouvrable_sort_en_erreur(self):
        numero = self._numero('ailleurs', '2026-02')
        with self.assertRaises(SystemExit):
            dk.trouver_racine_news(numero)

    def test_racine_news_argument_prime_sur_tout(self):
        numero = self._numero('Revue', '2026-02')
        self.assertEqual(dk.trouver_racine_news(numero, racine_news='/une/autre/racine'),
                          os.path.abspath('/une/autre/racine'))

    def test_racine_news_variable_environnement(self):
        numero = self._numero('ailleurs', '2026-02')  # indécouvrable sans surcharge
        ancien = os.environ.get('SZH_NEWS_RACINE')
        os.environ['SZH_NEWS_RACINE'] = '/une/racine/env'
        try:
            self.assertEqual(dk.trouver_racine_news(numero), os.path.abspath('/une/racine/env'))
        finally:
            if ancien is None:
                os.environ.pop('SZH_NEWS_RACINE', None)
            else:
                os.environ['SZH_NEWS_RACINE'] = ancien


# ── La bibliothèque de fiches : Ausgabe, langue, Ordre, orpheline, statut ────────────────

class BibliothequeFiches(unittest.TestCase):
    def setUp(self):
        with open(CHAMPS_JSON, encoding='utf-8') as f:
            self.champs = json.load(f)
        self.dossier = tempfile.mkdtemp(prefix='szh-doc-bib-')
        self.numero = os.path.join(self.dossier, 'numero')
        self.racine = os.path.join(self.dossier, 'racine')
        os.makedirs(self.numero, exist_ok=True)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.dossier, ignore_errors=True)

    def _fiche(self, slug, fichier, contenu, dossier_surcharge=None):
        # Fiches\<dossier du type>\<slug>\<fichier> (types[].dossier du contrat, docs/FORMAT-
        # DOCUMENTATION-KIRBY.md, §Une fiche, 23.09.2026) : le dossier de type se déduit du
        # type porté par le nom du fichier, sauf dossier_surcharge — utilisé par les tests qui
        # rangent volontairement un fichier au mauvais endroit.
        type_ = fichier.split('.', 1)[0]
        dossier_type = dossier_surcharge or self.champs['types'][type_]['dossier']
        chemin = os.path.join(self.racine, '_NewsUndActu', 'Fiches', dossier_type, slug)
        os.makedirs(chemin, exist_ok=True)
        with open(os.path.join(chemin, fichier), 'w', encoding='utf-8') as f:
            f.write(contenu)

    def _article(self, id_numero, lang):
        with open(os.path.join(self.numero, 'ausgabe.yaml'), 'w', encoding='utf-8') as f:
            f.write(f'id: {id_numero}\n')
        article = os.path.join(self.numero, 'articles', 'essai')
        os.makedirs(article, exist_ok=True)
        with open(os.path.join(article, 'essai.meta.yaml'), 'w', encoding='utf-8') as f:
            f.write(f'type: documentation\nlang: {lang}\n')
        with open(os.path.join(article, f'documentation.{lang}.txt'), 'w', encoding='utf-8') as f:
            f.write('Title: Essai\n')
        return article

    def test_id_manquant_sort_en_erreur(self):
        with open(os.path.join(self.numero, 'ausgabe.yaml'), 'w', encoding='utf-8') as f:
            f.write('title: "sans id"\n')
        article = os.path.join(self.numero, 'articles', 'essai')
        os.makedirs(article, exist_ok=True)
        with open(os.path.join(article, 'essai.meta.yaml'), 'w', encoding='utf-8') as f:
            f.write('type: documentation\nlang: fr\n')
        with open(os.path.join(article, 'documentation.fr.txt'), 'w', encoding='utf-8') as f:
            f.write('Title: X\n')
        with self.assertRaises(SystemExit):
            dk.convertir(article, CHAMPS_JSON, racine_news=self.racine)

    def test_selection_par_ausgabe_et_langue(self):
        article = self._article('numeroa00000001', 'de')
        # Rattachée au bon numéro, dans la bonne langue : doit sortir.
        self._fiche('a', 'agenda.de.txt',
                     'Title: A\n\n----\n\nAusgabe: numeroa00000001\n\n----\n\nOrdre: 1\n\n'
                     '----\n\nEvenement: cours\n\n----\n\nDebut: 2026-01-01\n\n'
                     '----\n\nFin: 2026-01-02\n\n----\n\nLieu: X\n\n----\n\nOrganisateur: Y\n\n'
                     '----\n\nDescriptif: Z\n')
        # Autre numéro : ne doit pas sortir.
        self._fiche('b', 'agenda.de.txt',
                     'Title: B\n\n----\n\nAusgabe: numeroaXXXXXXXX\n\n----\n\nOrdre: 1\n\n'
                     '----\n\nEvenement: cours\n\n----\n\nDebut: 2026-01-01\n\n'
                     '----\n\nFin: 2026-01-02\n\n----\n\nLieu: X\n\n----\n\nOrganisateur: Y\n\n'
                     '----\n\nDescriptif: Z\n')
        # Bon numéro, mauvaise langue (fr, numéro est de) : ne doit pas sortir.
        self._fiche('c', 'agenda.fr.txt',
                     'Title: C\n\n----\n\nAusgabe: numeroa00000001\n\n----\n\nOrdre: 1\n\n'
                     '----\n\nEvenement: cours\n\n----\n\nDebut: 2026-01-01\n\n'
                     '----\n\nFin: 2026-01-02\n\n----\n\nLieu: X\n\n----\n\nOrganisateur: Y\n\n'
                     '----\n\nDescriptif: Z\n')
        sortie = dk.convertir(article, CHAMPS_JSON, racine_news=self.racine)
        self.assertIn('title="A"', sortie)
        self.assertNotIn('title="B"', sortie)
        self.assertNotIn('title="C"', sortie)

    def test_orpheline_ausgabe_vide_jamais_rattachee(self):
        article = self._article('numeroa00000001', 'de')
        self._fiche('orpheline', 'agenda.de.txt',
                     'Title: Orpheline\n\n----\n\nAusgabe:\n\n----\n\nEvenement: cours\n\n'
                     '----\n\nDebut: 2026-01-01\n\n----\n\nFin: 2026-01-02\n\n'
                     '----\n\nLieu: X\n\n----\n\nOrganisateur: Y\n\n----\n\nDescriptif: Z\n')
        sortie = dk.convertir(article, CHAMPS_JSON, racine_news=self.racine)
        self.assertNotIn('Orpheline', sortie)

    def test_fiche_bilingue_deux_numeros_differents(self):
        contenu_fr = ('Title: FR\n\n----\n\nAusgabe: numerofr00000001\n\n----\n\nOrdre: 1\n\n'
                       '----\n\nPortee: national\n\n----\n\nDescriptif: D\n')
        contenu_de = ('Title: DE\n\n----\n\nAusgabe: numerode00000002\n\n----\n\nOrdre: 1\n\n'
                       '----\n\nPortee: national\n\n----\n\nDescriptif: D\n')
        self._fiche('bilingue', 'horizon.fr.txt', contenu_fr)
        self._fiche('bilingue', 'horizon.de.txt', contenu_de)

        article_fr = self._article('numerofr00000001', 'fr')
        sortie_fr = dk.convertir(article_fr, CHAMPS_JSON, racine_news=self.racine)
        self.assertIn('title="FR"', sortie_fr)
        self.assertNotIn('title="DE"', sortie_fr)

        # Un second numéro (allemand, id différent) dans le MÊME dossier temporaire.
        self.numero = os.path.join(self.dossier, 'numero-de')
        os.makedirs(self.numero, exist_ok=True)
        article_de = self._article('numerode00000002', 'de')
        sortie_de = dk.convertir(article_de, CHAMPS_JSON, racine_news=self.racine)
        self.assertIn('title="DE"', sortie_de)
        self.assertNotIn('title="FR"', sortie_de)

    def test_statut_jamais_lu_comme_une_fiche(self):
        article = self._article('numeroa00000001', 'de')
        chemin_statut = os.path.join(self.racine, '_NewsUndActu', '_Statuts', 'de')
        os.makedirs(chemin_statut, exist_ok=True)
        with open(os.path.join(chemin_statut, 'un-uuid.txt'), 'w', encoding='utf-8') as f:
            f.write('Statut: a-traduire\n\n----\n\nDate: 2026-09-23\n')
        sortie = dk.convertir(article, CHAMPS_JSON, racine_news=self.racine)
        self.assertNotIn('a-traduire', sortie)

    def test_ordre_absent_avertit_et_se_replie_sur_le_tri_du_contrat(self):
        article = self._article('numeroa00000001', 'de')
        self._fiche('sans-ordre', 'agenda.de.txt',
                     'Title: Sans ordre\n\n----\n\nAusgabe: numeroa00000001\n\n'
                     '----\n\nEvenement: cours\n\n----\n\nDebut: 2026-01-01\n\n'
                     '----\n\nFin: 2026-01-02\n\n----\n\nLieu: X\n\n----\n\nOrganisateur: Y\n\n'
                     '----\n\nDescriptif: Z\n')
        racine = dk.trouver_racine_news(self.numero, self.racine)
        fiches = dk.lire_fiches_bibliotheque(racine, 'de', 'numeroa00000001', self.champs)
        self.assertEqual(len(fiches), 1)
        self.assertIsNone(fiches[0]['ordre'])
        with contextlib.redirect_stderr(io.StringIO()) as capture:
            dk.trier_fiches_numero(self.champs, fiches)
        self.assertIn('Ordre absent', capture.getvalue())

    def test_sous_dossier_inconnu_ignore_avec_avertissement(self):
        article = self._article('numeroa00000001', 'de')
        self._fiche('perdue', 'agenda.de.txt',
                     'Title: Perdue\n\n----\n\nAusgabe: numeroa00000001\n\n----\n\nOrdre: 1\n\n'
                     '----\n\nEvenement: cours\n\n----\n\nDebut: 2026-01-01\n\n'
                     '----\n\nFin: 2026-01-02\n\n----\n\nLieu: X\n\n----\n\nOrganisateur: Y\n\n'
                     '----\n\nDescriptif: Z\n', dossier_surcharge='DossierInconnu')
        racine = dk.trouver_racine_news(self.numero, self.racine)
        with contextlib.redirect_stderr(io.StringIO()) as capture:
            fiches = dk.lire_fiches_bibliotheque(racine, 'de', 'numeroa00000001', self.champs)
        self.assertEqual(fiches, [])
        self.assertIn('sous-dossier inconnu', capture.getvalue())

    def test_fichier_range_sous_le_mauvais_dossier_de_type_est_signale_et_non_lu(self):
        article = self._article('numeroa00000001', 'de')
        # livre.de.txt (type livre, dossier buecher) rangé sous filme (dossier du type film).
        self._fiche('livre-egare', 'livre.de.txt',
                     'Title: Livre égaré\n\n----\n\nAusgabe: numeroa00000001\n\n'
                     '----\n\nOrdre: 1\n\n----\n\nAuteurs: X\n\n----\n\nAnnee: 2026\n\n'
                     '----\n\nEditeur: Y\n\n----\n\nDescriptif: Z\n', dossier_surcharge='filme')
        racine = dk.trouver_racine_news(self.numero, self.racine)
        with contextlib.redirect_stderr(io.StringIO()) as capture:
            fiches = dk.lire_fiches_bibliotheque(racine, 'de', 'numeroa00000001', self.champs)
        self.assertEqual(fiches, [])
        self.assertIn('rangé sous le dossier', capture.getvalue())

    def test_liste_multiple_transportee_telle_quelle_en_attribut(self):
        # documentation-kirby.py ne connaît pas les listes du contrat (genre_film, pays) :
        # il transporte la valeur brute « jeton1, jeton2 » telle quelle en attribut, jamais
        # éclatée ni validée — la traduction et le rejet d'un jeton inconnu (aucun rejet :
        # imprimé tel quel) vivent dans szh-ressource.lua, couvert par
        # test/documentation-kirby.test.js. Ce test couvre le seul rôle de ce script : ne
        # rien perdre, ne rien modifier, y compris un jeton absent de la liste (« jeton-
        # inconnu-xyz », « ZZ-inconnu ») — un jeton fautif n'est pas du ressort du
        # convertisseur.
        article = self._article('numeroa00000001', 'de')
        self._fiche('un-film', 'film.de.txt',
                     'Title: Film de test\n\n----\n\nAusgabe: numeroa00000001\n\n'
                     '----\n\nOrdre: 1\n\n----\n\nCategorie: documentaire\n\n'
                     '----\n\nGenre: drame, jeton-inconnu-xyz\n\n'
                     '----\n\nPays: DE, CH, ZZ-inconnu\n\n'
                     '----\n\nRealisateur: X\n\n----\n\nAnnee: 2026\n\n'
                     '----\n\nDescriptif: Z\n')
        sortie = dk.convertir(article, CHAMPS_JSON, racine_news=self.racine)
        self.assertIn('genre="drame, jeton-inconnu-xyz"', sortie)
        self.assertIn('pays="DE, CH, ZZ-inconnu"', sortie)

    def test_ordre_en_double_avertit(self):
        article = self._article('numeroa00000001', 'de')
        for slug in ('a', 'b'):
            self._fiche(slug, 'agenda.de.txt',
                        f'Title: {slug}\n\n----\n\nAusgabe: numeroa00000001\n\n'
                        '----\n\nOrdre: 1\n\n----\n\nEvenement: cours\n\n'
                        '----\n\nDebut: 2026-01-01\n\n----\n\nFin: 2026-01-02\n\n'
                        '----\n\nLieu: X\n\n----\n\nOrganisateur: Y\n\n----\n\nDescriptif: Z\n')
        racine = dk.trouver_racine_news(self.numero, self.racine)
        fiches = dk.lire_fiches_bibliotheque(racine, 'de', 'numeroa00000001', self.champs)
        with contextlib.redirect_stderr(io.StringIO()) as capture:
            dk.trier_fiches_numero(self.champs, fiches)
        self.assertIn('Ordre en double', capture.getvalue())


if __name__ == '__main__':
    unittest.main()
