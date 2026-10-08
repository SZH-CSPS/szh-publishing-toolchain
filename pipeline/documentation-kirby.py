#!/usr/bin/env python3
"""Convertisseur Documentation Kirby -> markdown pandoc.

Lit un dossier d'article Documentation (arborescence Kirby écrite par Pronto, voir
docs/FORMAT-DOCUMENTATION-KIRBY.md) et la description des champs
pipeline/kirby/champs-documentation.json. Écrit sur stdout (ou dans --sortie) le markdown
que szh-rubrique.lua et szh-ressource.lua mettent ensuite en forme.

Le script ne fait que transcrire les champs Kirby en attributs de Div, sous les noms du
JSON ; la présentation (libellés, dates, pastilles…) est dans les filtres Lua, qui lisent
le même JSON. Les deux formes de YAML que Kirby écrit ici sont lues par
parse_yaml_liste_simple() et parse_yaml_liste_structuree() (pas de PyYAML).

Les fiches viennent de la bibliothèque partagée <racine>/_NewsUndActu/Fiches/, trouvée en
remontant depuis --article, ou donnée par --racine-news ou SZH_NEWS_RACINE (tests). Seules
entrent les fiches dont le fichier dans la langue du numéro porte Ausgabe: <id
d'ausgabe.yaml>. Elles sont rangées selon leur champ Ordre (calculé par Pronto) ; un
Ordre absent, en double ou contraire au tri du JSON est signalé sur stderr, sans retri.

Usage :
    python3 documentation-kirby.py --article articles/07-documentation \
        --champs pipeline/kirby/champs-documentation.json [--sortie out/.../doc.md] \
        [--racine-news <racine>]
    python3 documentation-kirby.py --imprimer-racine-news [--article articles/07-documentation]
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
    """Valeur d'une clé de premier niveau d'un petit fichier YAML (<slug>.meta.yaml,
    ausgabe.yaml), sans ses guillemets. None si le fichier ou la clé manque."""
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
    """`Suivi:` + ligne vide + une liste YAML de structures (saisie `structure`) : un « - »
    seul sur sa ligne ouvre une entrée, les lignes « cle: valeur » qui suivent la
    remplissent. Valeurs entre guillemets doubles, simples (écrits par le Panel de Kirby)
    ou nues."""
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
    majuscule, le reste inchangé."""
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


# ── Ordre attendu des fiches, pour contrôle ─────────────────────────────────────────────

def cle_naturelle(s):
    """Clé de tri comme localeCompare avec numeric: true : sans accents ni casse, les
    suites de chiffres comparées comme des nombres."""
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

def deduire_langue(dossier_article, slug, champs, dossier_numero=None):
    """Langue de l'article, donc de ses fiches : `lang:` du .meta.yaml, sinon le seul
    documentation.<lang>.txt présent, sinon le jeton `revue:` d'ausgabe.yaml traduit par
    champs['revues'] (même ordre que langue_de() de szh-commun.lua). Chaque repli est
    signalé ; sans réponse, le script s'arrête en erreur."""
    langues = champs.get('langues', ['fr', 'de'])
    meta = os.path.join(dossier_article, slug + '.meta.yaml')
    brut = lire_scalaire_yaml(meta, 'lang')
    if brut:
        lang = brut.strip().lower()[:2]
        if lang in langues:
            return lang
    # Repli : le documentation.<lang>.txt présent, s'il est seul.
    candidats = sorted(
        m.group(1) for m in (
            re.match(r'^documentation\.(\w+)\.txt$', n) for n in os.listdir(dossier_article)
        ) if m and m.group(1) in langues
    )
    if len(candidats) == 1:
        print(f"{PREFIXE_MSG} ⚠ lang absente ou invalide dans {meta} — déduite de "
              f"documentation.{candidats[0]}.txt", file=sys.stderr)
        return candidats[0]
    if len(candidats) == 0 and dossier_numero:
        revue = lire_scalaire_yaml(os.path.join(dossier_numero, 'ausgabe.yaml'), 'revue')
        lang = (champs.get('revues') or {}).get((revue or '').strip().lower())
        if lang in langues:
            print(f"{PREFIXE_MSG} ⚠ lang absente ou invalide dans {meta}, et aucun "
                  f"documentation.<lang>.txt présent — déduite de ausgabe.yaml (revue: "
                  f"{revue})", file=sys.stderr)
            return lang
    sys.exit(f"{PREFIXE_MSG} ✖ langue de l'article introuvable ({meta}), et "
              f"{len(candidats)} documentation.<lang>.txt trouvé(s) : impossible de choisir.")


# ── Racine de la bibliothèque _NewsUndActu ──────────────────────────────────────────────

def trouver_dossier_numero(dossier_article):
    """Premier dossier parent qui contient ausgabe.yaml : le dossier du numéro. None si
    aucun (cas de certains tests) : il n'y a alors pas de fiches."""
    d = os.path.abspath(dossier_article)
    while True:
        if os.path.isfile(os.path.join(d, 'ausgabe.yaml')):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            return None
        d = parent


def trouver_racine_news(dossier_numero, racine_news=None):
    """Racine qui contient _NewsUndActu : argument, puis SZH_NEWS_RACINE, puis déduite des
    noms des dossiers parents du numéro. On ne compte pas les niveaux : un numéro archivé
    (<racine>/_Archive/Revue/<num>) est un niveau plus bas qu'un numéro en cours
    (<racine>/Revue/<num>)."""
    if racine_news and racine_news.strip():
        return os.path.abspath(racine_news.strip())
    env = os.environ.get('SZH_NEWS_RACINE')
    if env and env.strip():
        return os.path.abspath(env.strip())
    d = os.path.abspath(dossier_numero)
    parent = os.path.dirname(d)
    nom_parent = os.path.basename(parent)
    if nom_parent in ('Revue', 'Zeitschrift'):
        grand_parent = os.path.dirname(parent)
        if os.path.basename(grand_parent) == '_Archive':
            return os.path.dirname(grand_parent)
        return grand_parent
    sys.exit(f"{PREFIXE_MSG} ✖ racine _NewsUndActu introuvable depuis {d} (attendu sous "
              f"Revue\\<num>, Zeitschrift\\<num> ou _Archive\\Revue\\<num>) — passer "
              f"--racine-news ou définir SZH_NEWS_RACINE.")


def lire_fiches_bibliotheque(racine, lang, id_numero, champs):
    """Fiches <racine>/_NewsUndActu/Fiches/<dossier du type>/<slug>/<type>.<lang>.txt
    rattachées à ce numéro (Ausgabe == id_numero), dans cette langue.
    Avec un avertissement sur stderr :
      * un sous-dossier qui n'est le `dossier` d'aucun type du JSON est ignoré ;
      * un fichier dont le type (tiré de son nom) ne correspond pas à son dossier n'est
        pas lu.
    Les noms commençant par `_` sont ignorés."""
    dossier_fiches = os.path.join(racine, '_NewsUndActu', 'Fiches')
    fiches = []
    if not os.path.isdir(dossier_fiches):
        return fiches
    suffixe = f'.{lang}.txt'
    dossier_vers_type = {t_def['dossier']: t for t, t_def in champs['types'].items()}
    for nom_dossier in sorted(os.listdir(dossier_fiches)):
        if nom_dossier.startswith('_'):
            continue
        chemin_dossier_type = os.path.join(dossier_fiches, nom_dossier)
        if not os.path.isdir(chemin_dossier_type):
            continue
        type_attendu = dossier_vers_type.get(nom_dossier)
        if type_attendu is None:
            print(f"{PREFIXE_MSG} ⚠ Fiches/{nom_dossier} : sous-dossier inconnu (le dossier "
                  f"d'aucun type du contrat) — ignoré.", file=sys.stderr)
            continue
        for slug in sorted(os.listdir(chemin_dossier_type)):
            if slug.startswith('_'):
                continue
            chemin_slug = os.path.join(chemin_dossier_type, slug)
            if not os.path.isdir(chemin_slug):
                continue
            candidats = [f for f in os.listdir(chemin_slug) if f.endswith(suffixe)]
            if len(candidats) != 1:
                if len(candidats) > 1:
                    print(f"{PREFIXE_MSG} ⚠ {nom_dossier}/{slug} : {len(candidats)} fichiers "
                          f"*{suffixe} (1 attendu) — fiche ignorée.", file=sys.stderr)
                continue
            type_ = candidats[0][:-len(suffixe)]
            if type_ not in champs['types']:
                print(f"{PREFIXE_MSG} ⚠ {nom_dossier}/{slug} : type « {type_} » absent du "
                      f"contrat — fiche ignorée.", file=sys.stderr)
                continue
            if type_ != type_attendu:
                print(f"{PREFIXE_MSG} ✖ Fiches/{nom_dossier}/{slug}/{candidats[0]} : fichier "
                      f"de type « {type_} » rangé sous le dossier « {nom_dossier} », qui "
                      f"appartient au type « {type_attendu} » — non lu.", file=sys.stderr)
                continue
            with open(os.path.join(chemin_slug, candidats[0]), encoding='utf-8') as f:
                fields = parse_kirby_txt(f.read())
            if (fields.get('Ausgabe') or '').strip() != id_numero:
                continue  # sans numéro, ou d'un autre numéro
            ordre_brut = (fields.get('Ordre') or '').strip()
            ordre = int(ordre_brut) if re.fullmatch(r'\d+', ordre_brut) else None
            fiches.append({'dossier': slug, 'chemin': chemin_slug, 'type': type_,
                            'champs': fields, 'ordre': ordre})
    return fiches


def trier_fiches_numero(champs, fiches):
    """Trie par le champ Ordre (recalculé par Pronto à chaque enregistrement d'une fiche
    du numéro). Avertit sur stderr si Ordre manque, est en double, ou contredit le tri du
    JSON (ordre_attendu : ordreTypes puis le tri de chaque type). Ordre fait foi."""
    attendu = ordre_attendu(champs, fiches)
    sans_ordre = [f['dossier'] for f in fiches if f['ordre'] is None]
    if sans_ordre:
        print(f"{PREFIXE_MSG} ⚠ Ordre absent pour : {', '.join(sans_ordre)} — tri du "
              f"contrat utilisé en repli pour ces fiches.", file=sys.stderr)
    comptes = {}
    for f in fiches:
        if f['ordre'] is not None:
            comptes[f['ordre']] = comptes.get(f['ordre'], 0) + 1
    doublons = sorted(o for o, n in comptes.items() if n > 1)
    if doublons:
        print(f"{PREFIXE_MSG} ⚠ Ordre en double : {', '.join(str(o) for o in doublons)}.",
              file=sys.stderr)
    index_attendu = {d: i for i, d in enumerate(attendu)}
    fiches_triees = sorted(
        fiches,
        key=lambda f: (f['ordre'] if f['ordre'] is not None else float('inf'),
                        index_attendu.get(f['dossier'], len(attendu)))
    )
    ordre_disque = [f['dossier'] for f in fiches_triees]
    if ordre_disque != attendu:
        print(f"{PREFIXE_MSG} ⚠ l'ordre des fiches (Ordre : {', '.join(ordre_disque)}) ne "
              f"suit pas le tri du contrat ({', '.join(attendu)}) — le champ Ordre fait foi, "
              f"rien n'est retrié.", file=sys.stderr)
    return fiches_triees


# ── Émission du markdown ────────────────────────────────────────────────────────────────

def echapper_attribut(v):
    return v.replace('\\', '\\\\').replace('"', '\\"').replace('\n', ' ').strip()


def formater_dest_markdown(chemin):
    """Chemin d'image entre `< >` s'il contient une espace (« OneDrive - SZH CSPS ») :
    sinon markdown coupe la destination à la première espace."""
    return f'<{chemin}>' if ' ' in chemin else chemin


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
        # Chemin absolu : la fiche est hors du numéro, à une distance qui varie (numéro en
        # cours ou archivé). Il vient du même processus que le dossier de l'article, donc
        # de la même vue du système de fichiers (Windows ou /mnt/c).
        chemin_image = os.path.join(fiche['chemin'], image).replace('\\', '/')
        lignes.append(f'![]({formater_dest_markdown(chemin_image)}){{alt=""}}')
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


def convertir(dossier_article, champs_path, racine_news=None):
    with open(champs_path, encoding='utf-8') as f:
        champs = json.load(f)

    slug = os.path.basename(os.path.normpath(dossier_article))

    # Le numéro : ausgabe.yaml, trouvé en remontant. Absent : pas de fiches. Présent mais
    # sans `id:` : erreur.
    dossier_numero = trouver_dossier_numero(dossier_article)
    id_numero = None
    if dossier_numero:
        id_numero = lire_scalaire_yaml(os.path.join(dossier_numero, 'ausgabe.yaml'), 'id')
        if not id_numero or not id_numero.strip():
            sys.exit(f"{PREFIXE_MSG} ✖ {os.path.join(dossier_numero, 'ausgabe.yaml')} n'a pas "
                      f"de clé « id: » — un numéro sans id ne peut pas rattacher de fiche.")
        id_numero = id_numero.strip()
    else:
        print(f"{PREFIXE_MSG} ⚠ aucun ausgabe.yaml trouvé en remontant depuis "
              f"{dossier_article} — aucune fiche Kirby ne sera récupérée.", file=sys.stderr)

    lang = deduire_langue(dossier_article, slug, champs, dossier_numero)

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

    fiches = []
    if id_numero:
        racine = trouver_racine_news(dossier_numero, racine_news)
        fiches = lire_fiches_bibliotheque(racine, lang, id_numero, champs)
        fiches = trier_fiches_numero(champs, fiches)
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
            # Enveloppe de section : szh-rubrique.lua y pose un <h2> non numéroté tiré de
            # types[].libelle (szh-ressource.lua passe trop tôt dans la chaîne pour cela).
            # L'identifiant est obligatoire : un Div sans identifiant dont le premier enfant
            # est un Header devient une <section> qui prend l'identifiant du titre (voir
            # l'en-tête de szh-rubrique.lua).
            lignes.append(f'::: {{#doc-section-{section} .szh-ressources-section type="{section}"}}')
            lignes.append('')
            for fiche in groupe:
                lignes.extend(emettre_fiche(champs, section, fiche))
            lignes.append(':::')
            lignes.append('')
        # Une clé d'ordreSections qui n'est ni rubrique ni type ne produit rien.

    sortie = '\n'.join(lignes)
    sortie = re.sub(r'\n{3,}', '\n\n', sortie).strip('\n') + '\n'
    return sortie


def main():
    try:  # console Windows en cp1252 : un accent combinant y ferait planter print().
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--article', help='dossier de l\'article Documentation')
    p.add_argument('--champs', help='pipeline/kirby/champs-documentation.json')
    p.add_argument('--sortie', help='fichier de sortie (stdout si omis)')
    p.add_argument('--racine-news', help='surcharge la racine de _NewsUndActu (sinon '
                   'SZH_NEWS_RACINE, sinon découverte par les noms de dossiers — voir '
                   'trouver_racine_news)')
    p.add_argument('--imprimer-racine-news', action='store_true', help='imprime sur stdout '
                   'la racine découverte depuis --article (ou le répertoire courant) et '
                   'quitte, sans convertir ; pour $(shell) du Makefile (dépendances make).')
    args = p.parse_args()

    if args.imprimer_racine_news:
        dossier_numero = trouver_dossier_numero(args.article or '.')
        if not dossier_numero:
            sys.exit(1)  # rien sur stdout : DOC_FICHES du Makefile reste vide
        print(trouver_racine_news(dossier_numero, args.racine_news))
        return

    if not args.article or not args.champs:
        p.error('--article et --champs sont requis (sauf avec --imprimer-racine-news)')

    sortie = convertir(args.article, args.champs, args.racine_news)

    if args.sortie:
        os.makedirs(os.path.dirname(args.sortie) or '.', exist_ok=True)
        with open(args.sortie, 'w', encoding='utf-8', newline='\n') as f:
            f.write(sortie)
    else:
        sys.stdout.write(sortie)


if __name__ == '__main__':
    main()
