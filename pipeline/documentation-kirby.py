#!/usr/bin/env python3
"""Convertisseur Documentation Kirby -> markdown pandoc.

Lit un dossier d'article Documentation (arborescence Kirby écrite par Pronto : voir
docs/FORMAT-DOCUMENTATION-KIRBY.md) et le contrat pipeline/kirby/champs-documentation.json,
et écrit sur stdout (ou dans --sortie) le markdown intermédiaire que szh-rubrique.lua et
szh-ressource.lua composent ensuite. Bibliothèque standard seulement (pas de PyYAML) : les
deux formes de YAML que Kirby écrit ici (une liste d'un nom de fichier, une liste de
structures pour le suivi) sont lues par un petit analyseur maison, restreint à ces deux
formes — voir parse_yaml_liste_simple() et parse_yaml_liste_structuree().

Aucune logique de présentation ici (traduction de jeton, format de date, pastille,
suivi imprimé…) : ce script ne fait que transcrire les champs Kirby en attributs de Div,
dans les noms du JSON. La présentation vit dans szh-ressource.lua et szh-rubrique.lua, qui
lisent le même JSON — un seul endroit où changer un libellé.

Usage :
    python3 documentation-kirby.py --article articles/07-documentation \
        --champs pipeline/kirby/champs-documentation.json [--sortie out/.../doc.md]
"""

import argparse
import json
import os
import re
import sys
import unicodedata

PREFIXE_MSG = '[documentation-kirby]'


# ── Lecteurs restreints (bibliothèque standard seulement) ──────────────────────────────

def lire_scalaire_yaml(chemin, cle):
    """Une clé de premier niveau (colonne 0) d'un petit fichier YAML — <slug>.meta.yaml
    ici, jamais du YAML arbitraire. Guillemets simples ou doubles ôtés ; sinon valeur
    brute. Rend None si le fichier est absent ou la clé introuvable."""
    if not os.path.isfile(chemin):
        return None
    motif = re.compile(r'^' + re.escape(cle) + r':\s*(.*)$')
    with open(chemin, encoding='utf-8') as f:
        for ligne in f:
            m = motif.match(ligne.rstrip('\r\n'))
            if m:
                return devisser_scalaire(m.group(1))
    return None


def devisser_scalaire(valeur):
    v = valeur.strip()
    if len(v) >= 2 and v[0] == '"' and v[-1] == '"':
        return v[1:-1].replace('\\"', '"').replace('\\\\', '\\')
    if len(v) >= 2 and v[0] == "'" and v[-1] == "'":
        return v[1:-1].replace("''", "'")
    return v


def parse_yaml_liste_simple(valeur):
    """`Couverture:` + ligne vide + `- <nom-du-fichier>` : une liste d'un seul élément.
    Rend le premier (et seul) élément trouvé, ou None."""
    for ligne in (valeur or '').splitlines():
        s = ligne.strip()
        if s.startswith('- '):
            return devisser_scalaire(s[2:])
    return None


def parse_yaml_liste_structuree(valeur):
    """`Suivi:` + ligne vide + une liste YAML de structures (voir
    docs/FORMAT-DOCUMENTATION-KIRBY.md, saisie `structure`) : un « - » seul sur sa ligne
    ouvre une entrée, les lignes indentées « cle: valeur » qui suivent la remplissent.
    Accepte les valeurs entre guillemets doubles (écriture normale) ou simples (ce
    qu'écrit le Panel de Kirby), et les scalaires nus."""
    entrees = []
    courante = None
    motif_cle = re.compile(r'^([a-z][a-z0-9_]*):\s*(.*)$')
    for ligne in (valeur or '').splitlines():
        s = ligne.strip()
        if not s:
            continue
        if s == '-':
            if courante is not None:
                entrees.append(courante)
            courante = {}
            continue
        m = motif_cle.match(s)
        if m and courante is not None:
            courante[m.group(1)] = devisser_scalaire(m.group(2))
    if courante is not None:
        entrees.append(courante)
    return entrees


# ── Lecture d'un fichier .txt Kirby ─────────────────────────────────────────────────────

def kirby_key(cle):
    """`title` -> `Title`, `dossier_references` -> `Dossier_references` : initiale en
    majuscule, le reste inchangé (docs/FORMAT-DOCUMENTATION-KIRBY.md, §Syntaxe)."""
    if not cle:
        return cle
    return cle[0].upper() + cle[1:]


def parse_kirby_txt(texte):
    """Un fichier .txt Kirby en dict ordonné {Champ: valeur}. Champs séparés par une
    ligne `----` seule ; `Clé: valeur` sur une ligne, ou `Clé:` puis une ligne vide puis
    la valeur (multiligne). Une valeur qui commence par `----` est écrite `\\----` et se
    relit sans le `\\`."""
    texte = texte.replace('\r\n', '\n')
    blocs = texte.split('\n----\n')
    champs = {}
    motif = re.compile(r'^([A-Za-z][A-Za-z0-9_]*):(.*)$', re.S)
    for bloc in blocs:
        bloc = bloc.strip('\n')
        if not bloc.strip():
            continue
        m = motif.match(bloc)
        if not m:
            continue
        cle = m.group(1)
        reste = m.group(2)
        if reste.startswith('\n\n'):
            valeur = reste[2:]
        elif reste.startswith(' '):
            valeur = reste[1:]
        elif reste.startswith('\n'):
            valeur = reste[1:]
        else:
            valeur = reste
        # Une ligne de valeur échappée « \---- » se relit sans le backslash.
        valeur = re.sub(r'(^|\n)\\----', r'\1----', valeur)
        champs[cle] = valeur.strip('\n')
    return champs


# ── Ordre des fiches : comparaison, jamais un retri silencieux ─────────────────────────

def cle_naturelle(s):
    """Clé de comparaison localeCompare-like : diacritiques repliés, casse ignorée,
    et les suites de chiffres comparées numériquement plutôt que caractère à caractère
    (docs/FORMAT-DOCUMENTATION-KIRBY.md : « numeric true »)."""
    s = s or ''
    nfd = unicodedata.normalize('NFKD', s)
    sans_accents = ''.join(c for c in nfd if not unicodedata.combining(c))
    sans_accents = sans_accents.casefold()
    morceaux = re.findall(r'\d+|\D+', sans_accents)
    return tuple((0, int(m)) if m.isdigit() else (1, m) for m in morceaux)


def index_liste(champs, nom_liste, jeton):
    for i, item in enumerate(champs.get('listes', {}).get(nom_liste, [])):
        if item.get('jeton') == jeton:
            return i
    return len(champs.get('listes', {}).get(nom_liste, [])) + 1


def clef_champ_tri(champs, type_def, cle, valeur):
    trie_premier = type_def.get('triPremier') or {}
    if cle in trie_premier:
        prioritaire = 0 if valeur == trie_premier[cle] else 1
        return (prioritaire, cle_naturelle(valeur))
    champ_def = next((c for c in type_def.get('champs', []) if c.get('cle') == cle), None)
    if champ_def and champ_def.get('saisie') == 'liste':
        return (index_liste(champs, champ_def.get('liste'), valeur),)
    return (cle_naturelle(valeur),)


def clef_tri_fiche(champs, type_, fiche):
    type_def = champs['types'][type_]
    tri = type_def.get('tri') or ['title']
    return tuple(
        clef_champ_tri(champs, type_def, c, fiche['champs'].get(kirby_key(c), '') or '')
        for c in tri
    )


def ordre_attendu(champs, fiches):
    resultat = []
    for type_ in champs['ordreTypes']:
        groupe = [f for f in fiches if f['type'] == type_]
        groupe.sort(key=lambda f: clef_tri_fiche(champs, type_, f))
        resultat.extend(f['dossier'] for f in groupe)
    return resultat


# ── Lecture de l'arborescence ────────────────────────────────────────────────────────────

def deduire_langue(dossier_article, slug, champs):
    langues = champs.get('langues', ['fr', 'de'])
    meta = os.path.join(dossier_article, slug + '.meta.yaml')
    brut = lire_scalaire_yaml(meta, 'lang')
    if brut:
        lang = brut.strip().lower()[:2]
        if lang in langues:
            return lang
    # Repli : le fichier documentation.<lang>.txt présent le dit, s'il n'y en a qu'un.
    candidats = sorted(
        m.group(1) for m in (
            re.match(r'^documentation\.(\w+)\.txt$', n) for n in os.listdir(dossier_article)
        ) if m and m.group(1) in langues
    )
    if len(candidats) == 1:
        print(f"{PREFIXE_MSG} ⚠ lang absente ou invalide dans {meta} — déduite de "
              f"documentation.{candidats[0]}.txt", file=sys.stderr)
        return candidats[0]
    sys.exit(f"{PREFIXE_MSG} ✖ langue de l'article introuvable ({meta}), et "
              f"{len(candidats)} documentation.<lang>.txt trouvé(s) : impossible de choisir.")


def lire_fiches(dossier_article, lang, champs):
    entrees = []
    for nom in os.listdir(dossier_article):
        chemin = os.path.join(dossier_article, nom)
        if not os.path.isdir(chemin):
            continue
        m = re.match(r'^(\d+)_(.+)$', nom)
        if not m:
            continue
        entrees.append((int(m.group(1)), nom, chemin))
    entrees.sort(key=lambda t: t[0])

    fiches = []
    for prefixe, nom, chemin in entrees:
        suffixe = f'.{lang}.txt'
        candidats = [f for f in os.listdir(chemin) if f.endswith(suffixe)]
        if len(candidats) != 1:
            print(f"{PREFIXE_MSG} ⚠ {nom} : {len(candidats)} fichier(s) *{suffixe} "
                  f"(1 attendu) — fiche ignorée.", file=sys.stderr)
            continue
        type_ = candidats[0][:-len(suffixe)]
        if type_ not in champs['types']:
            print(f"{PREFIXE_MSG} ⚠ {nom} : type « {type_} » absent du contrat — "
                  f"fiche ignorée.", file=sys.stderr)
            continue
        with open(os.path.join(chemin, candidats[0]), encoding='utf-8') as f:
            fields = parse_kirby_txt(f.read())
        fiches.append({'prefixe': prefixe, 'dossier': nom, 'type': type_, 'champs': fields})

    ordre_disque = [f['dossier'] for f in fiches]
    attendu = ordre_attendu(champs, fiches)
    if ordre_disque != attendu:
        print(f"{PREFIXE_MSG} ⚠ l'ordre des fiches sur le disque ({', '.join(ordre_disque)}) "
              f"ne suit pas le tri du contrat ({', '.join(attendu)}) — le préfixe du dossier "
              f"fait foi, rien n'est retrié.", file=sys.stderr)
    return fiches


# ── Émission du markdown ────────────────────────────────────────────────────────────────

def echapper_attribut(v):
    return v.replace('\\', '\\\\').replace('"', '\\"').replace('\n', ' ').strip()


def identifiant_fiche(fiche):
    uuid = (fiche['champs'].get('Uuid') or '').strip()
    if uuid:
        return uuid
    secours = re.sub(r'[^A-Za-z0-9_-]+', '-', fiche['dossier']).strip('-')
    return secours or 'fiche'


def emettre_fiche(champs, type_, fiche):
    type_def = champs['types'][type_]
    attrs = []
    descriptif = ''
    image = None
    suivi = None
    for cdef in type_def.get('champs', []):
        cle = cdef['cle']
        saisie = cdef.get('saisie')
        brut = fiche['champs'].get(kirby_key(cle))
        if saisie == 'texte_long' and cle == 'descriptif':
            descriptif = (brut or '').strip('\n')
            continue
        if saisie == 'fichier':
            if brut:
                image = parse_yaml_liste_simple(brut)
            continue
        if saisie == 'structure':
            if brut:
                suivi = parse_yaml_liste_structuree(brut)
            continue
        if brut is not None and brut.strip() != '':
            attrs.append(f'{cle}="{echapper_attribut(brut)}"')

    lignes = []
    entete = f'::: {{#{identifiant_fiche(fiche)} .szh-ressource type="{type_}"'
    if attrs:
        entete += ' ' + ' '.join(attrs)
    entete += '}'
    lignes.append(entete)
    lignes.append('')
    if suivi:
        for e in suivi:
            sattrs = []
            for k in ('date', 'genre', 'libelle', 'lien'):
                v = (e.get(k) or '').strip()
                if v:
                    sattrs.append(f'{k}="{echapper_attribut(v)}"')
            lignes.append('::: {.szh-suivi-entree' + (' ' + ' '.join(sattrs) if sattrs else '') + '}')
            lignes.append(':::')
            lignes.append('')
    if descriptif:
        lignes.append(descriptif)
        lignes.append('')
    if image:
        chemin_image = fiche['dossier'] + '/' + image
        lignes.append(f'![]({chemin_image}){{alt=""}}')
        lignes.append('')
    lignes.append(':::')
    lignes.append('')
    return lignes


def emettre_rubrique(cle, texte):
    return [
        f'::: {{#doc-{cle} .szh-rubrique type="{cle}"}}',
        '',
        texte.strip('\n'),
        '',
        ':::',
        '',
    ]


def convertir(dossier_article, champs_path):
    with open(champs_path, encoding='utf-8') as f:
        champs = json.load(f)

    slug = os.path.basename(os.path.normpath(dossier_article))
    lang = deduire_langue(dossier_article, slug, champs)

    doc_path = os.path.join(dossier_article, f'documentation.{lang}.txt')
    if not os.path.isfile(doc_path):
        autres = sorted(n for n in os.listdir(dossier_article)
                         if re.match(r'^documentation\.\w+\.txt$', n))
        msg = f"{PREFIXE_MSG} ✖ {doc_path} introuvable."
        if autres:
            msg += f" Trouvé à la place : {', '.join(autres)}."
        sys.exit(msg)
    with open(doc_path, encoding='utf-8') as f:
        doc_fields = parse_kirby_txt(f.read())

    fiches = lire_fiches(dossier_article, lang, champs)
    rubriques_index = {r['cle']: r for r in champs['rubriques']}

    lignes = []
    for section in champs['ordreSections']:
        if section in rubriques_index:
            texte = doc_fields.get(kirby_key(section), '')
            if texte and texte.strip():
                lignes.extend(emettre_rubrique(section, texte))
        elif section in champs['types']:
            groupe = [f for f in fiches if f['type'] == section]
            if not groupe:
                continue
            # Enveloppe de section, composée par szh-rubrique.lua (pas szh-ressource.lua,
            # qui tourne trop tôt dans la chaîne pour poser un titre non numéroté — voir
            # son commentaire de tête) : un <h2> non numéroté, dans l'esprit d'une rubrique,
            # tiré de types[].libelle. Sans elle, une section de fiches n'avait aucun titre
            # imprimé — constaté le 23.09.2026 sur le banc réel.
            # Identifiant non vide obligatoire (#doc-section-<type>) : un Div SANS
            # identifiant dont le premier enfant est un Header voit le writer html5 de
            # pandoc lui voler cet identifiant en le promouvant en <section> — même piège
            # que documenté en tête de szh-rubrique.lua pour les rubriques, qui posent
            # toujours le leur (#doc-<cle>) pour la même raison.
            lignes.append(f'::: {{#doc-section-{section} .szh-ressources-section type="{section}"}}')
            lignes.append('')
            for fiche in groupe:
                lignes.extend(emettre_fiche(champs, section, fiche))
            lignes.append(':::')
            lignes.append('')
        # Une clé d'ordreSections qui ne serait ni une rubrique ni un type n'a rien à
        # produire : le contrat serait fautif, pas ce script — rien n'est écrit.

    sortie = '\n'.join(lignes)
    sortie = re.sub(r'\n{3,}', '\n\n', sortie).strip('\n') + '\n'
    return sortie


def main():
    try:  # console Windows en cp1252 : un accent combinant (avertissement, titre importé) y plante.
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--article', required=True, help='dossier de l\'article Documentation')
    p.add_argument('--champs', required=True, help='pipeline/kirby/champs-documentation.json')
    p.add_argument('--sortie', help='fichier de sortie (stdout si omis)')
    args = p.parse_args()

    sortie = convertir(args.article, args.champs)

    if args.sortie:
        os.makedirs(os.path.dirname(args.sortie) or '.', exist_ok=True)
        with open(args.sortie, 'w', encoding='utf-8', newline='\n') as f:
            f.write(sortie)
    else:
        sys.stdout.write(sortie)


if __name__ == '__main__':
    main()
