"""Utilitaires d'extraction HTML de skbf.py et sites.py."""
import re

from ..nettoyage import sans_balisage_brut

_BALISE = re.compile(r'<[^>]+>')
_ESPACES = re.compile(r'[ \t\r]+')


def texte_simple(fragment):
    """Texte sur une ligne : balises retirées, espaces normalisés."""
    t = _BALISE.sub(' ', sans_balisage_brut(fragment))
    return _ESPACES.sub(' ', t).replace('\n', ' ').strip()


def texte_paragraphes(fragment):
    """Texte multi-paragraphes : </p>, <br> et fin de <div> deviennent des sauts de ligne.

    Rend des paragraphes séparés par une ligne vide, comme attendu par le modèle.
    """
    t = sans_balisage_brut(fragment)
    t = re.sub(r'</p\s*>|<br\s*/?>|</div\s*>', '\n', t, flags=re.I)
    t = re.sub(r'<p[^>]*>', '\n\n', t, flags=re.I)
    t = _BALISE.sub('', t)
    t = _ESPACES.sub(' ', t)
    paragraphes = []
    courant = []
    for ligne in t.split('\n'):
        ligne = ligne.strip()
        if ligne:
            courant.append(ligne)
        elif courant:
            paragraphes.append(' '.join(courant))
            courant = []
    if courant:
        paragraphes.append(' '.join(courant))
    return '\n\n'.join(paragraphes)


def capturer(texte, motif, dotall=False):
    """Premier groupe du premier match, ou None."""
    m = re.search(motif, texte, re.S if dotall else 0)
    return m.group(1) if m else None


_BALISE_DIV = re.compile(r'<div\b[^>]*>|</div>', re.I)


def _fermeture_equilibree(texte, depart):
    """Depuis `depart` (juste après un <div ...> déjà ouvert), rend l'index de son </div>."""
    profondeur = 1
    for m in _BALISE_DIV.finditer(texte, depart):
        if m.group(0).lower() == '</div>':
            profondeur -= 1
            if profondeur == 0:
                return m.start()
        else:
            profondeur += 1
    return len(texte)


def capturer_div_tous(texte, motif_avant_contenu):
    """Comme capturer_div, mais rend la liste des contenus de tous les matches."""
    sortie = []
    for m in re.finditer(motif_avant_contenu, texte, re.S):
        fin = _fermeture_equilibree(texte, m.end())
        sortie.append(texte[m.end():fin])
    return sortie


def capturer_div(texte, motif_avant_contenu, dotall=True):
    """Contenu d'un <div> déjà ouvert par `motif_avant_contenu`, jusqu'à sa fermeture équilibrée.

    Plus sûr qu'un `(.*?)</div>` naïf dès que le contenu peut lui-même contenir un <div>
    imbriqué (image, légende...) : un simple lazy-match s'arrête alors trop tôt.
    """
    m = re.search(motif_avant_contenu, texte, re.S if dotall else 0)
    if not m:
        return None
    fin = _fermeture_equilibree(texte, m.end())
    return texte[m.end():fin]
