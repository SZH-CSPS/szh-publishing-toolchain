#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Découpe un chapitre importé d'un docx en autant de chapitres qu'il a de titres de
niveau 1, avec les mêmes règles de slug que le reste de la chaîne.

Appel : python3 livre-scinder.py <dossier du livre> <slug du chapitre à scinder>

La cible `import` du Makefile l'appelle juste après la conversion d'un .docx de
chapitres-word/, si le .md produit a au moins deux titres de niveau 1 (un seul est le
titre du chapitre). Voir aussi chapitres-word/LISEZ-MOI.txt.

Les nouveaux chapitres reçoivent leurs images et tableaux. Si une ressource manque, le
chapitre d'origine est conservé et le code de sortie vaut 1.
"""

import sys
import os
import re
import shutil
from pathlib import Path
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import szh_commun


def _charger_migreur():
    """Charge livre-migrer-meta.py (nom à tiret, pas d'import ordinaire)."""
    import importlib.util
    chemin = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'livre-migrer-meta.py')
    spec = importlib.util.spec_from_file_location('livre_migrer_meta', chemin)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


migrer_meta = _charger_migreur()

# Pas de PyYAML dans l'image : buch.yaml se lit comme texte (lire_ordre_existant()).

# --------------------------------------------------------------------------------------
# Slugs : szh_commun.slugifier() reproduit celle de la cible `import` du Makefile ;
# slugifier_chapitre() y ajoute la limite de longueur des chapitres.
# --------------------------------------------------------------------------------------
slugifier = szh_commun.slugifier
slugifier_chapitre = szh_commun.slugifier_chapitre

# --------------------------------------------------------------------------------------
# Lecture et découpe du chapitre
# --------------------------------------------------------------------------------------
def lire_chapitre(chemin_md: str) -> tuple[str, list[tuple[str, str]]]:
    """
    Lit le chapitre et le découpe aux titres de niveau 1.
    Rend (texte avant le premier titre, [(titre, contenu), ...]).
    """
    with open(chemin_md, 'r', encoding='utf-8') as f:
        texte = f.read()

    # « # titre » : un seul #, suivi d'une espace
    pattern = r'^#\s+(.+)$'
    # Dans un bloc de code (```…```), un « # commentaire » n'est pas un titre.
    cloture = re.compile(r'^\s*```')

    sections = []
    liminaire = []
    dans_liminaire = True
    dans_bloc_code = False
    lignes = texte.split('\n')
    section_actuelle_titre = None
    section_actuelle_contenu = []

    for ligne in lignes:
        if cloture.match(ligne):
            dans_bloc_code = not dans_bloc_code
            match = None
        elif dans_bloc_code:
            match = None
        else:
            match = re.match(pattern, ligne)
        if match:
            titre = match.group(1).strip()

            if section_actuelle_titre is not None:
                contenu = '\n'.join(section_actuelle_contenu)
                sections.append((section_actuelle_titre, contenu))

            dans_liminaire = False
            section_actuelle_titre = titre
            section_actuelle_contenu = []
        else:
            if section_actuelle_titre is not None:
                section_actuelle_contenu.append(ligne)
            else:
                liminaire.append(ligne)

    if section_actuelle_titre is not None:
        contenu = '\n'.join(section_actuelle_contenu)
        sections.append((section_actuelle_titre, contenu))

    # Lignes vides retirées au début et à la fin du texte de tête
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
    Références aux médias et tableaux d'un texte markdown :
    {'images': {...}, 'tables': {...}}, en chemins relatifs.

    Avec `dossier_source` (le dossier du chapitre d'origine), on lit aussi les tableaux
    cités, pour y trouver leurs images : docx-tables.py écrit des <img src="media/…"> dans
    tables/table-NN.html, absents du .md (même règle que fichiers_de_texte()
    d'import-medias.py).

    Deux formes d'image : `![](media/x.png)`, et du HTML brut
    (`<figure><img src="./media/x.png" …></figure>`) pour une image avec texte alternatif
    que le writer markdown ne sait pas exprimer. Les deux peuvent avoir un préfixe « ./ ».
    """
    references = {'images': set(), 'tables': set()}

    # Images en markdown : ![...](media/xxx) ou ![...](./media/xxx.png)
    for match in re.finditer(r'!\[.*?\]\((?:\./)?(media/[^)\s]+)', contenu):
        references['images'].add(match.group(1))

    # Images en HTML brut : <img src="media/xxx"> ou <img src="./media/xxx">, seule ou
    # dans un <figure>.
    for match in re.finditer(r'<img\s[^>]*?src=["\'](?:\./)?(media/[^"\']+)["\']', contenu):
        references['images'].add(match.group(1))

    # Tableaux : ::: {.szh-tabelle src="tables/table-NN.html"}
    for match in re.finditer(r'::: \{\.szh-tabelle src="(tables/[^"]+)"\}', contenu):
        references['tables'].add(match.group(1))

    # Puis les images citées dans ces tableaux. Un tableau absent est signalé à sa copie.
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
    Copie une ressource (image ou tableau), en remplaçant la destination. Rend False si
    la source n'existe pas.
    """
    if not src.exists():
        return False

    dst.parent.mkdir(parents=True, exist_ok=True)

    if src.is_file():
        shutil.copy2(src, dst)
    else:
        # Dossier (rare)
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(src, dst)

    return True

# --------------------------------------------------------------------------------------
# Avertissements, même forme que docx-meta.py, docx-tables.py et reimporter.py : un code
# stable, des champs, une phrase en français puis en allemand, sur stderr et dans
# $SZH_IMPORT_LOG s'il est posé. Un outil de suivi cherche le code.
# --------------------------------------------------------------------------------------
PREFIXE_AVERT = '[scission-avertissement]'

def avertir(code: str, champs: list, fr: str, de: str) -> None:
    szh_commun.avertir(PREFIXE_AVERT, code, champs, fr, de)

def copier_medias_references(chemin_md: Path, dossier_source_medias: Path) -> tuple:
    """
    Copie à côté d'un fichier markdown (pièce liminaire, ou texte de tête mis de côté par
    main()) les images et tableaux qu'il cite et qui manquent, en les prenant dans
    dossier_source_medias, le chapitre en cours de découpe. Un texte recopié à la main
    depuis le manuscrit cite souvent ses images sans les avoir.

    Rend (copiees, manquantes), deux listes de chemins relatifs.
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
    Liste actuelle de « ordre-chapitres: », lue comme texte, dans les deux formes que lit
    aussi la compilation (szh-lire-config.lua) : en ligne « [a, b] » (écrite par
    serialiserAusgabe(), seule forme qu'ecrire_buch_yaml() réécrit) et en bloc, un
    « - slug » par ligne au bord gauche (saisie à la main). [] si absente.
    """
    if not os.path.exists(chemin_buch):
        return []
    motif_ligne = re.compile(r'^ordre-chapitres:\s*\[([^\]]*)\]')
    motif_bloc = re.compile(r'^ordre-chapitres:\s*$')
    motif_item = re.compile(r'^-\s*(.*)$')
    with open(chemin_buch, 'r', encoding='utf-8') as f:
        lignes = f.readlines()
    for i, ligne in enumerate(lignes):
        m = motif_ligne.match(ligne)
        if m:
            contenu = m.group(1).strip()
            if not contenu:
                return []
            return [s.strip().strip('\'"') for s in contenu.split(',') if s.strip()]
        if motif_bloc.match(ligne):
            items = []
            for suivante in lignes[i + 1:]:
                if not suivante.strip() or suivante.lstrip().startswith('#'):
                    continue
                m_item = motif_item.match(suivante)
                if not m_item:
                    break
                items.append(m_item.group(1).strip().strip('\'"'))
            return items
    return []

def fusionner_ordre(ordre_existant: list, slug_remplace: str, slugs_nouveaux: list) -> list:
    """
    Remplace sur place l'entrée `slug_remplace` (le manuscrit découpé) par les nouveaux
    chapitres, dans leur ordre. Le reste d'ordre-chapitres (autres découpes, ordre réglé
    dans le cockpit) est gardé tel quel.
    """
    if slug_remplace in ordre_existant:
        resultat = []
        for s in ordre_existant:
            if s == slug_remplace:
                resultat.extend(slugs_nouveaux)
            else:
                resultat.append(s)
        return resultat
    # Manuscrit absent d'ordre-chapitres : les nouveaux chapitres s'ajoutent à la fin.
    return ordre_existant + slugs_nouveaux

def ecrire_buch_yaml(chemin_buch: str, data: dict) -> None:
    """Réécrit la ligne `ordre-chapitres:` de buch.yaml (s'il existe), en forme
    « ['a', 'b'] », en gardant le reste du fichier et ses fins de ligne."""
    if not os.path.exists(chemin_buch):
        return

    # newline='' : les fins de ligne (CRLF compris) sont lues telles quelles.
    with open(chemin_buch, 'r', encoding='utf-8', newline='') as f:
        lignes = f.readlines()

    ordre_str = '[]'
    if 'ordre-chapitres' in data:
        slugs = ', '.join(f"'{slug}'" for slug in data['ordre-chapitres'])
        ordre_str = f'[{slugs}]'

    # Même fin de ligne que le fichier.
    fin_ligne = '\r\n' if '\r\n' in ''.join(lignes) else '\n'

    trouve = False
    nouvelles_lignes = []
    for ligne in lignes:
        if ligne.startswith('ordre-chapitres:'):
            nouvelles_lignes.append(f'ordre-chapitres: {ordre_str}{fin_ligne}')
            trouve = True
        else:
            nouvelles_lignes.append(ligne)

    # Clé absente : ajoutée en fin de fichier.
    if not trouve:
        if nouvelles_lignes and not nouvelles_lignes[-1].endswith(('\n', '\r')):
            nouvelles_lignes[-1] += fin_ligne
        derniere_vide = bool(nouvelles_lignes) and nouvelles_lignes[-1].strip('\r\n') == ''
        if nouvelles_lignes and not derniere_vide:
            nouvelles_lignes.append(fin_ligne)
        nouvelles_lignes.append(f'ordre-chapitres: {ordre_str}{fin_ligne}')

    # Par un temporaire du même dossier : le fichier n'est jamais visible à moitié écrit.
    szh_commun.ecrire_atomique(
        os.path.abspath(chemin_buch), lambda f: f.writelines(nouvelles_lignes),
        binaire=False, encoding='utf-8', newline='')

# --------------------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------------------
def main():
    try:  # console Windows en cp1252 : un accent combinant y ferait planter print().
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass
    if len(sys.argv) != 3:
        print("Usage: python3 livre-scinder.py <dossier du livre> <slug du chapitre>")
        sys.exit(1)

    dossier_livre = Path(sys.argv[1]).resolve()
    slug_original = sys.argv[2]

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
    langue_livre = str(szh_commun.lire_yaml(str(dossier_buch)).get('lang') or 'fr').strip().lower()[:2]

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

    # Slugs des nouveaux chapitres, et contrôle que leurs dossiers n'existent pas encore.
    slugs_nouveaux = []
    for i, (titre, _) in enumerate(sections):
        slug = slugifier_chapitre(titre)
        # Titres identiques : suffixe -2, -3…
        slug_final = slug
        compteur = 2
        while slug_final in slugs_nouveaux and slug_final != f"{slug}-{compteur}":
            slug_final = f"{slug}-{compteur}"
            compteur += 1
        slugs_nouveaux.append(slug_final)

        num_chapitre = str(i + 1).zfill(2)
        slug_numerote = f"{num_chapitre}-{slug_final}"

        # Un dossier de destination existe déjà (manuscrit déjà découpé, ou homonyme) : on
        # s'arrête avant de créer ou supprimer quoi que ce soit, pour ne pas écraser un
        # chapitre retravaillé. Le dossier découpé lui-même est admis.
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

    dossiers_crees = []
    media_utilises = defaultdict(set)  # image -> qui la cite
    tables_utilisees = defaultdict(set)
    # Une ressource manquante des nouveaux chapitres empêche de supprimer le chapitre
    # d'origine, qui devait la fournir : on garde de quoi comprendre. Un manque dans une
    # pièce liminaire existante (qui peut citer l'image d'un autre chapitre) est seulement
    # signalé.
    ressources_manquantes = []
    liminaires_manquantes = []

    try:
        for i, (titre, contenu) in enumerate(sections):
            slug = slugifier_chapitre(titre)
            slug_final = slugs_nouveaux[i]
            num_chapitre = str(i + 1).zfill(2)
            slug_numerote = f"{num_chapitre}-{slug_final}"

            dossier_nouveau = dossier_chapitres / slug_numerote

            dossier_nouveau.mkdir(parents=True, exist_ok=True)
            dossiers_crees.append((slug_numerote, titre))

            # Le titre va dans la fiche (title.<lang>), puis livre-migrer-meta.py y range
            # la ligne d'auteurs. Si la fiche refuse le titre, il reste dans le .md (la
            # compilation lit les deux).
            chemin_fiche_nouveau = dossier_nouveau / f"{slug_numerote}.meta.yaml"
            titre_en_fiche = migrer_meta.ecrire_titre_fiche(
                str(chemin_fiche_nouveau), langue_livre, titre)
            contenu_complet = (f"{contenu.strip()}\n" if titre_en_fiche
                               else f"# {titre}\n\n{contenu.strip()}\n")

            chemin_md_nouveau = dossier_nouveau / f"{slug_numerote}.md"
            with open(chemin_md_nouveau, 'w', encoding='utf-8') as f:
                f.write(contenu_complet)

            for ligne_rapport in migrer_meta.migrer_chapitre(
                    str(dossier_livre), slug_numerote, langue_livre):
                print(f"  {ligne_rapport}", file=sys.stderr)

            print(f"  Créé {slug_numerote}/{slug_numerote}.md", file=sys.stderr)

            # Ressources citées, y compris les images des tableaux.
            refs = extraire_references(contenu, dossier_original)

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

        # Le texte avant le premier titre de niveau 1 n'entre dans aucun chapitre. Il est
        # mis de côté dans chapitres/_scission-<slug>-liminaire-non-repris.md avec ses
        # images, et signalé. Il n'est pas écrit dans liminaires/ : les pièces liminaires
        # s'écrivent à la main, et un fichier posé là serait compilé.
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

        # Pièces liminaires existantes : les médias qu'elles citent et qui manquent sont
        # copiés depuis le chapitre découpé. Leur texte n'est pas modifié.
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

        # Ressources que personne ne cite
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

        # ordre-chapitres de buch.yaml, fusionné (fusionner_ordre()).
        slugs_numerotes = [f"{i+1:02d}-{slugs_nouveaux[i]}" for i in range(len(sections))]
        ordre_existant = lire_ordre_existant(str(dossier_buch))
        nouvel_ordre = fusionner_ordre(ordre_existant, slug_original, slugs_numerotes)

        print(f"Écriture de buch.yaml avec ordre-chapitres...", file=sys.stderr)
        ecrire_buch_yaml(str(dossier_buch), {'ordre-chapitres': nouvel_ordre})

        # Le chapitre d'origine n'est supprimé que si toutes ses ressources ont été copiées.
        # Sinon il reste (à retirer à la main) : un dossier en trop vaut mieux qu'un média
        # disparu sans trace.
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
        # Les dossiers déjà créés sont gardés, et le chapitre d'origine aussi (sa
        # suppression vient en fin de bloc) : le livre les compile tous jusqu'à ce qu'on
        # retire les uns ou l'autre. On le dit.
        print("Les dossiers déjà créés ET le manuscrit d'origine restent tous deux sur le "
              "disque : ce sont désormais, les uns comme l'autre, des chapitres valides, et "
              "le livre sortira en double tant que l'un des deux n'est pas retiré à la main.",
              file=sys.stderr)
        print("[de] Die bereits erstellten Ordner UND das Ursprungsmanuskript bleiben beide "
              "auf der Platte: beide sind jetzt gültige Kapitel, und das Buch erscheint "
              "doppelt, solange nicht eines der beiden von Hand entfernt wird.",
              file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)

    # Ressources manquantes : code 1, que la cible `import` compte comme découpe
    # incomplète. Les chapitres et buch.yaml restent écrits, le dossier d'origine reste.
    if ressources_manquantes:
        sys.exit(1)

if __name__ == '__main__':
    main()
