import datetime
import json
import os
import tempfile
import unittest

from parlement import decisions, export_propositions as ep, purge, tout
from parlement.sources.openparldata import Affaire
from parlement.stockage import Base
from parlement.tests.outils_test import SourceFictive, config_pipeline

AUJOURDHUI = '2026-10-03'
VIEUX, RECENT = '2026-03-01', '2026-09-01'      # > 6 mois / < 6 mois avant AUJOURDHUI
CLE = 'parlement:openparldata:ZH:1'


class Fond(unittest.TestCase):
    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.tmp = self._t.name
        self.cfg = config_pipeline(self.tmp)
        self.lots = self.cfg['sortie']['propositions']
        self.dec = self.cfg['sortie']['decisions']
        os.makedirs(self.lots)
        os.makedirs(self.dec)
        self.base = Base(':memory:')

    def tearDown(self):
        self.base.fermer()
        self._t.cleanup()

    def lot(self, nom, contenu='{"recolte": "2026-01-01T00:00:00Z"}\n'):
        chemin = os.path.join(self.lots, nom)
        with open(chemin, 'w', encoding='utf-8') as f:
            f.write(contenu)
        return chemin

    def decision(self, cle, date=VIEUX, decision='refuse', reporte=True, nom=None):
        chemin = os.path.join(self.dec, (nom or decisions.empreinte_cle(cle)) + '.txt')
        corps = f'Cle: {cle}\n\n----\n\nDecision: {decision}\n\n----\n\nMotif: hors-sujet\n'
        if date:
            corps += f'\n----\n\nDate: {date}\n'
        with open(chemin, 'w', encoding='utf-8') as f:
            f.write(corps)
        if reporte:
            self.base.c.execute('INSERT OR REPLACE INTO decisions(cle, decision, motif, fiche, date, lue_le) '
                                'VALUES (?,?,?,?,?,?)', (cle, decision, 'hors-sujet', '', date or '', 'now'))
            self.base.commit()
        return chemin

    def purger(self):
        return purge.purger(self.cfg, self.base, aujourdhui=AUJOURDHUI)


class TestLots(Fond):
    def test_vieux_lot_efface_lot_recent_garde(self):
        vieux, recent = self.lot('2026-03-01-1.jsonl'), self.lot('2026-09-01-1.jsonl')
        r = self.purger()
        self.assertFalse(os.path.exists(vieux))
        self.assertTrue(os.path.exists(recent))
        self.assertEqual(r['lots'], ['2026-03-01-1.jsonl'])

    def test_l_age_se_lit_sur_le_nom_jamais_sur_le_mtime(self):
        vieux_par_nom = self.lot('2026-03-01-2.jsonl')
        recent_par_nom = self.lot('2026-09-20-1.jsonl')
        os.utime(vieux_par_nom, (4102444800, 4102444800))      # mtime en 2100 : OneDrive réécrit les dates
        os.utime(recent_par_nom, (946684800, 946684800))       # mtime en 2000
        self.purger()
        self.assertFalse(os.path.exists(vieux_par_nom))
        self.assertTrue(os.path.exists(recent_par_nom))

    def test_nom_sans_date_age_lu_dans_le_contenu(self):
        a = self.lot('lot-ancien.jsonl', '{"recolte": "2026-01-15T10:00:00Z"}\n')
        b = self.lot('lot-recent.jsonl', '{"recolte": "2026-09-30T10:00:00Z"}\n')
        self.purger()
        self.assertFalse(os.path.exists(a))
        self.assertTrue(os.path.exists(b))

    def test_date_illisible_jamais_effacee(self):
        a = self.lot('notes.jsonl', 'pas du json')
        b = self.lot('2026-13-45-1.jsonl', '{}')             # date impossible dans le nom, rien dans le contenu
        c = self.lot('vide.jsonl', '')
        r = self.purger()
        for f in (a, b, c):
            self.assertTrue(os.path.exists(f), f)
        self.assertEqual(r['lots'], [])

    def test_seuls_les_lots_jsonl_sont_concernes(self):
        autre = os.path.join(self.lots, 'etat.json')
        with open(autre, 'w') as f:
            f.write('{}')
        txt = self.lot('2026-03-01-1.txt')
        self.purger()
        self.assertTrue(os.path.exists(autre))
        self.assertTrue(os.path.exists(txt))

    def test_aucun_dossier_supprime(self):
        os.makedirs(os.path.join(self.lots, 'sous-dossier-2026-03-01-1.jsonl'))
        self.lot('2026-03-01-1.jsonl')
        self.purger()
        self.assertTrue(os.path.isdir(self.lots))
        self.assertTrue(os.path.isdir(os.path.join(self.lots, 'sous-dossier-2026-03-01-1.jsonl')))

    def test_lien_symbolique_sortant_jamais_suivi(self):
        dehors = os.path.join(self.tmp, 'dehors')
        os.makedirs(dehors)
        cible = os.path.join(dehors, '2026-03-01-1.jsonl')
        with open(cible, 'w') as f:
            f.write('{}')
        lien = os.path.join(self.lots, '2026-03-01-9.jsonl')
        try:
            os.symlink(cible, lien)
        except (OSError, NotImplementedError):
            self.skipTest('liens symboliques indisponibles sur ce système')
        self.purger()
        self.assertTrue(os.path.exists(cible))
        self.assertTrue(os.path.islink(lien))

    def test_fichier_hors_dossier_des_lots_jamais_efface(self):
        voisin = os.path.join(self.tmp, 'sortie', 'propositions', 'recherche')
        os.makedirs(voisin)
        f = os.path.join(voisin, '2026-03-01-1.jsonl')
        with open(f, 'w') as h:
            h.write('{}')
        self.purger()
        self.assertTrue(os.path.exists(f))

    def test_dossier_de_lots_absent_n_est_pas_une_erreur(self):
        os.rmdir(self.lots)
        self.assertEqual(self.purger()['lots'], [])


class TestDecisions(Fond):
    def test_decision_reportee_et_vieille_effacee(self):
        f = self.decision(CLE)
        r = self.purger()
        self.assertFalse(os.path.exists(f))
        self.assertEqual(r['decisions'], [decisions.empreinte_cle(CLE)])

    def test_decision_non_reportee_gardee(self):
        f = self.decision(CLE, reporte=False)
        self.assertEqual(self.purger()['decisions'], [])
        self.assertTrue(os.path.exists(f))

    def test_decision_vieille_mais_non_reportee_puis_reportee_au_tour_suivant(self):
        f = self.decision(CLE, reporte=False)
        self.purger()
        self.assertTrue(os.path.exists(f))
        decisions.appliquer(self.dec, self.base)            # le moissonneur la reporte en base
        self.purger()
        self.assertFalse(os.path.exists(f))

    def test_decision_reportee_mais_sans_date_gardee(self):
        f = self.decision(CLE, date='')
        self.purger()
        self.assertTrue(os.path.exists(f))

    def test_date_de_decision_illisible_gardee(self):
        f = self.decision(CLE, date='hier')
        self.purger()
        self.assertTrue(os.path.exists(f))

    def test_decision_recente_gardee(self):
        f = self.decision(CLE, date=RECENT)
        self.purger()
        self.assertTrue(os.path.exists(f))

    def test_l_age_vient_de_la_date_ecrite_pas_du_mtime(self):
        f = self.decision(CLE, date=RECENT)
        os.utime(f, (946684800, 946684800))
        self.purger()
        self.assertTrue(os.path.exists(f))

    def test_cle_qui_n_est_pas_parlement_gardee(self):
        f = self.decision('recherche:snf:123', reporte=True)
        self.assertEqual(self.purger()['decisions'], [])
        self.assertTrue(os.path.exists(f))

    def test_lien_symbolique_de_decision_jamais_suivi(self):
        dehors = os.path.join(self.tmp, 'dehors')
        os.makedirs(dehors)
        cible = os.path.join(dehors, 'x.txt')
        with open(cible, 'w') as f:
            f.write(f'Cle: {CLE}\n\n----\n\nDecision: refuse\n\n----\n\nDate: {VIEUX}\n')
        self.base.c.execute('INSERT INTO decisions(cle, decision, motif, fiche, date, lue_le) VALUES (?,?,?,?,?,?)',
                            (CLE, 'refuse', '', '', VIEUX, 'now'))
        try:
            os.symlink(cible, os.path.join(self.dec, 'lien.txt'))
        except (OSError, NotImplementedError):
            self.skipTest('liens symboliques indisponibles sur ce système')
        self.purger()
        self.assertTrue(os.path.exists(cible))

    def test_une_decision_purgee_ne_revient_pas_a_l_export_suivant(self):
        a = Affaire(body_key='ZH', external_id='1', id_api='1', number='M 1', title='Sonderpädagogik',
                    type_name={'de': 'Motion'}, type_harmonized_id=2, date_depot='2026-08-01',
                    updated_at='2026-09-01T00:00:00', url_externe='https://exemple.invalide/1', brut={'title': 'x'})
        self.base.enregistrer_affaire(a)
        self.base.c.execute("INSERT INTO verdicts VALUES ('ZH','1','retenu',8,'education','','ancrage','now')")
        f = self.decision(CLE, reporte=False)
        self.assertIsNone(ep.exporter(self.cfg, self.base)['lot'])      # décidée : exclue (et reportée en base)
        self.purger()
        self.assertFalse(os.path.exists(f))                               # fichier purgé
        self.assertIsNone(ep.exporter(self.cfg, self.base)['lot'])      # la base se souvient : elle ne revient pas

    def test_decision_annulee_avant_purge_redevient_proposable(self):
        a = Affaire(body_key='ZH', external_id='1', id_api='1', number='M 1', title='Sonderpädagogik',
                    type_name={'de': 'Motion'}, type_harmonized_id=2, date_depot='2026-08-01',
                    updated_at='2026-09-01T00:00:00', url_externe='https://exemple.invalide/1', brut={'title': 'x'})
        self.base.enregistrer_affaire(a)
        self.base.c.execute("INSERT INTO verdicts VALUES ('ZH','1','retenu',8,'education','','ancrage','now')")
        f = self.decision(CLE, date=RECENT, reporte=False)
        self.assertIsNone(ep.exporter(self.cfg, self.base)['lot'])
        os.remove(f)                                                      # « Annuler » dans le cockpit
        self.assertIsNotNone(ep.exporter(self.cfg, self.base)['lot'])


class TestDansTout(Fond):
    def reseau(self):
        from parlement.reseau import Reseau
        return Reseau(dict(self.cfg['reseau']), ouvrir=lambda u, h: (500, {}, b''), dormir=lambda s: None)

    def lancer(self):
        from parlement import lexique
        src = SourceFictive()
        lignes = []
        r, code = tout.tout(self.cfg, lignes.append, source=src, reseau=self.reseau(), lex=lexique.charger(),
                            aujourdhui=AUJOURDHUI)
        return r, code, lignes

    def test_resume_et_etat_json_comptent_les_purges(self):
        self.lot('2026-03-01-1.jsonl')
        self.lot('2026-03-02-1.jsonl')
        self.decision(CLE)
        r, code, lignes = self.lancer()
        self.assertEqual((len(r['purge']['lots']), len(r['purge']['decisions'])), (2, 1))
        self.assertEqual(r['purge']['lots'], ['2026-03-01-1.jsonl', '2026-03-02-1.jsonl'])
        self.assertEqual(r['purge']['decisions'], [decisions.empreinte_cle(CLE)])
        with open(os.path.join(self.lots, 'etat.json'), encoding='utf-8') as f:
            etat = json.load(f)
        self.assertEqual(etat['purge'], r['purge'])
        for ancien in ('lots_purges', 'decisions_purgees', 'corps_en_echec'):
            self.assertNotIn(ancien, etat)
        self.assertIn('purge', [l.get('etape') for l in lignes])

    def test_echec_de_purge_figure_au_resume_sans_arreter_tout(self):
        original = purge.purger
        purge.purger = lambda *a, **k: (_ for _ in ()).throw(RuntimeError('disque en lecture seule'))
        try:
            r, code, lignes = self.lancer()
        finally:
            purge.purger = original
        self.assertEqual(code, 1)
        self.assertIn('purge', [e['etape'] for e in r['etapes_en_echec']])
        self.assertTrue(r['sauvegarde'])
        self.assertTrue(os.path.exists(os.path.join(self.lots, 'etat.json')))

    def test_echec_partiel_d_une_suppression_est_consigne(self):
        f = self.lot('2026-03-01-1.jsonl')
        os.chmod(self.lots, 0o500)
        try:
            if os.access(self.lots, os.W_OK):
                self.skipTest('le système laisse écrire dans un dossier en lecture seule (root)')
            r = self.purger()
        finally:
            os.chmod(self.lots, 0o700)
        self.assertEqual(r['lots'], [])
        self.assertEqual(len(r['echecs']), 1)
        self.assertTrue(os.path.exists(f))


if __name__ == '__main__':
    unittest.main()


class TestGardeFou(Fond):
    """La suppression elle-même vérifie le chemin résolu, indépendamment du parcours qui l'appelle."""
    def test_supprimer_refuse_un_fichier_hors_du_dossier(self):
        dehors = os.path.join(self.tmp, 'dehors.txt')
        with open(dehors, 'w') as f:
            f.write('x')
        echecs = []
        self.assertFalse(purge._supprimer(os.path.realpath(self.lots), dehors, echecs))
        self.assertTrue(os.path.exists(dehors))

    def test_supprimer_refuse_un_lien_meme_vers_un_fichier_interne(self):
        interne = self.lot('2026-03-01-1.jsonl')
        lien = os.path.join(self.lots, 'lien.jsonl')
        try:
            os.symlink(interne, lien)
        except (OSError, NotImplementedError):
            self.skipTest('liens symboliques indisponibles sur ce système')
        self.assertFalse(purge._supprimer(os.path.realpath(self.lots), lien, []))
        self.assertTrue(os.path.islink(lien))

    def test_supprimer_refuse_un_dossier(self):
        d = os.path.join(self.lots, 'dossier')
        os.makedirs(d)
        self.assertFalse(purge._supprimer(os.path.realpath(self.lots), d, []))
        self.assertTrue(os.path.isdir(d))

    def test_supprimer_efface_un_fichier_du_dossier(self):
        f = self.lot('2026-03-01-1.jsonl')
        self.assertTrue(purge._supprimer(os.path.realpath(self.lots), f, []))
        self.assertFalse(os.path.exists(f))
