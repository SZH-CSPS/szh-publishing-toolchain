#!/usr/bin/env python3
# Dernière étape de l'import d'un Word : range les photos des auteurs, supprime les images
# que le texte n'utilise pas, puis renomme les autres.
#
#   python3 import-medias.py <slug> <dossier-article> [<fichier-photos>]
#
# 1. Photos. docx-meta.py associe chaque auteur du tableau de fin de document à l'image de
#    sa cellule (ou de la voisine) et écrit une instruction par ligne :
#      A<TAB><slug-auteur><TAB><nom dans media/>  photo associée
#      G<TAB><nom dans media/>                    photo reconnue, non associée
#    Une photo associée passe de media/ à portraits/<slug-auteur>.original.<ext>, puis
#    portraits.py recadre le visage et détoure le fond, comme un dépôt de photo dans le
#    cockpit. En cas de succès, le champ `photo` du meta.yaml passe à .sans-fond.png ;
#    sinon il garde l'original. Sans interprète de portraits, les photos sont rangées sans
#    détourage.
#    Si le déplacement est impossible (fichier absent de media/, ou image utilisée aussi
#    dans le corps), le champ `photo` est retiré, pour ne pas désigner un fichier absent.
#
# 2. Suppression. pandoc extrait sous media/ tout ce que le Word contient (logos,
#    filigranes, portraits). Une image qu'aucune insertion du .md ni aucun
#    <img src="media/…"> de tables/*.html ne cite est supprimée, définitivement (le .docx
#    l'est aussi). Précautions :
#      - le test cherche le nom du fichier dans le texte : il peut garder une image de
#        trop, pas en supprimer une qui sert ;
#      - une photo d'auteur reconnue est protégée, même non associée (le tableau des
#        auteurs ayant quitté le corps, rien ne la cite) ;
#      - sans .md lisible et non vide, rien n'est supprimé.
#    Seuls les fichiers image sont concernés.
#
# 3. Renommage. Les noms de Word (image1.png, image7.jpeg) deviennent <slug>-fig-NN.<ext>,
#    NN suivant l'ordre de première citation, et les références du .md et des tableaux
#    sont réécrites. Un fichier non cité (photo protégée non associée) garde son nom.
#
# Sortie : une ligne JSON de statistiques sur stdout, messages sur stderr. Code 0 même si
# le détourage échoue.

import glob
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.parse

# Ce qui peut précéder une cible locale : début du texte, espace, parenthèse, guillemet ou
# chevron, puis éventuellement « ./ ». Ainsi une URL comme
# « https://exemple.org/media/image1.png » n'est pas prise pour une insertion.
AVANT_CIBLE = "\\s(\"'<"
GARDE_CIBLE_LOCALE = '(?<![^' + AVANT_CIBLE + '])'
PREFIXE_RELATIF = r'(?:\./)?'

# Images que Word peut contenir, métafichiers Windows (emf, wmf) compris.
EXTENSIONS_IMAGE = ('.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp',
                    '.tif', '.tiff', '.emf', '.wmf')

# Python du venv de portraits, comme lib/portraits.js. La variable sert aux tests.
INTERPRETE_PORTRAITS = os.environ.get('SZH_PORTRAITS_PYTHON', '/opt/portraits/bin/python')


def progression(message):
    print(message, file=sys.stderr, flush=True)


# ---------------------------------------------------------------------------------
# Texte de référence : là où une image peut être citée

def fichiers_de_texte(dossier, slug):
    """Fichiers où une image peut être citée, le .md en premier, puis la bibliographie et
    les tableaux. Liste commune à la suppression et au renommage."""
    return [os.path.join(dossier, slug + '.md'),
            os.path.join(dossier, slug + '.biblio.md')] + \
        sorted(glob.glob(os.path.join(dossier, 'tables', '*.htm*')))


def texte_de_reference(dossier, slug):
    """Les fichiers de fichiers_de_texte() concaténés en minuscules (docx-tables.py écrit
    des <img src="media/…"> dans les tableaux). None si le .md manque ou est vide."""
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
    for chemin in fichiers_de_texte(dossier, slug)[1:]:
        try:
            with open(chemin, encoding='utf-8', errors='replace') as f:
                morceaux.append(f.read())
        except OSError:
            continue
    return '\n'.join(morceaux).lower()


def est_citee(nom, texte):
    """Vrai si le nom du fichier figure dans le texte, tel quel ou encodé en % (pandoc
    encode les espaces de certaines cibles)."""
    if not texte:
        return False
    return any(forme in texte for forme in (nom.lower(), urllib.parse.quote(nom).lower()))


# ---------------------------------------------------------------------------------
# Photos des auteurs

def un_segment(valeur):
    """Vrai pour un nom de fichier sans chemin, qui ne sort pas de media/ ni de portraits/."""
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
    """Déplace les photos associées de media/ vers portraits/. Rend (rangees, echouees) :
    rangees = [(slug-auteur, extension, chemin absolu)], echouees = [(slug-auteur,
    extension)], dont le champ `photo` est à retirer."""
    media = os.path.join(dossier, 'media')
    portraits = os.path.join(dossier, 'portraits')
    rangees, echouees = [], []
    for base, nom in appariements:
        ext = os.path.splitext(nom)[1].lstrip('.').lower()
        source = os.path.join(media, nom)
        if not os.path.isfile(source):
            # pandoc n'extrait pas toutes les formes d'image.
            progression('[import-medias] photo absente de media/ : %s' % nom)
            echouees.append((base, ext))
            continue
        if est_citee(nom, texte):
            # Le corps utilise la même image : la déplacer casserait son insertion.
            progression('[import-medias] %s sert aussi dans le texte : laissée dans media/' % nom)
            echouees.append((base, ext))
            continue
        cible = os.path.join(portraits, '%s.original.%s' % (base, ext))
        try:
            os.makedirs(portraits, exist_ok=True)
            # Un seul .original.* par auteur, sinon trouverOriginal() du cockpit hésite.
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
    """Appelle portraits.py sur les originaux rangés. Rend l'ensemble des slugs réussis ;
    vide si l'interprète manque, si l'appel échoue ou si SZH_SANS_DETOURAGE est posée."""
    if not rangees:
        return set()
    if os.environ.get('SZH_SANS_DETOURAGE'):
        # Réimport : les portraits de l'article sont gardés, détourer ceux du Word ne
        # servirait à rien.
        progression('[import-medias] portraits rangés sans détourage (réimport)')
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
        # Le premier appel charge le modèle u2net_human_seg : délai large, comme
        # TIMEOUT_DEFAUT de lib/portraits.js.
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
    """Retouche le champ `photo` (lignes écrites par docx-meta.py, comparées telles
    quelles) : .sans-fond.png pour un portrait détouré, ligne retirée pour un portrait
    non rangé. Rend (promus, retires)."""
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
        # Ligne entière, fin de ligne comprise (le champ `photo` est facultatif).
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
# Suppression des images que le texte n'utilise pas

def purger(dossier, texte, protegees):
    """Supprime de media/ les images absentes de `texte` et non protégées. Rend les noms
    supprimés."""
    media = os.path.join(dossier, 'media')
    if texte is None or not os.path.isdir(media):
        return []
    supprimees = []
    for racine, _, fichiers in os.walk(media):
        for nom in fichiers:
            # « ~$… » : temporaire laissé par une écriture interrompue.
            temporaire = nom.startswith('~$')
            if not temporaire and not nom.lower().endswith(EXTENSIONS_IMAGE):
                continue                  # pas une image
            if not temporaire and (nom in protegees or est_citee(nom, texte)):
                continue
            chemin = os.path.join(racine, nom)
            try:
                os.unlink(chemin)
            except OSError as exc:
                progression('[import-medias] suppression impossible de %s : %s' % (nom, exc))
                continue
            supprimees.append(os.path.relpath(chemin, media).replace('\\', '/'))
    return sorted(supprimees)


# ---------------------------------------------------------------------------------
# Renommage des images en <slug>-fig-NN.<ext>

def premiere_citation(nom, texte):
    """Position de la première citation « media/<nom> » dans le texte, ou -1. Le préfixe
    est exigé, contrairement à est_citee : reecrire_references ne réécrit que les cibles
    préfixées, et une mention du nom en prose ne doit pas faire renommer le fichier."""
    positions = []
    for forme in (nom.lower(), urllib.parse.quote(nom).lower()):
        trouve = re.search(GARDE_CIBLE_LOCALE + PREFIXE_RELATIF + 'media/' + re.escape(forme), texte)
        if trouve:
            positions.append(trouve.start())
    return min(positions) if positions else -1


def reecrire_references(dossier, slug, couples):
    """Réécrit media/<ancien> en media/<nouveau> dans le .md et les tableaux extraits.

    Une seule passe, par une alternative : des substitutions successives pourraient
    réécrire ce qu'une précédente vient d'écrire (image1.png -> art-fig-01.png, puis
    art-fig-01.png -> art-fig-02.png).
    Insensible à la casse (la cible écrite par pandoc peut différer du disque) ; l'extension
    dans le motif empêche image1.png de prendre image10.png. Fins de ligne conservées."""
    table = {}
    for ancien, nouveau in couples:
        table['media/' + ancien.lower()] = 'media/' + nouveau
        cite = urllib.parse.quote(ancien)
        if cite != ancien:
            table['media/' + cite.lower()] = 'media/' + urllib.parse.quote(nouveau)
    if not table:
        return
    # Les cibles les plus longues d'abord, pour qu'aucune n'en masque une autre. La garde
    # écarte les URL ; le « ./ » éventuel est recopié tel quel.
    motif = re.compile(GARDE_CIBLE_LOCALE + '(' + PREFIXE_RELATIF + ')('
                       + '|'.join(re.escape(k) for k in sorted(table, key=len, reverse=True)) + ')',
                       re.I)
    for chemin in fichiers_de_texte(dossier, slug):
        try:
            with open(chemin, encoding='utf-8', errors='replace', newline='') as f:
                contenu = f.read()
        except OSError as exc:
            progression('[import-medias] %s illisible (%s) : références non réécrites'
                        % (chemin, exc))
            continue
        sortie = motif.sub(lambda m: m.group(1) + table[m.group(2).lower()], contenu)
        if sortie == contenu:
            continue
        try:
            with open(chemin, 'w', encoding='utf-8', newline='') as f:
                f.write(sortie)
        except OSError as exc:
            progression('[import-medias] %s non réécrit (%s)' % (chemin, exc))


def renommer(dossier, slug, texte):
    """Renomme les images citées en <slug>-fig-NN.<ext>. Rend [(ancien, nouveau)].
    En deux temps, par un nom temporaire : le nom visé peut être celui d'un fichier pas
    encore renommé (image déjà nommée par un import précédent)."""
    media = os.path.join(dossier, 'media')
    if texte is None or not os.path.isdir(media):
        return []
    candidats = []
    for nom in sorted(os.listdir(media)):
        chemin = os.path.join(media, nom)
        if not os.path.isfile(chemin) or not nom.lower().endswith(EXTENSIONS_IMAGE):
            continue
        rang = premiere_citation(nom, texte)
        if rang < 0:
            continue                      # non citée : pas de rang
        candidats.append((rang, nom))
    if not candidats:
        return []
    candidats.sort()
    largeur = 3 if len(candidats) > 99 else 2
    couples = []
    for i, (_, ancien) in enumerate(candidats, start=1):
        ext = os.path.splitext(ancien)[1].lower()
        nouveau = '%s-fig-%0*d%s' % (slug, largeur, i, ext)
        if nouveau != ancien:
            couples.append((ancien, nouveau))
    if not couples:
        return []
    deplaces = []
    for ancien, nouveau in couples:
        tmp = os.path.join(media, '~$' + nouveau)
        try:
            os.replace(os.path.join(media, ancien), tmp)
        except OSError as exc:
            progression('[import-medias] renommage impossible de %s : %s' % (ancien, exc))
            continue
        deplaces.append((ancien, nouveau))
    faits = []
    for ancien, nouveau in deplaces:
        tmp = os.path.join(media, '~$' + nouveau)
        try:
            os.replace(tmp, os.path.join(media, nouveau))
        except OSError as exc:
            # Échec : le fichier reprend son ancien nom et sa référence n'est pas réécrite.
            # Resté sous « ~$ », il serait masqué par le cockpit et ignoré par OneDrive.
            progression('[import-medias] renommage annulé pour %s : %s' % (nouveau, exc))
            try:
                os.replace(tmp, os.path.join(media, ancien))
            except OSError:
                progression('[import-medias] ⚠ %s est resté sous « ~$ »' % nouveau)
            continue
        faits.append((ancien, nouveau))
    if faits:
        reecrire_references(dossier, slug, faits)
    return faits


def principal(argv):
    try:  # console Windows en cp1252 : un accent combinant y ferait planter print().
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass
    if len(argv) not in (3, 4):
        progression('usage : import-medias.py <slug> <dossier-article> [<fichier-photos>]')
        return 2
    slug, dossier = argv[1], argv[2]
    chemin_photos = argv[3] if len(argv) == 4 else None

    # Lu avant tout déplacement : il dit aussi si une photo sert dans le corps.
    texte = texte_de_reference(dossier, slug)
    appariements, protegees = lire_instructions(chemin_photos)
    rangees, echouees = ranger_photos(dossier, appariements, texte)
    reussis = detourer(dossier, rangees)
    promus, retires = corriger_meta(os.path.join(dossier, slug + '.meta.yaml'),
                                    rangees, reussis, echouees)
    supprimees = purger(dossier, texte, protegees)
    # Après la suppression, pour que la numérotation n'ait pas de trou.
    renommees = renommer(dossier, slug, texte)

    stats = {
        'slug': slug,
        'portraits_ranges': [base for base, _, _ in rangees],
        'portraits_detoures': sorted(reussis),
        'portraits_promus': promus,
        'portraits_sans_fichier': [base for base, _ in echouees],
        'champs_photo_retires': retires,
        'images_protegees': sorted(protegees),
        'images_supprimees': supprimees,
        'images_renommees': ['%s -> %s' % c for c in renommees],
    }
    print(json.dumps(stats, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(principal(sys.argv))
