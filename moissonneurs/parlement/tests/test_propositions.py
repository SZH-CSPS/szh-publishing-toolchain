import json
import os
import tempfile
import unittest

from parlement import decisions, export_propositions as ep
from parlement.cli import CONTRAT
from parlement.sources.openparldata import Affaire
from parlement.stockage import Base
from parlement.tests.outils_test import config_pipeline



def ecrire_prod(racine, slug, titre, uuid, canton, numero='', lien='', cat='motion', lang='de'):
    dossier = os.path.join(racine, 'vorstoesse', slug)
    os.makedirs(dossier, exist_ok=True)
    corps = [('Title', titre), ('Uuid', uuid), ('Ausgabe', ''), ('Canton', canton), ('Categorie', cat),
             ('Numero', numero), ('Date', '2025-01-01'), ('Lien', lien)]
    texte = '\n\n----\n\n'.join(f'{k}: {v}' for k, v in corps if v != '' or k == 'Ausgabe') + '\n'
    with open(os.path.join(dossier, f'intervention.{lang}.txt'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(texte)


def aff(corps, ext, titre, number='M 1', harm=2, depot='2026-08-01', tn=None, **kw):
    d = dict(body_key=corps, external_id=ext, id_api=ext, number=number, title=titre,
             type_name=tn if tn is not None else {'de': 'Motion'}, type_harmonized_id=harm, date_depot=depot,
             updated_at='2026-09-01T00:00:00', url_externe=f'https://example.invalid/ext/{corps}/{ext}',
             url_oparl=f'https://example.invalid/{corps}/{ext}', brut={'title': titre})
    d.update(kw)
    return Affaire(**d)


class TestPropositions(unittest.TestCase):
    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.tmp = self._t.name
        self.cfg = config_pipeline(self.tmp)
        self.prod = os.path.join(self.tmp, 'prod')
        os.makedirs(self.prod)
        self.cfg['bibliotheque'] = {'fiches': self.prod, 'contrat': CONTRAT}
        self.cfg['sortie'].update({'propositions': os.path.join(self.tmp, 'props'),
                                   'decisions': os.path.join(self.tmp, 'decisions')})
        self.base = Base(':memory:')

    def tearDown(self):
        self.base.fermer()
        self._t.cleanup()

    def ajouter(self, a, verdict='retenu', raison='ancrage dans le titre : x', domaine='education'):
        self.base.enregistrer_affaire(a)
        self.base.c.execute('INSERT OR REPLACE INTO verdicts VALUES (?,?,?,?,?,?,?,?)',
                            (a.body_key, a.external_id, verdict, 8, domaine, '', raison, 'now'))

    def lot(self, res):
        with open(res['lot'], encoding='utf-8') as f:
            return [json.loads(l) for l in f.read().splitlines()]

    def test_une_ligne_par_affaire_au_format_pronto_proposition_1(self):
        self.ajouter(aff('ZH', '2', 'Förderklassen: Rahmenbedingungen', number='25.200'))
        res = ep.exporter(self.cfg, self.base)
        (p,) = self.lot(res)
        self.assertEqual(p['format'], 'pronto-proposition/1')
        self.assertEqual(p['cle'], 'parlement:openparldata:ZH:2')
        self.assertEqual((p['moissonneur'], p['type'], p['langue']), ('parlement', 'intervention', 'de'))
        self.assertRegex(p['recolte'], r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$')
        v = p['valeurs']
        self.assertEqual((v['canton'], v['categorie'], v['numero'], v['date'], v['source']),
                         ('ZH', 'motion', '25.200', '2026-08-01', 'openparldata'))
        self.assertEqual(p['pertinence']['verdict'], 'retenu')
        self.assertEqual(p['doutes'], [])
        self.assertIsNone(p['doublon'])
        self.assertTrue(p['lien_source'].startswith('https://'))
        for cle in ('title', 'date', 'categorie', 'numero', 'canton'):    # clés = noms de champs du contrat
            self.assertIn(cle, p['brut'])

    def test_ecarte_n_est_jamais_exporte_a_relire_l_est(self):
        self.ajouter(aff('ZH', '1', 'Strassen'), verdict='ecarte')
        self.ajouter(aff('ZH', '2', 'Inklusion in der Schule'), verdict='a-relire')
        res = ep.exporter(self.cfg, self.base)
        self.assertEqual([p['cle'] for p in self.lot(res)], ['parlement:openparldata:ZH:2'])
        self.assertEqual(self.lot(res)[0]['pertinence']['verdict'], 'a-relire')

    def test_lot_nomme_date_et_rang_ecrit_en_une_fois_jamais_modifie(self):
        self.ajouter(aff('ZH', '1', 'A'))
        r1 = ep.exporter(self.cfg, self.base, maintenant='2026-10-02T10:00:00Z')
        self.assertTrue(r1['lot'].endswith('2026-10-02-1.jsonl'))
        contenu = open(r1['lot'], 'rb').read()
        self.ajouter(aff('ZH', '2', 'B'))
        r2 = ep.exporter(self.cfg, self.base, maintenant='2026-10-02T11:00:00Z')
        self.assertTrue(r2['lot'].endswith('2026-10-02-2.jsonl'))
        self.assertEqual(open(r1['lot'], 'rb').read(), contenu)
        self.assertEqual([n for n in os.listdir(os.path.dirname(r1['lot'])) if n.endswith('.tmp')], [])

    def test_une_affaire_inchangee_n_est_pas_reproposee(self):
        self.ajouter(aff('ZH', '1', 'A'))
        ep.exporter(self.cfg, self.base)
        res = ep.exporter(self.cfg, self.base)
        self.assertIsNone(res['lot'])
        self.assertEqual(res['ecrites'], 0)

    def test_une_affaire_modifiee_revient_dans_un_lot_plus_recent(self):
        # la même cle dans un lot plus récent remplace l'ancienne (FORMAT-PROPOSITIONS.md)
        self.ajouter(aff('ZH', '1', 'A', brut={'v': 1}))
        r1 = ep.exporter(self.cfg, self.base, maintenant='2026-10-02T10:00:00Z')
        self.ajouter(aff('ZH', '1', 'A, corrigée', brut={'v': 2}))
        r2 = ep.exporter(self.cfg, self.base, maintenant='2026-10-03T10:00:00Z')
        self.assertEqual(self.lot(r2)[0]['cle'], self.lot(r1)[0]['cle'])
        self.assertEqual(self.lot(r2)[0]['valeurs']['title'], 'A, corrigée')

    def test_une_affaire_modifiee_mais_decidee_ne_revient_pas(self):
        self.ajouter(aff('ZH', '1', 'A', brut={'v': 1}))
        ep.exporter(self.cfg, self.base)
        os.makedirs(self.cfg['sortie']['decisions'])
        h = decisions.empreinte_cle('parlement:openparldata:ZH:1')
        with open(os.path.join(self.cfg['sortie']['decisions'], h + '.txt'), 'w', encoding='utf-8') as f:
            f.write('Cle: parlement:openparldata:ZH:1\n\n----\n\nDecision: accepte\n')
        self.ajouter(aff('ZH', '1', 'A', brut={'v': 2}))
        self.assertIsNone(ep.exporter(self.cfg, self.base)['lot'])

    def test_aucun_lot_vide(self):
        res = ep.exporter(self.cfg, self.base)
        self.assertIsNone(res['lot'])
        self.assertFalse(os.path.exists(self.cfg['sortie']['propositions']) and
                         os.listdir(self.cfg['sortie']['propositions']))

    def test_aucune_ecriture_hors_du_dossier_de_propositions(self):
        self.ajouter(aff('ZH', '1', 'A'))
        ep.exporter(self.cfg, self.base)
        self.assertFalse(os.path.exists(os.path.join(self.cfg['sortie']['dossier'], 'vorstoesse')))
        self.assertEqual(os.listdir(self.prod), [])

    def test_doublon_sur_n_est_pas_exporte(self):
        ecrire_prod(self.prod, 'deja', 'Titre déjà publié', 'U' * 16, 'LU', numero='25.356')
        self.ajouter(aff('LU', '1', 'Autre titre', number='25.356'))
        res = ep.exporter(self.cfg, self.base)
        self.assertIsNone(res['lot'])
        self.assertIn('LU/1', dict(res['ecartees']))
        self.assertIn('doublon sûr', res['ecartees'][0][1])

    def test_doublon_probable_est_exporte_avec_sa_fiche(self):
        ecrire_prod(self.prod, 'sonderpaed-lu', 'Sonderpädagogik im Kanton Luzern stärken', 'V' * 16, 'LU',
                    numero='24.001')
        self.ajouter(aff('LU', '1', 'Sonderpädagogik im Kanton Luzern deutlich stärken', number='25.999'))
        (p,) = self.lot(ep.exporter(self.cfg, self.base))
        self.assertEqual(p['doublon'], {'uuid': 'V' * 16, 'slug': 'sonderpaed-lu', 'certitude': 'probable'})

    def test_cle_decidee_est_exclue_et_son_motif_garde(self):
        self.ajouter(aff('ZH', '1', 'A'))
        self.ajouter(aff('ZH', '2', 'B'))
        h = decisions.empreinte_cle('parlement:openparldata:ZH:1')
        os.makedirs(self.cfg['sortie']['decisions'])
        with open(os.path.join(self.cfg['sortie']['decisions'], h + '.txt'), 'w', encoding='utf-8') as f:
            f.write('Cle: parlement:openparldata:ZH:1\n\n----\n\nDecision: refuse\n\n----\n\nMotif: hors-sujet\n'
                    '\n----\n\nDate: 2026-10-02\n')
        res = ep.exporter(self.cfg, self.base)
        self.assertEqual([p['cle'] for p in self.lot(res)], ['parlement:openparldata:ZH:2'])
        ligne = self.base.c.execute("SELECT decision, motif FROM decisions WHERE cle='parlement:openparldata:ZH:1'").fetchone()
        self.assertEqual((ligne['decision'], ligne['motif']), ('refuse', 'hors-sujet'))

    def test_date_illisible_champ_vide_et_doute(self):
        self.ajouter(aff('ZH', '1', 'A', depot='04.03.2026'))
        (p,) = self.lot(ep.exporter(self.cfg, self.base))
        self.assertNotIn('date', {k for k, v in p['valeurs'].items() if v})
        self.assertIn(('date', 'date-illisible'), [(d['champ'], d['code']) for d in p['doutes']])
        self.assertEqual(p['brut']['date'], '04.03.2026')
        d = next(d for d in p['doutes'] if d['champ'] == 'date')
        self.assertNotIn('04.03.2026', d['detail'])      # le detail explique, la valeur lue est dans brut.date
        doute = next(d for d in p['doutes'] if d['champ'] == 'date')
        self.assertEqual(doute['suggestion'], '2026-03-04')     # valeur conforme applicable d'un clic

    def test_date_vide_est_aussi_un_doute(self):
        self.ajouter(aff('ZH', '1', 'A', depot=''))
        (p,) = self.lot(ep.exporter(self.cfg, self.base))
        self.assertIn(('date', 'date-illisible'), [(d['champ'], d['code']) for d in p['doutes']])

    def test_type_sans_jeton_donne_un_doute_pas_un_jeton_invente(self):
        self.ajouter(aff('BE', '1', 'Bericht zur Inklusion', harm=None, tn={'de': 'Recommandation'}))
        (p,) = self.lot(ep.exporter(self.cfg, self.base))
        self.assertEqual(p['valeurs'].get('categorie', ''), '')
        self.assertIn(('categorie', 'correspondance-incertaine'), [(d['champ'], d['code']) for d in p['doutes']])

    def test_type_a_confirmer_est_exporte_avec_doute(self):
        self.ajouter(aff('BE', '1', 'Gesetz über die Sonderschulung', harm=9, tn={'de': 'Gesetz'}))
        (p,) = self.lot(ep.exporter(self.cfg, self.base))
        self.assertEqual(p['valeurs']['categorie'], 'objet-gouvernement')
        self.assertIn(('categorie', 'correspondance-incertaine'), [(d['champ'], d['code']) for d in p['doutes']])

    def test_canton_hors_liste_et_numero_absent(self):
        self.ajouter(aff('XX', '1', 'A', number=''))
        (p,) = self.lot(ep.exporter(self.cfg, self.base))
        codes = [(d['champ'], d['code']) for d in p['doutes']]
        self.assertIn(('canton', 'valeur-hors-liste'), codes)
        self.assertIn(('numero', 'champ-introuvable'), codes)
        self.assertEqual(p['valeurs'].get('canton', ''), '')

    def test_codes_de_doute_de_la_liste_fermee_seulement(self):
        self.ajouter(aff('XX', '1', 'A', number='', depot='n/a', harm=16))
        self.ajouter(aff('CHE', '2', 'Bericht', number='', depot=''))
        for p in self.lot(ep.exporter(self.cfg, self.base)):
            for d in p['doutes']:
                self.assertIn(d['code'], ep.CODES_DOUTE)
        self.assertEqual(set(ep.CODES_DOUTE), {'date-illisible', 'langue-devinee', 'correspondance-incertaine',
                                               'valeur-hors-liste', 'champ-introuvable', 'texte-tronque', 'personne-nommee'})

    def test_une_affaire_une_langue(self):
        self.ajouter(aff('GE', '1', 'Motion pour les élèves handicapés', number='M 2', harm=None, tn={}))
        self.ajouter(aff('TI', '2', 'Mozione sulla pedagogia speciale'))
        self.ajouter(aff('ZH', '3', 'Förderklassen'))
        ps = {p['cle'].split(':')[-2]: p for p in self.lot(ep.exporter(self.cfg, self.base))}
        self.assertEqual((ps['GE']['langue'], ps['TI']['langue'], ps['ZH']['langue']), ('fr', 'fr', 'de'))
        self.assertEqual(len(ps), 3)

    def test_langue_devinee_pour_un_canton_bilingue_sans_indice(self):
        a = aff('BE', '1', 'Förderung der Sonderpädagogik im Kanton Bern', brut={'title': 'Förderung der Sonderpädagogik im Kanton Bern'})
        self.ajouter(a)
        (p,) = self.lot(ep.exporter(self.cfg, self.base))
        self.assertEqual(p['langue'], 'de')
        self.assertIn('langue-devinee', [d['code'] for d in p['doutes']])

    def test_langue_sure_quand_la_source_la_donne(self):
        a = aff('CHE', '1', 'Titre', brut={'title': {'fr': 'Titre fr'}})
        self.ajouter(a)
        (p,) = self.lot(ep.exporter(self.cfg, self.base))
        self.assertEqual(p['langue'], 'fr')
        self.assertNotIn('langue-devinee', [d['code'] for d in p['doutes']])

    def test_aucun_nom_de_personne_dans_le_lot(self):
        a = aff('ZH', '1', 'A', brut={'title': 'A', 'contributors': [{'name': 'Une Personne'}]})
        self.ajouter(a)
        res = ep.exporter(self.cfg, self.base)
        self.assertNotIn('Une Personne', open(res['lot'], encoding='utf-8').read())

    def test_fragestunde_toujours_a_relire(self):
        from parlement import classement, lexique
        r = classement.classer(lexique.charger(), dict(body_key='CHE', number='1', title='Behindertengerechte Bahnhöfe',
                                                       type_name={'de': 'Fragestunde'}, type_harmonized_id=10), '')
        self.assertEqual(r.verdict, 'a-relire')


if __name__ == '__main__':
    unittest.main()


class TestBrutParChamp(unittest.TestCase):
    """FORMAT-PROPOSITIONS.md : une clé de brut porte le nom du champ du contrat ; champ introuvable = rien dans brut."""
    setUp, tearDown, ajouter, lot = (TestPropositions.setUp, TestPropositions.tearDown, TestPropositions.ajouter,
                                     TestPropositions.lot)

    def test_champ_introuvable_ne_laisse_rien_dans_brut(self):
        self.ajouter(aff('CHE', '1', 'Titre', number='', depot=''))
        (p,) = self.lot(ep.exporter(self.cfg, self.base))
        self.assertNotIn('numero', p['brut'])
        self.assertNotIn('date', p['brut'])
        codes = [(d['champ'], d['code']) for d in p['doutes']]
        self.assertIn(('numero', 'champ-introuvable'), codes)

    def test_brut_porte_la_valeur_lue_a_cote_du_champ(self):
        self.ajouter(aff('ZH', '1', 'Titre', number='KR-Nr. 41/2026', tn={'de': 'Anzug'}))
        (p,) = self.lot(ep.exporter(self.cfg, self.base))
        self.assertEqual(p['brut']['numero'], 'KR-Nr. 41/2026')
        self.assertEqual(p['brut']['categorie'], {'de': 'Anzug'})
        self.assertEqual(p['brut']['canton'], 'ZH')


class TestLangueToujoursRenseignee(unittest.TestCase):
    setUp, tearDown, ajouter, lot = (TestPropositions.setUp, TestPropositions.tearDown, TestPropositions.ajouter,
                                     TestPropositions.lot)
    """FORMAT-PROPOSITIONS.md : `langue` vaut `fr` ou `de`, jamais vide ; sinon la ligne est écartée par le cockpit."""
    def test_aucune_proposition_sans_langue(self):
        cas = [('BE', 'x1', 'Xyz 123'), ('FR', 'x2', 'Xyz 456'), ('VS', 'x3', '12345'), ('GR', 'x4', 'ABC'),
               ('CHE', 'x5', 'Titre sans mot-outil')]
        for corps, ext, titre in cas:
            self.ajouter(aff(corps, ext, titre, number=f'N{ext}', brut={'title': titre}))
        lot = self.lot(ep.exporter(self.cfg, self.base))
        self.assertEqual(len(lot), 5)
        for p in lot:
            self.assertIn(p['langue'], ('fr', 'de'), p['cle'])

    def test_langue_majoritaire_du_corps_quand_rien_ne_tranche(self):
        attendu = {'BE': 'de', 'FR': 'fr', 'VS': 'fr', 'GR': 'de', 'CHE': 'de'}
        for i, corps in enumerate(attendu):
            self.ajouter(aff(corps, f'm{i}', 'Xyz', number=f'M{i}', brut={'title': 'Xyz'}))
        for p in self.lot(ep.exporter(self.cfg, self.base)):
            corps = p['cle'].split(':')[-2]
            self.assertEqual(p['langue'], attendu[corps], corps)
            doute = next(d for d in p['doutes'] if d['code'] == 'langue-devinee')
            self.assertEqual(doute['champ'], 'langue')
            self.assertIn('majoritaire', doute['detail'])


class TestConstatsSurDonneesReelles(unittest.TestCase):
    """Défauts vus dans le premier lot réel (03.10.2026) : titres sur plusieurs lignes, numéro « V null », décisions du gouvernement."""
    setUp, tearDown, ajouter, lot = (TestPropositions.setUp, TestPropositions.tearDown, TestPropositions.ajouter,
                                     TestPropositions.lot)

    def test_titre_sur_une_seule_ligne(self):
        self.ajouter(aff('TI', '1', 'Petizione: "Disabilità"\r\nSessione  parlamentare\n\ndel 5 giugno', number='PE84'))
        (p,) = self.lot(ep.exporter(self.cfg, self.base))
        self.assertEqual(p['valeurs']['title'], 'Petizione: "Disabilità" Sessione parlamentare del 5 giugno')

    def test_numero_null_de_la_source_est_un_champ_introuvable(self):
        self.ajouter(aff('BL', '1', 'Behinderung im Kanton', number='V null'))
        (p,) = self.lot(ep.exporter(self.cfg, self.base))
        self.assertNotIn('numero', p['valeurs'])
        self.assertNotIn('numero', p['brut'])
        self.assertIn(('numero', 'champ-introuvable'), [(d['champ'], d['code']) for d in p['doutes']])

    def test_decision_du_gouvernement_sans_type_harmonise_est_ecartee(self):
        from parlement import classement, lexique
        a = dict(body_key='BS', number='1', title='Rahmenkredit Verwaltung', type_harmonized_id=None,
                 type_name={'de': 'Regierungsratsbeschluss'})
        self.assertEqual(classement.classer(lexique.charger(), a, '').verdict, 'ecarte')


class TestFiltreDesVerdicts(unittest.TestCase):
    """[export] verdicts : filtre temporaire ; les verdicts non listés restent en base, jamais marqués exportés."""
    setUp, tearDown, ajouter, lot = (TestPropositions.setUp, TestPropositions.tearDown, TestPropositions.ajouter,
                                     TestPropositions.lot)

    def deux(self):
        self.ajouter(aff('ZH', '1', 'Sonderpädagogik'), verdict='retenu')
        self.ajouter(aff('ZH', '2', 'Inklusion an der Schule'), verdict='a-relire')

    def test_seul_retenu_est_exporte_et_les_autres_sont_comptes(self):
        self.cfg['export'] = {'verdicts': ['retenu']}
        self.deux()
        res = ep.exporter(self.cfg, self.base)
        self.assertEqual([p['cle'] for p in self.lot(res)], ['parlement:openparldata:ZH:1'])
        self.assertEqual(res['hors_lot_filtre'], 1)

    def test_liste_absente_ou_vide_vaut_retenu(self):
        for export in ({}, {'verdicts': []}):
            self.cfg['export'] = export
            self.assertEqual(ep.verdicts_exportes(self.cfg), ('retenu',))
        del self.cfg['export']
        self.assertEqual(ep.verdicts_exportes(self.cfg), ('retenu',))

    def test_valeur_inconnue_est_une_erreur_de_configuration(self):
        self.cfg['export'] = {'verdicts': ['retenu', 'ecarte']}
        with self.assertRaises(ep.ConfigurationExport):
            ep.verdicts_exportes(self.cfg)

    def test_les_lignes_filtrees_ne_sont_pas_marquees_exportees_et_partent_si_la_liste_change(self):
        self.cfg['export'] = {'verdicts': ['retenu']}
        self.deux()
        ep.exporter(self.cfg, self.base)
        n = self.base.c.execute('SELECT COUNT(*) FROM propositions').fetchone()[0]
        self.assertEqual(n, 1)
        self.cfg['export'] = {'verdicts': ['retenu', 'a-relire']}
        res = ep.exporter(self.cfg, self.base)
        self.assertEqual([p['cle'] for p in self.lot(res)], ['parlement:openparldata:ZH:2'])
        self.assertEqual(res['hors_lot_filtre'], 0)

    def test_filtre_a_relire_seul(self):
        self.cfg['export'] = {'verdicts': ['a-relire']}
        self.deux()
        res = ep.exporter(self.cfg, self.base)
        self.assertEqual([p['cle'] for p in self.lot(res)], ['parlement:openparldata:ZH:2'])
        self.assertEqual(res['hors_lot_filtre'], 1)


class TestArriereDuPremierLot(unittest.TestCase):
    """[export] arriere_a_relire_mois : au premier lot seulement, les « à relire » anciens restent en base, sans proposition."""
    setUp, tearDown, ajouter, lot = (TestPropositions.setUp, TestPropositions.tearDown, TestPropositions.ajouter,
                                     TestPropositions.lot)
    MAINTENANT = '2026-10-03T08:00:00Z'

    def preparer(self, mois=6):
        self.cfg['export'] = {'verdicts': ['retenu', 'a-relire'], 'arriere_a_relire_mois': mois}
        self.ajouter(aff('ZH', '1', 'Sonderpädagogik', depot='2025-01-10'), verdict='retenu')
        self.ajouter(aff('ZH', '2', 'Inklusion an der Schule', depot='2025-01-10'), verdict='a-relire')
        self.ajouter(aff('ZH', '3', 'Inklusion in der Schule', depot='2026-08-01'), verdict='a-relire')
        self.ajouter(aff('ZH', '4', 'Inklusion im Kindergarten', depot='2026-04-03'), verdict='a-relire')
        self.ajouter(aff('ZH', '5', 'Inklusion im Hort', depot=''), verdict='a-relire')

    def cles(self, res):
        return sorted(p['cle'].rsplit(':', 1)[1] for p in self.lot(res))

    def test_premier_lot_garde_les_retenus_de_toute_profondeur_et_retient_les_vieux_a_relire(self):
        self.preparer()
        res = ep.exporter(self.cfg, self.base, maintenant=self.MAINTENANT)
        self.assertEqual(self.cles(res), ['1', '3', '4', '5'])     # 4 : pile à la limite (N mois), 5 : sans date
        self.assertEqual(res['hors_lot_arriere'], 1)

    def test_la_retenue_ne_laisse_aucune_trace_et_le_lot_suivant_l_emporte(self):
        self.preparer()
        ep.exporter(self.cfg, self.base, maintenant=self.MAINTENANT)
        n = self.base.c.execute('SELECT COUNT(*) FROM propositions WHERE cle LIKE "%:ZH:2"').fetchone()[0]
        self.assertEqual(n, 0)
        res = ep.exporter(self.cfg, self.base, maintenant='2026-10-04T08:00:00Z')    # plus le premier lot
        self.assertEqual(self.cles(res), ['2'])
        self.assertEqual(res['hors_lot_arriere'], 0)

    def test_pas_de_regle_si_un_lot_a_deja_ete_ecrit(self):
        self.cfg['export'] = {'verdicts': ['retenu', 'a-relire'], 'arriere_a_relire_mois': 6}
        self.ajouter(aff('ZH', '9', 'Sonderpädagogik', depot='2026-09-01'), verdict='retenu')
        ep.exporter(self.cfg, self.base, maintenant=self.MAINTENANT)
        self.ajouter(aff('ZH', '2', 'Inklusion an der Schule', depot='2025-01-10'), verdict='a-relire')
        res = ep.exporter(self.cfg, self.base, maintenant='2026-10-04T08:00:00Z')
        self.assertEqual(self.cles(res), ['2'])
        self.assertEqual(res['hors_lot_arriere'], 0)

    def test_la_purge_des_fichiers_de_lot_ne_ramene_pas_au_premier_lot(self):
        self.cfg['export'] = {'verdicts': ['retenu', 'a-relire'], 'arriere_a_relire_mois': 6}
        self.ajouter(aff('ZH', '9', 'Sonderpädagogik', depot='2026-09-01'), verdict='retenu')
        res = ep.exporter(self.cfg, self.base, maintenant=self.MAINTENANT)
        os.remove(res['lot'])                                                   # la purge a effacé le lot
        self.ajouter(aff('ZH', '2', 'Inklusion an der Schule', depot='2025-01-10'), verdict='a-relire')
        res = ep.exporter(self.cfg, self.base, maintenant='2026-10-04T08:00:00Z')
        self.assertEqual(self.cles(res), ['2'])

    def test_sans_reglage_rien_n_est_retenu(self):
        self.preparer()
        del self.cfg['export']['arriere_a_relire_mois']
        res = ep.exporter(self.cfg, self.base, maintenant=self.MAINTENANT)
        self.assertEqual(self.cles(res), ['1', '2', '3', '4', '5'])
        self.assertEqual(res['hors_lot_arriere'], 0)

    def test_valeur_invalide_est_une_erreur_de_configuration(self):
        for v in (-3, 'six', 2.5, True):
            self.cfg['export'] = {'arriere_a_relire_mois': v}
            with self.assertRaises(ep.ConfigurationExport, msg=repr(v)):
                ep.arriere_a_relire_mois(self.cfg)
        self.cfg['export'] = {'arriere_a_relire_mois': 6}
        self.assertEqual(ep.arriere_a_relire_mois(self.cfg), 6)
        self.cfg['export'] = {}
        self.assertEqual(ep.arriere_a_relire_mois(self.cfg), 0)


class TestPropositionsMultilingues(unittest.TestCase):
    """FORMAT-PROPOSITIONS.md « Une proposition pour les deux revues » : `langues` + `titres` à la racine, jamais `langue` ni `valeurs.title`."""
    setUp, tearDown, ajouter, lot = (TestPropositions.setUp, TestPropositions.tearDown, TestPropositions.ajouter,
                                     TestPropositions.lot)

    def une(self, corps, titres, ext='1'):
        self.ajouter(aff(corps, ext, ' / '.join(titres.values()), brut={'title': titres}))
        (p,) = self.lot(ep.exporter(self.cfg, self.base))
        return p

    def codes(self, p):
        return [d['code'] for d in p['doutes']]

    def test_affaire_federale_trilingue_une_proposition_deux_langues_et_titres_par_langue(self):
        t = {'fr': 'Titre français', 'de': 'Deutscher Titel', 'it': 'Titolo italiano'}
        p = self.une('CHE', t)
        self.assertEqual(p['langues'], ['fr', 'de'])
        self.assertNotIn('langue', p)
        self.assertEqual(p['titres'], t)
        self.assertNotIn('title', p['valeurs'])
        self.assertNotIn('langue-devinee', self.codes(p))
        self.assertEqual(p['cle'], 'parlement:openparldata:CHE:1')

    def test_titre_blanc_ou_absent_n_est_pas_un_titre(self):
        p = self.une('CHE', {'fr': 'Seulement français', 'de': '  ', 'it': 'Solo'})
        self.assertEqual((p['langue'], 'langues' in p, 'titres' in p), ('fr', False, False))

    def test_federale_fr_seul_ou_it_seul_langue_fr_sans_doute(self):
        for t in ({'fr': 'Titre'}, {'it': 'Titolo'}):
            p = self.une('CHE', t, ext=str(len(t['fr' if 'fr' in t else 'it'])))
            self.assertEqual(p['langue'], 'fr')
            self.assertNotIn('langue-devinee', self.codes(p))
            self.assertEqual(p['valeurs']['title'], next(iter(t.values())))

    def test_grisons_de_et_it_reste_en_de_sans_doute(self):
        p = self.une('GR', {'de': 'Deutscher Titel', 'it': 'Titolo'})
        self.assertEqual(p['langue'], 'de')
        self.assertNotIn('langue-devinee', self.codes(p))

    def test_cantons_bilingues_avec_les_deux_titres_sont_multilingues(self):
        for i, corps in enumerate(('BE', 'FR', 'VS', 'GR')):
            self.ajouter(aff(corps, f'b{i}', 'x', brut={'title': {'fr': f'fr {corps}', 'de': f'de {corps}'}}))
        lot = self.lot(ep.exporter(self.cfg, self.base))
        self.assertEqual(len(lot), 4)
        for p in lot:
            self.assertEqual(p['langues'], ['fr', 'de'], p['cle'])
            self.assertNotIn('langue', p)

    def test_canton_monolingue_ne_change_pas(self):
        self.ajouter(aff('ZH', '1', 'Förderklassen', brut={'title': {'de': 'Förderklassen', 'fr': 'Classes de soutien'}}))
        (p,) = self.lot(ep.exporter(self.cfg, self.base))
        self.assertEqual(p['langue'], 'de')
        self.assertNotIn('langues', p)
        self.assertNotIn('titres', p)
        self.assertEqual(p['valeurs']['title'], 'Förderklassen')


class TestVorlageBlDansLExport(unittest.TestCase):
    setUp, tearDown, ajouter, lot = (TestPropositions.setUp, TestPropositions.tearDown, TestPropositions.ajouter,
                                     TestPropositions.lot)

    def test_la_vorlage_de_bl_prend_le_jeton_de_son_vrai_type_sans_doute_objet_gouvernement(self):
        a = aff('BL', 'v1', 'Integrative Schule: Kosten und Wirksamkeit', number='2024/557', harm=9, tn={'de': 'Vorlage'})
        self.ajouter(a)
        self.base.c.execute("INSERT INTO documents VALUES ('BL','v1','d1','n','','','de',?,'e')",
                            ('Parlamentarischer Vorstoss 2024/557 \n\nGeschäftstyp: Interpellation \n\nTitel: X',))
        self.ajouter(aff('BL', 'v2', 'Teilrevision Gesetz', number='2026/4676', harm=9, tn={'de': 'Vorlage'}))
        lot = {p['cle'].split(':')[-1]: p for p in self.lot(ep.exporter(self.cfg, self.base))}
        self.assertEqual(lot['v1']['valeurs']['categorie'], 'interpellation')
        self.assertNotIn('correspondance-incertaine', [d['code'] for d in lot['v1']['doutes']])
        self.assertEqual(lot['v2']['valeurs']['categorie'], 'objet-gouvernement')     # sans document : inchangé
