#!/usr/bin/env python3
# livre-assembler.py — assemble les fragments HTML des chapitres, les liminaires et le
# sommaire en un document, celui que WeasyPrint paginera.
#
#   python3 livre-assembler.py --meta buch.yaml --gabarit <g.html> --sortie <out.html>
#                              [--css <feuille>]... [--css-embed <feuille>]... <fragment>...
#                              [--sans-liminaires]
#
# --sans-liminaires : le chapitre seul (cible livre-chapitre-pdf de livre.mk). Aucun
# liminaire, pas de sommaire ; le titre du document devient celui du chapitre.
#
#   python3 livre-assembler.py --meta buch.yaml --numeros-chapitres <slug>...
#
# --numeros-chapitres : écrit « slug=1.1 » pour chaque chapitre numéroté par sa partie
# (numeros-chapitres: partie), que livre.mk passe au chapitre ; rien d'autre.
#
#   python3 livre-assembler.py --meta buch.yaml --fichiers-images
#
# --fichiers-images : les images que l'assemblage incorpore, une par ligne, dont livre.mk
# fait des prérequis ; rien d'autre.
#
# --css lie la feuille (<link>) : la voie du PDF, où un chemin absolu ne pose pas de
# problème. --css-embed l'incorpore (<style>) : la voie du HTML web, qui doit rester un
# seul fichier ouvrable par file:// sans rien à côté — voir main() pour le détail.
#
# Pourquoi un assembleur, et pas une seule invocation de pandoc sur tous les chapitres.
# La règle de compilation fait `cd chapitres/<slug>` avant pandoc, pour que `media/` tombe
# juste — c'est ce qui permet à un chapitre d'être compilé exactement comme un article de
# revue, avec la même suite de filtres et le même gestionnaire de médias. Douze chapitres,
# ce sont douze dossiers courants différents : une seule invocation ne peut pas les avoir
# tous. On compile donc chapitre par chapitre, avec --embed-resources, et l'assemblage
# devient une opération de texte : chaque fragment est déjà autonome, images comprises en
# data: URI. Mesuré sur le banc : zéro chemin relatif survivant dans un fragment.
#
# Ce que ce script fait, et rien d'autre :
#   1. lit buch.yaml (analyseur plat maison — l'image WSL n'a pas PyYAML) ;
#   2. compose les liminaires que la machine sait écrire : demi-titre, impressum,
#      page de titre, sommaire ;
#   3. relève les titres des fragments pour bâtir le sommaire, avec des liens internes —
#      les numéros de page sont posés par WeasyPrint (target-counter), jamais ici ;
#   4. remplit le gabarit et écrit la sortie.
#
# ⚠ Ce script n'invente aucune métadonnée. Une clé absente de buch.yaml laisse le bloc
#   correspondant vide plutôt que d'écrire une valeur plausible : un ISBN inventé
#   s'imprimerait.

import html
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import szh_commun

# Analyseur YAML plat (une clé par ligne, listes en tirets, sous-blocs indentés d'un
# niveau) : voir szh_commun.lire_yaml(), dont couverture.py se sert aussi — une divergence
# entre les deux lecteurs serait un livre dont la couverture et l'intérieur se contredisent.
lire_yaml = szh_commun.lire_yaml


# --------------------------------------------------------------------------------------
# Le bloc `mise-en-page:` de buch.yaml, maquette normal seulement.
#
# Une clé à valeurs nommées devient data-<clé>="<valeur>" sur <html>, un nombre en mm une
# propriété personnalisée dans le style="" de <html> ; les règles vivent dans
# styles/livre/normal.css. Les filtres de chapitre (szh-sections, szh-numerotation,
# szh-livre-auteurs, szh-legende-avant) relisent le même bloc, par szh-commun.lua.
# Une maquette falc ignore le bloc entier.
# --------------------------------------------------------------------------------------

# Les clés, leurs valeurs, leurs défauts et les refus : pipeline/livre/mise-en-page.json,
# que szh-commun.lua lit aussi. Rien n'est recopié ici.
CHEMIN_MISE_EN_PAGE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                   'livre', 'mise-en-page.json')
with open(CHEMIN_MISE_EN_PAGE, encoding='utf-8') as _f:
    _CONTRAT = json.load(_f)
MISE_EN_PAGE = _CONTRAT['cles']
REFUS_MISE_EN_PAGE = _CONTRAT['refus']

RE_NOMBRE_MM = re.compile(r'^\d+(?:[.,]\d+)?$')


def _erreur_mise_en_page(code, champ, **valeurs):
    gabarit = REFUS_MISE_EN_PAGE[code]
    return szh_commun.formater_avertissement(
        '[livre-blocage]', code, [champ], gabarit['fr'].format(**valeurs),
        gabarit['de'].format(**valeurs))


def lire_mise_en_page(meta):
    """Rend (réglages, erreurs). Réglages : chaque clé de MISE_EN_PAGE avec sa valeur,
    défaut compris ; None pour une maquette falc. Erreurs : lignes au format maison, une
    par clé inconnue ou valeur refusée."""
    if str(meta.get('maquette') or 'normal') == 'falc':
        return None, []
    bloc = meta.get('mise-en-page')
    if bloc in (None, ''):
        bloc = {}
    erreurs = []
    if not isinstance(bloc, dict):
        erreurs.append(_erreur_mise_en_page('mise-en-page-illisible', 'mise-en-page'))
        bloc = {}
    reglages = {cle: d['defaut'] for cle, d in MISE_EN_PAGE.items()}
    for cle, brut in bloc.items():
        champ = 'mise-en-page.' + cle
        if cle not in MISE_EN_PAGE:
            erreurs.append(_erreur_mise_en_page('mise-en-page-cle-inconnue', champ, cle=cle,
                                                permises=', '.join(MISE_EN_PAGE)))
            continue
        # Un commentaire en fin de ligne n'appartient pas à la valeur : pandoc l'ignore, le
        # lecteur plat de szh_commun le garderait.
        valeur = re.sub(r'\s+#.*$', '', str(brut).strip()).strip().strip('"\'')
        definition = MISE_EN_PAGE[cle]
        if 'valeurs' not in definition:
            bas, haut = definition['min'], definition['max']
            nombre = float(valeur.replace(',', '.')) if RE_NOMBRE_MM.match(valeur) else None
            if nombre is None or not bas <= nombre <= haut:
                erreurs.append(_erreur_mise_en_page('mise-en-page-valeur-mm', champ,
                                                    valeur=valeur, cle=cle, min=bas, max=haut))
                continue
            reglages[cle] = int(nombre) if nombre == int(nombre) else nombre
        elif valeur not in definition['valeurs']:
            erreurs.append(_erreur_mise_en_page('mise-en-page-valeur', champ, valeur=valeur,
                                                cle=cle,
                                                permises=', '.join(definition['valeurs'])))
        else:
            reglages[cle] = valeur
    return reglages, erreurs


def attributs_mise_en_page(reglages):
    """Les attributs de <html> : data-<clé> pour chaque valeur nommée, puis un style=""
    pour les nombres. Chaîne vide sans réglages (maquette falc)."""
    if not reglages:
        return ''
    attrs, style = [], []
    for cle, valeur in reglages.items():
        propriete = MISE_EN_PAGE[cle].get('propriete')
        if propriete:
            style.append('%s: %smm' % (propriete, valeur))
        else:
            attrs.append(' data-%s="%s"' % (cle, html.escape(str(valeur), quote=True)))
    if style:
        attrs.append(' style="%s"' % '; '.join(style))
    return ''.join(attrs)


# --------------------------------------------------------------------------------------
# Sommaire : relevé des titres dans les fragments.
# --------------------------------------------------------------------------------------

RE_TITRE = re.compile(
    r'<h(?P<n>[1-3])\b[^>]*\bid="(?P<id>[^"]+)"[^>]*>(?P<txt>.*?)</h(?P=n)>',
    re.S | re.I)
RE_BALISE = re.compile(r'<[^>]+>')
RE_BR = re.compile(r'<br\s*/?>', re.I)
RE_NUM_SECTION = re.compile(r'<span class="szh-num-section">.*?</span>', re.S)

# La couleur d'un chapitre est déjà dans son fragment : livre.mk (PALETTE_CHAPITRE) l'a
# posée en --c-chapitre sur la <section class="szh-chapitre"> qui l'enveloppe (voir
# templates/szh-livre-chapitre.html) — c'est ce qui peint la pastille et l'onglet de
# tranche sur la page d'ouverture. On la lit ici, on ne la recalcule pas : un chapitre, un
# seul calcul de sa couleur. Une liminaire ou la 4e de couverture n'a pas cette section et
# ne matche donc jamais — ses entrées de sommaire, s'il y en avait, resteraient sans
# couleur, ce qui est la bonne réponse : elles n'appartiennent à aucun chapitre.
RE_COULEUR_CHAPITRE = re.compile(
    r'<section\b[^>]*\bclass="[^"]*\bszh-chapitre\b[^"]*"[^>]*\bstyle="[^"]*--c-chapitre:\s*'
    r'([^;"]+)', re.S | re.I)

# Même lecture que la couleur, mais pour --onglet-hauteur : la hauteur de case de l'index
# à pouce, calculée une seule fois par livre.mk (ONGLET_Y0/ONGLET_Y1, voir sa note de
# tête) et posée en métadonnée sur CHAQUE chapitre du sommaire — identique pour tous, donc
# n'importe lequel suffit à la retrouver ici, une seule fois, pour tout le livre.
RE_ONGLET_HAUTEUR = re.compile(r'--onglet-hauteur:\s*([^;"]+)')

# Un chapitre retiré du sommaire (`sommaire: non` dans son <slug>.meta.yaml) porte
# `data-sommaire="non"` sur sa section — posé par livre.mk/szh-livre-chapitre.html, jamais
# recalculé ici. Ses titres (h1 d'ouverture comme ses h2/h3 internes) n'entrent dans
# AUCUNE entrée de sommaire : le chapitre entier est invisible à la table des matières.
RE_HORS_SOMMAIRE = re.compile(
    r'<section\b[^>]*\bclass="[^"]*\bszh-chapitre\b[^"]*"[^>]*\bdata-sommaire="non"',
    re.S | re.I)

# Le numéro DU SOMMAIRE (rang parmi les chapitres du sommaire, voir livre.mk § Index à
# pouce) : le même texte que celui écrit en dur dans la pastille (templates/szh-livre-
# chapitre.html, <div class="szh-pastille">). On le relit ici pour la même raison que la
# couleur et --onglet-hauteur : une seule fois calculé, jamais recalculé.
RE_NUMERO_CHAPITRE = re.compile(r'<div class="szh-pastille" aria-hidden="true">(\d+)</div>')


def couleur_du_fragment(fragment):
    """Rend la couleur du chapitre (« #RRGGBB ») si le fragment en porte une, sinon None."""
    m = RE_COULEUR_CHAPITRE.search(fragment)
    return m.group(1).strip() if m else None


def onglet_hauteur_du_fragment(fragment):
    """Rend la hauteur de case de l'index à pouce (« 22.857mm ») si le fragment en porte
    une, sinon None — absente pour un chapitre hors sommaire, ou hors maquette FALC."""
    m = RE_ONGLET_HAUTEUR.search(fragment)
    return m.group(1).strip() if m else None


def numero_chapitre_du_fragment(fragment):
    """Rend le numéro DU SOMMAIRE (« 3 »), tel qu'écrit dans la pastille, si le fragment
    en porte un — absent pour un chapitre hors sommaire (sa pastille est vide)."""
    m = RE_NUMERO_CHAPITRE.search(fragment)
    return m.group(1) if m else None


def hors_sommaire(fragment):
    """Vrai si CE fragment est un chapitre retiré de la table des matières."""
    return RE_HORS_SOMMAIRE.search(fragment) is not None


# La ligne des auteur·e·s d'un chapitre collectif : celle de szh-livre-auteurs.lua, ou le
# bloc venu de l'import Word.
RE_AUTEURS_CHAPITRE = re.compile(
    r'<(p|div)\b[^>]*\bclass="szh-auteurs"[^>]*>(?P<txt>.*?)</(?:p|div)>', re.S | re.I)


def auteurs_du_fragment(fragment):
    """Rend la ligne d'auteur·e·s du chapitre, en texte, ou None."""
    m = RE_AUTEURS_CHAPITRE.search(fragment)
    if not m:
        return None
    txt = re.sub(r'\s+', ' ', html.unescape(RE_BALISE.sub('', m.group('txt'))).strip())
    return txt or None


def titres_du_fragment(fragment, numeroter=True, separateur=" "):
    """Rend [(niveau, ancre, texte, couleur, onglet_hauteur)] pour h1..h3. Le texte est
    dépouillé de ses balises : « <span class="szh-num-section">2</span> Teilhabe » donne
    « 2 Teilhabe » — SAUF pour le h1 d'un chapitre QUI A UN NUMÉRO DE SOMMAIRE (voir
    ci-dessous), où ce numéro-là remplace celui de la balise. `couleur` et
    `onglet_hauteur` sont ceux du CHAPITRE ENTIER : un fragment est un seul chapitre, donc
    tous ses titres — le h1 d'ouverture comme ses h2/h3 internes — les partagent,
    exactement comme l'onglet de tranche les accompagne du premier au dernier paragraphe
    du chapitre.

    ⚠ Le h1 d'un chapitre porte un `<span class="szh-num-section">` posé par
    szh-sections.lua à partir de SZH_CHAPITRE — le RANG dans $(CHAPITRES), pas le numéro
    du sommaire (voir livre.mk, § Index à pouce : les deux divergent dès qu'un chapitre
    est hors sommaire). Un chapitre 4 devenu 1er du sommaire y gardait donc écrit « 4 » —
    la pastille disait 1, le sommaire disait 4, en contradiction avec la charte FALC (le
    numéro imprimé sur la page ouvrante), et FALC masque de toute façon cette balise par
    CSS (`.szh-num-section { display: none }`), donc son contenu n'a de sens QUE relu ici.
    Pour un h1 qui porte --numero-chapitre (voir numero_chapitre_du_fragment), on retire
    donc CETTE balise avec son contenu (pas seulement la balise) et on préfixe le numéro
    du sommaire à sa place — pastille et sommaire disent alors, toujours, le même nombre.
    Les h2/h3 (numérotation de section, pas de chapitre) ne sont pas concernés : leur
    balise `szh-num-section` reste lue comme avant.

    Un chapitre hors sommaire (`sommaire: non`) ne rend AUCUNE entrée : il est absent de
    la table des matières dans son entier, pas seulement de son propre h1.

    `numeroter` faux (maquette normal, `numeros-chapitres: aucun`) : le h1 ne reçoit aucun
    numéro, pastille ou non. `separateur` : ce qui sépare le numéro du titre."""
    if hors_sommaire(fragment):
        return []
    couleur = couleur_du_fragment(fragment)
    onglet_h = onglet_hauteur_du_fragment(fragment)
    numero = numero_chapitre_du_fragment(fragment) if numeroter else None
    trouves = []
    for m in RE_TITRE.finditer(fragment):
        niveau = int(m.group('n'))
        brut = m.group('txt')
        prefixe = numero if niveau == 1 else None
        if niveau == 1 and numero:
            brut = RE_NUM_SECTION.sub('', brut)
        elif niveau == 1:
            # Sans numéro de sommaire (numeros-chapitres: partie), celui que szh-sections.lua
            # a écrit dans le titre, suivi du séparateur du sommaire.
            m_num = RE_NUM_SECTION.search(brut)
            if m_num:
                prefixe = re.sub(r'\s+', ' ', html.unescape(RE_BALISE.sub('', m_num.group(0)))).strip()
                brut = RE_NUM_SECTION.sub('', brut)
        # Un <br> du titre (« // ») vaut une espace : sans cela, deux mots se colleraient.
        txt = RE_BALISE.sub('', RE_BR.sub(' ', brut))
        txt = re.sub(r'\s+', ' ', html.unescape(txt).strip())
        if prefixe and txt:
            txt = prefixe + separateur + txt
        if txt:
            trouves.append((niveau, m.group('id'), txt, couleur, onglet_h))
    return trouves


# --------------------------------------------------------------------------------------
# Avertissement : une case de l'index à pouce trop basse pour son titre.
#
# Estimation grossière, pas une mesure de glyphes (fontTools serait le bon outil, mais un
# avertissement de mise en page n'a pas besoin de cette précision) : à 13 pt Light sur la
# colonne FALC standard (125 mm de texte utile), une ligne tient environ 52 caractères —
# ~0,52 em par caractère, moyenne d'usage pour un sans-serif proportionnel. Une entrée qui
# dépasse 85 % de cette capacité (⁓44 caractères) risque de passer sur deux lignes : le
# dernier mot, s'il est long, ne trouve pas sa place et bascule en entier (aucune césure
# en FALC — voir --cesure ci-dessus), ce qui déclenche le repli avant d'atteindre 100 %.
CAR_PAR_LIGNE = 52
SEUIL_RISQUE_DEUX_LIGNES = int(CAR_PAR_LIGNE * 0.85)
# Hauteur de case minimale pour UNE ligne de titre (padding 4+4 mm, filet ~0,3 mm, une
# ligne à 13 pt / interligne 1,64 ≈ 7,5 mm) et pour DEUX (la même plus une ligne) — les
# deux mesures qui bornent l'avertissement ci-dessous.
ONGLET_H_MIN_1_LIGNE = 16.0
ONGLET_H_MIN_2_LIGNES = 24.0


def verifier_hauteur_sommaire(entrees):
    """Émet un [livre-avertissement] pour chaque entrée de CHAPITRE (niveau 1) dont la
    case de l'index à pouce risque d'être trop basse pour son titre. N'arrête rien : c'est
    un avertissement, pas une porte — le sommaire se compose quand même, au pire un peu
    à l'étroit, et c'est cette étroitesse que le message signale."""
    for niveau, ancre, txt, couleur, onglet_h in (e[:5] for e in entrees):
        if niveau != 1 or not onglet_h:
            continue
        try:
            h = float(re.sub(r'[a-zA-Z%]+$', '', onglet_h.strip()))
        except ValueError:
            continue
        risque_deux_lignes = len(txt) > SEUIL_RISQUE_DEUX_LIGNES
        if h < ONGLET_H_MIN_1_LIGNE:
            print('[livre-avertissement] onglet-case-etroite | chapitre « %s » | '
                  'La case de l\'index à pouce pour ce chapitre ne fait que %.1f mm de '
                  "haut : même un titre d'une ligne y tient à l'étroit. Repli : réduire "
                  'le nombre de chapitres au sommaire, élargir la plage --onglet-y0/'
                  '--onglet-y1 (livre.mk/falc.css), ou réduire le remplissage vertical '
                  "d'une entrée. | [de] Das Feld im Inhaltsverzeichnis-Register für "
                  'dieses Kapitel ist nur %.1f mm hoch: selbst ein einzeiliger Titel hat '
                  'darin wenig Platz.' % (txt, h, h), file=sys.stderr)
        elif h < ONGLET_H_MIN_2_LIGNES and risque_deux_lignes:
            print('[livre-avertissement] onglet-case-etroite | chapitre « %s » | '
                  'La case de l\'index à pouce pour ce chapitre fait %.1f mm de haut, et '
                  'son titre (%d caractères) risque de tenir sur deux lignes : il lui '
                  'faudrait environ %.1f mm. Repli : réduire le remplissage vertical de '
                  "l'entrée, élargir la plage --onglet-y0/--onglet-y1 (livre.mk/"
                  'falc.css), ou raccourcir le titre. | [de] Das Feld im '
                  'Inhaltsverzeichnis-Register für dieses Kapitel ist %.1f mm hoch, sein '
                  'Titel (%d Zeichen) könnte zwei Zeilen brauchen — dafür wären etwa '
                  '%.1f mm nötig.'
                  % (txt, h, len(txt), ONGLET_H_MIN_2_LIGNES, h, len(txt),
                     ONGLET_H_MIN_2_LIGNES), file=sys.stderr)


def sommaire_html(entrees, titre, hierarchique=False, auteurs=None, cases=True):
    """Le sommaire est une <ol> de liens internes. Le numéro de page est posé par
    target-counter() dans base.css : rien ici ne connaît la pagination, et c'est bien —
    un numéro écrit ici serait faux au premier paragraphe ajouté.

    Chaque entrée reçoit la couleur DE SON CHAPITRE en --c-chapitre, posée en style inline
    sur le <li> — la même variable, au même format, que celle que livre.mk pose sur la
    <section> du chapitre. C'est ce qui permet à livre/falc.css de peindre le repère de
    sommaire avec la règle qu'il porte déjà (`.szh-sommaire li::after { background:
    var(--c-chapitre, …) }`) : elle attendait cette variable, jamais posée avant ce
    correctif — d'où des repères tous à la couleur de repli, --c-falc-accent-defaut.

    --onglet-hauteur (la hauteur de case de l'index à pouce, IDENTIQUE pour tout le livre)
    est posée UNE FOIS, en style inline sur la <section> elle-même — elle est héritée par
    chaque <li>, comme toute propriété personnalisée CSS non redéfinie. C'est la même
    valeur que celle que livre.mk a posée sur chaque chapitre (voir onglet_hauteur_du_
    fragment ci-dessus) : le sommaire ne la recalcule jamais, il la relit.

    `hierarchique` (maquette normal, `sommaire: hierarchique`) : parties et chapitres seuls,
    chaque chapitre suivi de ses auteur·e·s quand `auteurs` (ancre du h1 -> ligne) en donne.

    Une entrée est (niveau, ancre, texte, couleur, hauteur de case[, extra]) ; niveau 0 pour
    une partie. `extra` : classes du <li> et numéro de partie, imprimé dans son <span>.
    `cases` faux : pas d'index à pouce (maquette normal), rien à vérifier.
    """
    if cases:
        verifier_hauteur_sommaire(entrees)
    if hierarchique:
        entrees = [e for e in entrees if e[0] <= 1]
    auteurs = auteurs or {}
    onglet_hauteur = next((e[4] for e in entrees if e[4]), None)
    style_section = (' style="--onglet-hauteur: %s"' % html.escape(onglet_hauteur, quote=True)
                      if onglet_hauteur else '')
    lignes = ['<section class="szh-sommaire" id="szh-sommaire"%s>' % style_section,
              '<h1>' + html.escape(titre) + '</h1>', '<ol>']
    for entree in entrees:
        niveau, ancre, txt, couleur = entree[:4]
        extra = entree[5] if len(entree) > 5 else {}
        style = (' style="--c-chapitre: %s"' % html.escape(couleur, quote=True)
                 if couleur else '')
        # Un <span> entre le <li> et le <a> : le <li> FALC est un flex, et un <a> enfant
        # direct d'un flex n'a pas d'annotation /Link dans le PDF (WeasyPrint 70).
        ligne_auteurs = auteurs.get(ancre) if hierarchique else None
        suite = ('<span class="szh-sommaire-auteurs">%s</span>' % html.escape(ligne_auteurs)
                 if ligne_auteurs else '')
        classes = ''.join(' ' + c for c in extra.get('classes', ()))
        numero = ('<span class="szh-sommaire-num">%s</span>' % html.escape(extra['numero'])
                  if extra.get('numero') else '')
        lignes.append('<li class="niveau-%d%s"%s><span>%s<a href="#%s">%s</a></span>%s</li>'
                      % (niveau, classes, style, numero, html.escape(ancre, quote=True),
                         html.escape(txt), suite))
    lignes += ['</ol>', '</section>']
    return '\n'.join(lignes)


# --------------------------------------------------------------------------------------
# Liminaires composés par la machine.
# --------------------------------------------------------------------------------------

# Même table que CONJONCTION dans szh-livre-auteurs.lua : la conjonction avant le dernier nom.
CONJONCTION_AUTEURS = {'fr': ' et ', 'de': ' und ', 'it': ' e ', 'en': ' and '}


def _auteurs_ligne(meta, lang='fr'):
    """« Prénom Nom, Prénom Nom et Prénom Nom ». Rien de plus : le bloc auteurs détaillé
    (fonction, affiliation, ORCID) est l'affaire des chapitres."""
    noms = []
    for a in (meta.get('auteurs') or []):
        if isinstance(a, dict):
            n = ' '.join(x for x in (a.get('prenom'), a.get('nom')) if x)
            if n:
                noms.append(n)
        elif a:
            noms.append(str(a))
    if not noms:
        return ''
    if len(noms) == 1:
        return noms[0]
    conjonction = CONJONCTION_AUTEURS.get(lang, CONJONCTION_AUTEURS['fr'])
    return ', '.join(noms[:-1]) + conjonction + noms[-1]


def _editeurs_ligne(meta, lang='fr'):
    """Même format que _auteurs_ligne : « Prénom Nom, Prénom Nom et Prénom Nom »."""
    noms = []
    for a in (meta.get('editeurs') or []):
        if isinstance(a, dict):
            n = ' '.join(x for x in (a.get('prenom'), a.get('nom')) if x)
            if n:
                noms.append(n)
        elif a:
            noms.append(str(a))
    if not noms:
        return ''
    if len(noms) == 1:
        return noms[0]
    conjonction = CONJONCTION_AUTEURS.get(lang, CONJONCTION_AUTEURS['fr'])
    return ', '.join(noms[:-1]) + conjonction + noms[-1]


def metadonnees_html(meta, lang='fr'):
    """Génère les balises <meta> du <head> pour le gabarit HTML du livre."""
    lignes = []
    # Auteurs et éditeurs pour meta name="author"
    auteurs = _auteurs_ligne(meta, lang)
    editeurs = _editeurs_ligne(meta, lang)
    auteurs_et_editeurs = auteurs
    if editeurs:
        auteurs_et_editeurs = auteurs + (', ' + editeurs if auteurs else editeurs)
    if auteurs_et_editeurs:
        lignes.append('  <meta name="author" content="%s" />' % html.escape(auteurs_et_editeurs, quote=True))
    # Résumé pour meta name="description"
    if meta.get('resume'):
        lignes.append('  <meta name="description" content="%s" />' % html.escape(str(meta['resume']), quote=True))
    # Mots-clés
    if meta.get('mots-cles'):
        lignes.append('  <meta name="keywords" content="%s" />' % html.escape(str(meta['mots-cles']), quote=True))
    # Année pour dcterms.created
    if meta.get('annee'):
        lignes.append('  <meta name="dcterms.created" content="%s" />' % html.escape(str(meta['annee']), quote=True))
    return '\n'.join(lignes) + ('\n' if lignes else '')


def _titre_en_lignes(titre):
    """Titre composé en bloc : chaque « // » devient un <br>, le reste est échappé."""
    return '<br>'.join(html.escape(l) for l in szh_commun.titre_lignes(titre))


def _responsables_page_titre(meta, lang, normal):
    """La ligne du haut du demi-titre et de la page de titre. Maquette normal : celle de la
    couverture (couverture.responsables : les auteur·e·s, à défaut les éditeur·rice·s suivi·e·s
    de « (Hrsg.) », « (éd.) », « (a cura di) » ou de `mention-editeurs`), une seule règle pour
    les deux. Le FALC garde ses seuls auteur·e·s."""
    if not normal:
        return _auteurs_ligne(meta, lang)
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        'szh_couverture', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'couverture.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.responsables(meta, lang)


def demi_titre(meta, lang='fr', normal=False):
    """En maquette normal, le titre y court d'un trait : ses « // » sont ceux de la page de
    titre, où il est composé en grand. Le sous-titre garde les siens sur les deux pages."""
    titre = (html.escape(szh_commun.titre_plat(meta.get('titre'))) if normal
             else _titre_en_lignes(meta.get('titre')))
    return ('<section class="szh-liminaire szh-demi-titre">'
            '<p class="szh-auteurs">%s</p>'
            '<p class="szh-titre">%s</p>'
            '<p class="szh-sous-titre">%s</p></section>'
            % (html.escape(_responsables_page_titre(meta, lang, normal)), titre,
               _titre_en_lignes(meta.get('sous-titre'))))


# Le logo de l'éditeur, en bas à droite de la page de titre (`logo-page-titre`). Son alt
# est vide, à dessein : le nom de l'éditeur est déjà écrit en toutes lettres à l'impressum.
LOGO_PAGE_TITRE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'media', 'logos',
                               'edition-szh-csps.svg')


def page_titre(meta, lang='fr', normal=False, logo=False):
    suite = ''
    if logo:
        suite = '<p class="szh-logo-editeur">%s</p>' % _img(LOGO_PAGE_TITRE, '', 'szh-logo-editeur-image')
    return ('<section class="szh-liminaire szh-page-titre">'
            '<p class="szh-auteurs">%s</p>'
            '<p class="szh-titre">%s</p>'
            '<p class="szh-sous-titre">%s</p>%s</section>'
            % (html.escape(_responsables_page_titre(meta, lang, normal)),
               _titre_en_lignes(meta.get('titre')),
               _titre_en_lignes(meta.get('sous-titre')), suite))


def dedicace(meta):
    """La dédicace de buch.yaml, « // » pour un saut de ligne. Un liminaire comme le
    demi-titre : avant le sommaire, sans folio ; après lui, avec."""
    return ('<section class="szh-liminaire szh-dedicace"><p>%s</p></section>'
            % _titre_en_lignes(meta.get('dedicace')))


# --------------------------------------------------------------------------------------
# Images posées par l'assembleur (logos de l'impressum, illustration de partie, logo de la
# page de titre) : incorporées en data: URI, comme celles des chapitres, pour que le HTML
# web reste un seul fichier.
# --------------------------------------------------------------------------------------
TYPES_IMAGE = {'.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
               '.jpeg': 'image/jpeg'}


def uri_image(chemin):
    import base64
    with open(chemin, 'rb') as f:
        donnees = base64.b64encode(f.read()).decode('ascii')
    type_ = TYPES_IMAGE.get(os.path.splitext(chemin)[1].lower(), 'application/octet-stream')
    return 'data:%s;base64,%s' % (type_, donnees)


def dimensions_image(chemin):
    """(largeur, hauteur) naturelles d'une image png, jpeg ou svg ; None si illisible."""
    import struct
    try:
        with open(chemin, 'rb') as f:
            d = f.read()
    except OSError:
        return None
    if d[:8] == b'\x89PNG\r\n\x1a\n' and len(d) >= 24:
        return struct.unpack('>II', d[16:24])
    if d[:2] == b'\xff\xd8':
        i = 2
        while i + 9 < len(d):
            if d[i] != 0xFF:
                return None
            marque, longueur = d[i + 1], struct.unpack('>H', d[i + 2:i + 4])[0]
            if 0xC0 <= marque <= 0xCF and marque not in (0xC4, 0xC8, 0xCC):
                h, l = struct.unpack('>HH', d[i + 5:i + 9])
                return l, h
            i += 2 + longueur
        return None
    m = re.search(rb'viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)', d[:4000])
    if m:
        return float(m.group(1)), float(m.group(2))
    # Sans viewBox, la largeur et la hauteur de la racine <svg>, en px ou sans unité.
    racine = re.search(rb'<svg\b[^>]*>', d[:4000])
    if racine:
        l = re.search(rb'\swidth="([\d.]+)(?:px)?"', racine.group(0))
        h = re.search(rb'\sheight="([\d.]+)(?:px)?"', racine.group(0))
        if l and h and float(l.group(1)) and float(h.group(1)):
            return float(l.group(1)), float(h.group(1))
    return None


def _img(chemin, alt, classe):
    """Une image posée par l'assembleur. Avec un texte alternatif, un <img>. Décorative
    (alt vide), un fond CSS dans deux <span>, comme les décors de szh-numerotation.lua :
    WeasyPrint balise tout <img> en /Figure, et une /Figure sans /Alt n'est pas conforme
    PDF/UA. --ratio (hauteur sur largeur) donne la géométrie à la feuille de style."""
    if str(alt or '').strip():
        return '<img class="%s" src="%s" alt="%s" />' % (
            classe, uri_image(chemin), html.escape(str(alt), quote=True))
    taille = dimensions_image(chemin) or (1, 1)
    return ('<span class="szh-decor-livre %s" role="presentation" style="--ratio: %.4f">'
            '<span style="background-image: url(&quot;%s&quot;)"></span></span>'
            % (classe, float(taille[1]) / float(taille[0]), uri_image(chemin)))


def _liste(v):
    """Une valeur de buch.yaml qui peut être un nom seul ou une liste de noms."""
    if v in (None, ''):
        return []
    return [str(x) for x in v] if isinstance(v, list) else [str(v)]


def _erreur(code, champ, fr, de):
    return szh_commun.formater_avertissement('[livre-blocage]', code, [champ], fr, de)


def _fichier_livre(racine, nom, champ, erreurs):
    """Le chemin d'un fichier nommé dans buch.yaml (relatif au dossier du livre), ou None
    après un refus s'il n'existe pas ou n'est pas une image connue."""
    chemin = os.path.join(racine, nom)
    if not os.path.isfile(chemin):
        erreurs.append(_erreur('fichier-introuvable', champ,
            'Le fichier « %s » nommé dans buch.yaml est introuvable dans le dossier du livre.' % nom,
            'Die in buch.yaml genannte Datei « %s » fehlt im Buchordner.' % nom))
        return None
    if os.path.splitext(nom)[1].lower() not in TYPES_IMAGE:
        erreurs.append(_erreur('image-format', champ,
            '« %s » n\'est pas une image reconnue (svg, png, jpg).' % nom,
            '« %s » ist kein erkanntes Bild (svg, png, jpg).' % nom))
        return None
    return chemin


PHRASE_RESPONSABILITE = {
    'de': 'Die Verantwortung für den Inhalt der Texte liegt bei den jeweiligen Autor:innen.',
    'fr': 'La responsabilité du contenu des textes incombe à leurs autrices et auteurs.',
    'it': 'La responsabilità del contenuto dei testi spetta alle rispettive autrici e ai '
          'rispettivi autori.',
}


# Les quatre raisons sociales de la fondation, dans l'ordre des livres publiés. Elles ne
# sont pas une métadonnée du livre : elles ne changent pas d'un ouvrage à l'autre.
FONDATION = [
    'Stiftung Schweizer Zentrum für Heil- und Sonderpädagogik (SZH) Bern',
    'Fondation Centre suisse de pédagogie spécialisée (CSPS) Berne',
    'Fondazione Centro svizzero di pedagogia specializzata (CSPS) Berna',
    'Fundaziun Center svizzer da pedagogia speciala (CSPS) Berna',
]

LICENCES = {
    'cc-by-nc-nd-4.0': 'Creative Commons CC BY-NC-ND 4.0 International',
    'cc-by-4.0':       'Creative Commons CC BY 4.0 International',
    'cc-by-sa-4.0':    'Creative Commons CC BY-SA 4.0 International',
    'cc-by-nc-4.0':    'Creative Commons CC BY-NC 4.0 International',
}

# L'acte (Commons deed) de chaque licence, sans « https:// » ni barre finale : la phrase de
# licence l'imprime ainsi, le badge y mène. Les mêmes adresses que la licence d'article de
# szh-maquette.lua (test/js/livre-structure.test.js).
ACTES_LICENCE = {
    'cc-by-nc-nd-4.0': 'creativecommons.org/licenses/by-nc-nd/4.0',
    'cc-by-4.0':       'creativecommons.org/licenses/by/4.0',
    'cc-by-sa-4.0':    'creativecommons.org/licenses/by-sa/4.0',
    'cc-by-nc-4.0':    'creativecommons.org/licenses/by-nc/4.0',
}

# Le bouton de chaque licence, sous la phrase de licence en maquette normal : un fichier
# officiel de Creative Commons, versé sans retouche (media/logos/README.md).
LOGOS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'media', 'logos')


def badge_licence(cle):
    return os.path.join(LOGOS_DIR, cle + '.svg')


PHRASE_LICENCE = {
    'de': 'Dieses Werk ist lizenziert unter einer %s (%s).',
    'fr': 'Cette œuvre est diffusée sous licence %s (%s).',
    'it': "Quest'opera è distribuita con licenza %s (%s).",
}

# Le nom accessible du badge, un lien vide.
LIEN_ACTE_LICENCE = {
    'de': 'Zusammenfassung der Lizenz %s',
    'fr': 'Résumé de la licence %s',
    'it': 'Riassunto della licenza %s',
}

ETIQUETTES_ISBN = (('isbn-print', 'ISBN Print on demand'), ('isbn-ebook', 'ISBN E-Book'))

TITRES_SOMMAIRE = {'de': 'Inhaltsverzeichnis', 'fr': 'Sommaire', 'it': 'Indice'}


# Les sous-clés du bloc `impressum:` de buch.yaml, toutes facultatives. Une image a son
# texte alternatif dans `<clé>-alt` ; sans lui, elle est décorative (alt="") : un logo
# répète le plus souvent un nom déjà écrit à côté (docs/ACCESSIBILITE.md).
CLES_IMPRESSUM = ('logo-soutien', 'logo-soutien-alt', 'logo-soutien-hauteur-mm', 'soutien',
                  'credits', 'responsabilite', 'reserve', 'imprimeur', 'logos-imprimeur',
                  'logos-imprimeur-alt')
IMAGES_IMPRESSUM = ('logo-soutien', 'logos-imprimeur')
# Hauteur du logo de soutien en mm : sans la clé, celle de normal.css (15,6 mm).
HAUTEUR_LOGO_SOUTIEN = (4, 30)


def _bloc_impressum(meta):
    bloc = meta.get('impressum')
    return bloc if isinstance(bloc, dict) else {}


def verifier_impressum(meta, racine):
    """Rend les refus du bloc impressum : clé inconnue, image absente, licence connue dont le
    badge n'est pas livré. Une licence inconnue de LICENCES n'est pas refusée ici."""
    erreurs = []
    cle_licence = str(meta.get('licence') or '')
    if cle_licence in LICENCES and not os.path.isfile(badge_licence(cle_licence)):
        erreurs.append(_erreur('licence-badge-absent', 'licence',
            'La licence « %s » n\'a pas de badge livré : le fichier %s.svg manque dans '
            'pipeline/media/logos.' % (cle_licence, cle_licence),
            'Für die Lizenz « %s » fehlt das Badge: Die Datei %s.svg fehlt in '
            'pipeline/media/logos.' % (cle_licence, cle_licence)))
    bloc = _bloc_impressum(meta)
    for cle in bloc:
        if cle not in CLES_IMPRESSUM:
            erreurs.append(_erreur('impressum-cle-inconnue', 'impressum.' + cle,
                'Clé inconnue dans impressum : « %s ». Clés permises : %s.'
                % (cle, ', '.join(CLES_IMPRESSUM)),
                'Unbekannter Schlüssel in impressum: « %s ». Erlaubt: %s.'
                % (cle, ', '.join(CLES_IMPRESSUM))))
    for cle in IMAGES_IMPRESSUM:
        for nom in _liste(bloc.get(cle)):
            _fichier_livre(racine, nom, 'impressum.' + cle, erreurs)
    if bloc.get('logo-soutien-hauteur-mm') not in (None, '') and _hauteur_logo(bloc) is None:
        bas, haut = HAUTEUR_LOGO_SOUTIEN
        valeur = str(bloc['logo-soutien-hauteur-mm']).strip()
        erreurs.append(_erreur('impressum-valeur-mm', 'impressum.logo-soutien-hauteur-mm',
            '« %s » n\'est pas une valeur permise pour logo-soutien-hauteur-mm : un nombre de mm '
            'entre %s et %s.' % (valeur, bas, haut),
            '« %s » ist für logo-soutien-hauteur-mm nicht erlaubt: eine Zahl in mm zwischen '
            '%s und %s.' % (valeur, bas, haut)))
    return erreurs


def _hauteur_logo(bloc):
    """La hauteur du logo de soutien en mm (nombre), ou None si absente ou refusée."""
    valeur = str(bloc.get('logo-soutien-hauteur-mm') or '').strip().strip('"\'')
    if not RE_NOMBRE_MM.match(valeur):
        return None
    nombre = float(valeur.replace(',', '.'))
    bas, haut = HAUTEUR_LOGO_SOUTIEN
    return (int(nombre) if nombre == int(nombre) else nombre) if bas <= nombre <= haut else None


def _lien_badge(cle, nom, lang):
    """Le badge de la licence, lien vers son acte : un <a> vide à aria-label, le bouton en
    fond CSS. Un élément dans le <a> donnerait une annotation par boîte (partage-filtres.css,
    a.szh-orcid) ; --ratio donne sa géométrie à normal.css."""
    chemin = badge_licence(cle)
    largeur, hauteur = dimensions_image(chemin) or (1, 1)
    label = LIEN_ACTE_LICENCE.get(lang, LIEN_ACTE_LICENCE['fr']) % nom
    return ('<a class="szh-impressum-badge" href="https://%s/" aria-label="%s" style="--ratio: %.4f; '
            'background-image: url(&quot;%s&quot;)"></a>'
            % (ACTES_LICENCE[cle], html.escape(label, quote=True), float(hauteur) / float(largeur),
               uri_image(chemin)))


def _oui(v):
    return v is True or str(v).strip().lower() in ('oui', 'true', 'ja', 'si', 'sì')


def impressum(meta, racine='.', normal=False):
    """L'ordre est celui des livres publiés : année et éditeur, la fondation, le logo et la
    phrase de soutien, les crédits, les ISBN, le DOI, la responsabilité des auteur·e·s, la
    licence, la réserve, l'imprimeur et la rangée de ses logos. Chaque ligne absente de
    buch.yaml disparaît : on n'imprime pas un ISBN qu'on n'a pas. Les images ont été
    vérifiées par verifier_impressum(). En maquette normal, l'année et l'éditeur forment un
    seul bloc, comme dans les livres de l'Edition SZH ; le FALC garde ses deux blocs."""
    bloc = _bloc_impressum(meta)
    lang = str(meta.get('lang') or 'fr')

    def texte(cle):
        v = bloc.get(cle)
        if v in (None, '', False):
            return None
        return '<br>'.join(html.escape(l) for l in szh_commun.titre_lignes(str(v)))

    def images(cle):
        alts = _liste(bloc.get(cle + '-alt'))
        return ' '.join(_img(os.path.join(racine, nom), alts[i] if i < len(alts) else '',
                             'szh-impressum-image')
                        for i, nom in enumerate(_liste(bloc.get(cle))))

    blocs = []
    if meta.get('annee'):
        blocs.append(('', '© ' + html.escape(str(meta['annee']))))
    if normal and blocs:
        blocs[0] = ('', blocs[0][1] + '<br>Edition SZH/CSPS')
    else:
        blocs.append(('', 'Edition SZH/CSPS'))
    blocs.append(('', '<br>'.join(html.escape(x) for x in FONDATION)))
    if _liste(bloc.get('logo-soutien')):
        blocs.append(('szh-impressum-logo', images('logo-soutien')))
    for cle in ('soutien', 'credits'):
        if texte(cle):
            blocs.append(('', texte(cle)))
    # Les ISBN et le DOI : un seul bloc en maquette normal (Hofer p2), un bloc chacun en FALC.
    identifiants = ['%s: %s' % (etiquette, html.escape(str(meta[cle])))
                    for cle, etiquette in ETIQUETTES_ISBN if meta.get(cle)]
    if meta.get('doi'):
        identifiants.append('https://doi.org/' + html.escape(str(meta['doi'])))
    if normal and identifiants:
        blocs.append(('', '<br>'.join(identifiants)))
    else:
        blocs.extend(('', x) for x in identifiants)
    if _oui(bloc.get('responsabilite')):
        blocs.append(('', html.escape(PHRASE_RESPONSABILITE.get(lang, PHRASE_RESPONSABILITE['fr']))))
    cle_licence = str(meta.get('licence') or '')
    lic = LICENCES.get(cle_licence)
    if lic:
        phrase = PHRASE_LICENCE.get(lang, PHRASE_LICENCE['fr'])
        blocs.append(('', phrase % (html.escape(lic), ACTES_LICENCE[cle_licence])))
        if normal:
            blocs.append(('szh-impressum-licence', _lien_badge(cle_licence, lic, lang)))
    for cle in ('reserve', 'imprimeur'):
        if texte(cle):
            blocs.append(('', texte(cle)))
    if _liste(bloc.get('logos-imprimeur')):
        blocs.append(('szh-impressum-logos-imprimeur', images('logos-imprimeur')))
    corps = '\n'.join(('<p class="%s">' % c if c else '<p>') + x + '</p>' for c, x in blocs)
    hauteur = _hauteur_logo(bloc)
    style = ' style="--impressum-logo-soutien: %smm"' % hauteur if hauteur is not None else ''
    return '<section class="szh-liminaire szh-impressum"%s>' % style + corps + '</section>'


# --------------------------------------------------------------------------------------
# Parties du livre : `parties:` de buch.yaml, une liste ordonnée.
#
#   - titre: "Grundlagen"        « // » = saut de ligne
#     numero: "1"                texte libre ("1", "III") ou absent
#     chapitres: [01-a, 02-b]    une suite contiguë de l'ordre des chapitres
#     page-seule: oui            oui : page de partie sur un recto ; non : le titre ouvre
#                                la page du premier chapitre
#     numeroter: oui             avec numeros-chapitres: partie, « 1.1 », « 1.2 »…
#     illustration: parties/x.jpg   page-seule seulement ; illustration-alt facultatif
#
# La partie est une <section class="szh-partie"> sœur des chapitres, son titre un <h1> ;
# ses chapitres portent data-partie, qui leur donne le niveau 2 des signets (base.css).
# --------------------------------------------------------------------------------------
CLES_PARTIE = ('titre', 'numero', 'chapitres', 'page-seule', 'numeroter', 'illustration',
               'illustration-alt')
RE_SLUG_FRAGMENT = re.compile(r'<section\b[^>]*\bclass="szh-chapitre"[^>]*\bid="ch-([^"]+)"')


def slug_du_fragment(fragment):
    m = RE_SLUG_FRAGMENT.search(fragment)
    return m.group(1) if m else None


def _oui_non(v, defaut):
    if v in (None, ''):
        return defaut
    s = str(v).strip().lower()
    if v is True or s in ('oui', 'true'):
        return True
    if v is False or s in ('non', 'false'):
        return False
    return None


def lire_parties(meta, slugs):
    """Rend (parties, erreurs). `slugs` : l'ordre des chapitres du livre. Chaque partie :
    dict titre, numero, chapitres, page_seule, numeroter, illustration, illustration_alt,
    rang (1, 2…)."""
    brut = meta.get('parties')
    if brut in (None, '', []):
        return [], []
    erreurs = []
    if not isinstance(brut, list) or not all(isinstance(p, dict) for p in brut):
        return [], [_erreur('parties-illisible', 'parties',
            'Le bloc parties de buch.yaml doit être une liste de parties, chacune ouverte par '
            '« - titre: ».',
            'Der Block parties in buch.yaml muss eine Liste von Teilen sein, jeder mit '
            '« - titre: » eröffnet.')]
    rang_de = {s: i for i, s in enumerate(slugs)}
    deja = {}
    parties = []
    for rang, p in enumerate(brut, 1):
        champ = 'parties[%d]' % rang
        for cle in p:
            if cle not in CLES_PARTIE:
                erreurs.append(_erreur('partie-cle-inconnue', champ + '.' + cle,
                    'Clé inconnue dans une partie : « %s ». Clés permises : %s.'
                    % (cle, ', '.join(CLES_PARTIE)),
                    'Unbekannter Schlüssel in einem Teil: « %s ». Erlaubt: %s.'
                    % (cle, ', '.join(CLES_PARTIE))))
        titre = str(p.get('titre') or '').strip()
        if not titre:
            erreurs.append(_erreur('partie-sans-titre', champ + '.titre',
                'La partie %d n\'a pas de titre.' % rang,
                'Teil %d hat keinen Titel.' % rang))
        chapitres = _liste(p.get('chapitres'))
        if not chapitres:
            erreurs.append(_erreur('partie-sans-chapitre', champ + '.chapitres',
                'La partie %d ne nomme aucun chapitre (chapitres: [slug, …]).' % rang,
                'Teil %d nennt kein Kapitel (chapitres: [slug, …]).' % rang))
        inconnus = [s for s in chapitres if s not in rang_de]
        for s in inconnus:
            erreurs.append(_erreur('partie-chapitre-inconnu', champ + '.chapitres',
                'Le chapitre « %s » de la partie %d n\'existe pas dans chapitres/.' % (s, rang),
                'Das Kapitel « %s » von Teil %d existiert nicht in chapitres/.' % (s, rang)))
        for s in chapitres:
            if s in deja:
                erreurs.append(_erreur('partie-chapitre-double', champ + '.chapitres',
                    'Le chapitre « %s » est déjà dans la partie %d.' % (s, deja[s]),
                    'Das Kapitel « %s » steht schon in Teil %d.' % (s, deja[s])))
            deja.setdefault(s, rang)
        rangs = [rang_de[s] for s in chapitres if s in rang_de]
        if not inconnus and rangs and rangs != list(range(rangs[0], rangs[0] + len(rangs))):
            erreurs.append(_erreur('partie-non-contigue', champ + '.chapitres',
                'Les chapitres de la partie %d doivent se suivre, dans l\'ordre des chapitres '
                'du livre (ordre-chapitres) : %s.' % (rang, ', '.join(slugs)),
                'Die Kapitel von Teil %d müssen aufeinander folgen, in der Reihenfolge der '
                'Kapitel des Buches (ordre-chapitres): %s.' % (rang, ', '.join(slugs))))
        page_seule = _oui_non(p.get('page-seule'), True)
        numeroter = _oui_non(p.get('numeroter'), False)
        for cle, v in (('page-seule', page_seule), ('numeroter', numeroter)):
            if v is None:
                erreurs.append(_erreur('partie-valeur', champ + '.' + cle,
                    '« %s » n\'est pas une valeur permise pour %s : oui ou non.'
                    % (p.get(cle), cle),
                    '« %s » ist für %s nicht erlaubt: oui oder non.' % (p.get(cle), cle)))
        illustration = str(p.get('illustration') or '').strip()
        if illustration and page_seule is False:
            erreurs.append(_erreur('partie-illustration-page', champ + '.illustration',
                'Une illustration de partie ne va que sur une page de partie seule '
                '(page-seule: oui).',
                'Eine Illustration ist nur auf einer eigenen Teilseite möglich '
                '(page-seule: oui).'))
        parties.append({'rang': rang, 'titre': titre,
                        'numero': str(p.get('numero') or '').strip(),
                        'chapitres': chapitres, 'page_seule': page_seule is not False,
                        'numeroter': numeroter is True, 'illustration': illustration,
                        'illustration_alt': str(p.get('illustration-alt') or '')})
    return parties, erreurs


def _a_un_titre(racine, slug):
    """Vrai si le chapitre a un titre : `title` dans sa fiche, ou un « # » dans son .md
    (szh-livre-titre.lua suit la même règle)."""
    dossier = os.path.join(racine, 'chapitres', slug)
    fiche = szh_commun.lire_yaml(os.path.join(dossier, slug + '.meta.yaml'))
    titre = fiche.get('title')
    if isinstance(titre, dict):
        titre = ''.join(str(v or '') for v in titre.values())
    if str(titre or '').strip():
        return True
    try:
        with open(os.path.join(dossier, slug + '.md'), encoding='utf-8-sig') as f:
            return any(re.match(r'#\s+\S', l) for l in f)
    except OSError:
        return False


def numeros_chapitres(reglages, parties, racine):
    """Le numéro de chaque chapitre d'une partie `numeroter: oui`, sous
    numeros-chapitres: partie : « <numéro de partie>.<rang parmi ses chapitres titrés> ».
    Un chapitre sans titre n'est ni numéroté ni compté. Calculé ici seulement : livre.mk le
    passe au chapitre (SZH_NUMERO_CHAPITRE), szh-sections.lua l'écrit."""
    if not reglages or reglages['numeros-chapitres'] != 'partie':
        return {}
    numeros = {}
    for p in parties:
        if not p['numeroter'] or not p['numero']:
            continue
        k = 0
        for slug in p['chapitres']:
            if _a_un_titre(racine, slug):
                k += 1
                numeros[slug] = '%s.%d' % (p['numero'], k)
    return numeros


def partie_html(partie, reglages, racine):
    """La section d'une partie. Le numéro s'imprime avec `titre-partie: titre` ; un
    intercalaire n'en montre pas. Le signet porte le titre à plat."""
    avec_numero = bool(partie['numero']) and reglages['titre-partie'] == 'titre'
    numero = ('<span class="szh-num-partie">%s </span>' % html.escape(partie['numero'])
              if avec_numero else '')
    plat = szh_commun.titre_plat(partie['titre'])
    if avec_numero:
        plat = partie['numero'] + ' ' + plat
    illustration = ''
    if partie['illustration']:
        illustration = ('<p class="szh-partie-illustration">%s</p>\n'
                        % _img(os.path.join(racine, partie['illustration']),
                               partie['illustration_alt'], 'szh-partie-image'))
    return ('<section class="szh-partie" id="partie-%d" data-page-seule="%s">\n'
            '<h1 id="partie-%d-titre" data-signet="%s">%s%s</h1>\n%s</section>'
            % (partie['rang'], 'oui' if partie['page_seule'] else 'non', partie['rang'],
               html.escape(plat, quote=True), numero, _titre_en_lignes(partie['titre']),
               illustration))


def fichiers_images(meta, racine):
    """Les images que l'assemblage incorpore : celles que buch.yaml nomme (impressum,
    illustrations de partie) et celles du toolkit (badge de licence, logo de la page de
    titre). Les mêmes lectures que l'assemblage ; un nom absent n'est pas refusé ici, il
    l'est à l'assemblage. Un fichier du livre est rendu relatif à son dossier."""
    reglages, _ = lire_mise_en_page(meta)
    bloc = _bloc_impressum(meta)
    chemins = [os.path.join(racine, nom) for cle in IMAGES_IMPRESSUM for nom in _liste(bloc.get(cle))]
    if reglages is not None:
        parties, _ = lire_parties(meta, [])
        chemins += [os.path.join(racine, p['illustration']) for p in parties if p['illustration']]
        if str(meta.get('licence') or '') in LICENCES:
            chemins.append(badge_licence(str(meta['licence'])))
        if reglages['logo-page-titre'] == 'oui':
            chemins.append(LOGO_PAGE_TITRE)
    rendus = []
    for c in chemins:
        relatif = os.path.relpath(c, racine)
        rendus.append(c if relatif.startswith('..') else relatif)
    return rendus


def dans_partie(fragment, rang):
    """Marque la section du chapitre comme membre de la partie `rang`."""
    return fragment.replace('<section class="szh-chapitre"',
                            '<section class="szh-chapitre" data-partie="%d"' % rang, 1)


# --------------------------------------------------------------------------------------
# Incorporation d'une feuille de style (--css-embed) : voir main() pour le pourquoi.
# --------------------------------------------------------------------------------------

RE_URL_CSS = re.compile(r'url\(\s*([\'"]?)([^\'")]+)\1\s*\)')


def _url_absolues(css_texte, css_chemin):
    """Réécrit les `url(...)` relatives d'une feuille (@font-face, url() d'image) en
    chemins absolus file://, résolus depuis le DOSSIER DE LA FEUILLE — pas depuis le
    document final. Indispensable ici et nulle part ailleurs : une feuille LIÉE (--css)
    garde ses url() relatives à SA PROPRE position, le navigateur les résout depuis elle ;
    une feuille INCORPORÉE dans un <style> voit ses url() résolues depuis le document qui
    la contient — socle.css écrit `url("../fonts/…")`, juste depuis styles/, faux depuis
    out/ une fois collé dans le HTML web. Une url() déjà absolue (http, https, data, file)
    traverse sans changement.

    ⚠ Le toolkit compile tantôt sous Windows, tantôt dans l'image WSL (voir Makefile,
    `wsl.exe -d SZH-Publishing`) : la MÊME feuille, sur le MÊME disque, y a deux visages
    (`C:\…` et `/mnt/c/…`). Le HTML web, lui, est ouvert depuis Windows (ce sont ses
    polices que file:// doit retrouver) : un chemin `/mnt/<lettre>/…` — celui que rendrait
    `os.path.abspath` lancé depuis WSL — est donc reconverti en `<LETTRE>:/…` avant de
    devenir une URI, sans quoi la police resterait introuvable une fois le HTML ouvert par
    un navigateur Windows natif (repli silencieux sur la police système : rien de cassé à
    l'écran, mais plus la police de la maison)."""
    dossier = os.path.dirname(os.path.abspath(css_chemin))
    m_wsl = re.match(r'^/mnt/([a-zA-Z])(/.*)$', dossier)
    if m_wsl:
        dossier = '%s:%s' % (m_wsl.group(1).upper(), m_wsl.group(2))

    def remplace(m):
        brut = m.group(2)
        if re.match(r'^(https?|data|file):', brut):
            return m.group(0)
        chemin_absolu = os.path.normpath(os.path.join(dossier, brut))
        uri = 'file:///' + chemin_absolu.replace('\\', '/').lstrip('/')
        return 'url("%s")' % uri

    return RE_URL_CSS.sub(remplace, css_texte)


# --------------------------------------------------------------------------------------
# Substitution des jetons du gabarit, jamais à l'intérieur d'un commentaire HTML de celui-ci.
#
# Un remplacement fait au ras du texte (`str.replace` sur le gabarit entier) matcherait
# aussi bien un jeton cité dans un commentaire de documentation du gabarit que celui que
# pandoc insère lui-même entre deux listes adjacentes de même type d'un fragment (pour
# qu'un outil qui relit le HTML ne les recolle pas en une seule) ; refermer ce commentaire
# par erreur fait alors passer tout ce qui suit pour du HTML réel avant la balise <html>,
# ce qui a déjà fait sortir un livre publié sans H1 dans son arbre de structure (PDF/UA-1
# non conforme), sans qu'un seul niveau de titre n'ait bougé dans le texte source.
#
# Le remède ne touche pas au commentaire — le nommer est légitime, c'est de la
# documentation — il rend le remplacement aveugle à ce qu'il y a dans un commentaire.
_RE_COMMENTAIRE = re.compile(r'(<!--.*?-->)', re.S)


def _remplacer_jetons(gabarit, remplacements):
    """Substitue les jetons du dict partout sauf dans un commentaire HTML du gabarit.

    `re.split` avec un groupe capturant rend une liste où les commentaires eux-mêmes
    alternent avec le texte qui les sépare : indices pairs = hors commentaire (à
    substituer), indices impairs = le commentaire tel quel (à laisser intact, jetons
    littéraux compris)."""
    morceaux = _RE_COMMENTAIRE.split(gabarit)
    for i in range(0, len(morceaux), 2):
        for cle, val in remplacements.items():
            morceaux[i] = morceaux[i].replace(cle, val)
    return ''.join(morceaux)


# --------------------------------------------------------------------------------------
# Métadonnées pandoc pour l'EPUB.
#
# Pourquoi ici et pas dans le Makefile : les tirer de buch.yaml à coups de `sed` demande une
# expression par clé, et une de plus pour la liste des auteur·e·s — qui est un bloc à tirets,
# donc hors de portée d'un sed d'une ligne. La première version l'a payé : elle sortait un
# EPUB sans ISBN, et avec un `dc:creator` codé en dur au nom de la personne qui l'avait
# écrite. Ce module lit déjà buch.yaml correctement ; il écrit donc le fichier que pandoc
# attend, et le Makefile ne fait que le lui passer.
#
# ⚠ Aucune clé n'est inventée. Un ISBN absent ne produit pas d'identifiant : pandoc en
#   fabriquera un urn:uuid, ce qui est la bonne réponse pour un fichier qui n'en a pas
#   encore — un identifiant faux serait pire qu'un identifiant provisoire.

def metadonnees_epub(meta):
    """Rend le texte d'un fichier de métadonnées YAML pour pandoc (--metadata-file)."""
    def guillemets(v):
        return '"' + str(v).replace('\\', '\\\\').replace('"', '\\"') + '"'

    lignes = []
    if meta.get('titre'):
        lignes.append('title: ' + guillemets(szh_commun.titre_plat(meta['titre'])))
    if meta.get('sous-titre'):
        lignes.append('subtitle: ' + guillemets(szh_commun.titre_plat(meta['sous-titre'])))
    lignes.append('lang: ' + guillemets(str(meta.get('lang') or 'fr')))

    # Les auteur·e·s et éditeur·rice·s de l'ouvrage au format pandoc EPUB : creator avec
    # role (aut pour auteurs, edt pour éditeurs) et text (le nom). En ouvrage collectif la
    # liste des auteurs peut être vide, ce qui est voulu : les auteur·e·s sont ceux des
    # chapitres, et les hisser en dc:creator du volume attribuerait le livre à la première
    # personne de la liste.
    creators = []
    for a in (meta.get('auteurs') or []):
        if isinstance(a, dict):
            n = ' '.join(x for x in (a.get('prenom'), a.get('nom')) if x)
            if n:
                creators.append(('aut', n))
        elif a:
            creators.append(('aut', str(a)))
    for a in (meta.get('editeurs') or []):
        if isinstance(a, dict):
            n = ' '.join(x for x in (a.get('prenom'), a.get('nom')) if x)
            if n:
                creators.append(('edt', n))
        elif a:
            creators.append(('edt', str(a)))
    if creators:
        lignes.append('creator:')
        for role, nom in creators:
            lignes.append('- role: ' + role)
            lignes.append('  text: ' + guillemets(nom))

    if meta.get('resume'):
        lignes.append('description: ' + guillemets(meta['resume']))

    if meta.get('isbn-ebook'):
        lignes.append('identifier:')
        lignes.append('- scheme: ISBN-13')
        lignes.append('  text: ' + guillemets(meta['isbn-ebook']))
    if meta.get('annee'):
        lignes.append('date: ' + guillemets(meta['annee']))
    lic = LICENCES.get(str(meta.get('licence') or ''))
    if lic:
        lignes.append('rights: ' + guillemets(lic))
    if meta.get('collection'):
        serie = str(meta['collection'])
        if meta.get('tome'):
            serie += ', ' + str(meta['tome'])
        lignes.append('belongs-to-collection: ' + guillemets(serie))
    lignes.append('publisher: "Edition SZH/CSPS"')
    return chr(10).join(lignes) + chr(10)


def main(argv):
    """Les feuilles de style passées en --css sont LIÉES, pas incorporées : le fichier
    reste lisible pour qui débogue une coupure de page, et WeasyPrint lit un chemin
    absolu sans difficulté — c'est la voie du PDF (numérique et imprimeur) et du HTML de
    compilation. Les images, elles, sont déjà en data: URI dans chaque fragment.

    --css-embed fait l'inverse : la feuille est INCORPORÉE dans un <style>, pas liée. Il
    n'existe que pour le HTML web (livre-html-web) : « autonome » y est la promesse — un
    seul fichier qu'on partage ou qu'on ouvre par file:// sans rien à côté — et un <link>
    vers un chemin absolu du poste de compilation ne survivrait pas au voyage."""
    try:  # console Windows en cp1252 : un accent combinant (nom venu du partage) y plante.
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass
    meta_p = gabarit_p = sortie_p = meta_epub = None
    # Dossier de sortie du livre (celui que livre.mk appelle $(OUT), toujours « out » sur ce
    # dépôt) : un argument plutôt qu'un chemin en dur, pour que la recherche des liminaires
    # écrits à la main (out/liminaires/<nom>.html) suive livre.mk si ce dossier changeait un
    # jour. SZH_OUT_LIVRE en repli, pour un appel hors Makefile (tests, essai à la main).
    out_dir = os.environ.get('SZH_OUT_LIVRE') or 'out'
    feuilles, feuilles_incorporees, fragments = [], [], []
    sans_liminaires = numeros_seuls = images_seules = False
    i = 1
    while i < len(argv):
        a = argv[i]
        if a == '--meta' and i + 1 < len(argv):
            meta_p = argv[i + 1]
            i += 2
        elif a == '--gabarit' and i + 1 < len(argv):
            gabarit_p = argv[i + 1]
            i += 2
        elif a == '--sortie' and i + 1 < len(argv):
            sortie_p = argv[i + 1]
            i += 2
        elif a == '--css' and i + 1 < len(argv):
            feuilles.append(argv[i + 1])
            i += 2
        elif a == '--metadonnees-epub' and i + 1 < len(argv):
            meta_epub = argv[i + 1]
            i += 2
        elif a == '--css-embed' and i + 1 < len(argv):
            feuilles_incorporees.append(argv[i + 1])
            i += 2
        elif a == '--sans-liminaires':
            sans_liminaires = True
            i += 1
        elif a == '--numeros-chapitres':
            numeros_seuls = True
            i += 1
        elif a == '--fichiers-images':
            images_seules = True
            i += 1
        elif a == '--out' and i + 1 < len(argv):
            out_dir = argv[i + 1]
            i += 2
        elif a.startswith('--'):
            print('[livre] option inconnue : ' + a, file=sys.stderr)
            return 2
        else:
            fragments.append(a)
            i += 1
    if not (meta_p and (numeros_seuls or images_seules or (gabarit_p and sortie_p))):
        print('usage: livre-assembler.py --meta buch.yaml --gabarit g.html '
              '--sortie out.html [--out dossier] [--css f.css]... '
              '[--css-embed f.css]... <fragment>...', file=sys.stderr)
        return 2

    meta = lire_yaml(meta_p)
    racine = os.path.dirname(os.path.abspath(meta_p))
    langue = str(meta.get('lang') or 'fr')
    reglages, erreurs = lire_mise_en_page(meta)

    if images_seules:
        for chemin in fichiers_images(meta, racine):
            print(chemin)
        return 0

    # Mode de livre.mk : les numéros « 1.1 » des chapitres, une ligne « slug=numéro » par
    # chapitre numéroté ; les arguments sont les slugs, dans l'ordre du livre.
    if numeros_seuls:
        parties, erreurs_parties = lire_parties(meta, fragments) if reglages else ([], [])
        if erreurs or erreurs_parties:
            for ligne in erreurs + erreurs_parties:
                print(ligne, file=sys.stderr)
            return 1
        for slug, numero in numeros_chapitres(reglages, parties, racine).items():
            print('%s=%s' % (slug, numero))
        return 0

    frags = []
    for f in fragments:
        try:
            frags.append(open(f, encoding='utf-8').read())
        except OSError as e:
            print('[livre] fragment illisible : %s (%s)' % (f, e), file=sys.stderr)
            return 1
    slugs = [slug_du_fragment(t) for t in frags]

    # La structure (parties, pièces de fin, dédicace, impressum) est celle de la maquette
    # normal ; le FALC n'en lit rien. Tous les refus sont dits avant d'en arrêter.
    normal = reglages is not None
    parties = []
    if normal and not sans_liminaires:
        parties, erreurs_parties = lire_parties(meta, [s for s in slugs if s])
        erreurs += erreurs_parties
        for p in parties:
            if p['illustration']:
                _fichier_livre(racine, p['illustration'],
                               'parties[%d].illustration' % p['rang'], erreurs)
        erreurs += verifier_impressum(meta, racine)
        pieces_fin = _liste(meta.get('pieces-fin'))
        for piece in pieces_fin:
            if not piece.endswith('.md'):
                erreurs.append(_erreur('piece-fin-inconnue', 'pieces-fin',
                    'La pièce de fin « %s » doit être un fichier .md de liminaires/.' % piece,
                    'Das Schlussstück « %s » muss eine .md-Datei aus liminaires/ sein.' % piece))
        if 'dedicace' in [str(x) for x in (meta.get('liminaires') or [])] \
                and not str(meta.get('dedicace') or '').strip():
            erreurs.append(_erreur('dedicace-vide', 'dedicace',
                'Le liminaire « dedicace » est annoncé, mais buch.yaml n\'a pas de clé dedicace.',
                'Das Vorsatzstück « dedicace » ist angekündigt, aber buch.yaml hat keinen '
                'Schlüssel dedicace.'))
    else:
        pieces_fin = []
    if erreurs:
        for ligne in erreurs:
            print(ligne, file=sys.stderr)
        return 1

    hierarchique = normal and reglages['sommaire'] == 'hierarchique'
    # Le numéro du sommaire (pastille) remplace celui du titre, sauf quand il n'y en a pas
    # (`aucun`) ou que le titre porte le sien (`partie`).
    numeroter = not normal or reglages['numeros-chapitres'] == 'continu'
    # Le numéro de chapitre suivi d'un demi-cadratin dans le sommaire hiérarchique.
    separateur = ' ' if hierarchique else ' '
    niveau_max = int(reglages['sommaire-niveaux']) if normal else 3

    def garder(entree):
        """Maquette normal : ni la bibliographie, ni ce qui passe sous sommaire-niveaux."""
        if not normal:
            return True
        return entree[0] <= niveau_max and not entree[1].endswith('szh-bibliographie')

    # Les pièces écrites à la main, lues une fois : liminaires puis pièces de fin.
    def piece_compilee(piece):
        f = os.path.join(racine, out_dir, 'liminaires', piece[:-3] + '.html')
        if os.path.exists(f):
            return open(f, encoding='utf-8').read()
        # Une pièce annoncée dans buch.yaml mais jamais compilée manquerait au livre sans un
        # mot : son absence arrête l'assemblage.
        print('[livre-blocage] liminaire-introuvable | pièce « ' + piece + ' » | '
              "La pièce « " + piece + " » est annoncée dans buch.yaml (liminaires: ou "
              "pieces-fin:) mais n'a pas été compilée : " + f + " est introuvable. "
              "Vérifiez qu'elle existe dans liminaires/, puis relancez la "
              'compilation. | [de] Das im buch.yaml angekündigte Stück « '
              + piece + ' » (liminaires: oder pieces-fin:) wurde nicht kompiliert: ' + f
              + ' fehlt. Prüfen Sie, ob es in liminaires/ liegt, und kompilieren '
              'Sie danach neu.', file=sys.stderr)
        return None

    def entree_piece(texte):
        """L'entrée de sommaire d'une pièce écrite à la main : son titre, au premier niveau."""
        for m in RE_TITRE.finditer(texte):
            if m.group('n') == '1':
                titre = re.sub(r'\s+', ' ', html.unescape(RE_BALISE.sub('', RE_BR.sub(' ', m.group('txt'))))).strip()
                return [(1, m.group('id'), titre, None, None)] if titre else []
        return []

    liminaires = [] if sans_liminaires else [str(p) for p in (meta.get('liminaires') or [])]
    textes_pieces = {}
    for piece in [p for p in liminaires if p.endswith('.md')] + pieces_fin:
        texte = piece_compilee(piece)
        if texte is None:
            return 1
        textes_pieces[piece] = texte

    # Les entrées du sommaire, dans l'ordre du livre : les liminaires écrits qui suivent le
    # sommaire (maquette normal), les parties et leurs chapitres, les pièces de fin.
    entrees, auteurs = [], {}
    if normal and 'sommaire' in liminaires:
        for piece in liminaires[liminaires.index('sommaire') + 1:]:
            if piece in textes_pieces:
                entrees.extend(entree_piece(textes_pieces[piece]))
    premier_de = {p['chapitres'][0]: p for p in parties if p['chapitres']}
    partie_de = {s: p for p in parties for s in p['chapitres']}
    corps = []
    for frag, slug in zip(frags, slugs):
        if slug in premier_de:
            p = premier_de[slug]
            corps.append(partie_html(p, reglages, racine))
            avec_numero = bool(p['numero']) and reglages['titre-partie'] == 'titre'
            entrees.append((0, 'partie-%d-titre' % p['rang'], szh_commun.titre_plat(p['titre']),
                            None, None,
                            {'classes': ('partie-seule' if p['page_seule'] else 'partie-partagee',),
                             'numero': p['numero'] if avec_numero else ''}))
        titres = [e for e in titres_du_fragment(frag, numeroter, separateur) if garder(e)]
        if slug in partie_de:
            frag = dans_partie(frag, partie_de[slug]['rang'])
            titres = [e + ({'classes': ('dans-partie',)},) if e[0] == 1 else e for e in titres]
        ligne_auteurs = auteurs_du_fragment(frag)
        if ligne_auteurs and titres and titres[0][0] == 1:
            auteurs[titres[0][1]] = ligne_auteurs
        entrees.extend(titres)
        corps.append(frag)
    for piece in pieces_fin:
        entrees.extend(entree_piece(textes_pieces[piece]))
        corps.append('<section class="szh-liminaire szh-romain szh-piece-fin">'
                     + textes_pieces[piece] + '</section>')

    # Les liminaires, dans l'ordre déclaré. Un nom de fichier .md renvoie à la pièce écrite
    # à la main, compilée comme un chapitre ; les autres sont des mots-clés que la machine
    # compose à partir de buch.yaml.
    logo = normal and reglages['logo-page-titre'] == 'oui'
    composeurs = {
        'demi-titre': lambda: demi_titre(meta, langue, normal),
        'colophon':   lambda: impressum(meta, racine, normal),
        'impressum':  lambda: impressum(meta, racine, normal),
        'page-titre': lambda: page_titre(meta, langue, normal, logo),
        'sommaire':   lambda: sommaire_html(entrees,
                                            TITRES_SOMMAIRE.get(langue, 'Sommaire'),
                                            hierarchique, auteurs, not normal),
    }
    if normal:
        composeurs['dedicace'] = lambda: dedicace(meta)
    tete = []
    for piece in liminaires:
        if piece in composeurs:
            tete.append(composeurs[piece]())
        elif piece in textes_pieces:
            tete.append('<section class="szh-liminaire szh-romain">'
                        + textes_pieces[piece] + '</section>')
        else:
            print('[livre] liminaire inconnu, ignore : ' + piece, file=sys.stderr)

    try:
        gabarit = open(gabarit_p, encoding='utf-8').read()
    except OSError as e:
        print('[livre] gabarit illisible : %s (%s)' % (gabarit_p, e), file=sys.stderr)
        return 1

    liens = '\n'.join('  <link rel="stylesheet" href="%s" />' % html.escape(c, quote=True)
                      for c in feuilles)
    for c in feuilles_incorporees:
        try:
            contenu = open(c, encoding='utf-8').read()
        except OSError as e:
            print('[livre] feuille à incorporer illisible : %s (%s)' % (c, e),
                  file=sys.stderr)
            return 1
        contenu = _url_absolues(contenu, c)
        # </style> dans le contenu couperait la balise court : aucune feuille du toolkit
        # n'en contient (c'est du CSS), mais une locale future pourrait — le
        # remplacement est gratuit et évite un HTML cassé en silence.
        contenu = contenu.replace('</style>', '<\\/style>')
        liens += ('\n  <style>/* %s */\n%s\n</style>'
                  % (html.escape(os.path.basename(c)), contenu))
    # Chapitre seul : le <title> (donc le /Title du PDF) nomme le chapitre, puis le livre.
    titre_document = szh_commun.titre_plat(meta.get('titre'))
    if sans_liminaires:
        premier = next((e[2] for e in entrees if e[0] == 1), '')
        if premier:
            titre_document = premier + (' — ' + titre_document if titre_document else '')
    remplacements = {
        '$lang$':          langue,
        '$titre$':         html.escape(titre_document),
        '$sous-titre$':    html.escape(szh_commun.titre_plat(meta.get('sous-titre'))),
        '$auteurs$':       html.escape(_auteurs_ligne(meta, langue)),
        # Pas en EPUB : le lecteur HTML de pandoc ferait de <meta name="author"> un dc:creator de plus.
        '$metadonnees$':   '' if meta_epub else metadonnees_html(meta, langue),
        '$classe-format$': 'szh-a4' if str(meta.get('format')) == 'a4' else '',
        '$mise-en-page$':  attributs_mise_en_page(reglages),
        '$css$':           liens,
        '$liminaires$':    '\n'.join(tete),
        '$corps$':         '\n'.join(corps),
    }
    sortie = _remplacer_jetons(gabarit, remplacements)

    dossier = os.path.dirname(os.path.abspath(sortie_p))
    if dossier:
        os.makedirs(dossier, exist_ok=True)
    with open(sortie_p, 'w', encoding='utf-8') as fh:
        fh.write(sortie)
    if meta_epub:
        with open(meta_epub, 'w', encoding='utf-8') as fh:
            fh.write(metadonnees_epub(meta))

    print('[livre] %d chapitre(s), %d liminaire(s), %d entree(s) de sommaire'
          % (len(fragments), len(tete), len(entrees)), file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
