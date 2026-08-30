#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Scinde un chapitre importé d'un docx en autant de chapitres qu'il porte de titres
de niveau 1. Reproduit exactement les règles de slug du reste de la chaîne.

Appel : python3 livre-scinder.py <dossier du livre> <slug du chapitre à scinder>
"""

import sys
import os
import re
import shutil
import unicodedata
from pathlib import Path
from collections import defaultdict

# Pas d'import yaml - la WSL n'a que la stdlib. Parseur YAML simple pour ce qu'on en a besoin.
try:
    import yaml
except ImportError:
    yaml = None

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
def extraire_references(contenu: str) -> dict:
    """
    Extrait les références aux médias et tableaux du contenu markdown.
    Retourne {'images': [...], 'tables': [...]} avec les chemins.
    """
    references = {'images': set(), 'tables': set()}

    # Images : ![...](media/xxx) ou ![...](media/xxx.png)
    for match in re.finditer(r'!\[.*?\]\((media/[^)]+)\)', contenu):
        references['images'].add(match.group(1))

    # Tableaux : ::: {.szh-tabelle src="tables/table-NN.html"}
    for match in re.finditer(r'::: \{\.szh-tabelle src="(tables/[^"]+)"\}', contenu):
        references['tables'].add(match.group(1))

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
# Écriture de buch.yaml
# --------------------------------------------------------------------------------------
def lire_buch_yaml(chemin_buch: str) -> dict:
    """Lit buch.yaml et retourne le dictionnaire (parseur simple)."""
    if not os.path.exists(chemin_buch):
        return {}

    if yaml:
        with open(chemin_buch, 'r', encoding='utf-8') as f:
            return yaml.safe_load(f) or {}

    # Parseur très simple sans dépendance externe
    with open(chemin_buch, 'r', encoding='utf-8') as f:
        content = f.read()
    return {}  # Retourner dict vide - on lira/écrira le fichier tel quel

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

    # Lire le chapitre et le découper
    print(f"Lecture de {chemin_md}...", file=sys.stderr)
    liminaire_texte, sections = lire_chapitre(str(chemin_md))

    if not sections:
        print("Erreur : aucun titre de niveau 1 trouvé dans le chapitre", file=sys.stderr)
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

        dossier_nouveau = dossier_chapitres / slug_numerote
        if dossier_nouveau.exists() and dossier_nouveau != dossier_original:
            print(f"Erreur : le dossier {dossier_nouveau} existe déjà", file=sys.stderr)
            sys.exit(1)

    # Traiter chaque section
    dossiers_crees = []
    media_utilises = defaultdict(set)  # chaque image -> qui la référence
    tables_utilisees = defaultdict(set)

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

            # Extraire les ressources référencées
            refs = extraire_references(contenu)

            # Copier les médias
            dossier_media_original = dossier_original / 'media'
            for img_path in refs['images']:
                media_utilises[img_path].add(slug_numerote)

                chemin_src = dossier_original / img_path
                chemin_dst = dossier_nouveau / img_path

                if not copier_ressource(chemin_src, chemin_dst, img_path, slug_numerote):
                    print(f"  ⚠ Image introuvable : {img_path} (référencée par {slug_numerote})",
                          file=sys.stderr)

            # Copier les tableaux
            for table_path in refs['tables']:
                tables_utilisees[table_path].add(slug_numerote)

                chemin_src = dossier_original / table_path
                chemin_dst = dossier_nouveau / table_path

                if not copier_ressource(chemin_src, chemin_dst, table_path, slug_numerote):
                    print(f"  ⚠ Tableau introuvable : {table_path} (référencé par {slug_numerote})",
                          file=sys.stderr)

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

        # Mettre à jour buch.yaml avec ordre-chapitres
        buch_data = lire_buch_yaml(str(dossier_buch))
        slugs_numerotes = [f"{i+1:02d}-{slugs_nouveaux[i]}" for i in range(len(sections))]
        buch_data['ordre-chapitres'] = slugs_numerotes

        print(f"Écriture de buch.yaml avec ordre-chapitres...", file=sys.stderr)
        ecrire_buch_yaml(str(dossier_buch), buch_data)

        # Supprimer le chapitre d'origine (seulement si on a réussi à ce point)
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

if __name__ == '__main__':
    main()
