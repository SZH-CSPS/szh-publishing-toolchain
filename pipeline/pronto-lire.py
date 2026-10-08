#!/usr/bin/env python3
# Ligne de commande du lecteur du gabarit « Pronto — modèle d'article » (.docx). Passe le
# modèle neutre rendu par pronto_docx.lire() à pronto_modele.principal(). Les règles du
# gabarit sont dans pronto_modele.py, la lecture du format dans pronto_docx.py. Un .odt est
# converti en .docx avant d'arriver ici (import-docx.sh, nettoyeur).
#
#   python3 pronto-lire.py <fichier.docx> <slug> <dossier-article>   -> 0 = lu, 1 = bloquant (clé
#                                                            non reconnue), 3 = fichier illisible
#   python3 pronto-lire.py --reconnaitre <fichier.docx>   -> 0 = au gabarit, 10 = non,
#                                                            tout autre code = panne
#
# pipeline/import-docx.sh choisit ce lecteur pour un document au gabarit (--reconnaitre), et
# docx-meta.py pour les autres. Sorties, communes avec docx-meta.py :
# <dossier-article>/<slug>.meta.yaml (jamais écrasé : il appartient au formulaire du
# cockpit), une ligne JSON de statistiques sur stdout, et, si $SZH_META / $SZH_PHOTOS sont
# posées, des fichiers d'instructions « LETTRE<TAB>valeur » pour les étapes suivantes (voir
# l'en-tête de pronto_modele.py). Ce lecteur n'émet ni G ni F : dans le gabarit, titre,
# sous-titre, résumé, type et auteurs sont dans un tableau, et la légende d'une figure ou
# d'un tableau est une clé de bloc.
#
# Bibliothèque standard seule : la WSL n'a pas PyYAML.

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pronto_modele
import pronto_docx

LECTEURS = {
    '.docx': pronto_docx.lire,
}

RECONNAISSEURS = {
    '.docx': pronto_docx.est_pronto,
}

# Les autres noms sous lesquels une même image peut apparaître dans le .md (Word range un
# SVG derrière un aperçu bitmap ; pandoc cite le SVG). Voir pronto_docx.variantes_images().
VARIANTES = {
    '.docx': pronto_docx.variantes_images,
}


PAS_AU_GABARIT = 10
# Le fichier ne s'ouvre pas (zip cassé, document.xml mal formé) : import-docx.sh le signale
# autrement qu'une clé à corriger.
LECTURE_IMPOSSIBLE = 3


def reconnaitre(chemin):
    """Mode `--reconnaitre` : 0 si le document est au gabarit Pronto, PAS_AU_GABARIT (10)
    sinon, y compris s'il est illisible. Tout autre code (1 pour un plantage Python) est une
    panne, que import-docx.sh signale. N'écrit rien."""
    ext = os.path.splitext(chemin)[1].lower()
    reconnaisseur = RECONNAISSEURS.get(ext)
    return 0 if reconnaisseur is not None and reconnaisseur(chemin) else PAS_AU_GABARIT


def principal(argv):
    try:  # une console en cp1252 plante sur un accent combinant
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass
    if len(argv) == 3 and argv[1] == '--reconnaitre':
        return reconnaitre(argv[2])
    if len(argv) != 4:
        print('usage : pronto-lire.py <fichier.docx> <slug> <dossier-article>\n'
              '        pronto-lire.py --reconnaitre <fichier.docx>',
              file=sys.stderr)
        return 2
    chemin, slug, dossier = argv[1], argv[2], argv[3]
    stats = {'slug': slug, 'avertissements': []}

    ext = os.path.splitext(chemin)[1].lower()
    lecteur = LECTEURS.get(ext)
    if lecteur is None:
        if ext == '.odt':
            print('[pronto-lire] un .odt n’est pas lu directement : l’import le convertit '
                  'd’abord en .docx. [de] eine .odt-Datei wird nicht direkt gelesen: der '
                  'Import wandelt sie zuerst in .docx um : %s' % chemin, file=sys.stderr)
            return 1
        print('[pronto-lire] extension non reconnue (%s) : %s' % (ext, chemin),
              file=sys.stderr)
        chemin_meta = os.getenv('SZH_META')
        if chemin_meta:
            open(chemin_meta, 'w', encoding='utf-8', newline='\n').close()
        print(json.dumps({'slug': slug, 'erreur': 'extension non reconnue : %s' % ext},
                          ensure_ascii=False))
        return 1

    try:
        blocs = lecteur(chemin)
    except Exception as e:
        # Bloquant : ni fiche ni instructions ; import-docx.sh refuse l'import et le Word
        # reste en attente.
        print('[pronto-lire] lecture impossible de %s : %s' % (chemin, e), file=sys.stderr)
        pronto_modele.avertir(
            'fichier-illisible',
            ['article « %s »' % slug, 'erreur « %s »' % e],
            "Le fichier Word n’a pas pu être ouvert\u00a0: il est peut-être tronqué ou "
            "endommagé. Rien n’a été importé. Ouvrez-le dans Word, enregistrez-le de "
            "nouveau, puis relancez la conversion.",
            "Die Word-Datei konnte nicht geöffnet werden: sie ist möglicherweise "
            "abgeschnitten oder beschädigt. Es wurde nichts importiert. Öffnen Sie sie in "
            "Word, speichern Sie sie erneut und starten Sie die Konvertierung noch einmal.")
        chemin_meta = os.getenv('SZH_META')
        if chemin_meta:
            open(chemin_meta, 'w', encoding='utf-8', newline='\n').close()
        print(json.dumps({'slug': slug, 'erreur': str(e)}, ensure_ascii=False))
        return LECTURE_IMPOSSIBLE

    # $SZH_PRODUIT : le jeton `revue:` du numéro (« revue » | « zeitschrift »), posé par
    # import-docx.sh ; il donne la langue de l'article. Absent (appel à la main) : français,
    # avec l'avertissement 'langue-deduite'.
    try:
        variantes = VARIANTES[ext](chemin)
    except Exception:   # l'appariement se fera sur le seul nom principal
        variantes = {}
    stats = pronto_modele.principal(blocs, chemin, slug, dossier,
                                     produit=os.getenv('SZH_PRODUIT', ''),
                                     variantes=variantes)
    if stats.get('bloquant'):
        # Une clé remplie que le lecteur n'a pas su ranger bloque l'import : principal() n'a
        # rien écrit. On liste chaque clé, son texte et son emplacement.
        for entree in stats.get('cles_non_reconnues', []):
            print('[pronto-lire] clé non reconnue : « %s » (%s)'
                  % (entree.get('texte', ''), entree.get('lieu', '')), file=sys.stderr)
        print(json.dumps(stats, ensure_ascii=False))
        return 1
    print(json.dumps(stats, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(principal(sys.argv))
