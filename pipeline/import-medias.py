#!/usr/bin/env python3
# import-medias.py — dernier maillon de l'import d'un Word : range les photos des autrices
# et auteurs, puis purge les images que le texte n'utilise pas.
#
#   python3 import-medias.py <slug> <dossier-article> [<fichier-photos>]
#
# 1. Photos. docx-meta.py apparie chaque auteur·e du tableau de fin de document à l'image
#    de sa cellule (ou de la cellule voisine) et écrit ici ce qu'il a compris, une
#    instruction par ligne :
#      A<TAB><slug-auteur><TAB><nom dans media/>  photo appariée
#      G<TAB><nom dans media/>                    photo reconnue, non appariée
#    Une photo appariée quitte media/ pour portraits/<slug-auteur>.original.<ext>, puis
#    pipeline/portraits.py recadre le visage et détoure le fond — exactement ce que fait un
#    dépôt dans le formulaire des auteur·e·s du cockpit. Quand il réussit, le champ `photo`
#    du meta.yaml passe de .original.<ext> à .sans-fond.png, la version que ce formulaire
#    propose par défaut ; sinon il continue de désigner l'original, qui existe. Sans
#    interprète de portraits (hors rootfs WSL), les photos sont quand même rangées : rien
#    n'est perdu, le détourage se refait au dépôt.
#    Quand le déplacement ne peut pas avoir lieu — fichier absent de media/, ou image que le
#    corps de l'article utilise aussi — le champ `photo` est retiré du meta.yaml plutôt que
#    de désigner un fichier qui n'existera pas : un chemin mort casse la composition.
#
# 2. Purge. Word livre tout ce que le document embarque — logos d'en-tête, filigranes,
#    portraits — et pandoc extrait tout sous media/. Ce qu'aucune insertion du .md ni aucun
#    <img src="media/…"> de tables/*.html ne cite n'a nulle part où être légendé ni rendu :
#    ces fichiers sont supprimés. Trois garde-fous, la suppression étant définitive (le
#    Makefile efface le .docx source dès l'import réussi) :
#      - le test est volontairement grossier, une recherche du nom de fichier dans le
#        texte : il peut garder une image de trop, jamais en supprimer une qui sert ;
#      - toute image que docx-meta.py a reconnue comme photo d'auteur est protégée, même
#        s'il n'a pas su à qui l'attribuer — le tableau des auteurs quittant le corps, ces
#        images ne sont plus citées nulle part ;
#      - sans texte de référence lisible (pas de .md, ou .md vide), la purge ne fait rien :
#        « je ne sais pas ce qui sert » ne doit pas valoir « rien ne sert ».
#    Seuls les fichiers image sont candidats — media/<slug>.bib reste.
#
# Sortie : une ligne JSON de stats sur stdout, messages sur stderr. Code retour 0 même si
# le détourage échoue : l'import ne doit pas tomber pour une photo.
#
# stdlib uniquement, comme les autres pré-passes : pas de PyYAML dans la WSL.

import glob
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.parse

# Fichiers candidats à la purge. Tout ce que Word peut embarquer comme image, y compris les
# métafichiers Windows que pandoc extrait sans savoir les rendre.
EXTENSIONS_IMAGE = ('.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp',
                    '.tif', '.tiff', '.emf', '.wmf')

# Interprète du venv de portraits dans le rootfs WSL, comme lib/portraits.js. La variable
# d'environnement sert aux tests hors rootfs.
INTERPRETE_PORTRAITS = os.environ.get('SZH_PORTRAITS_PYTHON', '/opt/portraits/bin/python')


def progression(message):
    print(message, file=sys.stderr, flush=True)


# ---------------------------------------------------------------------------------
# Texte de référence : ce qui décide de ce qui sert

def texte_de_reference(dossier, slug):
    """Le .md et les tableaux extraits, concaténés en minuscules : c'est là que se lit ce
    qui sert. Les tableaux comptent, docx-tables.py y écrivant des <img src="media/…">.
    Rend None si le .md manque ou est vide — cas où l'on ne purge rien."""
    md = os.path.join(dossier, slug + '.md')
    try:
        with open(md, encoding='utf-8', errors='replace') as f:
            corps = f.read()
    except OSError as exc:
        progression('[import-medias] %s illisible (%s) : aucune purge' % (md, exc))
        return None
    if not corps.strip():
        progression('[import-medias] %s vide : aucune purge' % md)
        return None
    morceaux = [corps]
    for chemin in sorted(glob.glob(os.path.join(dossier, 'tables', '*.htm*'))):
        try:
            with open(chemin, encoding='utf-8', errors='replace') as f:
                morceaux.append(f.read())
        except OSError:
            continue
    return '\n'.join(morceaux).lower()


def est_citee(nom, texte):
    """Le nom du fichier apparaît-il dans le texte de référence ? La forme citée peut être
    percent-encodée (pandoc encode les espaces de certaines cibles)."""
    if not texte:
        return False
    return any(forme in texte for forme in (nom.lower(), urllib.parse.quote(nom).lower()))


# ---------------------------------------------------------------------------------
# Photos des auteur·e·s

def un_segment(valeur):
    """Nom de fichier sans chemin : rien ne doit sortir de media/ ni de portraits/."""
    return bool(valeur) and os.path.basename(valeur) == valeur and valeur not in ('.', '..')


def lire_instructions(chemin):
    """(appariements, protegees) d'après le fichier écrit par docx-meta.py :
    appariements = [(slug-auteur, nom)] des lignes A, protegees = {noms} des lignes A et G."""
    appariements, protegees = [], set()
    if not chemin or not os.path.isfile(chemin):
        return appariements, protegees
    with open(chemin, encoding='utf-8') as f:
        for ligne in f:
            bouts = ligne.rstrip('\n').split('\t')
            if bouts[0] == 'A' and len(bouts) == 3 and un_segment(bouts[1]) and un_segment(bouts[2]):
                appariements.append((bouts[1], bouts[2]))
                protegees.add(bouts[2])
            elif bouts[0] == 'G' and len(bouts) == 2 and un_segment(bouts[1]):
                protegees.add(bouts[1])
    return appariements, protegees


def ranger_photos(dossier, appariements, texte):
    """Déplace les photos appariées de media/ vers portraits/. Retourne
    (rangees, echouees) où rangees = [(slug-auteur, extension, chemin absolu)] et
    echouees = [(slug-auteur, extension)] — celles dont le champ `photo` du meta.yaml doit
    être retiré, puisqu'il désignerait un fichier absent."""
    media = os.path.join(dossier, 'media')
    portraits = os.path.join(dossier, 'portraits')
    rangees, echouees = [], []
    for base, nom in appariements:
        ext = os.path.splitext(nom)[1].lstrip('.').lower()
        source = os.path.join(media, nom)
        if not os.path.isfile(source):
            # pandoc n'extrait pas toutes les formes d'image : ne pas laisser le meta.yaml
            # désigner un fichier qui n'arrivera jamais.
            progression('[import-medias] photo absente de media/ : %s' % nom)
            echouees.append((base, ext))
            continue
        if est_citee(nom, texte):
            # Le corps de l'article utilise la même image : la déplacer casserait son
            # insertion. L'article passe avant le portrait.
            progression('[import-medias] %s sert aussi dans le texte : laissée dans media/' % nom)
            echouees.append((base, ext))
            continue
        cible = os.path.join(portraits, '%s.original.%s' % (base, ext))
        try:
            os.makedirs(portraits, exist_ok=True)
            # Un seul .original.* par auteur, sinon trouverOriginal() du cockpit devient
            # ambigu — même invariant que son dépôt de photo.
            for autre in glob.glob(os.path.join(portraits, base + '.original.*')):
                if os.path.abspath(autre) != os.path.abspath(cible):
                    os.unlink(autre)
            shutil.move(source, cible)
        except OSError as exc:
            progression('[import-medias] déplacement impossible de %s : %s' % (nom, exc))
            echouees.append((base, ext))
            continue
        rangees.append((base, ext, os.path.abspath(cible)))
    return rangees, echouees


def detourer(dossier, rangees):
    """Appelle portraits.py sur les originaux rangés. Retourne l'ensemble des slugs
    traités avec succès ; vide si l'interprète manque ou si l'appel échoue."""
    if not rangees:
        return set()
    if not os.path.isfile(INTERPRETE_PORTRAITS):
        progression('[import-medias] interprète de portraits absent (%s) : '
                    'les photos restent en original' % INTERPRETE_PORTRAITS)
        return set()
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'portraits.py')
    portraits = os.path.abspath(os.path.join(dossier, 'portraits'))
    commande = [INTERPRETE_PORTRAITS, script, portraits]
    for base, _, source in rangees:
        commande += [base, source]
    try:
        # Le premier appel paie le réveil du modèle u2net_human_seg : marge large, comme
        # le TIMEOUT_DEFAUT de lib/portraits.js.
        fini = subprocess.run(commande, capture_output=True, text=True, timeout=300)
    except (OSError, subprocess.SubprocessError) as exc:
        progression('[import-medias] détourage impossible : %s' % exc)
        return set()
    if fini.stderr:
        progression(fini.stderr.rstrip())
    reussis = set()
    for ligne in (fini.stdout or '').splitlines():
        nette = ligne.strip()
        if not nette.startswith('{'):
            continue
        try:
            obj = json.loads(nette)
        except ValueError:
            continue
        if isinstance(obj, dict) and obj.get('ok') and isinstance(obj.get('slug'), str):
            reussis.add(obj['slug'])
    return reussis


def corriger_meta(chemin_meta, rangees, reussis, echouees):
    """Deux retouches du champ `photo`, littérales : les chaînes comparées sont écrites par
    docx-meta.py. Un portrait détouré passe à .sans-fond.png ; un portrait qui n'a pas pu
    être rangé perd sa ligne, plutôt que de désigner un fichier absent.
    Retourne (promus, retires)."""
    if not os.path.isfile(chemin_meta):
        return 0, 0
    with open(chemin_meta, encoding='utf-8') as f:
        contenu = f.read()
    depart = contenu
    promus = 0
    for base, ext, _ in rangees:
        if base not in reussis:
            continue
        ancien = 'photo: "portraits/%s.original.%s"' % (base, ext)
        nouveau = 'photo: "portraits/%s.sans-fond.png"' % base
        if ancien in contenu:
            contenu = contenu.replace(ancien, nouveau, 1)
            promus += 1
    retires = 0
    for base, ext in echouees:
        # La ligne entière part, indentation et fin de ligne comprises : le champ `photo`
        # est facultatif, l'auteur reste complet sans lui.
        motif = re.compile(r'^[ \t]*photo: "portraits/%s\.original\.%s"[ \t]*\r?\n'
                           % (re.escape(base), re.escape(ext)), re.M)
        contenu, n = motif.subn('', contenu, count=1)
        retires += n
    if contenu == depart:
        return promus, 0
    with open(chemin_meta, 'w', encoding='utf-8', newline='\n') as f:
        f.write(contenu)
    return promus, retires


# ---------------------------------------------------------------------------------
# Purge des images que le texte n'utilise pas

def purger(dossier, texte, protegees):
    """Supprime de media/ les images dont le nom n'apparaît nulle part dans `texte` et que
    docx-meta.py n'a pas signalées comme photos d'auteur. Retourne les noms supprimés."""
    media = os.path.join(dossier, 'media')
    if texte is None or not os.path.isdir(media):
        return []
    supprimees = []
    for racine, _, fichiers in os.walk(media):
        for nom in fichiers:
            if not nom.lower().endswith(EXTENSIONS_IMAGE):
                continue                  # <slug>.bib et compagnie : jamais candidats
            if nom in protegees or est_citee(nom, texte):
                continue
            chemin = os.path.join(racine, nom)
            try:
                os.unlink(chemin)
            except OSError as exc:
                progression('[import-medias] suppression impossible de %s : %s' % (nom, exc))
                continue
            supprimees.append(os.path.relpath(chemin, media).replace('\\', '/'))
    return sorted(supprimees)


def principal(argv):
    if len(argv) not in (3, 4):
        progression('usage : import-medias.py <slug> <dossier-article> [<fichier-photos>]')
        return 2
    slug, dossier = argv[1], argv[2]
    chemin_photos = argv[3] if len(argv) == 4 else None

    # Le texte de référence est lu avant tout déplacement : il dit aussi si une photo sert
    # dans le corps, auquel cas elle ne bouge pas.
    texte = texte_de_reference(dossier, slug)
    appariements, protegees = lire_instructions(chemin_photos)
    rangees, echouees = ranger_photos(dossier, appariements, texte)
    reussis = detourer(dossier, rangees)
    promus, retires = corriger_meta(os.path.join(dossier, slug + '.meta.yaml'),
                                    rangees, reussis, echouees)
    supprimees = purger(dossier, texte, protegees)

    stats = {
        'slug': slug,
        'portraits_ranges': [base for base, _, _ in rangees],
        'portraits_detoures': sorted(reussis),
        'portraits_promus': promus,
        'portraits_sans_fichier': [base for base, _ in echouees],
        'champs_photo_retires': retires,
        'images_protegees': sorted(protegees),
        'images_supprimees': supprimees,
    }
    print(json.dumps(stats, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(principal(sys.argv))
