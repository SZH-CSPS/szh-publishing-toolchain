import json
import os
import tempfile
import unittest

from parlement import lexique, sauvegarde, tout
from parlement.reseau import Reseau
from parlement.sources.openparldata import Affaire
from parlement.stockage import Base
from parlement.tests.outils_test import SourceFictive, config_pipeline


def affaire(corps, ext, titre, maj='2026-09-01T00:00:00', depot='2026-08-01', typ=2, **kw):
    d = dict(body_key=corps, external_id=ext, id_api=f'{corps}{ext}', number=f'M {ext}', title=titre,
             type_name={'de': 'Motion'}, type_harmonized_id=typ, date_depot=depot, updated_at=maj,
             url_oparl=f'https://example.invalid/{corps}/{ext}', brut={'id': f'{corps}{ext}', 'titre': titre})
    d.update(kw)
    return Affaire(**d)


def reseau_de(cfg):
    return Reseau(dict(cfg['reseau']), ouvrir=lambda u, h: (500, {}, b''), dormir=lambda s: None)


class TestPipeline(unittest.TestCase):
    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.tmp = self._t.name
        self.cfg = config_pipeline(self.tmp)
        self.lignes = []
        self.lex = lexique.charger()

    def tearDown(self):
        self._t.cleanup()

    def emit(self, obj):
        self.lignes.append(obj)

    def source(self, **kw):
        s = SourceFictive(
            affaires={'CHE': [affaire('CHE', '1', 'Sonderpädagogik stärken')],
                      'GE': [affaire('GE', '2', 'Motion pour les élèves handicapés', typ=None, number='M 2')],
                      'ZH': [affaire('ZH', '3', 'Strassenunterhalt')]},
            totaux={('Sonderpädagogik', 'de'): 20, ('Sonderpadagogik', 'de'): 2,
                    ('pédagogie spécialisée', 'fr'): 30, ('pedagogie specialisee', 'fr'): 1}, **kw)
        return s

    def lancer(self, source=None, **kw):
        source = source or self.source()
        return tout.tout(self.cfg, self.emit, source=source, reseau=reseau_de(self.cfg), lex=self.lex,
                         aujourdhui='2026-10-02', **kw) + (source,)

    def test_estimer_ne_fait_aucune_requete_et_rend_du_json(self):
        plan = tout.estimer(self.cfg)
        json.dumps(plan)
        self.assertEqual(plan['type'], 'estimation')
        self.assertEqual([e['id'] for e in plan['etapes']],
                         ['moisson', 'criblage', 'textes', 'classement', 'sauvegarde'])
        self.assertEqual(plan['budget'], 1000)
        self.assertEqual(plan['duree_estimee_s'], int(min(plan['requetes_prevues'], 1000) * 0.0))
        self.assertFalse(plan['base_presente'])
        self.assertTrue(plan['chemins']['sauvegardes'].endswith('sauvegardes'))

    def test_estimer_pret_sans_adresse_de_contact(self):
        self.cfg['reseau'].pop('contact', None)
        plan = tout.estimer(self.cfg)
        self.assertTrue(plan['pret'], plan['avertissements'])

    def test_estimer_durée_a_une_requete_toutes_les_deux_secondes(self):
        self.cfg['reseau']['delai'] = 2.0
        plan = tout.estimer(self.cfg)
        self.assertEqual(plan['duree_estimee_s'], int(min(plan['requetes_prevues'], plan['budget']) * 2.0))

    def test_estimer_apres_moisson_prevoit_une_requete_par_corps(self):
        self.lancer()
        plan = tout.estimer(self.cfg)
        moisson = plan['etapes'][0]
        self.assertTrue(plan['base_presente'])
        self.assertTrue(all(c['requetes'] == 1 and not c['initiale'] for c in moisson['corps']
                            if c['corps'] in ('CHE', 'GE', 'ZH')))

    def test_tout_enchaine_et_resume(self):
        resume, code, _ = self.lancer()
        self.assertEqual(code, 0)
        self.assertEqual(resume['type'], 'resume')
        self.assertEqual(resume['nouvelles_affaires'], 3)
        self.assertEqual(resume['retenues'], 2)
        self.assertEqual(resume['sources_en_echec'], [])
        self.assertTrue(os.path.exists(resume['sauvegarde']))
        etapes = [l['etape'] for l in self.lignes if l['type'] == 'progression']
        for e in ('moisson', 'criblage', 'titres', 'textes', 'classement', 'liste', 'propositions', 'sauvegarde'):
            self.assertIn(e, etapes)
        self.assertEqual(self.lignes[-1], resume)
        for l in self.lignes:
            json.dumps(l)

    def test_une_ligne_de_progression_par_corps(self):
        self.lancer()
        corps = [l['corps'] for l in self.lignes if l.get('etape') == 'moisson']
        self.assertEqual(sorted(corps), ['CHE', 'GE', 'ZH'])

    def test_echec_d_un_corps_visible_dans_le_resume_sans_arreter_les_autres(self):
        src = self.source(erreurs={'GE': ValueError('format inattendu')})
        resume, code, _ = self.lancer(src)
        self.assertEqual(code, 1)
        self.assertEqual([c['source'] for c in resume['sources_en_echec']], ['GE'])
        self.assertIn('format inattendu', resume['sources_en_echec'][0]['raison'])
        self.assertGreaterEqual(resume['nouvelles_affaires'], 2)      # CHE et ZH sont passés
        self.assertTrue(os.path.exists(resume['sauvegarde']))          # la sauvegarde a eu lieu quand même

    def test_echec_de_classement_figure_dans_le_resume(self):
        from parlement import classement
        original = classement.classer_base
        classement.classer_base = lambda *a, **k: (_ for _ in ()).throw(RuntimeError('défaut'))
        try:
            resume, code, _ = self.lancer()
        finally:
            classement.classer_base = original
        self.assertEqual(code, 1)
        self.assertEqual([e['etape'] for e in resume['etapes_en_echec']], ['classement'])
        self.assertTrue(resume['sauvegarde'])

    def test_accents_mutiles_arretent_le_criblage_mais_pas_le_reste(self):
        src = self.source()
        src.totaux = {('Sonderpädagogik', 'de'): 2, ('Sonderpadagogik', 'de'): 2}
        resume, code, _ = self.lancer(src)
        self.assertEqual(code, 1)
        self.assertIn('criblage', [e['etape'] for e in resume['etapes_en_echec']])
        self.assertEqual(resume['retenues'], 2)

    def test_sans_adresse_de_contact_la_moisson_part(self):
        self.cfg['reseau'].pop('contact', None)
        resume, code, _ = self.lancer()
        self.assertEqual(code, 0, resume)
        self.assertIsNone(resume.get('interrompu'))

    def test_base_absente_repart_de_la_derniere_sauvegarde(self):
        self.lancer()
        os.remove(self.cfg['stockage']['base'])
        src = SourceFictive()                    # plus rien de neuf à moissonner
        resume, code, _ = self.lancer(src)
        self.assertTrue(any(l.get('etape') == 'restauration' for l in self.lignes))
        b = Base(self.cfg['stockage']['base'])
        self.assertEqual(b.c.execute('SELECT COUNT(*) FROM affaires').fetchone()[0], 3)
        b.fermer()

    def test_budget_epuise_interrompt_et_sauvegarde(self):
        from parlement.reseau import BudgetEpuise

        class Court(SourceFictive):
            def moissonner(self, *a, **k):
                raise BudgetEpuise('plus de budget')
                yield
        resume, code, _ = self.lancer(Court())
        self.assertEqual(code, 3)
        self.assertEqual(resume['interrompu'], 'budget')
        self.assertTrue(os.path.exists(resume['sauvegarde']))

    def test_deuxieme_execution_ne_recharge_pas_les_textes(self):
        src = self.source(docs={'GE2': [{'id': 1, 'name': 'doc', 'text': 'x'}]})
        self.lancer(src)
        n = len(src.appels_docs)
        self.lancer(src)
        self.assertEqual(len(src.appels_docs), n)


if __name__ == '__main__':
    unittest.main()


class TestPropositionsEtEtat(unittest.TestCase):
    setUp, tearDown, emit, source, lancer = (TestPipeline.setUp, TestPipeline.tearDown, TestPipeline.emit,
                                             TestPipeline.source, TestPipeline.lancer)

    def test_tout_ecrit_un_lot_et_etat_json(self):
        resume, code, _ = self.lancer()
        self.assertEqual(code, 0, resume)
        self.assertEqual(resume['propositions_ecrites'], 2)
        self.assertNotIn('fiches_ecrites', resume)
        with open(resume['lot'], encoding='utf-8') as f:
            lignes = [json.loads(l) for l in f]
        self.assertEqual(sorted(p['cle'] for p in lignes),
                         ['parlement:openparldata:CHE:1', 'parlement:openparldata:GE:2'])
        self.assertIn('propositions', [l.get('etape') for l in self.lignes])
        etat_chemin = os.path.join(self.cfg['sortie']['propositions'], 'etat.json')
        self.assertEqual(resume['etat'], etat_chemin)
        with open(etat_chemin, encoding='utf-8') as f:
            etat = json.load(f)
        self.assertEqual((etat['moissonneur'], etat['propositions_ecrites'], etat['lot']),
                         ('parlement', 2, os.path.basename(resume['lot'])))
        self.assertEqual(etat['sources_en_echec'], [])
        self.assertRegex(etat['derniere_moisson'], r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$')

    def test_etat_json_dit_les_corps_en_echec_avec_leur_raison(self):
        src = self.source(erreurs={'GE': ValueError('format inattendu')})
        self.lancer(src)
        with open(os.path.join(self.cfg['sortie']['propositions'], 'etat.json'), encoding='utf-8') as f:
            etat = json.load(f)
        self.assertEqual([c['source'] for c in etat['sources_en_echec']], ['GE'])
        self.assertIn('format inattendu', etat['sources_en_echec'][0]['raison'])

    def test_etat_json_ecrit_d_un_coup(self):
        self.lancer()
        self.assertEqual([n for n in os.listdir(self.cfg['sortie']['propositions']) if n.endswith('.tmp')], [])

    def test_une_decision_exclut_la_cle_dans_tout(self):
        d = self.cfg['sortie']['decisions']
        os.makedirs(d)
        from parlement import decisions
        cle = 'parlement:openparldata:GE:2'
        with open(os.path.join(d, decisions.empreinte_cle(cle) + '.txt'), 'w', encoding='utf-8') as f:
            f.write(f'Cle: {cle}\n\n----\n\nDecision: refuse\n\n----\n\nMotif: hors-sujet\n')
        resume, _, _ = self.lancer()
        self.assertEqual(resume['propositions_ecrites'], 1)

    def test_deuxieme_execution_n_ecrit_pas_de_nouveau_lot(self):
        self.lancer()
        n = len(os.listdir(self.cfg['sortie']['propositions']))
        resume, _, _ = self.lancer()
        self.assertEqual(resume['propositions_ecrites'], 0)
        self.assertEqual(len(os.listdir(self.cfg['sortie']['propositions'])), n)

    def test_aucune_ecriture_de_fiche_kirby(self):
        self.lancer()
        for racine, _, noms in os.walk(self.tmp):
            for n in noms:
                self.assertFalse(n.startswith('intervention.'), os.path.join(racine, n))
        self.assertFalse(os.path.exists(os.path.join(self.cfg['sortie']['dossier'], 'vorstoesse')))

    def test_estimer_donne_les_dossiers_de_propositions_et_de_decisions(self):
        plan = tout.estimer(self.cfg)
        self.assertEqual(plan['chemins']['propositions'], self.cfg['sortie']['propositions'])
        self.assertEqual(plan['chemins']['decisions'], self.cfg['sortie']['decisions'])


class TestConfigurationBloquante(unittest.TestCase):
    """Un vrai blocage de configuration : la base ne peut être ni ouverte ni créée (code 2)."""
    setUp, tearDown, emit, source = (TestPipeline.setUp, TestPipeline.tearDown, TestPipeline.emit, TestPipeline.source)

    def base_impossible(self):
        fichier = os.path.join(self.tmp, 'un-fichier')
        open(fichier, 'w').close()
        self.cfg['stockage']['base'] = os.path.join(fichier, 'sous-dossier', 'p.sqlite')   # parent = fichier ordinaire

    def test_base_impossible_donne_code_2_et_etat_json(self):
        self.base_impossible()
        src = self.source()
        resume, code = tout.tout(self.cfg, self.emit, source=src, reseau=reseau_de(self.cfg), lex=self.lex)
        self.assertEqual(code, 2)
        self.assertEqual(resume['interrompu'], 'configuration')
        self.assertIn('base', resume['erreur'])
        self.assertEqual(resume['requetes'], 0)
        self.assertEqual(self.lignes[-1], resume)
        with open(os.path.join(self.cfg['sortie']['propositions'], 'etat.json'), encoding='utf-8') as f:
            etat = json.load(f)
        self.assertEqual(etat['interrompu'], 'configuration')
        self.assertIn('base', etat['erreur'])

    def test_dossier_d_etat_inaccessible_part_sur_stderr_avec_le_code_2(self):
        import contextlib
        import io
        self.base_impossible()
        fichier = os.path.join(self.tmp, 'autre-fichier')
        open(fichier, 'w').close()
        self.cfg['sortie']['propositions'] = os.path.join(fichier, 'parlement')
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            resume, code = tout.tout(self.cfg, self.emit, source=self.source(), reseau=reseau_de(self.cfg), lex=self.lex)
        self.assertEqual(code, 2)
        self.assertIn('etat.json', err.getvalue())
        self.assertIn('base', err.getvalue())


class TestTextesPour(unittest.TestCase):
    setUp, tearDown, source = TestPipeline.setUp, TestPipeline.tearDown, TestPipeline.source

    def test_textes_demandes_pour_des_affaires_non_candidates(self):
        from parlement import criblage
        src = self.source(docs={'ZH3': [{'id': 1, 'name': 'doc', 'text': 'Texte du document'}]})
        base = Base(':memory:')
        base.enregistrer_affaire(src.affaires['ZH'][0])
        res = criblage.recuperer_textes_pour(self.cfg, base, reseau_de(self.cfg), src, [('ZH', '3'), ('ZH', 'inconnue')])
        self.assertEqual(res['faits'], 1)
        self.assertEqual(src.appels_docs, ['ZH3'])
        self.assertEqual(base.c.execute('SELECT texte FROM documents').fetchone()[0], 'Texte du document')
        criblage.recuperer_textes_pour(self.cfg, base, reseau_de(self.cfg), src, [('ZH', '3')])
        self.assertEqual(src.appels_docs, ['ZH3'])                 # jamais retéléchargé
        base.fermer()


class TestTitresToutesLangues(unittest.TestCase):
    """Constaté sur le jeu de référence : la Confédération dépose en trois langues ; le titre français seul manque des ancrages."""
    setUp, tearDown = TestPipeline.setUp, TestPipeline.tearDown

    def test_classement_lit_les_titres_de_toutes_les_langues(self):
        from parlement import classement
        base = Base(':memory:')
        a = affaire('CHE', '7', 'Titre français neutre', brut={'title': {'fr': 'Titre français neutre',
                                                                          'de': 'Förderklassen stärken', 'it': 'Titolo'}})
        base.enregistrer_affaire(a)
        base.c.execute("INSERT INTO candidats VALUES ('CHE','7','(titre)','-','now')")
        classement.classer_base(self.cfg, base, self.lex)
        v = base.c.execute("SELECT verdict, raison FROM verdicts WHERE external_id='7'").fetchone()
        self.assertEqual(v['verdict'], 'retenu')
        self.assertIn('Förderklasse', v['raison'])
        base.fermer()

    def test_candidat_par_titre_voit_aussi_les_autres_langues(self):
        from parlement import criblage
        base = Base(':memory:')
        base.enregistrer_affaire(affaire('CHE', '8', 'Titre neutre', brut={'title': {'fr': 'Titre neutre', 'de': 'Sonderpädagogik'}}))
        self.assertEqual(criblage.candidats_par_titre(self.cfg, base, self.lex), 1)
        base.fermer()


class TestHorsLigne(unittest.TestCase):
    """`tout --hors-ligne` rejoue classement, liste, propositions, purge, sauvegarde et etat.json sans aucune requête."""
    setUp, tearDown = TestPipeline.setUp, TestPipeline.tearDown

    def test_aucune_methode_reseau_n_est_appelee(self):
        class Interdit(SourceFictive):
            def moissonner(self, *a, **k):
                raise AssertionError('réseau')
                yield
            rechercher = documents = total_recherche = moissonner
        base = Base(self.cfg['stockage']['base'])
        base.enregistrer_affaire(affaire('CHE', '1', 'Sonderpädagogik stärken'))
        base.c.execute("INSERT INTO candidats VALUES ('CHE','1','(titre)','-','now')")
        base.fermer()
        r, code = tout.tout(self.cfg, lambda o: None, source=Interdit(), reseau=reseau_de(self.cfg), lex=self.lex,
                            aujourdhui='2026-10-02', hors_ligne=True)
        self.assertEqual(r['requetes'], 0)
        self.assertEqual(r['propositions_ecrites'], 1)
        self.assertEqual(code, 0, r)


class TestFiltreDansTout(unittest.TestCase):
    setUp, tearDown, emit, source, lancer = (TestPipeline.setUp, TestPipeline.tearDown, TestPipeline.emit,
                                             TestPipeline.source, TestPipeline.lancer)

    def test_filtre_retenu_compte_dans_le_resume_et_etat_json(self):
        self.cfg['export'] = {'verdicts': ['retenu']}
        self.cfg['classement'] = {'ecole_generale': False, 'themes_elargis': False}
        src = self.source()
        src.affaires['ZH'] = [affaire('ZH', '3', 'Inklusion an der Schule')]     # ancrage ambigu : à relire
        r, code, _ = self.lancer(src)
        self.assertEqual(r['propositions_ecrites'], 2)
        self.assertEqual(r['hors_lot_filtre'], 1)
        with open(os.path.join(self.cfg['sortie']['propositions'], 'etat.json'), encoding='utf-8') as f:
            self.assertEqual(json.load(f)['hors_lot_filtre'], 1)

    def test_valeur_inconnue_code_2_et_etat_json(self):
        self.cfg['export'] = {'verdicts': ['peut-etre']}
        r, code, lignes = self.lancer()
        self.assertEqual(code, 2)
        self.assertEqual(r['interrompu'], 'configuration')
        self.assertIn('verdicts', r['erreur'])
        self.assertEqual(r['requetes'], 0)
        with open(os.path.join(self.cfg['sortie']['propositions'], 'etat.json'), encoding='utf-8') as f:
            self.assertEqual(json.load(f)['interrompu'], 'configuration')

    def test_arriere_invalide_code_2_et_etat_json(self):
        self.cfg['export'] = {'arriere_a_relire_mois': 'six'}
        r, code, lignes = self.lancer()
        self.assertEqual(code, 2)
        self.assertEqual(r['interrompu'], 'configuration')
        self.assertIn('arriere_a_relire_mois', r['erreur'])

    def test_arriere_du_premier_lot_compte_dans_le_resume_et_etat_json(self):
        self.cfg['export'] = {'verdicts': ['retenu', 'a-relire'], 'arriere_a_relire_mois': 6}
        self.cfg['classement'] = {'ecole_generale': False, 'themes_elargis': False}
        src = self.source()
        vieux = affaire('ZH', '3', 'Inklusion an der Schule')
        vieux.date_depot = '2025-02-01'
        src.affaires['ZH'] = [vieux]
        r, code, _ = self.lancer(src)
        self.assertEqual(r['hors_lot_arriere'], 1)
        with open(os.path.join(self.cfg['sortie']['propositions'], 'etat.json'), encoding='utf-8') as f:
            self.assertEqual(json.load(f)['hors_lot_arriere'], 1)

    def test_retenues_et_a_relire_comptent_le_lot_et_le_classement_a_ses_propres_champs(self):
        self.cfg['export'] = {'verdicts': ['retenu', 'a-relire']}
        self.cfg['classement'] = {'ecole_generale': False, 'themes_elargis': False}
        src = self.source()
        r, code, _ = self.lancer(src)
        self.assertEqual((r['retenues'], r['retenues_classement']), (2, 2))
        r, code, _ = self.lancer(src)                    # rien de neuf : le lot est vide, le classement garde ses comptes
        self.assertEqual((r['retenues'], r['a_relire'], r['propositions_ecrites']), (0, 0, 0))
        self.assertEqual(r['retenues_classement'], 2)
        with open(os.path.join(self.cfg['sortie']['propositions'], 'etat.json'), encoding='utf-8') as f:
            etat = json.load(f)
        self.assertEqual((etat['retenues'], etat['retenues_classement']), (0, 2))


class TestHybride(unittest.TestCase):
    """Deux sources : exports pour l'import de base, API pour la passe mensuelle (désactivée) ; aucune requête à l'API."""
    def setUp(self):
        import io
        from parlement.sources import exports
        from parlement.tests.test_importer import FICHIERS
        self._t = tempfile.TemporaryDirectory()
        self.cfg = config_pipeline(self._t.name)
        self.cfg['exports'] = {'dossier': os.path.join(self._t.name, 'exp'), 'delai': 5.0}
        self.cfg['mensuelle'] = {'active': False, 'budget': 800, 'delai': 5.0}
        self.cfg['moisson']['depuis'] = '2024-07-01'
        self.lex = lexique.charger()
        self.lignes = []
        self.vus = []

        def ouvrir(url):
            rel = url[len(exports.BASE_URL):]
            self.vus.append(rel)
            if rel not in FICHIERS:
                raise exports.FichierAbsent(url)
            return io.BytesIO(FICHIERS[rel])
        self.tel = exports.Telechargeur(os.path.join(self._t.name, 'dl'), delai=0, ouvrir=ouvrir, dormir=lambda s: None)

    def tearDown(self):
        self._t.cleanup()

    def test_estimer_importe_par_les_exports_les_corps_sans_repere(self):
        plan = tout.estimer(self.cfg)
        self.assertEqual(plan['sources'], {'import': 'exports', 'mensuelle': 'desactivee', 'budget_mensuel': 800})
        etapes = {e['id']: e for e in plan['etapes']}
        self.assertEqual(sorted(etapes['import']['corps']), ['CHE', 'GE', 'ZH'])
        self.assertEqual(etapes['import']['fichiers'], 1 + 3 + 1)                 # affairs + 3 docs + texts_CHE
        self.assertEqual(etapes['import']['requetes_api'], 0)
        self.assertEqual(plan['requetes_prevues'], 0)
        self.assertTrue(all(c['source'] == 'exports' and c['requetes'] == 0 for c in etapes['moisson']['corps']))

    def test_estimer_sans_sections_exports_reste_celui_de_l_api(self):
        del self.cfg['exports'], self.cfg['mensuelle']
        plan = tout.estimer(self.cfg)
        self.assertEqual(plan['sources'], {'import': 'api', 'mensuelle': 'api'})
        self.assertGreater(plan['requetes_prevues'], 0)
        self.assertNotIn('import', {e['id'] for e in plan['etapes']})

    def test_tout_importe_par_les_exports_et_n_appelle_jamais_l_api(self):
        class Interdit:
            def __getattr__(self, nom):
                raise AssertionError(f"appel à l'API interdit : {nom}")

        resume, code = tout.tout(self.cfg, self.lignes.append, source=Interdit(), lex=self.lex, aujourdhui='2026-10-03',
                                 telechargeur=self.tel)
        self.assertEqual(code, 0, resume)
        self.assertEqual(resume['requetes'], 0)
        self.assertGreater(resume['nouvelles_affaires'], 0)
        self.assertIn('import', [l['etape'] for l in self.lignes if l.get('type') == 'progression'])
        self.assertNotIn('moisson', [l['etape'] for l in self.lignes if l.get('type') == 'progression'])
        self.assertTrue(all(u in ('affairs.ndjson.gz', 'docs/docs_GE.ndjson.gz', 'docs/docs_CHE.ndjson.gz', 'docs/docs_ZH.ndjson.gz',
                                  'texts/texts_CHE.ndjson.gz') for u in self.vus))
        b = Base(self.cfg['stockage']['base'])
        self.assertIsNotNone(b.repere('GE'))
        b.fermer()
        self.lignes.clear()                                                       # 2e passage : plus rien à importer
        tout.tout(self.cfg, self.lignes.append, source=Interdit(), lex=self.lex, aujourdhui='2026-10-03', telechargeur=self.tel)
        self.assertNotIn('import', [l['etape'] for l in self.lignes if l.get('type') == 'progression'])
