"""Noms de personnes possibles, vus seulement derrière un signal (titre civil ou académique, citation « Nom, I. (2020) ») :
signalés masqués (doute `personne-nommee`) dans le titre et les institutions, retirés d'un champ brut."""
import re

_CAP = r"[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿß'’]+(?:-[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿß'’]+)?"
_CIVIL = re.compile(r"(?<![\w.])(?:M\.|MM\.|Mme|Mmes|Mlle|Frau|Herrn?)\s+(" + _CAP + r"(?:\s+" + _CAP + r"){1,2})(?![\w])")
_ACADEMIQUE = re.compile(r"(?<![\w.])(?:Prof\.|Dr\.|PD|Dre)(?:\s+(?:Dr\.|Prof\.|phil\.|rer\.|nat\.|med\.|paed\.|habil\.|em\.|des\.|h\.\s?c\.))*"
                         r"\s+(" + _CAP + r"(?:\s+" + _CAP + r"){0,2})(?![\w])")
_CITATION = re.compile(r"(?<![\w])(" + _CAP + r"(?:\s+" + _CAP + r")?),\s+((?:[A-Z]\.\s?)+?)(?=\s*(?:,|&|\(\d{4}))")


def masque(seq):
    """« Anna Beispiel » devient « A*** B*** » : jamais un nom en clair dans un message."""
    return ' '.join(w[0] + '***' if w[:1].isupper() else w for w in seq.split())


def noms_possibles(texte):
    """Noms possibles, en clair et sans doublon, dans l'ordre du texte : à masquer avant tout message."""
    trouves = []
    for motif in (_CIVIL, _ACADEMIQUE):
        for m in motif.finditer(texte or ''):
            trouves.append((m.start(1), m.group(1)))
    for m in _CITATION.finditer(texte or ''):
        trouves.append((m.start(1), m.group(1) + ' ' + m.group(2).strip()))
    sortie = []
    for _, seq in sorted(trouves):
        if seq not in sortie:
            sortie.append(seq)
    return sortie


def retirer_noms(texte):
    """`texte` sans ses noms possibles, titre civil ou académique compris ; '' s'il ne reste ni lettre ni sens."""
    t = str(texte or '')
    for motif in (_CIVIL, _ACADEMIQUE, _CITATION):
        t = motif.sub(' ', t)
    t = re.sub(r'\s+([,;:)])', r'\1', ' '.join(t.split())).strip(' ,;:/-–')
    return t if re.search(r'[^\W\d_]{2}', t) else ''
