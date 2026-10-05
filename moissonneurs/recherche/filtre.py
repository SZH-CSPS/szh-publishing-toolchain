"""Pertinence d'un projet : institution toujours retenue, mot de `mots` dans le titre ou le descriptif, ou mot
courant de `mots_titre` dans le titre seul. Sans casse ni accents, en début de mot (« autis » trouve « autisme »)."""
import re
import unicodedata


def _normaliser(texte):
    s = unicodedata.normalize('NFD', str(texte or '').lower())
    return ''.join(c for c in s if not unicodedata.combining(c))


def _motifs_debut_mot(texte_normalise, mots):
    """Rend les mots (dans l'ordre, sans doublon) qui apparaissent en début de mot dans le texte."""
    trouves = []
    for mot in mots:
        motif = _normaliser(mot)
        if not motif:
            continue
        if re.search(r'(?<![a-z0-9])' + re.escape(motif), texte_normalise) and mot not in trouves:
            trouves.append(mot)
    return trouves


def pertinence(projet, config_filtre, avec_descriptif=True):
    """Rend le motif de pertinence (« institution » ou mots trouvés, séparés par ', »),
    ou None si le projet n'est pas pertinent."""
    institutions_toujours = config_filtre.get('institutions_toujours', [])
    mots = config_filtre.get('mots', [])

    institutions_normalisees = _normaliser(projet.institutions)
    if _motifs_debut_mot(institutions_normalisees, institutions_toujours):
        return 'institution'

    titre = _normaliser(projet.title)
    texte = _normaliser(projet.title + ' ' + projet.descriptif) if avec_descriptif else titre
    trouves = _motifs_debut_mot(texte, mots)
    # Hors domaine (FNS : physique, médecine...), même un titre « double-blind » ou
    # « accessible » n'est pas un signal : les mots courants ne comptent qu'avec le résumé.
    if avec_descriptif:
        trouves += [m for m in _motifs_debut_mot(titre, config_filtre.get('mots_titre', [])) if m not in trouves]
    if trouves:
        return ', '.join(trouves)
    return None
