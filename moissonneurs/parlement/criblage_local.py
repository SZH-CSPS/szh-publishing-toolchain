"""Criblage local : le même étage 1 que la recherche serveur, rejoué sur les textes des exports.

Mêmes termes que `criblage.termes_de_recherche`, mêmes motifs que le lexique, même normalisation (accents, casse,
apostrophes) : un terme touche ici ce que son motif touche ailleurs. Produit aussi les extraits que la recherche
serveur fournissait (`_search_meta.snippets`), pour que le classement n'y voie aucune différence.
"""
import re
import unicodedata

from . import criblage
from .lexique import normaliser

COMBINANTS = re.compile('[̀-ͯ]')
ESPACES = re.compile(r'\s+')
FENETRE = 160          # caractères de part et d'autre de la première touche


def normaliser_vite(texte):
    """Même résultat que `lexique.normaliser(texte)` (casse ignorée), plus vite sur de gros textes."""
    s = unicodedata.normalize('NFC', texte or '')
    s = s.replace('’', "'").replace('ʼ', "'").replace("'", ' ').replace(' ', ' ')
    s = s.replace('ß', 'ss').replace('œ', 'oe').replace('Œ', 'oe').replace('æ', 'ae').lower()
    s = COMBINANTS.sub('', unicodedata.normalize('NFD', s))
    return ESPACES.sub(' ', s)


def racine(terme):
    """Sous-chaîne normalisée que tout texte touché par le motif du terme contient forcément (préfiltre)."""
    mots = normaliser(terme.texte).split(' ')
    w = max(mots, key=len)
    n = len(w)
    return w[:max(3, n - 3)] if n >= 4 else w


class Balayeur:
    """Cherche dans un texte les termes interrogés côté serveur ; rend les paires (terme, langue) touchées."""

    def __init__(self, lex, paires=None):
        self.paires = list(paires) if paires is not None else criblage.termes_de_recherche(lex)
        par_cle = {}
        for t in lex.termes:
            par_cle.setdefault((t.texte, t.langue), t)
        self.termes = {p: par_cle[p] for p in self.paires}
        self.par_racine = {}
        for p, t in self.termes.items():
            self.par_racine.setdefault(racine(t), []).append(p)

    def touches(self, texte, norm=None):
        """{paire: position de la première touche dans le texte normalisé}."""
        if not texte:
            return {}
        norm = norm if norm is not None else normaliser_vite(texte)
        sortie = {}
        for r, paires in self.par_racine.items():
            if r in norm:
                for p in paires:
                    m = self.termes[p].motif.search(norm)
                    if m:
                        sortie[p] = m.start()
        return sortie

    def extrait(self, texte, position):
        """Fenêtre de texte (casse et accents gardés, pour que les sigles restent lisibles) autour de `position`."""
        brut = normaliser(texte, casse=True)
        a = max(0, position - FENETRE)
        return brut[a:position + FENETRE].strip()


def cribler_flux(balayeur, ouvrir_flux, a_garder=frozenset()):
    """Deux passes sur le flux (`ouvrir_flux()` rend un itérateur neuf de (id d'affaire, document)) :
    {id: {'touches': {paire: extrait}, 'documents': [doc]}}.

    Passe 1 : quelles affaires ont un document qui touche un terme (et un extrait pour chaque terme touché).
    Passe 2 : tous les documents des candidates, par le texte ou par le titre (`a_garder`), car le classement lit
    l'ensemble ; rien d'autre n'est gardé en mémoire.
    """
    touches = {}
    for aid, doc in ouvrir_flux():
        texte = doc.get('text') or ''
        t = balayeur.touches(texte)
        if t:
            e = touches.setdefault(aid, {})
            for p, pos in t.items():
                e.setdefault(p, balayeur.extrait(texte, pos))
    candidates = set(touches) | set(a_garder)
    sortie = {aid: {'touches': touches.get(aid, {}), 'documents': []} for aid in candidates}
    for aid, doc in ouvrir_flux():
        if aid in sortie:
            sortie[aid]['documents'].append(doc)
    return {aid: v for aid, v in sortie.items() if v['touches'] or v['documents'] or aid in a_garder}
