#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Catalogue des règles structurelles et moteur d'alertes du nettoyeur de manuscrit (voir
# docs/ARCHITECTURE-nettoyeur-manuscrit.md).
#
# Règles structurelles : ce qu'un motif lexical ne voit pas. Longueurs (article, résumé,
# titres), niveaux de titre, forme de la bibliographie extraite, accessibilité, ordre
# prénom-nom. Ailleurs :
#  - règles lexicales et éditoriales (épicène, vocabulaire du handicap, casse maison, et/&,
#    citation directe, nom des éditions) : Vale, dans pipeline/vale/ (voir
#    pipeline/vale/LISEZMOI.md) et pipeline/manuscrit_vale.py ;
#  - typographie : pipeline/filters/szh-typographie.lua. Ses avertissements C1 (ß) et C2
#    (guillemets droits non appariés) sont repris tels quels par
#    _reprendre_avertissements_typo() ;
#  - ordre alphabétique de la bibliographie : manuscrit_biblio.verifier_ordre().
# Media.ResolutionImage et Media.TaillePortrait ne sont pas mécanisés : le modèle riche ne
# donne qu'une aire d'image, dont on ne peut pas tirer une résolution. Ce qui demande un
# jugement (style, accord, contraste d'une image) ne l'est pas non plus.
#
# Le module ne connaît ni Word ni OpenDocument. Il reçoit un Contexte (dict JSON) et ne
# devine pas quel paragraphe est le titre ou le résumé : l'appelant le dit.
# Bibliothèque standard seule.
#
# ── Contexte (JSON reçu par --diagnostiquer, sur stdin) ────────────────────────────────────
#
#   {
#     "produit": "revue" | "zeitschrift",
#     "langue": "fr" | "de" | "fr-CH" | "de-CH" ...,
#     "paragraphes": [
#       {"source": 0, "texte": "…", "role": "titre", "niveau_retenu": 0}, ...
#     ],
#     "bibliographie": [
#       {"nom": "Dupont", "annee": 2020, "nb_auteurs": 3, "texte": "…", "source": 12}, ...
#     ],
#     "images": [ {"alt": "…", "source": 3}, ... ],
#     "tableaux": [ {"fusion": true, "source": 5}, ... ],
#     "avertissements_typo": [ "[typo-avertissement] eszett | article « … » | … | [de] …", ... ],
#     "auteurs": [
#       {"prenom": "Edith", "nom": "Guilley", "ordre_confiance": "defaut",
#        "ordre_motif": "signaux contradictoires à poids égal (casse, email) : convention "
#                        "prénom-nom appliquée par défaut",
#        "ordre_conflit": true, "texte_source": "Guilley Edith"},
#       ...
#     ]
#   }
#
# `langue` : seule la sous-étiquette primaire compte (fr-CH → fr), voir _langue_courte().
# `regle.langue` est toujours court ('fr', 'de' ou '').
#
# `role` d'un paragraphe : '' (corps, par défaut), 'titre', 'sous_titre', 'resume',
# 'auteurs', 'mots_cles', 'bibliographie'. Fourni par l'appelant ; absent, il vaut ''.
#
# `niveau_retenu` : celui de manuscrit_modele.classer_titres() (0 = corps, 1 à 3 = titre).
# `bibliographie[i].texte` ne sert qu'à repérer une troncature déjà posée (« … » ou « ... »).
#
# `auteurs` : une fiche par autrice ou auteur reconnu par manuscrit_entete.py, en cas B
# seulement (liste vide en cas A).
#  - `ordre_confiance` : une valeur de manuscrit_noms.CONFIANCE ;
#  - `ordre_motif` : la phrase de manuscrit_noms.trancher(), reprise sans modification ;
#  - `ordre_conflit` : le `conflit` de manuscrit_noms.trancher(), vrai quand deux signaux de
#    même poids se contredisent. C'est ce booléen, et non le texte du motif, qui distingue
#    un conflit d'une absence d'indice ;
#  - `texte_source` : le segment tel que tapé (« Guilley Edith »).
#
# ── Sortie : une alerte ────────────────────────────────────────────────────────────────────
#
#   {"rule": str, "severity": "error"|"warning"|"suggestion", "action": "fix"|"track"|
#    "comment"|"report", "para": int|None, "span": [int,int]|None, "found": str|None,
#    "suggested": str|None, "message": str}
#
# `chapitre` et `famille` se retrouvent en cherchant `rule` dans CATALOGUE.

import json
import re
import sys
from collections import namedtuple

# ---------------------------------------------------------------------------------
# Seuils, tirés des consignes de rédaction de la Revue et de la Zeitschrift. Tous vivent ici.

# Forme.LongueurArticle : même plafond, périmètre différent. La Zeitschrift compte le résumé,
# la Revue non. Seuls les rôles nommés dans l'appel à _signes_par_role() entrent dans le
# total : titre, sous-titre, auteurs et mots-clés en sont exclus.
LONGUEUR_ARTICLE_MAX = 18000

# Forme.LongueurResume : minimum et maximum en français, maximum seul en allemand.
RESUME_MIN_REVUE = 400
RESUME_MAX_REVUE = 600
RESUME_MAX_ZEITSCHRIFT = 700

# Forme.LongueurTitre, LongueurSousTitre, LongueurTitreChapitre : chiffrées seulement par la
# Checkliste allemande. La Revue demande un titre « court et représentatif », sans chiffre.
TITRE_MAX_ZEITSCHRIFT = 100
SOUS_TITRE_MAX_ZEITSCHRIFT = 120
TITRE_CHAPITRE_MAX_ZEITSCHRIFT = 80

# APA.NombreAuteursListes : 20 auteurs nommés au plus. Au-delà, la Revue prescrit la
# troncature (19 premiers, « … », dernier) ; la Zeitschrift ne dit rien, d'où une simple
# suggestion à trancher à la main.
NB_AUTEURS_TRONCATURE = 20

# Pas de règle de style nominal allemand (-ung/-heit/-keit) : elle commentait presque chaque
# paragraphe sans aider la rédaction.


# ---------------------------------------------------------------------------------
# Une règle est une donnée. Son seul champ appelable, `detecter(contexte) -> [constat, ...]`,
# a la même signature pour toutes les règles : evaluer() parcourt le catalogue en une boucle.
Regle = namedtuple('Regle', ['id', 'famille', 'langue', 'produit', 'severite', 'action',
                              'chapitre', 'detecter', 'message_fr', 'message_de'])


# ---------------------------------------------------------------------------------
# Langue : seule la sous-étiquette primaire compte (fr-CH → fr).

def _langue_courte(langue):
    return (langue or '').split('-')[0].strip().lower()


# ---------------------------------------------------------------------------------
# Accès au Contexte : un champ manquant rend '' ou [], sans exception. Un Contexte incomplet
# produit moins d'alertes.

def _paragraphes(contexte):
    return contexte.get('paragraphes') or []


def _bibliographie(contexte):
    return contexte.get('bibliographie') or []


def _images(contexte):
    return contexte.get('images') or []


def _tableaux(contexte):
    return contexte.get('tableaux') or []


def _auteurs(contexte):
    return contexte.get('auteurs') or []


def _role(paragraphe):
    return paragraphe.get('role') or ''


def _signes_par_role(contexte, roles):
    return sum(len(p.get('texte') or '') for p in _paragraphes(contexte) if _role(p) in roles)


# ---------------------------------------------------------------------------------
# Forme : longueurs. Chaque seuil porte sur une liste de rôles explicite.

def _detecter_longueur_article_revue(contexte):
    # Revue : « 18 000 signes, références bibliographiques et espaces compris », sans le
    # résumé.
    total = _signes_par_role(contexte, ('', 'corps', 'bibliographie'))
    if total > LONGUEUR_ARTICLE_MAX:
        return [{'para': None, 'span': None, 'found': '%d signes' % total,
                 'suggested': 'réduire sous %d signes (résumé exclu de ce total)'
                               % LONGUEUR_ARTICLE_MAX}]
    return []


def _detecter_longueur_article_zeitschrift(contexte):
    # Zeitschrift : 18 000 signes au plus, espaces, résumé et bibliographie compris.
    total = _signes_par_role(contexte, ('', 'corps', 'bibliographie', 'resume'))
    if total > LONGUEUR_ARTICLE_MAX:
        return [{'para': None, 'span': None, 'found': '%d Zeichen' % total,
                 'suggested': 'höchstens %d Zeichen (inkl. Leerzeichen, Zusammenfassung und '
                              'Literaturverzeichnis)' % LONGUEUR_ARTICLE_MAX}]
    return []


def _detecter_longueur_resume_revue(contexte):
    total = _signes_par_role(contexte, ('resume',))
    if total == 0:
        return []  # aucun paragraphe de rôle 'resume'
    if total < RESUME_MIN_REVUE or total > RESUME_MAX_REVUE:
        return [{'para': None, 'span': None, 'found': '%d signes' % total,
                 'suggested': 'entre %d et %d signes' % (RESUME_MIN_REVUE, RESUME_MAX_REVUE)}]
    return []


def _detecter_longueur_resume_zeitschrift(contexte):
    total = _signes_par_role(contexte, ('resume',))
    if total == 0:
        return []
    if total > RESUME_MAX_ZEITSCHRIFT:
        return [{'para': None, 'span': None, 'found': '%d Zeichen' % total,
                 'suggested': 'höchstens %d Zeichen' % RESUME_MAX_ZEITSCHRIFT}]
    return []


def _detecter_longueur_titre_zeitschrift(contexte):
    total = _signes_par_role(contexte, ('titre',))
    if total == 0:
        return []
    if total > TITRE_MAX_ZEITSCHRIFT:
        return [{'para': None, 'span': None, 'found': '%d Zeichen' % total,
                 'suggested': 'höchstens %d Zeichen' % TITRE_MAX_ZEITSCHRIFT}]
    return []


def _detecter_longueur_sous_titre_zeitschrift(contexte):
    total = _signes_par_role(contexte, ('sous_titre',))
    if total == 0:
        return []
    if total > SOUS_TITRE_MAX_ZEITSCHRIFT:
        return [{'para': None, 'span': None, 'found': '%d Zeichen' % total,
                 'suggested': 'höchstens %d Zeichen' % SOUS_TITRE_MAX_ZEITSCHRIFT}]
    return []


def _detecter_longueur_titre_chapitre_zeitschrift(contexte):
    # Une seule alerte par document : le nombre d'intertitres trop longs, la limite, et le
    # premier, sur lequel l'alerte est ancrée.
    trop_longs = [p for p in _paragraphes(contexte)
                  if (p.get('niveau_retenu') or 0) in (1, 2, 3)
                  and len(p.get('texte') or '') > TITRE_CHAPITRE_MAX_ZEITSCHRIFT]
    if not trop_longs:
        return []
    premier = trop_longs[0]
    texte = premier.get('texte') or ''
    n = len(trop_longs)
    # Phrase allemande selon le nombre : singulier pour un seul titre, « der erste » sinon.
    return [{'para': premier.get('source'), 'span': [0, len(texte)], 'found': texte,
             'suggested': None, 'n_titres': n, 'limite': TITRE_CHAPITRE_MAX_ZEITSCHRIFT,
             'sujet': 'Ein Titel der Kapitel ist' if n == 1 else '%d Titel der Kapitel sind' % n,
             'suite': ': ' if n == 1 else '; der erste: '}]


# ---------------------------------------------------------------------------------
# Structure : un saut de niveau de titre, par exemple un niveau 3 directement sous un niveau 1
# (même règle en fr et en de).

def _detecter_saut_niveau_titre(contexte):
    constats = []
    niveau_max_vu = 0
    for p in _paragraphes(contexte):
        niveau = p.get('niveau_retenu') or 0
        if niveau == 0:
            continue
        # Le premier titre fixe le niveau de départ : commencer au niveau 2 n'est pas un saut.
        if niveau_max_vu > 0 and niveau > niveau_max_vu + 1:
            constats.append({'para': p.get('source'), 'span': None,
                              'found': 'niveau %d après %d (aucun niveau %d)'
                                       % (niveau, niveau_max_vu, niveau_max_vu + 1),
                              'suggested': 'ajouter les niveaux intermédiaires, ou '
                                           'renuméroter ce titre au niveau %d'
                                           % (niveau_max_vu + 1)})
        niveau_max_vu = max(niveau_max_vu, niveau)
    return constats


# ---------------------------------------------------------------------------------
# APA : forme des citations et des références.

RE_ANNEE = re.compile(r'(?:19|20)\d{2}')

# APA.TroisAuteursPlus : le nombre réel d'auteurs n'est pas dans le texte ; on vérifie
# seulement que « et al. » porte son point.
RE_ET_AL_INCOMPLET = re.compile(r'\bet\s*al(?!\.)\b', re.IGNORECASE)


def _detecter_et_al(contexte):
    constats = []
    for p in _paragraphes(contexte):
        texte = p.get('texte') or ''
        for m in RE_ET_AL_INCOMPLET.finditer(texte):
            constats.append({'para': p.get('source'), 'span': [m.start(), m.end()],
                              'found': m.group(0), 'suggested': m.group(0).rstrip() + '.'})
    return constats


# APA.MemeAuteurMemeAnnee : la lettre a, b, c colle à l'année, sans espace.
RE_ANNEE_LETTRE_ESPACEE = re.compile(
    r'\(([A-ZÀ-Ý][\wÀ-ÿ\'-]*),\s*((?:19|20)\d{2})\s+([a-z])\)')


def _detecter_annee_lettre_espacee(contexte):
    constats = []
    for p in _paragraphes(contexte):
        texte = p.get('texte') or ''
        for m in RE_ANNEE_LETTRE_ESPACEE.finditer(texte):
            constats.append({'para': p.get('source'), 'span': [m.start(), m.end()],
                              'found': m.group(0),
                              'suggested': '(%s, %s%s)' % (m.group(1), m.group(2), m.group(3))})
    return constats


# APA.NombreAuteursListes : lit la bibliographie extraite par l'appelant
# (contexte['bibliographie']).

def _detecter_nb_auteurs_revue(contexte):
    constats = []
    for e in _bibliographie(contexte):
        nb = e.get('nb_auteurs') or 0
        texte = e.get('texte') or ''
        if nb > NB_AUTEURS_TRONCATURE and '…' not in texte and '...' not in texte:
            constats.append({'para': e.get('source'), 'span': None,
                              'found': '%d auteurs' % nb,
                              'suggested': 'tronquer : les 19 premiers, « … », puis le dernier'})
    return constats


def _detecter_nb_auteurs_zeitschrift(contexte):
    constats = []
    for e in _bibliographie(contexte):
        nb = e.get('nb_auteurs') or 0
        if nb > NB_AUTEURS_TRONCATURE:
            constats.append({'para': e.get('source'), 'span': None,
                              'found': '%d auteurs' % nb,
                              'suggested': 'règle non précisée au-delà de %d auteurs côté '
                                           'allemand — à trancher à la main'
                                           % NB_AUTEURS_TRONCATURE})
    return constats


# ---------------------------------------------------------------------------------
# Accessibilité : prescrite par la Revue seule. La Zeitschrift en hérite en `suggestion`,
# par une entrée de catalogue distincte qui dit d'où vient la règle.

def _detecter_alt_manquant(contexte):
    constats = []
    for img in _images(contexte):
        if not (img.get('alt') or '').strip():
            # `found` reste None : il n'y a aucun texte à citer. manuscrit_annoter.py commente
            # alors le paragraphe voisin, ou renvoie l'alerte au rapport.
            constats.append({'para': img.get('source'), 'span': None,
                              'found': None, 'suggested': None})
    return constats


def _detecter_tableau_fusionne(contexte):
    constats = []
    for tbl in _tableaux(contexte):
        if tbl.get('fusion'):
            constats.append({'para': tbl.get('source'), 'span': None,
                              'found': 'cellules fusionnées',
                              'suggested': 'tableau lisible linéairement, sans fusion'})
    return constats


# ---------------------------------------------------------------------------------
# En-tête : ordre prénom-nom. Contrôle technique de l'attribution automatique, sans source
# dans les consignes de rédaction. Seules les fiches de confiance `defaut` sont signalées :
#   - par conflit (deux signaux contraires de même poids) : Entete.OrdreNomIncertain, une
#     alerte par fiche ;
#   - faute d'indice : Entete.OrdreNomParDefaut, une seule alerte pour le document, qui nomme
#     les fiches concernées.

def _auteur_en_conflit(auteur):
    """Vrai pour un ordre `defaut` dû à un conflit. Se lit sur `ordre_conflit`, et non dans
    le texte de `ordre_motif`, qu'une reformulation changerait. `ordre_confiance` est vérifié
    aussi, au cas où une fiche tranchée porterait `ordre_conflit`."""
    return auteur.get('ordre_confiance') == 'defaut' and bool(auteur.get('ordre_conflit'))


def _nom_lisible_auteur(auteur):
    """Le segment tel que tapé (`texte_source`, « Guilley Edith »), que la rédaction
    reconnaît dans son manuscrit ; à défaut, prénom et nom."""
    texte_source = (auteur.get('texte_source') or '').strip()
    if texte_source:
        return texte_source
    return ('%s %s' % (auteur.get('prenom') or '', auteur.get('nom') or '')).strip()


def _detecter_ordre_nom_incertain(contexte):
    constats = []
    for a in _auteurs(contexte):
        if _auteur_en_conflit(a):
            constats.append({'para': None, 'span': None,
                              'found': _nom_lisible_auteur(a), 'suggested': None})
    return constats


def _detecter_ordre_nom_par_defaut(contexte):
    # Une seule alerte pour toutes les fiches.
    noms = [_nom_lisible_auteur(a) for a in _auteurs(contexte)
            if a.get('ordre_confiance') == 'defaut' and not _auteur_en_conflit(a)]
    noms = [n for n in noms if n]
    if not noms:
        return []
    return [{'para': None, 'span': None, 'n_fiches': len(noms),
              'found': '; '.join(noms), 'suggested': None}]


# ---------------------------------------------------------------------------------
# Catalogue. `chapitre` renvoie au passage des consignes de rédaction qui fonde la règle,
# pour que la rédaction puisse contester une alerte.

CATALOGUE = [
    Regle('Forme.LongueurArticle.Revue', 'Forme', 'fr', 'revue', 'error', 'report',
          'Revue: Essentiel en bref / 1 Aspects formels', _detecter_longueur_article_revue,
          'Article trop long : %(found)s (résumé exclu, biblio et espaces compris).',
          ''),
    Regle('Forme.LongueurArticle.Zeitschrift', 'Forme', 'de', 'zeitschrift', 'error', 'report',
          'Zeitschrift: Checkliste', _detecter_longueur_article_zeitschrift,
          '',
          'Artikel zu lang: %(found)s (Zusammenfassung und Literaturverzeichnis inklusive).'),
    Regle('Forme.LongueurResume.Revue', 'Forme', 'fr', 'revue', 'error', 'report',
          'Revue: Essentiel en bref', _detecter_longueur_resume_revue,
          'Résumé hors fourchette : %(found)s.', ''),
    Regle('Forme.LongueurResume.Zeitschrift', 'Forme', 'de', 'zeitschrift', 'error', 'report',
          'Zeitschrift: Checkliste', _detecter_longueur_resume_zeitschrift,
          '', 'Zusammenfassung zu lang: %(found)s.'),
    Regle('Forme.LongueurTitre.Zeitschrift', 'Forme', 'de', 'zeitschrift', 'error', 'report',
          'Zeitschrift: Checkliste', _detecter_longueur_titre_zeitschrift,
          '', 'Titel zu lang: %(found)s.'),
    Regle('Forme.LongueurSousTitre.Zeitschrift', 'Forme', 'de', 'zeitschrift', 'error', 'report',
          'Zeitschrift: Checkliste', _detecter_longueur_sous_titre_zeitschrift,
          '', 'Untertitel zu lang: %(found)s.'),
    Regle('Forme.LongueurTitreChapitre.Zeitschrift', 'Forme', 'de', 'zeitschrift', 'error',
          'report', 'Zeitschrift: Checkliste', _detecter_longueur_titre_chapitre_zeitschrift,
          '', '%(sujet)s länger als %(limite)d Zeichen (inkl. Leerzeichen)%(suite)s«%(found)s».'),

    Regle('Structure.NiveauxTitre', 'Structure', '', '', 'warning', 'report',
          'Revue: 1.1 Mise en page / Zeitschrift: Checkliste', _detecter_saut_niveau_titre,
          'Saut de niveau de titre : %(found)s.',
          'Sprung in der Titelebene: %(found)s.'),

    Regle('APA.TroisAuteursPlus', 'APA', '', '', 'warning', 'fix',
          'Revue: 3.1.3 / Zeitschrift: Weitere Regeln', _detecter_et_al,
          '« et al. » doit porter son point final : « %(found)s ».',
          '«et al.» muss mit Punkt enden: «%(found)s».'),
    Regle('APA.MemeAuteurMemeAnnee', 'APA', '', '', 'warning', 'fix',
          'Revue: 3.1.2 / 3.2.1 / Zeitschrift: Sinngemässe Zitate im Text / Anordnung',
          _detecter_annee_lettre_espacee,
          'La lettre colle à l’année, sans espace\u00a0: «\u00a0%(found)s\u00a0».',
          'Der Buchstabe klebt am Jahr, ohne Leerzeichen: « %(found)s ».'),
    Regle('APA.NombreAuteursListes.Revue', 'APA', 'fr', 'revue', 'error', 'comment',
          'Revue: 3.2.2.1', _detecter_nb_auteurs_revue,
          'Liste d’auteurs non tronquée : %(found)s.', ''),
    Regle('APA.NombreAuteursListes.Zeitschrift', 'APA', 'de', 'zeitschrift', 'suggestion',
          'report', 'Zeitschrift: Literaturverzeichnis / Anordnung',
          _detecter_nb_auteurs_zeitschrift,
          '', 'Mehr als %d Autor:innen: %%(found)s.' % NB_AUTEURS_TRONCATURE),

    Regle('A11y.TexteAlternatif.Revue', 'A11y', 'fr', 'revue', 'warning', 'comment',
          'Revue: 2.4.2 Images et schéma', _detecter_alt_manquant,
          'Image sans texte alternatif.', ''),
    Regle('A11y.TexteAlternatif.ZeitschriftHeritee', 'A11y', '', 'zeitschrift', 'suggestion',
          'comment',
          'Revue: 2.4.2 (hérité\u00a0– aucun chapitre équivalent dans le document allemand)',
          _detecter_alt_manquant,
          '', 'Bild ohne Alternativtext (aus der Revue übernommen, keine deutsche Quelle).'),
    Regle('A11y.TableauLineaire.Revue', 'A11y', 'fr', 'revue', 'warning', 'comment',
          'Revue: 2.4.3 Tableaux', _detecter_tableau_fusionne,
          'Tableau avec cellules fusionnées\u00a0: lecture linéaire compromise.', ''),
    Regle('A11y.TableauLineaire.ZeitschriftHeritee', 'A11y', '', 'zeitschrift', 'suggestion',
          'comment',
          'Revue: 2.4.3 (hérité\u00a0– aucun chapitre équivalent dans le document allemand)',
          _detecter_tableau_fusionne,
          '', 'Tabelle mit verschmolzenen Zellen (aus der Revue übernommen).'),

    Regle('Entete.OrdreNomIncertain', 'Entete', '', '', 'warning', 'report',
          "Aucune source normative\u00a0: contrôle technique interne (attribution automatique "
          "de l’ordre prénom/nom, absente des deux Redaktionsrichtlinien).",
          _detecter_ordre_nom_incertain,
          '«\u00a0%(found)s\u00a0»\u00a0: lu Prénom Nom, mais les indices se contredisent\u00a0– vérifier.',
          '«%(found)s»: als Vorname Nachname gelesen, aber die Hinweise widersprechen '
          'sich – bitte prüfen.'),
    Regle('Entete.OrdreNomParDefaut', 'Entete', '', '', 'suggestion', 'report',
          "Aucune source normative\u00a0: contrôle technique interne (attribution automatique "
          "de l’ordre prénom/nom, absente des deux Redaktionsrichtlinien).",
          _detecter_ordre_nom_par_defaut,
          "Ordre prénom/nom établi par convention faute d’indice, pour %(n_fiches)d "
          'fiche(s)\u00a0: %(found)s.',
          'Reihenfolge Vorname/Nachname mangels Hinweis nach Konvention festgelegt, für '
          '%(n_fiches)d Eintrag/Einträge: %(found)s.'),
]

CATALOGUE_PAR_ID = {r.id: r for r in CATALOGUE}


# ---------------------------------------------------------------------------------
# Reprise des avertissements de szh-typographie.lua, lus sur sa sortie d'erreur :
#   [typo-avertissement] <code> | article « <slug> » | <phrase fr> | [de] <phrase de>

RE_TYPO_AVERTISSEMENT = re.compile(
    r'^\[typo-avertissement\]\s+(\S+)\s+\|\s+article\s+«[^»]*»\s+\|\s+(.*?)\s+\|\s+\[de\]\s+(.*)$')


def _reprendre_avertissements_typo(contexte, langue_courte):
    alertes = []
    for ligne in contexte.get('avertissements_typo') or []:
        m = RE_TYPO_AVERTISSEMENT.match(ligne)
        if not m:
            continue
        code, phrase_fr, phrase_de = m.groups()
        message = phrase_de if langue_courte == 'de' and phrase_de else phrase_fr
        alertes.append({'rule': 'Typo.' + code, 'severity': 'warning', 'action': 'report',
                         'para': None, 'span': None, 'found': code, 'suggested': None,
                         'message': message})
    return alertes


# ---------------------------------------------------------------------------------
# Moteur. Une règle ne s'exécute que si son `produit` et sa `langue` correspondent au
# Contexte (chaîne vide : les deux). C'est ce qui permet à une règle de valoir pour une revue
# et pas pour l'autre.

def evaluer(contexte):
    produit = contexte.get('produit') or ''
    langue_courte = _langue_courte(contexte.get('langue'))
    alertes = []
    for regle in CATALOGUE:
        if regle.produit and regle.produit != produit:
            continue
        if regle.langue and regle.langue != langue_courte:
            continue
        for constat in (regle.detecter(contexte) or []):
            gabarit_message = regle.message_de if (langue_courte == 'de' and regle.message_de) \
                else regle.message_fr
            # Tout le constat est passé au gabarit du message : certaines règles y ajoutent
            # des clés (%(n_fiches)d, %(limite)d…). L'opérateur % ignore les clés en trop.
            champs = dict(constat)
            try:
                message = gabarit_message % champs
            except (KeyError, ValueError, TypeError):
                message = gabarit_message
            alertes.append({
                'rule': regle.id,
                'severity': regle.severite,
                'action': regle.action,
                'para': constat.get('para'),
                'span': constat.get('span'),
                'found': constat.get('found'),
                'suggested': constat.get('suggested'),
                'message': message,
            })
    alertes.extend(_reprendre_avertissements_typo(contexte, langue_courte))
    return alertes


# ---------------------------------------------------------------------------------
# Groupement par famille et compte par règle. Pour chaque règle, on garde le total et les
# dix premières alertes.

MAX_EXEMPLES_PAR_REGLE = 10


def grouper(alertes):
    par_famille = {}
    par_regle = {}
    for a in alertes:
        regle = CATALOGUE_PAR_ID.get(a['rule'])
        famille = regle.famille if regle is not None else 'Typo'
        par_famille[famille] = par_famille.get(famille, 0) + 1
        par_regle.setdefault(a['rule'], []).append(a)

    resume_par_regle = {}
    for identifiant, lot in par_regle.items():
        resume_par_regle[identifiant] = {
            'total': len(lot),
            'exemples': lot[:MAX_EXEMPLES_PAR_REGLE],
        }
    return {'par_famille': par_famille, 'par_regle': resume_par_regle}


# ---------------------------------------------------------------------------------
# CLI de diagnostic, comme manuscrit_modele.py : JSON sur stdin, JSON ASCII sur stdout (la
# console Windows n'est pas forcément en UTF-8). `--catalogue` liste le catalogue, pour les
# tests qui le vérifient sans fabriquer de Contexte.

def principal(argv):
    args = argv[1:]

    if '--catalogue' in args:
        try:
            sys.stdout.reconfigure(encoding='utf-8')
        except Exception:
            pass
        print(json.dumps([
            {'id': r.id, 'famille': r.famille, 'langue': r.langue, 'produit': r.produit,
             'severite': r.severite, 'action': r.action, 'chapitre': r.chapitre}
            for r in CATALOGUE], ensure_ascii=True))
        return 0

    if '--diagnostiquer' not in args:
        print('usage : manuscrit_regles.py --diagnostiquer   (Contexte JSON sur stdin)\n'
              '        manuscrit_regles.py --catalogue        (liste le catalogue)',
              file=sys.stderr)
        return 2

    try:
        sys.stdin.reconfigure(encoding='utf-8')
        sys.stdout.reconfigure(encoding='utf-8')
        # stderr aussi : la console Windows (cp1252) plante sur un accent combinant.
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

    try:
        contexte = json.loads(sys.stdin.read())
    except Exception as e:
        print('[manuscrit_regles] JSON d\'entrée illisible : %s' % e, file=sys.stderr)
        return 1

    alertes = evaluer(contexte)
    resultat = {'alertes': alertes, 'groupes': grouper(alertes)}
    print(json.dumps(resultat, ensure_ascii=True))
    return 1 if any(a['severity'] == 'error' for a in alertes) else 0


if __name__ == '__main__':
    sys.exit(principal(sys.argv))
