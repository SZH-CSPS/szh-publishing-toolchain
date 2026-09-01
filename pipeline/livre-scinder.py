#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Scinde un chapitre importé d'un docx en autant de chapitres qu'il porte de titres
de niveau 1. Reproduit exactement les règles de slug du reste de la chaîne.

Appel : python3 livre-scinder.py <dossier du livre> <slug du chapitre à scinder>

Lanceur : la cible `import` de pipeline/Makefile appelle ce script automatiquement,
juste après avoir converti un .docx de chapitres-word/ en chapitre unique — exactement
comme le ferait quelqu'un à la main. Elle ne le fait que si le .md fraîchement produit
porte 2 titres de niveau 1 ou plus : un seul (le titre du chapitre lui-même, comme le
pose le modèle Modele-chapitre-SZH.docx) n'est pas un manuscrit à scinder, c'est déjà un
chapitre. Voir chapitres-word/LISEZ-MOI.txt (« Un manuscrit en UN SEUL fichier... se
découpe ensuite, aux titres de niveau 1 ») et le commentaire de la cible `import`.
"""

import sys
import os
import re
import shutil
import unicodedata
from pathlib import Path
from collections import defaultdict

# Pas d'import yaml - la WSL de production n'a que la stdlib (voir lire_ordre_existant() :
# buch.yaml se lit en texte brut pour cette raison, jamais avec un module absent en
# production).

# --------------------------------------------------------------------------------------
# Translittération et normalisation de slug, reproduisant slug.js exactement
# --------------------------------------------------------------------------------------
def slugifier(nom_fichier: str) -> str:
    """
    Reproduit le slug de la cible « import » du Makefile :
    nom sans extension | iconv ASCII//TRANSLIT | minuscules | [^a-z0-9]+ -> '-' | trim '-'
    """
    # Retirer l'extension
    s = re.sub(r'\.[^.]*$', '', nom_fichier)

    # Translittération des ligatures françaises (comme en JS)
    s = s.replace('œ', 'oe').replace('Œ', 'oe')
    s = s.replace('æ', 'ae').replace('Æ', 'ae')
    s = s.replace('ß', 'ss')

    # NFD normalisation + suppression des diacritiques
    s = unicodedata.normalize('NFD', s)
    s = re.sub(r'[̀-ͯ]', '', s)

    # Minuscules, remplacer [^a-z0-9]+ par '-', trim
    s = s.lower()
    s = re.sub(r'[^a-z0-9]+', '-', s)
    s = re.sub(r'^-+|-+$', '', s)

    return s or 'article'

LONGUEUR_MAX_SLUG = 39

def borner_slug(s: str) -> str:
    """
    Coupe au dernier mot entier plutôt qu'au caractère près.
    Retire les segments orphelins d'une lettre à la fin (élisions comme « d-enseignement »).
    """
    if len(s) <= LONGUEUR_MAX_SLUG:
        return s

    coupe = s[:LONGUEUR_MAX_SLUG]
    i = coupe.rfind('-')
    court = coupe[:i] if i > 0 else coupe

    # Retirer les segments orphelins à la fin, mais pas si ça laisse un seul segment
    sans_orphelin = re.sub(r'(-[a-z0-9])+$', '', court)
    if '-' in sans_orphelin:
        court = sans_orphelin

    return court

def slugifier_chapitre(titre: str) -> str:
    """
    Slug d'un chapitre : slugifier puis borner. Pas de complément de deux chiffres
    (c'est pour les articles, pas les chapitres).
    """
    return borner_slug(slugifier(titre))

# --------------------------------------------------------------------------------------
# Lecture et découpe du chapitre
# --------------------------------------------------------------------------------------
def lire_chapitre(chemin_md: str) -> tuple[str, list[tuple[str, str]]]:
    """
    Lit le chapitre et le découpe aux titres # de niveau 1.
    Retourne (liminaire, [(titre, contenu), ...])
    """
    with open(chemin_md, 'r', encoding='utf-8') as f:
        texte = f.read()

    # Découper aux « # titre » (ligne commençant par # suivi d'espace, pas ##)
    # Pattern : début de ligne, exactement un #, puis espace, puis le titre
    pattern = r'^#\s+(.+)$'

    sections = []
    liminaire = []
    dans_liminaire = True
    lignes = texte.split('\n')
    section_actuelle_titre = None
    section_actuelle_contenu = []

    for ligne in lignes:
        match = re.match(pattern, ligne)
        if match:
            # C'est un titre de niveau 1
            titre = match.group(1).strip()

            # Sauvegarder la section précédente
            if section_actuelle_titre is not None:
                contenu = '\n'.join(section_actuelle_contenu)
                sections.append((section_actuelle_titre, contenu))

            dans_liminaire = False
            section_actuelle_titre = titre
            section_actuelle_contenu = []
        else:
            # Pas un titre de niveau 1
            if section_actuelle_titre is not None:
                # On est dans une section
                section_actuelle_contenu.append(ligne)
            else:
                # On est dans le liminaire
                liminaire.append(ligne)

    # Sauvegarder la dernière section
    if section_actuelle_titre is not None:
        contenu = '\n'.join(section_actuelle_contenu)
        sections.append((section_actuelle_titre, contenu))

    # Nettoyer le liminaire (retirer les lignes vides au début et à la fin)
    while liminaire and not liminaire[0].strip():
        liminaire.pop(0)
    while liminaire and not liminaire[-1].strip():
        liminaire.pop()

    liminaire_texte = '\n'.join(liminaire)

    return liminaire_texte, sections

# --------------------------------------------------------------------------------------
# Gestion des médias et tableaux
# --------------------------------------------------------------------------------------
def extraire_references(contenu: str, dossier_source: Path = None) -> dict:
    """
    Extrait les références aux médias et tableaux du contenu markdown.
    Retourne {'images': [...], 'tables': [...]} avec les chemins.

    `dossier_source` — le dossier du chapitre d'origine — est ce qui permet de suivre un
    tableau jusqu'aux images QU'IL cite : docx-tables.py écrit des « <img src="media/…" > »
    dans tables/table-NN.html, et ces images-là n'apparaissent nulle part dans le .md. Sans
    cette lecture, la scission copiait le tableau sans son image, et le chapitre partait
    avec un trou. C'est arrivé au VN-FALC : le chapitre 09 citait fig-73 dans son tableau 05
    et ne l'a jamais reçue — WeasyPrint le disait à chaque compilation, dans une ligne
    d'erreur que rien ne remontait. import-medias.py connaît déjà cette règle (voir sa
    fonction fichiers_de_texte, qui lit les tableaux au même titre que le corps) ; elle
    manquait ici. Sans `dossier_source`, le comportement reste l'ancien.

    Deux formes d'image, pas une seule — mesuré en testant ce script de bout en bout sur
    un vrai aller-retour pandoc plutôt qu'à la lecture : une image SANS texte alternatif
    ressort en markdown ordinaire (`![](media/x.png)`), mais dès qu'elle en porte un,
    pandoc en fait un Figure à légende que le writer markdown ne peut exprimer et rend en
    HTML brut (`<figure><img src="./media/x.png" …></figure>`) — et c'est justement le cas
    d'une image que szh-legendes.lua n'a pas su réduire à une légende de paragraphe. Ne
    reconnaître que la première forme, comme avant ce correctif, faisait passer une telle
    image pour absente : ni copiée vers le nouveau chapitre, ni comptée dans les orphelines,
    simplement invisible. Les DEUX formes, en plus, peuvent porter un chemin préfixé
    « ./ » (observé sur le même aller-retour, y compris en markdown ordinaire) : l'ancien
    motif exigeait que « media/ » ouvre le chemin pile, et le loupait aussi.
    """
    references = {'images': set(), 'tables': set()}

    # Images en markdown : ![...](media/xxx) ou ![...](./media/xxx.png)
    for match in re.finditer(r'!\[.*?\]\((?:\./)?(media/[^)\s]+)', contenu):
        references['images'].add(match.group(1))

    # Images en HTML brut : <img src="media/xxx"> ou <img src="./media/xxx">, seule ou
    # dans un <figure>. Pandoc y recourt pour une image que le markdown ne peut pas
    # exprimer telle quelle (une légende promue en Caption, par exemple).
    for match in re.finditer(r'<img\s[^>]*?src=["\'](?:\./)?(media/[^"\']+)["\']', contenu):
        references['images'].add(match.group(1))

    # Tableaux : ::: {.szh-tabelle src="tables/table-NN.html"}
    for match in re.finditer(r'::: \{\.szh-tabelle src="(tables/[^"]+)"\}', contenu):
        references['tables'].add(match.group(1))

    # Puis les images citées DANS ces tableaux (voir la docstring). Un tableau illisible ou
    # absent n'est pas traité ici : la copie du tableau le signalera d'elle-même.
    if dossier_source is not None:
        for chemin_table in sorted(references['tables']):
            try:
                with open(Path(dossier_source) / chemin_table, encoding='utf-8',
                          errors='replace') as f:
                    corps_table = f.read()
            except OSError:
                continue
            for match in re.finditer(
                    r'<img\s[^>]*?src=["\'](?:\./)?(media/[^"\']+)["\']', corps_table):
                references['images'].add(match.group(1))

    return references

def copier_ressource(src: Path, dst: Path, nom_ressource: str, contexte: str) -> bool:
    """
    Copie une ressource (image ou tableau). Retourne True si copié ou existant,
    False si la source n'existe pas.
    """
    if not src.exists():
        return False

    # Créer le dossier parent si nécessaire
    dst.parent.mkdir(parents=True, exist_ok=True)

    # Copier (ou remplacer si existe)
    if src.is_file():
        shutil.copy2(src, dst)
    else:
        # Dossier (rare)
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(src, dst)

    return True

# --------------------------------------------------------------------------------------
# Constats nommés — même forme que docx-meta.py, docx-tables.py et reimporter.py : un code
# stable, des champs, une phrase française puis allemande, sur stderr ET dans SZH_IMPORT_LOG
# si le lanceur en a posé un. C'est l'absence de cette forme qui a rendu l'incident du
# B329 indiagnosticable le 31.08 : un « ⚠ » perdu dans stderr, jamais bloquant, suivi d'un
# rmtree — voir docs/REPRISE-LIVRES.md. Le code est ce qu'un outil de surveillance doit
# chercher ; les phrases ne sont qu'un repli d'affichage.
# --------------------------------------------------------------------------------------
PREFIXE_AVERT = '[scission-avertissement]'

def avertir(code: str, champs: list, fr: str, de: str) -> None:
    ligne = ' | '.join([PREFIXE_AVERT + ' ' + code] + list(champs) + [fr, '[de] ' + de])
    print(ligne, file=sys.stderr)
    journal = os.getenv('SZH_IMPORT_LOG')
    if not journal:
        return
    try:
        with open(journal, 'a', encoding='utf-8', newline='\n') as f:
            f.write(ligne + '\n')
    except OSError:
        pass                                  # un journal illisible ne casse pas la scission

def copier_medias_references(chemin_md: Path, dossier_source_medias: Path) -> tuple:
    """
    Complète, à côté d'un fichier markdown écrit à la main (une pièce liminaire, ou le
    texte de tête recueilli par lire_chapitre() et mis de côté par main()), les images et
    tableaux qu'il référence mais qui n'y sont pas encore — en les cherchant dans
    dossier_source_medias, le chapitre en cours de scission : c'est de là que vient le
    plus souvent ce texte recopié à la main (impressum-du-livre.md du B329 citait sept
    images sans avoir copié le media/ du manuscrit — voir docs/REPRISE-LIVRES.md, 31.08).

    Symétrique de la copie déjà faite pour les sections d'un chapitre : même forme de
    chemin relatif (« media/xxx.png »), même copier_ressource().

    Retourne (copiees, manquantes), deux listes de chemins relatifs.
    """
    with open(chemin_md, 'r', encoding='utf-8') as f:
        contenu = f.read()

    refs = extraire_references(contenu, dossier_source_medias)
    dossier_dest = chemin_md.parent
    copiees, manquantes = [], []

    for chemin_relatif in sorted(refs['images']) + sorted(refs['tables']):
        chemin_dst = dossier_dest / chemin_relatif
        if chemin_dst.exists():
            continue
        chemin_src = dossier_source_medias / chemin_relatif
        if copier_ressource(chemin_src, chemin_dst, chemin_relatif, chemin_md.name):
            copiees.append(chemin_relatif)
        else:
            manquantes.append(chemin_relatif)

    return copiees, manquantes

# --------------------------------------------------------------------------------------
# Écriture de buch.yaml
# --------------------------------------------------------------------------------------
def lire_ordre_existant(chemin_buch: str) -> list:
    """
    Lit la liste actuelle de « ordre-chapitres: » en texte brut — même lecture que le sed
    de pipeline/profils/livre.mk (ORDRE_LU), volontairement, pour ne jamais dire une chose
    différente de ce que le moteur de compilation va lire. Ne dépend PAS de PyYAML : sur la
    WSL de production, `yaml` est absent (voir l'import en tête de ce fichier). L'ancien
    code lisait buch.yaml avec PyYAML quand il était là et {} sinon, puis écrasait de toute
    façon ordre-chapitres avec les seuls slugs de CETTE scission — perdant tous les autres
    chapitres déjà listés (ceux d'une scission précédente, ou saisis à la main dans le
    cockpit) dès qu'un livre en avait plus d'un. fusionner_ordre() ci-dessous corrige ça ;
    encore faut-il d'abord lire ce qui existe, texte brut, jamais None ni {}.
    """
    if not os.path.exists(chemin_buch):
        return []
    motif = re.compile(r'^ordre-chapitres:\s*\[([^\]]*)\]')
    with open(chemin_buch, 'r', encoding='utf-8') as f:
        for ligne in f:
            m = motif.match(ligne)
            if not m:
                continue
            contenu = m.group(1).strip()
            if not contenu:
                return []
            return [s.strip().strip('\'"') for s in contenu.split(',') if s.strip()]
    return []

def fusionner_ordre(ordre_existant: list, slug_remplace: str, slugs_nouveaux: list) -> list:
    """
    Remplace, À SA PLACE, l'entrée `slug_remplace` (le manuscrit tel qu'il apparaissait
    avant scission, s'il y était) par les chapitres qui en sortent, dans l'ordre où ils
    sortent. Tout le reste d'ordre-chapitres — les chapitres d'une AUTRE scission, ceux
    réordonnés à la main dans le cockpit (« Monter d'un rang » / « Descendre d'un rang »,
    voir docs/REPRISE-LIVRES.md §2.1b) — traverse intact : c'est précisément ce que
    l'ancien code ne faisait pas, en réécrivant ordre-chapitres avec les seuls slugs de
    cette scission-ci, quel que soit ce que buch.yaml portait déjà.
    """
    if slug_remplace in ordre_existant:
        resultat = []
        for s in ordre_existant:
            if s == slug_remplace:
                resultat.extend(slugs_nouveaux)
            else:
                resultat.append(s)
        return resultat
    # Le manuscrit n'était pas encore nommé dans ordre-chapitres (livre qui n'en a pas
    # encore, ou chapitre resté à l'ordre alphabétique des dossiers) : les nouveaux
    # chapitres s'ajoutent à la suite de ce qui existe, rien n'est perdu.
    return ordre_existant + slugs_nouveaux

def ecrire_buch_yaml(chemin_buch: str, data: dict) -> None:
    """Écrit buch.yaml avec les conventions du projet."""
    if not os.path.exists(chemin_buch):
        return

    # Lire le fichier existant pour le modifier
    with open(chemin_buch, 'r', encoding='utf-8') as f:
        lignes = f.readlines()

    # Chercher et remplacer la ligne ordre-chapitres
    ordre_str = '[]'
    if 'ordre-chapitres' in data:
        # Format YAML simple
        slugs = ', '.join(f"'{slug}'" for slug in data['ordre-chapitres'])
        ordre_str = f'[{slugs}]'

    # Remplacer dans le contenu
    nouvelles_lignes = []
    for ligne in lignes:
        if ligne.startswith('ordre-chapitres:'):
            nouvelles_lignes.append(f'ordre-chapitres: {ordre_str}\n')
        else:
            nouvelles_lignes.append(ligne)

    # Écrire le fichier modifié
    with open(chemin_buch, 'w', encoding='utf-8') as f:
        f.writelines(nouvelles_lignes)

# --------------------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------------------
def main():
    if len(sys.argv) != 3:
        print("Usage: python3 livre-scinder.py <dossier du livre> <slug du chapitre>")
        sys.exit(1)

    dossier_livre = Path(sys.argv[1]).resolve()
    slug_original = sys.argv[2]

    # Vérifications préalables
    if not dossier_livre.is_dir():
        print(f"Erreur : {dossier_livre} n'est pas un dossier", file=sys.stderr)
        sys.exit(1)

    chemin_md = dossier_livre / 'chapitres' / slug_original / f'{slug_original}.md'
    if not chemin_md.exists():
        print(f"Erreur : {chemin_md} introuvable", file=sys.stderr)
        sys.exit(1)

    dossier_original = chemin_md.parent
    dossier_chapitres = dossier_livre / 'chapitres'
    dossier_buch = dossier_livre / 'buch.yaml'
    dossier_liminaires = dossier_livre / 'liminaires'

    # Lire le chapitre et le découper
    print(f"Lecture de {chemin_md}...", file=sys.stderr)
    liminaire_texte, sections = lire_chapitre(str(chemin_md))

    if not sections:
        avertir(
            'aucun-titre-niveau-1',
            ['chapitre « %s »' % slug_original],
            "Aucun titre de niveau 1 (« # ») n'a été trouvé dans « %s » : rien à scinder. "
            "Si ce fichier est bien un manuscrit à plusieurs chapitres, vérifiez que chaque "
            "titre de chapitre porte le style Word « Titre 1 » (chapitres-word/LISEZ-MOI.txt)."
            % chemin_md,
            'In « %s » wurde keine Überschrift 1. Ordnung (« # ») gefunden: nichts '
            'aufzuteilen. Handelt es sich tatsächlich um ein mehrkapitliges Manuskript, '
            'prüfen Sie, ob jeder Kapiteltitel den Word-Formatvorlagenstil « Titre 1 » '
            'trägt.' % chemin_md)
        sys.exit(1)

    print(f"Trouvé {len(sections)} chapitre(s) à créer", file=sys.stderr)

    # Vérifier que les dossiers de destination n'existent pas (sauf le premier qui est l'original)
    slugs_nouveaux = []
    for i, (titre, _) in enumerate(sections):
        slug = slugifier_chapitre(titre)
        # Désambiguïser les homonymes
        slug_final = slug
        compteur = 2
        while slug_final in slugs_nouveaux and slug_final != f"{slug}-{compteur}":
            slug_final = f"{slug}-{compteur}"
            compteur += 1
        slugs_nouveaux.append(slug_final)

        # Numéroter : 01, 02, ...
        num_chapitre = str(i + 1).zfill(2)
        slug_numerote = f"{num_chapitre}-{slug_final}"

        # Garde-fou d'IDEMPOTENCE : si l'import repasse sur un manuscrit déjà scindé — ou
        # si un autre chapitre porte déjà, par coïncidence, le nom qu'un des nouveaux
        # prendrait — on s'arrête ICI, avant de créer ou de supprimer quoi que ce soit.
        # dossier_original lui-même est exempté (c'est le cas normal d'une scission qui
        # renomme le dossier qu'elle scinde en son premier chapitre). Sans ce garde-fou,
        # un second passage sur le même manuscrit écraserait un chapitre déjà retravaillé
        # par la rédaction, ou un chapitre sans rapport portant le même nom.
        dossier_nouveau = dossier_chapitres / slug_numerote
        if dossier_nouveau.exists() and dossier_nouveau != dossier_original:
            avertir(
                'chapitre-cible-existe',
                ['manuscrit « %s »' % slug_original, 'dossier « %s »' % slug_numerote],
                "Le dossier « %s » existe déjà et n'est pas celui qu'on scinde : la "
                "scission de « %s » s'arrête ici, AVANT de rien créer ni supprimer. Ce "
                "manuscrit a-t-il déjà été scindé (relancer l'import ne doit pas dupliquer "
                "ses chapitres, ni écraser le travail déjà fait dedans) ? Si « %s » n'a "
                "aucun rapport avec ce manuscrit, c'est une coïncidence de nom : renommez "
                "l'un des deux."
                % (dossier_nouveau, slug_original, dossier_nouveau),
                'Der Ordner « %s » existiert bereits und ist nicht der aufzuteilende: Das '
                'Aufteilen von « %s » stoppt hier, BEVOR irgendetwas erstellt oder gelöscht '
                'wird. Wurde dieses Manuskript schon aufgeteilt (ein erneuter Import darf '
                'seine Kapitel nicht verdoppeln oder bereits geleistete Arbeit darin '
                'überschreiben)? Hat « %s » nichts mit diesem Manuskript zu tun, ist es ein '
                'Namenszufall: benennen Sie eines der beiden um.'
                % (dossier_nouveau, slug_original, dossier_nouveau))
            sys.exit(1)

    # Traiter chaque section
    dossiers_crees = []
    media_utilises = defaultdict(set)  # chaque image -> qui la référence
    tables_utilisees = defaultdict(set)
    # Toute ressource manquante ici interdit la suppression du chapitre d'origine : c'est
    # dossier_original qui est censé la fournir (import-medias.py y a renommé les figures),
    # donc une absence est suspecte et la détruire avant diagnostic est ce qui a rendu le
    # B329 indiagnosticable. Un manque signalé dans une pièce liminaire déjà existante n'a
    # pas cette garantie (le liminaire peut citer une image d'un tout autre chapitre, déjà
    # scindé depuis longtemps) : il se dit, mais ne bloque pas une scission sans rapport.
    ressources_manquantes = []
    liminaires_manquantes = []

    try:
        for i, (titre, contenu) in enumerate(sections):
            slug = slugifier_chapitre(titre)
            slug_final = slugs_nouveaux[i]
            num_chapitre = str(i + 1).zfill(2)
            slug_numerote = f"{num_chapitre}-{slug_final}"

            dossier_nouveau = dossier_chapitres / slug_numerote

            # Créer le dossier du nouveau chapitre
            dossier_nouveau.mkdir(parents=True, exist_ok=True)
            dossiers_crees.append((slug_numerote, titre))

            # Écrire le .md : on l'écrit AVEC le titre # (c'est le titre du chapitre)
            # Reconstruction du contenu : ajouter le titre # en début
            contenu_complet = f"# {titre}\n\n{contenu.strip()}\n"

            chemin_md_nouveau = dossier_nouveau / f"{slug_numerote}.md"
            with open(chemin_md_nouveau, 'w', encoding='utf-8') as f:
                f.write(contenu_complet)

            print(f"  Créé {slug_numerote}/{slug_numerote}.md", file=sys.stderr)

            # Extraire les ressources référencées — y compris les images que citent les
            # tableaux du chapitre, d'où le dossier d'origine en second argument.
            refs = extraire_references(contenu, dossier_original)

            # Copier les médias
            dossier_media_original = dossier_original / 'media'
            for img_path in refs['images']:
                media_utilises[img_path].add(slug_numerote)

                chemin_src = dossier_original / img_path
                chemin_dst = dossier_nouveau / img_path

                if not copier_ressource(chemin_src, chemin_dst, img_path, slug_numerote):
                    ressources_manquantes.append(('image', img_path, slug_numerote))
                    avertir(
                        'image-introuvable',
                        ['chapitre « %s »' % slug_numerote, 'image « %s »' % img_path],
                        "L'image « %s », référencée par le nouveau chapitre « %s », est "
                        "introuvable à l'endroit attendu (%s). Le chapitre ne reçoit que le "
                        "texte, pas l'image ; le dossier d'origine ne sera PAS supprimé : "
                        "diagnostiquez d'abord pourquoi elle manque."
                        % (img_path, slug_numerote, chemin_src),
                        'Das von Kapitel « %s » referenzierte Bild « %s » wurde an der '
                        'erwarteten Stelle (%s) nicht gefunden. Das Kapitel erhält nur den '
                        'Text, nicht das Bild; der Ursprungsordner wird NICHT gelöscht: '
                        'zuerst klären, warum es fehlt.' % (slug_numerote, img_path, chemin_src))

            # Copier les tableaux
            for table_path in refs['tables']:
                tables_utilisees[table_path].add(slug_numerote)

                chemin_src = dossier_original / table_path
                chemin_dst = dossier_nouveau / table_path

                if not copier_ressource(chemin_src, chemin_dst, table_path, slug_numerote):
                    ressources_manquantes.append(('tableau', table_path, slug_numerote))
                    avertir(
                        'tableau-introuvable',
                        ['chapitre « %s »' % slug_numerote, 'tableau « %s »' % table_path],
                        "Le tableau « %s », référencé par le nouveau chapitre « %s », est "
                        "introuvable à l'endroit attendu (%s). Le dossier d'origine ne sera "
                        "PAS supprimé : diagnostiquez d'abord pourquoi il manque."
                        % (table_path, slug_numerote, chemin_src),
                        'Die von Kapitel « %s » referenzierte Tabelle « %s » wurde an der '
                        'erwarteten Stelle (%s) nicht gefunden. Der Ursprungsordner wird '
                        'NICHT gelöscht: zuerst klären, warum sie fehlt.'
                        % (slug_numerote, table_path, chemin_src))

        # Le texte de tête (avant le premier titre de niveau 1) n'entre dans AUCUN des
        # nouveaux chapitres : lire_chapitre() le sépare, mais rien ne l'écrivait plus
        # loin — jeté en silence par l'ancien main(). C'est ainsi qu'impressum-du-livre.md
        # a vu le jour : quelqu'un l'a retrouvé en lisant le .md source, recopié à la main
        # dans liminaires/, syntaxe d'image comprise, sans le media/ qui va avec (voir
        # docs/REPRISE-LIVRES.md, 31.08). On ne l'écrit PAS nous-même dans liminaires/ :
        # les pièces liminaires sont éditoriales et écrites à la main (livre.mk:88), et un
        # fichier posé là sans revue se ferait passer pour l'une d'elles à la prochaine
        # compilation. On le met de côté, on le dit, et on lui évite de perdre ses images
        # si jamais quelqu'un le recopie ensuite dans liminaires/ comme pour le B329.
        if liminaire_texte.strip():
            chemin_rescape = dossier_chapitres / f'_scission-{slug_original}-liminaire-non-repris.md'
            with open(chemin_rescape, 'w', encoding='utf-8') as f:
                f.write(liminaire_texte.strip() + '\n')

            refs_liminaire = extraire_references(liminaire_texte, dossier_original)
            images_citees = sorted(refs_liminaire['images'])
            copiees_rescape, manquantes_rescape = copier_medias_references(
                chemin_rescape, dossier_original)
            for chemin_relatif in copiees_rescape:
                media_utilises[chemin_relatif].add('liminaire-non-repris')
                print(f"  Média mis de côté avec le texte non repris : {chemin_relatif}",
                      file=sys.stderr)

            avertir(
                'liminaire-texte-non-repris',
                ['chapitre « %s »' % slug_original,
                 'lignes %d' % len(liminaire_texte.splitlines())]
                + (['images citées %d' % len(images_citees)] if images_citees else []),
                "Le document portait du texte avant son premier titre de niveau 1 (%d "
                "ligne(s)) : il n'entre dans aucun des nouveaux chapitres et ne "
                "s'imprimera nulle part. Il a été mis de côté dans %s%s. Les pièces "
                "liminaires (préface, impressum…) s'écrivent à la main dans %s : si ce "
                "texte doit y figurer, recopiez-le vous-même."
                % (len(liminaire_texte.splitlines()), chemin_rescape,
                   (" (avec %d image(s) déjà retrouvée(s) à côté)" % len(copiees_rescape))
                   if copiees_rescape else '', dossier_liminaires),
                'Das Dokument enthielt Text vor seiner ersten Überschrift 1. Ordnung (%d '
                'Zeile(n)): er fliesst in keines der neuen Kapitel ein und wird nirgends '
                'gedruckt. Er wurde in %s abgelegt. Liminarien (Vorwort, Impressum…) '
                'werden von Hand in %s geschrieben: falls dieser Text dorthin gehört, '
                'übertragen Sie ihn selbst.'
                % (len(liminaire_texte.splitlines()), chemin_rescape, dossier_liminaires))

            for chemin_relatif in manquantes_rescape:
                ressources_manquantes.append(('liminaire-non-repris', chemin_relatif, slug_original))
                avertir(
                    'liminaire-texte-media-introuvable',
                    ['chapitre « %s »' % slug_original, 'média « %s »' % chemin_relatif],
                    "Le texte de tête mis de côté (%s) cite « %s », introuvable dans le "
                    "chapitre d'origine. Le dossier d'origine ne sera PAS supprimé : "
                    "retrouvez ce média avant de le recopier à la main dans une pièce "
                    "liminaire." % (chemin_rescape, chemin_relatif),
                    'Der beiseitegelegte Kopftext (%s) nennt « %s », im Ursprungskapitel '
                    'nicht gefunden. Der Ursprungsordner wird NICHT gelöscht: dieses '
                    'Medium zuerst wiederfinden.' % (chemin_rescape, chemin_relatif))

        # La chaîne alimente déjà media/ pour les chapitres ; elle ne le faisait pour
        # aucune pièce liminaire (« grep liminaires/media » sur tout pipeline/ ne rendait
        # rien avant ce correctif), alors qu'une pièce liminaire suit la même convention de
        # chemin relatif. On comble donc, depuis le chapitre en cours de scission, ce qui
        # manque à côté de chaque liminaire déjà écrite à la main — sans jamais créer ou
        # modifier le texte d'une liminaire, seulement ses médias.
        if dossier_liminaires.is_dir():
            for chemin_liminaire in sorted(dossier_liminaires.glob('*.md')):
                copiees_lim, manquantes_lim = copier_medias_references(
                    chemin_liminaire, dossier_original)
                for chemin_relatif in copiees_lim:
                    media_utilises[chemin_relatif].add('liminaire:' + chemin_liminaire.name)
                    print(f"  Média copié pour {chemin_liminaire.name} : {chemin_relatif}",
                          file=sys.stderr)
                for chemin_relatif in manquantes_lim:
                    liminaires_manquantes.append((chemin_liminaire.name, chemin_relatif))
                    avertir(
                        'liminaire-media-introuvable',
                        ['liminaire « %s »' % chemin_liminaire.name,
                         'média « %s »' % chemin_relatif],
                        "La pièce liminaire « %s » cite « %s », introuvable aussi bien à "
                        "côté d'elle que dans le chapitre « %s » en cours de scission. Les "
                        "pièces liminaires s'écrivent à la main : déposez ce média "
                        "vous-même dans %s." % (chemin_liminaire.name, chemin_relatif,
                                                 slug_original, dossier_liminaires),
                        'Die Liminarie « %s » nennt « %s », weder neben ihr noch im gerade '
                        'aufgeteilten Kapitel « %s » gefunden. Liminarien werden von Hand '
                        'geschrieben: legen Sie dieses Medium selbst in %s ab.'
                        % (chemin_liminaire.name, chemin_relatif, slug_original,
                           dossier_liminaires))

        # Signaler les ressources orphelines
        if dossier_media_original.exists():
            for fichier_media in dossier_media_original.rglob('*'):
                if fichier_media.is_file():
                    chemin_relatif = fichier_media.relative_to(dossier_original)
                    chemin_relatif_str = str(chemin_relatif).replace('\\', '/')

                    if chemin_relatif_str not in media_utilises:
                        print(f"  ⚠ Image orpheline : {chemin_relatif_str}", file=sys.stderr)

        dossier_tables_original = dossier_original / 'tables'
        if dossier_tables_original.exists():
            for fichier_table in dossier_tables_original.rglob('*.html'):
                chemin_relatif = fichier_table.relative_to(dossier_original)
                chemin_relatif_str = str(chemin_relatif).replace('\\', '/')

                if chemin_relatif_str not in tables_utilisees:
                    print(f"  ⚠ Tableau orphelin : {chemin_relatif_str}", file=sys.stderr)

        # Mettre à jour buch.yaml avec ordre-chapitres — FUSIONNÉ, pas écrasé : voir
        # fusionner_ordre() ci-dessus pour ce que ça corrige.
        slugs_numerotes = [f"{i+1:02d}-{slugs_nouveaux[i]}" for i in range(len(sections))]
        ordre_existant = lire_ordre_existant(str(dossier_buch))
        nouvel_ordre = fusionner_ordre(ordre_existant, slug_original, slugs_numerotes)

        print(f"Écriture de buch.yaml avec ordre-chapitres...", file=sys.stderr)
        ecrire_buch_yaml(str(dossier_buch), {'ordre-chapitres': nouvel_ordre})

        # Supprimer le chapitre d'origine — seulement si TOUT ce qu'il devait fournir a pu
        # être copié. C'est le correctif du 31.08 : une copie qui échoue interdit désormais
        # la destruction de la source, quelle que soit la ressource en cause (image ou
        # tableau d'une section, ou média d'un texte de tête mis de côté ci-dessus). Un
        # dossier orphelin à nettoyer à la main coûte moins cher qu'un média disparu sans
        # trace, et c'est la disparition de cette trace qui a rendu le B329 indiagnosticable.
        if ressources_manquantes:
            avertir(
                'source-non-supprimee',
                ['chapitre « %s »' % slug_original,
                 'ressources manquantes %d' % len(ressources_manquantes)],
                "%d ressource(s) sont restées introuvables pendant la scission de « %s » "
                "(voir les avertissements ci-dessus). Le dossier d'origine « %s » n'a PAS "
                "été supprimé : il reste sur le disque, EN PLUS des nouveaux chapitres, et "
                "sera compilé deux fois si vous ne le retirez pas vous-même une fois les "
                "ressources retrouvées et recopiées à la main."
                % (len(ressources_manquantes), slug_original, dossier_original),
                '%d Ressource(n) blieben beim Aufteilen von « %s » unauffindbar (siehe '
                'Warnungen oben). Der Ursprungsordner « %s » wurde NICHT gelöscht: er '
                'bleibt ZUSÄTZLICH zu den neuen Kapiteln auf der Platte und wird doppelt '
                'kompiliert, wenn Sie ihn nicht selbst entfernen, sobald die fehlenden '
                'Ressourcen wiedergefunden und von Hand übertragen wurden.'
                % (len(ressources_manquantes), slug_original, dossier_original))
            print(f"  Scission incomplète : {dossier_original} conservé.", file=sys.stderr)
        else:
            print(f"Suppression de {dossier_original}...", file=sys.stderr)
            shutil.rmtree(dossier_original)

        print(f"Succès : {len(sections)} chapitre(s) créé(s)", file=sys.stderr)
        for slug_num, titre in dossiers_crees:
            print(f"  {slug_num}: {titre}", file=sys.stderr)

    except Exception as e:
        print(f"Erreur lors de la scission : {e}", file=sys.stderr)
        # Ne pas nettoyer les dossiers partiellement créés pour éviter la perte de données
        # mais le signaler
        print(f"Les dossiers partiellement créés ne sont PAS supprimés par sécurité", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)

    # Échec franc si des ressources manquent, même si la scission elle-même n'a levé
    # aucune exception. La cible `import` de pipeline/Makefile EST désormais ce lanceur
    # (elle ne l'était pas quand ce paragraphe a été écrit le 31.08 — voir git blame) : elle
    # teste ce code de sortie et compte le manuscrit comme une scission incomplète, sans
    # pour autant effacer quoi que ce soit ni faire disparaître les chapitres déjà écrits.
    # Sortir non nul ici ne casse donc PAS l'automatisation, il la renseigne : c'est ce qui
    # permet de ne pas choisir entre « échouer » et « conserver la source en le disant » :
    # les deux à la fois. Les chapitres et buch.yaml restent écrits (rien d'utile n'est
    # perdu), le dossier d'origine reste sur le disque (ci-dessus), et le code de sortie
    # interdit qu'on lise ce résultat comme un succès.
    if ressources_manquantes:
        sys.exit(1)

if __name__ == '__main__':
    main()
