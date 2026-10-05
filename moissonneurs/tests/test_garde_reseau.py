"""Le garde des tests : aucune requête ne sort, quel que soit le chemin (urllib, socket brut), la boucle locale reste."""
import socket
import unittest
import urllib.request

from tests import garde_reseau

import parlement.tests  # noqa: F401  (chaque paquet de tests arme le garde)
import recherche.tests  # noqa: F401


class TestGarde(unittest.TestCase):
    def test_arme_par_chaque_paquet_de_tests(self):
        self.assertTrue(garde_reseau.arme())

    def test_urllib_ne_sort_pas(self):
        with self.assertRaises(garde_reseau.ReseauInterdit):
            urllib.request.urlopen('https://api.example.invalid/v1/affairs', timeout=1)

    def test_socket_brut_ne_sort_pas(self):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            with self.assertRaises(garde_reseau.ReseauInterdit):
                s.connect(('192.0.2.1', 80))

    def test_la_boucle_locale_reste_permise(self):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as serveur:
            serveur.bind(('127.0.0.1', 0))
            serveur.listen(1)
            with socket.create_connection(serveur.getsockname(), timeout=2):
                pass


if __name__ == '__main__':
    unittest.main()
