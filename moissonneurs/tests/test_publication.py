"""Le dépôt est public : dans tout moissonneurs/ (code, réglages, documentation, pages et fixtures fictives), ni adresse,
ni arobase hors décorateur et règle CSS, ni chemin personnel, ni prénom, ni identifiant de lot dans un commentaire."""
import ast
import io
import os
import re
import tokenize
import unittest

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEXTES = ('.py', '.toml', '.md', '.html', '.xml', '.txt', '.json', '.jsonl')
# Motifs assemblés en morceaux, pour que ce fichier ne se dénonce pas lui-même.
CHEMINS = [re.compile(re.escape('C:' + s + 'Users' + s), re.I) for s in ('/', '\\', '\\\\')]
CHEMINS.append(re.compile('/mnt/c/' + 'Users', re.I))
PRENOM = re.compile('rob' + 'in', re.I)
# Un arobase suivi d'une lettre : une adresse ou un pseudonyme. Restent permis un décorateur Python, une règle CSS
# (le nettoyage des descriptifs les cherche) et un arobase dans une classe de caractères d'expression régulière.
AROBASE = re.compile('@' + r'(?!(?:font-face|page|media|import|charset)\b)\w')
DECORATEUR = re.compile(r'^\s*' + '@' + r'[\w.]+\s*(\(|$)')
# Identifiant de lot ou de tâche (une lettre D, U ou X suivie d'un numéro) dans un commentaire ou une docstring.
LOT = re.compile(r'\b[DUX]\d{1,3}\b')


def fichiers():
    for dossier, sous, noms in os.walk(RACINE):
        sous[:] = [s for s in sous if s != '__pycache__']
        for nom in noms:
            if nom.endswith(TEXTES):
                yield os.path.join(dossier, nom)


def lire(chemin):
    with open(chemin, encoding='utf-8') as f:
        return f.read()


def commentaires(chemin, texte):
    """Les commentaires et docstrings d'un .py, les commentaires d'un .toml : [(ligne, texte)]."""
    if chemin.endswith('.toml'):
        return [(i, l.split('#', 1)[1]) for i, l in enumerate(texte.splitlines(), 1) if '#' in l]
    if not chemin.endswith('.py'):
        return []
    sortie = [(t.start[0], t.string) for t in tokenize.generate_tokens(io.StringIO(texte).readline)
              if t.type == tokenize.COMMENT]
    for noeud in ast.walk(ast.parse(texte)):
        if isinstance(noeud, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            doc = ast.get_docstring(noeud, clean=False)
            if doc:
                sortie.append((getattr(noeud, 'lineno', 1), doc))
    return sortie


class Publication(unittest.TestCase):
    def test_tout_l_arbre_est_lu(self):
        vus = {os.path.relpath(c, RACINE).replace(os.sep, '/') for c in fichiers()}
        for attendu in ('moisson.py', 'partage.py', 'LISEZMOI.md', 'recherche/reglages.toml',
                        'recherche/sources/sites.py', 'tests/fixtures/passe-exemple.jsonl'):
            self.assertIn(attendu, vus)
        self.assertTrue(any(v.startswith('recherche/tests/fixtures/') for v in vus))

    def test_aucun_arobase(self):
        for chemin in fichiers():
            for i, ligne in enumerate(lire(chemin).splitlines(), 1):
                if chemin.endswith('.py') and DECORATEUR.match(ligne):
                    continue
                self.assertIsNone(AROBASE.search(ligne), f'{os.path.relpath(chemin, RACINE)}:{i}')

    def test_aucun_chemin_personnel_ni_prenom(self):
        for chemin in fichiers():
            texte = lire(chemin)
            for motif in CHEMINS + [PRENOM]:
                self.assertIsNone(motif.search(texte), f'{os.path.relpath(chemin, RACINE)} : {motif.pattern}')

    def test_aucun_identifiant_de_lot_dans_un_commentaire(self):
        for chemin in fichiers():
            for i, texte in commentaires(chemin, lire(chemin)):
                self.assertIsNone(LOT.search(texte), f'{os.path.relpath(chemin, RACINE)}:{i} : {texte[:80]!r}')

    def test_le_controle_mord(self):
        self.assertTrue(AROBASE.search('ecrire a quelqu' + '@' + 'exemple.ch'))
        self.assertTrue(AROBASE.search('suivre ' + '@' + 'pseudo'))
        self.assertIsNone(AROBASE.search('@' + 'font-face {font-family: x}'))
        self.assertIsNone(AROBASE.search(r"(?<![\w.#:" + '@' + "-])"))
        self.assertTrue(DECORATEUR.match('    ' + '@' + 'unittest.skipIf(True, "x")'))
        self.assertTrue(any(m.search('x = "C:' + '/Users/quelqu_un"') for m in CHEMINS))
        self.assertTrue(any(m.search('/mnt/c/' + 'Users/x') for m in CHEMINS))
        self.assertTrue(PRENOM.search('par ' + 'Rob' + 'in'))
        self.assertTrue(LOT.search('voir le lot ' + 'D' + '47'))
        self.assertIsNone(LOT.search('noqa: F401'))
        self.assertEqual(commentaires('x.py', '"""Doc."""\nx = 1  # note\n'), [(2, '# note'), (1, 'Doc.')])


if __name__ == '__main__':
    unittest.main()
