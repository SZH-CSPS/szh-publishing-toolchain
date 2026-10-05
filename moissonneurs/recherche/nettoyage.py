"""Retire d'un descriptif le balisage qui n'est pas du texte : <style>, <script>, commentaires HTML
(conditionnels de Word compris) et feuilles de style recopiées en texte brut (@font-face, @page,
« p.MsoNormal {mso-… } », fragments tronqués en fin de texte).

Le texte lui-même n'est jamais touché : un bloc entre accolades ne part que s'il contient des
propriétés CSS reconnues, et les espaces ne sont normalisés qu'autour de ce qui a été retiré.
"""
import re

_MARQUE = '\x00'

_BALISES_BRUTES = re.compile(r'<(style|script)\b[^>]*>.*?(?:</\1\s*>|\Z)', re.I | re.S)
_COMMENTAIRE = re.compile(r'<!--.*?(?:-->|\Z)|<!\[[^\]]*\]>', re.S)

_PROP = (r'(?:mso-[\w-]+|panose-1|font-(?:family|size|weight|style)|margin(?:-[a-z]+)?|padding(?:-[a-z]+)?'
         r'|page|size|line-height|text-[a-z-]+|color|border(?:-[a-z-]+)?|background(?:-[a-z-]+)?)')
_PREMIERE_PROP = re.compile(r'(?:^|[;\s])' + _PROP + r'\s*:', re.I)
_DECLARATIONS = re.compile(r'^\s*(?:[\w-]+\s*:[^;{}]*;?\s*)+$')

_TAGS = r'(?:p|li|ul|ol|div|span|a|table|tr|td|th|h[1-6]|body|html)'
_SIMPLE = r'(?:' + _TAGS + r'(?:[.#:][\w-]+)*|(?:[.#:][\w-]+)+)'
_SELECTEUR = _SIMPLE + r'(?:\s*,\s*' + _SIMPLE + r')*'
_DEBUT = r'(?<![\w.#:@-])(?:@[a-z-]+[^{};@]{0,80}?|' + _SELECTEUR + r')'

_BLOC = re.compile(_DEBUT + r'\s*\{([^{}]*)\}', re.I)
# Fragment coupé en fin de texte : at-rule ouverte, ou sélecteur dont la première propriété est complète.
_FIN_AT = re.compile(r'(?<![\w.#:@-])@(?:font-face|page|media)\b(?:[^{}]{0,80}\{[^{}]*)?\Z', re.I)
_FIN_SELECTEUR = re.compile(_DEBUT + r'\s*\{\s*' + _PROP + r'\s*:[^{}]*\Z', re.I)


def sans_balisage_brut(fragment):
    """Fragment HTML sans le contenu de ses <style> et <script> ni ses commentaires (avant d'en retirer les balises)."""
    return _COMMENTAIRE.sub(' ', _BALISES_BRUTES.sub(' ', fragment or ''))


def _bloc_css(m):
    corps = m.group(1)
    if _DECLARATIONS.match(corps) and _PREMIERE_PROP.search(corps):
        return _MARQUE
    return m.group(0)


def retirer_balisage(texte):
    """Texte sans <style>, <script>, commentaires HTML ni blocs CSS en clair ; inchangé s'il n'en a pas."""
    if not texte:
        return texte
    t = _BALISES_BRUTES.sub(_MARQUE, texte)
    t = _COMMENTAIRE.sub(_MARQUE, t)
    t = _BLOC.sub(_bloc_css, t)
    t = _FIN_AT.sub(_MARQUE, t)
    t = _FIN_SELECTEUR.sub(_MARQUE, t)
    if _MARQUE not in t:
        return texte
    return re.sub(r'[^\S\n]*' + _MARQUE + r'(?:\s*' + _MARQUE + r')*[^\S\n]*', _recoller, t).strip()


def _recoller(m):
    """Une seule espace là où le bloc retiré séparait deux mots ; rien contre un saut de ligne ou un bord."""
    avant, apres = m.string[:m.start()], m.string[m.end():]
    if not avant or not apres or avant.endswith('\n') or apres.startswith('\n'):
        return ''
    return ' '
