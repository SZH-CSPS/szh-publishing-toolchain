"""Lots `pronto-proposition/1` : format, cle stable, décisions, doublons, langue, dates, noms. Hors réseau."""
import json
import os
import re
import shutil
import tempfile
import unittest
from types import SimpleNamespace

from recherche import cli, db, propositions
from recherche.modele import Projet
from recherche.tests import outils

MAINTENANT = '2026-10-04T08:00:00Z'
CHAMPS_CONTRAT = {'title', 'institutions', 'debut', 'fin', 'lien', 'lien_libelle', 'descriptif'}
CLES_LIGNE = {'format', 'cle', 'moissonneur', 'type', 'langue', 'recolte', 'lien_source', 'valeurs', 'doutes',
              'brut', 'pertinence', 'doublon'}


def projet(source='snf', source_id='1', title='Autismus in der Schule und im Alltag', **kw):
    kw.setdefault('url', f'https://exemple.ch/{source_id}')
    kw.setdefault('langue', 'de')
    kw.setdefault('institutions', 'Universität Zürich')
    kw.setdefault('debut', '2025-01')
    kw.setdefault('fin', '2027-12')
    kw.setdefault('descriptif', 'Ein Projekt zum Autismus.')
    return Projet(source=source, source_id=source_id, title=title, **kw)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.config = outils.config(self.tmp)
        self.con = db.connecter(self.config['base'])
        self.addCleanup(self.con.close)

    def inserer(self, p, statut='nouveau', pertinence='autis'):
        id_, _ = db.enregistrer(self.con, p, statut, pertinence)
        self.con.commit()
        return id_

    def exporter(self, maintenant=MAINTENANT):
        return propositions.exporter(self.config, self.con, maintenant=maintenant)

    def lignes(self):
        noms = outils.lots(self.config['propositions'])
        sortie = []
        for n in noms:
            sortie += outils.lire_lot(os.path.join(self.config['propositions'], n))[1]
        return sortie

    def une(self):
        """Exporte, puis rend l'unique proposition écrite."""
        self.exporter()
        lignes = self.lignes()
        self.assertEqual(len(lignes), 1, lignes)
        return lignes[0]

    def codes(self, p, champ=None):
        return [d['code'] for d in p['doutes'] if champ is None or d['champ'] == champ]


class TestFormat(Base):
    def test_ligne_et_lot(self):
        self.inserer(projet())
        r = self.exporter()
        self.assertEqual(r['ecrites'], 1)
        noms = outils.lots(self.config['propositions'])
        self.assertEqual(noms, ['2026-10-04-1.jsonl'])
        self.assertEqual([n for n in os.listdir(self.config['propositions']) if n.endswith('.tmp')], [])
        brut, lignes = outils.lire_lot(os.path.join(self.config['propositions'], noms[0]))
        self.assertTrue(brut.endswith('\n'))
        self.assertNotIn('\r', brut)
        self.assertEqual(len(brut.rstrip('\n').split('\n')), 1)
        p = lignes[0]
        self.assertEqual(set(p), CLES_LIGNE)
        self.assertEqual(p['format'], 'pronto-proposition/1')
        self.assertEqual(p['moissonneur'], 'recherche')
        self.assertEqual(p['type'], 'recherche')
        self.assertIn(p['langue'], ('fr', 'de'))
        self.assertNotIn('langues', p)
        self.assertRegex(p['recolte'], r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$')
        self.assertLessEqual(set(p['valeurs']), CHAMPS_CONTRAT)
        self.assertNotIn('', p['valeurs'].values())
        self.assertEqual(p['valeurs']['lien'], 'https://exemple.ch/1')
        self.assertEqual(p['lien_source'], 'https://exemple.ch/1')
        self.assertNotIn('score', p['pertinence'])
        for d in p['doutes']:
            self.assertIn(d['code'], propositions.CODES_DOUTE)
            self.assertEqual(set(d) - {'suggestion'}, {'champ', 'code', 'detail'})

    def test_pas_de_lot_vide(self):
        r = self.exporter()
        self.assertIsNone(r['lot'])
        self.assertEqual(outils.lots(self.config['propositions']), [])

    def test_numero_du_jour_suit(self):
        self.inserer(projet(source_id='1'))
        self.exporter()
        self.inserer(projet(source_id='2', title='Gebärdensprache und Handicap im Unterricht'))
        self.exporter()
        self.assertEqual(outils.lots(self.config['propositions']), ['2026-10-04-1.jsonl', '2026-10-04-2.jsonl'])

    def test_lot_du_jour_supprime_ne_libere_pas_son_numero(self):
        dossier = self.config['propositions']
        self.inserer(projet(source_id='1'))
        self.exporter()
        self.inserer(projet(source_id='2', title='Gebärdensprache und Handicap im Unterricht'))
        self.exporter()
        os.remove(os.path.join(dossier, '2026-10-04-1.jsonl'))
        self.inserer(projet(source_id='3', title='Logopädie und Legasthenie in der Primarschule'))
        self.exporter()
        self.assertEqual(outils.lots(dossier), ['2026-10-04-2.jsonl', '2026-10-04-3.jsonl'])

    def test_dernier_lot_supprime_ne_libere_pas_son_numero(self):
        dossier = self.config['propositions']
        self.inserer(projet(source_id='1'))
        self.exporter()
        os.remove(os.path.join(dossier, '2026-10-04-1.jsonl'))
        self.inserer(projet(source_id='2', title='Gebärdensprache und Handicap im Unterricht'))
        self.exporter()
        self.assertEqual(outils.lots(dossier), ['2026-10-04-2.jsonl'])

    def test_un_projet_propose_ne_revient_pas(self):
        self.inserer(projet())
        self.exporter()
        r = self.exporter()
        self.assertEqual(r['ecrites'], 0)
        self.assertEqual(len(outils.lots(self.config['propositions'])), 1)

    def test_hors_sujet_et_termine_jamais_exportes(self):
        self.inserer(projet(source_id='1'), statut='hors-sujet', pertinence='')
        self.inserer(projet(source_id='2', title='Handicap und Arbeit'), statut='termine')
        self.assertEqual(self.exporter()['ecrites'], 0)


class TestCle(Base):
    def test_cle_du_premier_membre_connu(self):
        id_snf = self.inserer(projet(source='snf', source_id='100', url='https://data.snf.ch/grants/grant/100',
                                     descriptif=''))
        self.inserer(projet(source='site:hfh', source_id='https://www.hfh.ch/projekt/x', url='https://www.hfh.ch/projekt/x'))
        p = self.une()
        self.assertEqual(p['cle'], 'recherche:snf:100')
        self.assertEqual(p['valeurs']['lien'], 'https://www.hfh.ch/projekt/x')   # la page de l'école est préférée
        self.assertEqual(db.par_id(self.con, id_snf)['cle_proposition'], 'recherche:snf:100')

    def test_cle_gardee_quand_le_principal_change(self):
        id_a = self.inserer(projet(source='snf', source_id='100', title='ZEBRA: Stress und Wohlbefinden von Lehrteams'))
        self.exporter()
        id_b = self.inserer(projet(source='site:phbern', source_id='https://www.phbern.ch/x', url='https://www.phbern.ch/x',
                                   title='ZEBRA: Stress und Wohlbefinden von Lehrteams im Kontext schulischer Veränderung'))
        r = self.exporter(maintenant='2026-10-05T08:00:00Z')
        self.assertEqual(r['ecrites'], 0)        # rattaché au groupe déjà proposé, pas reproposé
        self.assertEqual(db.par_id(self.con, id_b)['statut'], 'doublon')
        self.assertEqual(db.par_id(self.con, id_b)['cle_proposition'], 'recherche:snf:100')
        cli.cmd_retablir(self.config, self.con, SimpleNamespace(ids=[id_a, id_b]))
        self.exporter(maintenant='2026-10-06T08:00:00Z')
        derniere = outils.lire_lot(os.path.join(self.config['propositions'], '2026-10-06-1.jsonl'))[1]
        self.assertEqual(len(derniere), 1)
        self.assertEqual(derniere[0]['cle'], 'recherche:snf:100')
        self.assertEqual(derniere[0]['valeurs']['lien'], 'https://www.phbern.ch/x')

    def test_cle_d_un_site_et_de_la_skbf(self):
        self.assertEqual(propositions.cle_de('site:hfh', 'https://www.hfh.ch/projekt/x'),
                         'recherche:hfh:https://www.hfh.ch/projekt/x')
        self.assertEqual(propositions.cle_de('skbf', '26:096'), 'recherche:skbf:26:096')


class TestDecisions(Base):
    def test_cle_decidee_exclue_et_motif_en_base(self):
        self.inserer(projet(source_id='7'))
        outils.ecrire_decision(self.config['decisions'], 'recherche:snf:7', motif='hors-sujet')
        r = self.exporter()
        self.assertEqual(r['ecrites'], 0)
        self.assertEqual(r['decidees'], 1)
        ligne = self.con.execute('SELECT decision, motif FROM decisions WHERE cle=?', ('recherche:snf:7',)).fetchone()
        self.assertEqual((ligne['decision'], ligne['motif']), ('refuse', 'hors-sujet'))


class TestDoublons(Base):
    def test_regroupement_par_rapprochement_sur(self):
        self.inserer(projet(source='snf', source_id='1', title='ZEBRA: Stress und Wohlbefinden von Lehrteams'))
        id_site = self.inserer(projet(source='site:phbern', source_id='https://www.phbern.ch/zebra', url='https://www.phbern.ch/zebra',
                                      title='ZEBRA: Stress und Wohlbefinden von Lehrteams im Kontext schulischer Veränderung'))
        p = self.une()
        self.assertEqual(p['valeurs']['lien'], 'https://www.phbern.ch/zebra')
        self.assertEqual(db.par_id(self.con, id_site)['statut'], 'propose')
        statuts = sorted(r['statut'] for r in db.lister(self.con))
        self.assertEqual(statuts, ['doublon', 'propose'])

    def test_titres_seulement_probables_ne_se_regroupent_pas(self):
        self.inserer(projet(source_id='1', title='Autismus in der Schule: eine Studie'))
        self.inserer(projet(source_id='2', title='Autismus und Familie: eine andere Untersuchung zu Hause'))
        self.exporter()
        self.assertEqual(len(self.lignes()), 2)

    def test_doublon_sur_avec_la_bibliotheque_non_exporte(self):
        outils.ecrire_fiche(self.config['bibliotheque'], 'autismus-schule', 'de',
                            {'title': 'Autismus in der Schule und im Alltag', 'uuid': 'U1', 'lien': 'https://autre.ch'})
        id_ = self.inserer(projet())
        r = self.exporter()
        self.assertEqual(r['ecrites'], 0)
        self.assertEqual(db.par_id(self.con, id_)['statut'], 'existant')

    def test_doublon_probable_renseigne(self):
        outils.ecrire_fiche(self.config['bibliotheque'], 'autismus-familie', 'de',
                            {'title': 'Autismus und Familie im Wandel der Zeit', 'uuid': 'Uuid0000000000AB'})
        self.inserer(projet(title='Autismus und Familie: neue Wege für Kinder'))
        p = self.une()
        self.assertEqual(p['doublon'], {'uuid': 'Uuid0000000000AB', 'slug': 'autismus-familie', 'certitude': 'probable'})


class TestPertinence(Base):
    def test_retenu_et_a_relire(self):
        self.inserer(projet(source_id='1', title='Autismus im Unterricht'), pertinence='autis')
        self.inserer(projet(source_id='2', title='Inklusive Hochschule morgen'), pertinence='inklusi')
        self.inserer(projet(source_id='3', title='HfH Projekt Zukunft'), pertinence='institution')
        self.exporter()
        par_cle = {p['cle']: p['pertinence'] for p in self.lignes()}
        self.assertEqual(par_cle['recherche:snf:1']['verdict'], 'retenu')
        self.assertEqual(par_cle['recherche:snf:2']['verdict'], 'a-relire')
        self.assertEqual(par_cle['recherche:snf:3']['verdict'], 'retenu')
        for v in par_cle.values():
            self.assertTrue(v['raison'])


class TestLangue(Base):
    def test_hep_vaud_en_francais(self):
        self.inserer(projet(source='site:hepvd', source_id='https://www.hepl.ch/p', url='https://www.hepl.ch/p', langue='fr',
                            title='LIJA: Enseigner la lecture'))
        p = self.une()
        self.assertEqual(p['langue'], 'fr')
        self.assertNotIn('langue-devinee', self.codes(p))

    def test_titre_fns_en_francais(self):
        self.inserer(projet(langue='', title='Autisme & Société : comprendre, détecter, inclure'))
        p = self.une()
        self.assertEqual(p['langue'], 'fr')
        self.assertNotIn('langue-devinee', self.codes(p))

    def test_titre_anglais_donne_de_avec_doute(self):
        self.inserer(projet(langue='en', title='Autism and the brain: a longitudinal study of the children'))
        p = self.une()
        self.assertEqual(p['langue'], 'de')
        self.assertEqual(self.codes(p, 'langue'), ['langue-devinee'])

    def test_titre_allemand_sans_traduction_anglaise(self):
        self.inserer(projet(langue='en', title='Care Leaver als Care Giver: Biographische Perspektiven auf die Pflege'))
        p = self.une()
        self.assertEqual(p['langue'], 'de')
        self.assertNotIn('langue-devinee', self.codes(p))

    def test_titre_anglais_descriptif_francais(self):
        self.inserer(projet(langue='en', title='Autism and the brain: a longitudinal study of the children',
                            descriptif="Les enfants avec un trouble du spectre de l'autisme sont suivis pendant trois ans "
                                       'dans les écoles de la région, avec leurs familles et leurs enseignants.'))
        p = self.une()
        self.assertEqual(p['langue'], 'fr')
        doutes = [d for d in p['doutes'] if d['code'] == 'langue-devinee']
        self.assertEqual(len(doutes), 1)
        self.assertIn('descriptif', doutes[0]['detail'])

    def test_titre_anglais_descriptif_anglais_reste_de(self):
        self.inserer(projet(langue='en', title='Autism and the brain: a longitudinal study of the children',
                            descriptif='The children with autism are followed for three years in the schools of the region.'))
        p = self.une()
        self.assertEqual(p['langue'], 'de')
        self.assertEqual(self.codes(p, 'langue'), ['langue-devinee'])


class TestDates(Base):
    def test_valeurs_conformes_seulement(self):
        self.inserer(projet(debut='2025-13', fin='2027'))
        p = self.une()
        self.assertNotIn('debut', p['valeurs'])
        self.assertEqual(p['valeurs']['fin'], '2027')
        self.assertIn('date-illisible', self.codes(p, 'debut'))
        self.assertEqual(p['brut']['debut'], '2025-13')

    def test_duree_phfhnw_d_une_autre_forme(self):
        # forme ancienne en base : la durée entière gardée telle quelle dans `debut`
        self.inserer(projet(source='site:phfhnw', source_id='https://www.fhnw.ch/p', url='https://www.fhnw.ch/p',
                            debut='September 2022 - August 2026', fin='', institutions='Pädagogische Hochschule FHNW'))
        p = self.une()
        self.assertNotIn('debut', p['valeurs'])
        self.assertNotIn('fin', p['valeurs'])
        doutes = {d['champ']: d for d in p['doutes'] if d['code'] == 'date-illisible'}
        self.assertEqual(doutes['debut']['suggestion'], '2022-09')
        self.assertEqual(doutes['fin']['suggestion'], '2026-08')
        self.assertEqual(p['brut']['debut'], 'September 2022')
        self.assertEqual(p['brut']['fin'], 'August 2026')
        self.assertNotIn('September', doutes['debut']['detail'])

    def test_duree_phfhnw_nouvelle_forme_en_extra(self):
        self.inserer(projet(source='site:phfhnw', source_id='https://www.fhnw.ch/q', url='https://www.fhnw.ch/q', debut='', fin='',
                            extra={'debut_brut': '1.4.2020', 'fin_brut': '31.3.2024'}))
        p = self.une()
        doutes = {d['champ']: d for d in p['doutes'] if d['code'] == 'date-illisible'}
        self.assertEqual(doutes['debut']['suggestion'], '2020-04-01')
        self.assertEqual(doutes['fin']['suggestion'], '2024-03-31')

    def test_fin_ouverte_sans_doute(self):
        self.inserer(projet(debut='2024', fin=''))
        p = self.une()
        self.assertNotIn('fin', p['valeurs'])
        self.assertEqual(self.codes(p, 'fin'), [])
        self.assertNotIn('fin', p['brut'])


class TestInstitutionsEtNoms(Base):
    def test_institutions_phbern_nettoyees_a_l_export(self):
        self.inserer(projet(source='site:phbern', source_id='https://www.phbern.ch/a', url='https://www.phbern.ch/a',
                            institutions='Pädagogische Hochschule Bern, Musterdorf, Universität Musterstadt'))
        p = self.une()
        self.assertEqual(p['valeurs']['institutions'], 'Pädagogische Hochschule Bern, Universität Musterstadt')
        self.assertEqual(p['brut']['institutions'], 'Pädagogische Hochschule Bern, Universität Musterstadt')
        self.assertEqual(self.codes(p, 'institutions'), [])

    def test_seule_l_ecole_reste(self):
        self.inserer(projet(source='site:phfhnw', source_id='https://www.fhnw.ch/b', url='https://www.fhnw.ch/b',
                            institutions='Pädagogische Hochschule FHNW, Lea Probe'))
        p = self.une()
        self.assertEqual(p['valeurs']['institutions'], 'Pädagogische Hochschule FHNW')
        self.assertEqual(self.codes(p, 'institutions'), ['champ-introuvable'])
        self.assertNotIn('Probe', json.dumps(p, ensure_ascii=False))

    def test_descriptif_repris_tel_quel_sans_doute(self):
        texte = ('Das Projekt untersucht Autismus.\n\nProjektleitung: Prof. Dr. Anna Beispiel\n\n'
                 'Die Projektleitung erfolgt durch Hans Muster, HfH.')
        self.inserer(projet(descriptif=texte))
        p = self.une()
        self.assertEqual(p['valeurs']['descriptif'], texte)
        self.assertEqual(p['brut']['descriptif'], texte)
        self.assertEqual(self.codes(p, 'descriptif'), [])

    def test_personne_nommee_dans_le_titre_masquee(self):
        self.inserer(projet(title='Autismus: Studie nach Prof. Hans Muster'))
        p = self.une()
        doutes = [d for d in p['doutes'] if d['code'] == 'personne-nommee']
        self.assertEqual([d['champ'] for d in doutes], ['title'])
        self.assertIn('H*** M***', doutes[0]['detail'])
        self.assertNotIn('suggestion', doutes[0])
        self.assertNotIn('Muster', json.dumps(p['doutes'], ensure_ascii=False))


class TestMigration(Base):
    def test_exportes_absents_de_la_bibliotheque_repassent_nouveau(self):
        outils.ecrire_fiche(self.config['bibliotheque'], 'deja-la', 'de',
                            {'title': 'Gebärdensprache im Unterricht der Zukunft', 'uuid': 'U2'})
        id_a = self.inserer(projet(source_id='1'), statut='exporte')
        id_b = self.inserer(projet(source='site:hfh', source_id='https://www.hfh.ch/projekt/a', url='https://www.hfh.ch/projekt/a'),
                            statut='doublon')
        id_c = self.inserer(projet(source_id='3', title='Gebärdensprache im Unterricht der Zukunft'), statut='exporte')
        for i in (id_a, id_b, id_c):
            db.marquer_fiche(self.con, i, 'slug', 'UUID', os.path.join(self.tmp, 'sortie', 'forschung', 'slug', 'recherche.de.txt'))
        self.con.commit()
        r = db.migrer_exportes(self.con, propositions.index_bibliotheque(self.config['bibliotheque']))
        self.assertEqual(r, {'nouveau': 2, 'existant': 1})
        self.assertEqual(db.par_id(self.con, id_a)['statut'], 'nouveau')
        self.assertEqual(db.par_id(self.con, id_a)['fiche_chemin'], '')
        self.assertEqual(db.par_id(self.con, id_b)['statut'], 'nouveau')
        self.assertEqual(db.par_id(self.con, id_c)['statut'], 'existant')
        self.assertEqual(db.migrer_exportes(self.con, propositions.index_bibliotheque(self.config['bibliotheque'])),
                         {'nouveau': 0, 'existant': 0})
        self.assertTrue(self.con.execute("SELECT 1 FROM migrations WHERE nom='exportes-vers-nouveau'").fetchone())

    def test_l_export_migre_avant_le_premier_lot(self):
        id_a = self.inserer(projet(source_id='1'), statut='exporte')
        db.marquer_fiche(self.con, id_a, 'slug', 'UUID', 'sortie/forschung/slug/recherche.de.txt')
        self.con.commit()
        self.assertEqual(self.exporter()['ecrites'], 1)

    def test_base_ancienne_recoit_ses_colonnes(self):
        chemin = os.path.join(self.tmp, 'ancienne.sqlite')
        import sqlite3
        ancienne = sqlite3.connect(chemin)
        ancienne.executescript(re.sub(r'\s+cle_proposition[^\n]*\n|\s+lot TEXT[^\n]*\n', '\n', db.SCHEMA_PROJETS))
        ancienne.close()
        con = db.connecter(chemin)
        colonnes = {r[1] for r in con.execute('PRAGMA table_info(projets)')}
        con.close()
        self.assertLessEqual({'cle_proposition', 'lot'}, colonnes)


if __name__ == '__main__':
    unittest.main()
