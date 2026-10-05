"""Publication du socle : ce qui est figé et dont rien n'a changé est repris tel quel, sans reclasser son texte ; une
affaire modifiée, un autre lexique ou une ligne réécrite par un journal font recalculer. Tout est fictif."""
import json
import os
import shutil
import tempfile
import unittest
from unittest import mock

from parlement import etat, export_propositions as ep, finesse, lexique
from parlement.stockage import Base
from parlement.tests.test_etat_partage import Fond


def figees(base):
    return {t: sorted(tuple(r) for r in base.c.execute(f'SELECT body_key, external_id, donnees FROM {t}'))
            for t in ('figees', 'finesse')}


class Appels:
    """Compte les calculs de finesse et de lecture des documents, par affaire."""

    def __init__(self, test):
        self.par_affaire = []
        vrai_f, vrai_lu = finesse.finesse_de, ep.lu_dans_les_documents

        def f(config, base, lex, a):
            self.par_affaire.append(('finesse', a['body_key'], a['external_id']))
            return vrai_f(config, base, lex, a)

        def lu(config, base, a, lex=None):
            self.par_affaire.append(('figees', a['body_key'], a['external_id']))
            return vrai_lu(config, base, a, lex)
        for cible, nom, rempl in ((finesse, 'finesse_de', f), (ep, 'lu_dans_les_documents', lu)):
            p = mock.patch.object(cible, nom, rempl)
            p.start()
            test.addCleanup(p.stop)


class TestReprise(Fond):
    E = 'lexique-a'

    def test_une_seconde_publication_ne_refige_rien(self):
        etat.figer(self.dev, self.cfg, self.lex, empreinte_lex=self.E)
        premiere = figees(self.dev)
        self.assertTrue(premiere['finesse'] and premiere['figees'])
        appels = Appels(self)
        etat.figer(self.dev, self.cfg, self.lex, empreinte_lex=self.E)
        self.assertEqual(appels.par_affaire, [])
        self.assertEqual(figees(self.dev), premiere)

    def test_le_repris_egale_le_calcul_complet_a_l_octet(self):
        copie = os.path.join(self.tmp, 'copie.sqlite')
        self.dev.commit()
        shutil.copy(self.dev.chemin, copie)
        etat.figer(self.dev, self.cfg, self.lex, empreinte_lex=self.E)
        etat.figer(self.dev, self.cfg, self.lex, empreinte_lex=self.E)
        temoin = Base(copie)
        self.addCleanup(temoin.fermer)
        etat.figer(temoin, self.cfg, self.lex)
        self.assertEqual(figees(self.dev), figees(temoin))

    def test_une_affaire_modifiee_est_refigee(self):
        etat.figer(self.dev, self.cfg, self.lex, empreinte_lex=self.E)
        avant = figees(self.dev)
        id_api = self.dev.c.execute("SELECT id_api FROM affaires WHERE body_key='ZH' AND external_id='1'").fetchone()[0]
        self.dev.c.execute("UPDATE documents SET texte = texte || ' Gebärdensprache und Hörbehinderung.' "
                           "WHERE body_key='ZH' AND id_api=?", (id_api,))
        self.dev.commit()
        appels = Appels(self)
        etat.figer(self.dev, self.cfg, self.lex, empreinte_lex=self.E)
        self.assertEqual({(bk, ext) for _, bk, ext in appels.par_affaire}, {('ZH', '1')})
        self.assertNotEqual(figees(self.dev), avant)
        # Et ce qui a été refigé est ce qu'un calcul complet donne.
        apres = figees(self.dev)
        self.dev.c.execute('DELETE FROM figees')
        self.dev.c.execute('DELETE FROM finesse')
        etat.figer(self.dev, self.cfg, self.lex)
        self.assertEqual(figees(self.dev), apres)

    def test_un_autre_lexique_refige_tout(self):
        appels = Appels(self)
        etat.figer(self.dev, self.cfg, self.lex, empreinte_lex=self.E)
        premiers = list(appels.par_affaire)
        self.assertTrue(premiers)
        del appels.par_affaire[:]
        etat.figer(self.dev, self.cfg, self.lex, empreinte_lex='lexique-b')
        # ZH 4 n'a pas de texte ici : ce qui est figé pour elle vient d'ailleurs et ne bouge pas.
        self.assertEqual(appels.par_affaire, [p for p in premiers if p[1:] != ('ZH', '4')])

    def test_un_autre_reglage_refige_tout(self):
        etat.figer(self.dev, self.cfg, self.lex, empreinte_lex=self.E)
        appels = Appels(self)
        self.cfg['classement']['vivier_large'] = False
        etat.figer(self.dev, self.cfg, self.lex, empreinte_lex=self.E)
        self.assertTrue(appels.par_affaire)

    def test_une_ligne_reecrite_par_un_journal_reprend_le_calcul_du_poste(self):
        etat.figer(self.dev, self.cfg, self.lex, empreinte_lex=self.E)
        avant = figees(self.dev)
        bk, ext, _ = avant['finesse'][0]
        self.dev.c.execute('UPDATE finesse SET donnees=? WHERE body_key=? AND external_id=?',
                           (json.dumps({'score': 0}), bk, ext))
        self.dev.commit()
        etat.figer(self.dev, self.cfg, self.lex, empreinte_lex=self.E)
        self.assertEqual(figees(self.dev), avant)


class TestEmpreinteLexique(unittest.TestCase):
    def test_suit_le_contenu_des_fichiers(self):
        with tempfile.TemporaryDirectory() as d:
            for nom in os.listdir(lexique.DOSSIER):
                shutil.copy(os.path.join(lexique.DOSSIER, nom), d)
            a = etat.empreinte_lexique(d)
            self.assertEqual(a, etat.empreinte_lexique(lexique.DOSSIER))
            with open(os.path.join(d, 'ancrage.toml'), 'a', encoding='utf-8') as f:
                f.write('\n# un mot de plus\n')
            self.assertNotEqual(etat.empreinte_lexique(d), a)


class TestClasserUneFois(Fond):
    def test_finesse_de_et_evaluer_classent_le_texte_une_seule_fois(self):
        a = dict(self.dev.c.execute("SELECT * FROM affaires WHERE body_key='ZH' AND external_id='1'").fetchone())
        sans = mock.patch.object(finesse.classement, 'classer', wraps=finesse.classement.classer)
        with sans as espion:
            f1 = finesse.finesse_de(self.cfg, self.dev, self.lex, a)
            e1 = finesse.evaluer(self.lex, self.cfg, self.dev, a)
            seul = espion.call_count
        with mock.patch.object(finesse.classement, 'classer', wraps=finesse.classement.classer) as espion:
            with finesse.une_seule_fois():
                f2 = finesse.finesse_de(self.cfg, self.dev, self.lex, a)
                e2 = finesse.evaluer(self.lex, self.cfg, self.dev, a)
            self.assertEqual(espion.call_count, seul - 1)
        self.assertEqual((f1, e1), (f2, e2))
