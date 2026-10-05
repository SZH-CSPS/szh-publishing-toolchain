"""Créneau de moisson et budget du mois, avec deux « postes » simulés et une propagation retardée."""
import copy
import datetime
import json
import os
import shutil
import tempfile
import unittest

import creneau as cr

T0 = datetime.datetime(2026, 11, 1, 6, 0, tzinfo=datetime.timezone.utc)


class Horloge:
    def __init__(self, depart=T0):
        self.t = depart

    def __call__(self):
        return self.t

    def avancer(self, s):
        self.t += datetime.timedelta(seconds=s)


class Partage:
    """Un dossier partagé où chaque poste ne voit les écritures des autres qu'après `propager()`."""

    def __init__(self):
        self.vrai = {}
        self.vues = []

    def vue(self):
        v = Vue(self)
        self.vues.append(v)
        return v

    def propager(self):
        for v in self.vues:
            v.visible = copy.deepcopy(self.vrai)


class Vue:
    def __init__(self, partage):
        self.partage = partage
        self.visible = copy.deepcopy(partage.vrai)

    def lister(self):
        return copy.deepcopy(self.visible)

    def ecrire(self, nom, contenu):
        self.partage.vrai[nom] = copy.deepcopy(contenu)
        self.visible[nom] = copy.deepcopy(contenu)

    def retirer(self, nom):
        self.partage.vrai.pop(nom, None)
        self.visible.pop(nom, None)


def poste(dossier, nom, horloge, attendre=lambda s: None, signaux=None):
    return cr.Creneau(dossier, nom, 'compte', 'cockpit', ['parlement'], duree_estimee_s=600, horloge=horloge,
                      attendre=attendre, attente_s=90,
                      signaler=(lambda etat, a: signaux.append((etat, a['poste']))) if signaux is not None else None)


class Prise(unittest.TestCase):
    def test_le_premier_prend_le_second_est_refuse(self):
        p = Partage()
        h = Horloge()
        a = poste(p.vue(), 'poste-a', h)
        annonce = a.prendre()
        self.assertEqual(annonce['format'], 'pronto-creneau/1')
        self.assertEqual(set(annonce), {'format', 'poste', 'compte', 'debut', 'echeance', 'battement',
                                        'declencheur', 'moissonneurs'})
        self.assertEqual(annonce['debut'], '2026-11-01T06:00:00Z')
        p.propager()
        h.avancer(30)
        b = poste(p.vue(), 'poste-b', h)
        with self.assertRaises(cr.Occupe) as e:
            b.prendre()
        self.assertEqual((e.exception.autre['poste'], e.exception.autre['compte'], e.exception.autre['debut']),
                         ('poste-a', 'compte', '2026-11-01T06:00:00Z'))
        self.assertEqual(list(p.vrai), ['poste-a__compte.json'])

    def test_meme_poste_vivant_refuse(self):
        p = Partage()
        h = Horloge()
        poste(p.vue(), 'poste-a', h).prendre()
        p.propager()
        with self.assertRaises(cr.Occupe):
            poste(p.vue(), 'poste-a', h).prendre()

    def simultanes(self, nom_a, nom_b, decalage_b):
        """A écrit, puis B écrit sans voir A ; chacun relit après son attente."""
        p = Partage()
        ha, hb = Horloge(), Horloge(T0 + datetime.timedelta(seconds=decalage_b))
        va, vb = p.vue(), p.vue()
        resultat = {}

        def attente_b(s):
            p.propager()

        def attente_a(s):
            b = poste(vb, nom_b, hb, attendre=attente_b)
            try:
                b.prendre()
                resultat['b'] = 'pris'
            except cr.Occupe as e:
                resultat['b'] = e.autre['poste']
            p.propager()

        a = poste(va, nom_a, ha, attendre=attente_a)
        try:
            a.prendre()
            resultat['a'] = 'pris'
        except cr.Occupe as e:
            resultat['a'] = e.autre['poste']
        return resultat, sorted(p.vrai)

    def test_simultanes_le_debut_le_plus_ancien_gagne(self):
        resultat, restent = self.simultanes('poste-a', 'poste-b', decalage_b=5)
        self.assertEqual(resultat, {'a': 'pris', 'b': 'poste-a'})
        self.assertEqual(restent, ['poste-a__compte.json'])

    def test_simultanes_le_plus_ancien_meme_s_il_a_ecrit_apres(self):
        resultat, restent = self.simultanes('poste-a', 'poste-b', decalage_b=-5)
        self.assertEqual(resultat, {'a': 'poste-b', 'b': 'pris'})
        self.assertEqual(restent, ['poste-b__compte.json'])

    def test_simultanes_a_egalite_le_nom_departage(self):
        resultat, restent = self.simultanes('poste-z', 'poste-b', decalage_b=0)
        self.assertEqual(resultat, {'a': 'poste-b', 'b': 'pris'})
        self.assertEqual(restent, ['poste-b__compte.json'])

    def test_attente_de_d_secondes(self):
        attentes = []
        poste(Partage().vue(), 'poste-a', Horloge(), attendre=attentes.append).prendre()
        self.assertEqual(attentes, [90])


class Peremption(unittest.TestCase):
    def ancienne(self, p, battement_il_y_a, echeance_dans):
        h = Horloge(T0 - datetime.timedelta(seconds=battement_il_y_a))
        vieux = poste(p.vue(), 'poste-b', h)
        vieux.prendre()
        vieux.annonce['echeance'] = cr.iso(T0 + datetime.timedelta(seconds=echeance_dans))
        p.vrai[vieux.nom] = vieux.annonce
        p.propager()

    def test_battement_perime_repris(self):
        p = Partage()
        self.ancienne(p, battement_il_y_a=16 * 60, echeance_dans=3600)
        signaux = []
        poste(p.vue(), 'poste-a', Horloge(), signaux=signaux).prendre()
        self.assertEqual(signaux, [('repris-perime', 'poste-b'), ('pris', 'poste-a')])

    def test_echeance_depassee_reprise(self):
        p = Partage()
        self.ancienne(p, battement_il_y_a=60, echeance_dans=-1)
        poste(p.vue(), 'poste-a', Horloge()).prendre()

    def test_battement_recent_vivant(self):
        p = Partage()
        self.ancienne(p, battement_il_y_a=14 * 60, echeance_dans=3600)
        with self.assertRaises(cr.Occupe):
            poste(p.vue(), 'poste-a', Horloge()).prendre()

    def test_annonce_illisible_ignoree(self):
        p = Partage()
        p.vrai['poste-x__compte.json'] = None
        p.propager()
        poste(p.vue(), 'poste-a', Horloge()).prendre()

    def test_echeance_bornee(self):
        h = Horloge()
        for duree, attendu in ((None, cr.ECHEANCE_MAX_S), (10, cr.ECHEANCE_MIN_S), (3600, 5400),
                               (10 ** 7, cr.ECHEANCE_MAX_S)):
            c = cr.Creneau(Partage().vue(), 'p', 'c', 'cli', [], duree_estimee_s=duree, horloge=h,
                           attendre=lambda s: None)
            a = c.prendre()
            self.assertEqual(cr.lire_iso(a['echeance']) - T0, datetime.timedelta(seconds=attendu))


class SurDisque(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='creneau-test-')
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.dossier = os.path.join(self.tmp, '_Creneau')

    def test_battement_reecrit_en_place(self):
        h = Horloge()
        c = cr.Creneau(cr.DossierCreneau(self.dossier), 'Poste A', 'Compte', 'cli', ['parlement'], horloge=h,
                       attendre=lambda s: None)
        c.prendre()
        for _ in range(20):
            h.avancer(cr.BATTEMENT_S)
            c.battre()
        self.assertEqual(os.listdir(self.dossier), ['poste-a__compte.json'])
        with open(os.path.join(self.dossier, 'poste-a__compte.json'), encoding='utf-8') as f:
            annonce = json.load(f)
        self.assertEqual(annonce['battement'], '2026-11-01T06:20:00Z')
        self.assertEqual(annonce['debut'], '2026-11-01T06:00:00Z')

    def test_retrait_apres_une_exception(self):
        c = cr.Creneau(cr.DossierCreneau(self.dossier), 'p', 'c', 'cli', [], horloge=Horloge(),
                       attendre=lambda s: None)
        with self.assertRaises(ValueError):
            try:
                c.prendre()
                raise ValueError('panne')
            finally:
                c.retirer()
        self.assertEqual(os.listdir(self.dossier), [])
        c.retirer()                                   # idempotent

    def test_perdant_ne_retire_que_le_sien(self):
        d = cr.DossierCreneau(self.dossier)
        h = Horloge()
        cr.Creneau(d, 'poste-a', 'c', 'cli', [], horloge=h, attendre=lambda s: None).prendre()
        b = cr.Creneau(d, 'poste-b', 'c', 'cli', [], horloge=h, attendre=lambda s: None)
        with self.assertRaises(cr.Occupe):
            b.prendre()
        b.retirer()
        self.assertEqual(os.listdir(self.dossier), ['poste-a__c.json'])

    def test_fichiers_temporaires_ignores(self):
        os.makedirs(self.dossier)
        open(os.path.join(self.dossier, 'poste-b__c.json.tmp'), 'w').close()
        cr.Creneau(cr.DossierCreneau(self.dossier), 'poste-a', 'c', 'cli', [], horloge=Horloge(),
                   attendre=lambda s: None).prendre()


class Noms(unittest.TestCase):
    def test_cle_normalisee(self):
        self.assertEqual(cr.cle('Poste A', 'Compte.B'), 'poste-a__compte.b')
        self.assertEqual(cr.cle('PC/01', 'Rédaction'), 'pc-01__redaction')


class BudgetDuMois(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='budget-test-')
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def compteur(self, mois, cle, n):
        d = os.path.join(self.tmp, 'parlement', '_partage', 'requetes', mois)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, cle + '.json'), 'w', encoding='utf-8') as f:
            json.dump({'format': 'pronto-requetes/1', 'mois': mois, 'requetes': n, 'maj': '2026-11-01T06:00:00Z'}, f)

    def test_somme_de_tous_les_postes_du_mois(self):
        self.compteur('2026-11', 'a__x', 300)
        self.compteur('2026-11', 'b__y', 200)
        self.compteur('2026-10', 'a__x', 999)
        self.assertEqual(cr.somme_mois(self.tmp, 'parlement', '2026-11', 'a__x'), (500, 300))
        self.assertEqual(cr.somme_mois(self.tmp, 'parlement', '2026-12', 'a__x'), (0, 0))

    def test_compteur_illisible_ignore(self):
        self.compteur('2026-11', 'a__x', 10)
        with open(os.path.join(self.tmp, 'parlement', '_partage', 'requetes', '2026-11', 'b__y.json'), 'w') as f:
            f.write('{tronqué')
        self.assertEqual(cr.somme_mois(self.tmp, 'parlement', '2026-11', 'a__x'), (10, 10))

    def test_epuise_et_plafond(self):
        self.assertEqual(cr.MARGE_REQUETES, 50)
        self.assertFalse(cr.epuise(800, 749, 50))
        self.assertTrue(cr.epuise(800, 750, 50))       # plafond nul : épuisé
        self.assertTrue(cr.epuise(800, 751, 50))
        self.assertFalse(cr.epuise(None, 10 ** 6, 50))
        self.assertEqual(cr.plafond_local(800, 700, 50), 50)
        self.assertEqual(cr.plafond_local(800, 750, 50), 0)
        self.assertEqual(cr.plafond_local(800, 900, 50), 0)
        self.assertIsNone(cr.plafond_local(None, 0, 50))

    def test_ecrire_requetes_atomique(self):
        cr.ecrire_requetes(self.tmp, 'parlement', '2026-11', 'a__x', 42, T0)
        cr.ecrire_requetes(self.tmp, 'parlement', '2026-11', 'a__x', 43, T0)
        d = os.path.join(self.tmp, 'parlement', '_partage', 'requetes', '2026-11')
        self.assertEqual(os.listdir(d), ['a__x.json'])
        with open(os.path.join(d, 'a__x.json'), encoding='utf-8') as f:
            self.assertEqual(json.load(f), {'format': 'pronto-requetes/1', 'mois': '2026-11', 'requetes': 43,
                                            'maj': '2026-11-01T06:00:00Z'})

    def test_mois(self):
        self.assertEqual(cr.mois_de(T0), '2026-11')


if __name__ == '__main__':
    unittest.main()
