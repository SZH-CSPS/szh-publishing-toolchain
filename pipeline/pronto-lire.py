#!/usr/bin/env python3
# pronto-lire.py — CLI UNIQUE du lecteur du gabarit « Pronto — modèle d'article » (.docx ET
# .odt). Renifle l'extension, appelle le bon lecteur (pronto_docx.lire() ou pronto_odt.lire()),
# passe le modèle neutre qu'il rend à pronto_modele.principal(). Toutes les RÈGLES du gabarit
# vivent dans pronto_modele.py ; toute la lecture du format vit dans pronto_docx.py /
# pronto_odt.py ; ce fichier ne fait que les brancher l'un à l'autre.
#
#   python3 pronto-lire.py <fichier.docx|.odt> <slug> <dossier-article>
#   python3 pronto-lire.py --reconnaitre <fichier.docx|.odt>   -> 0 = au gabarit, 1 = non
#
# Reprend EXACTEMENT le contrat de sortie de l'ancien pipeline/docx-pronto.py (git log), lui
# -même écrit pour remplacer un jour pipeline/docx-meta.py : même <dossier-article>/<slug>.
# meta.yaml (jamais écrasé, propriété du formulaire du cockpit), même ligne JSON de stats sur
# stdout, mêmes fichiers d'instructions pour les maillons suivants si $SZH_META / $SZH_PHOTOS
# sont posées, une ligne « LETTRE<TAB>valeur » par instruction (Y type, L langue, T tableau
# consommé, P paragraphe de clé d'un bloc à retirer du corps, FI/FT les champs d'un bloc à
# poser sur son image ou sur son tableau, B/BT bibliographie) — voir l'en-tête de
# pronto_modele.py pour le détail complet. Ce lecteur n'émet JAMAIS de G ni de F : dans le
# gabarit Pronto, titre, sous-titre, résumé, type et autrices/auteurs vivent tous DANS un
# tableau, et la légende d'une figure ou d'un tableau est une clé de bloc, jamais une légende
# Word stylée voisine.
#
# BRANCHÉ sur la chaîne d'import réelle depuis le 22.09.2026 : pipeline/import-docx.sh choisit
# ce lecteur pour tout document qui déclare les styles du gabarit (mode `--reconnaitre`
# ci-dessous), et l'ancien docx-meta.py pour tous les autres.
#
# stdlib uniquement : pas de PyYAML dans la WSL de la flotte.

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pronto_modele
import pronto_docx
import pronto_odt

LECTEURS = {
    '.docx': pronto_docx.lire,
    '.odt': pronto_odt.lire,
}

RECONNAISSEURS = {
    '.docx': pronto_docx.est_pronto,
    '.odt': pronto_odt.est_pronto,
}

# Les autres noms de fichier sous lesquels une même image peut apparaître dans le .md (Word
# range un SVG derrière un aperçu bitmap ; pandoc cite le SVG). Table tenue À CÔTÉ du modèle
# neutre — voir pronto_docx.variantes_images() pour pourquoi elle n'entre pas dans Par.images.
VARIANTES = {
    '.docx': pronto_docx.variantes_images,
    '.odt': pronto_odt.variantes_images,
}


def reconnaitre(chemin):
    """Mode `--reconnaitre` : sort 0 si ce document est au gabarit Pronto, 1 sinon. C'est
    pipeline/import-docx.sh qui pose la question, une fois par document déposé, pour choisir
    entre ce lecteur et l'ancien docx-meta.py. N'écrit rien, ne juge pas le contenu : la
    seule question est « ce fichier vient-il du gabarit ? »."""
    ext = os.path.splitext(chemin)[1].lower()
    reconnaisseur = RECONNAISSEURS.get(ext)
    return 0 if reconnaisseur is not None and reconnaisseur(chemin) else 1


def principal(argv):
    try:  # console Windows en cp1252 : un accent combinant (nom venu du partage) y plante.
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass
    if len(argv) == 3 and argv[1] == '--reconnaitre':
        return reconnaitre(argv[2])
    if len(argv) != 4:
        print('usage : pronto-lire.py <fichier.docx|.odt> <slug> <dossier-article>\n'
              '        pronto-lire.py --reconnaitre <fichier.docx|.odt>',
              file=sys.stderr)
        return 2
    chemin, slug, dossier = argv[1], argv[2], argv[3]
    stats = {'slug': slug, 'avertissements': []}

    ext = os.path.splitext(chemin)[1].lower()
    lecteur = LECTEURS.get(ext)
    if lecteur is None:
        print('[pronto-lire] extension non reconnue (%s) : %s' % (ext, chemin),
              file=sys.stderr)
        chemin_meta = os.getenv('SZH_META')
        if chemin_meta:
            open(chemin_meta, 'w', encoding='utf-8', newline='\n').close()
        print(json.dumps({'slug': slug, 'erreur': 'extension non reconnue : %s' % ext},
                          ensure_ascii=False))
        return 0

    try:
        blocs = lecteur(chemin)
    except Exception as e:
        # Non bloquant : même repli que l'ancien docx-pronto.py, désormais commun aux deux
        # formats — un .docx ou un .odt corrompu, illisible, ou d'une forme inattendue au
        # point de ne même pas s'ouvrir comme un zip, ne doit jamais faire échouer l'import.
        print('[pronto-lire] lecture impossible de %s : %s' % (chemin, e), file=sys.stderr)
        chemin_meta = os.getenv('SZH_META')
        if chemin_meta:
            open(chemin_meta, 'w', encoding='utf-8', newline='\n').close()
        print(json.dumps({'slug': slug, 'erreur': str(e)}, ensure_ascii=False))
        return 0

    # $SZH_PRODUIT : le jeton `revue:` du numéro (« revue » | « zeitschrift »), posé par
    # pipeline/import-docx.sh, d'où vient la LANGUE de l'article — le gabarit ne la porte plus
    # depuis le 22.09.2026. Absente (appel direct en ligne de commande, hors d'un numéro) :
    # repli sur le français, dit par l'avertissement 'langue-deduite'.
    try:
        variantes = VARIANTES[ext](chemin)
    except Exception:   # jamais bloquant : l'appariement se fera sur le seul nom principal.
        variantes = {}
    stats = pronto_modele.principal(blocs, chemin, slug, dossier,
                                     produit=os.getenv('SZH_PRODUIT', ''),
                                     variantes=variantes)
    if stats.get('bloquant'):
        # Décision de Robin (22.09.2026) : une clé PRÉSENTE (valeur non vide) que le lecteur
        # n'a pas su ranger ne doit jamais s'importer en silence — principal() n'a rien écrit
        # (ni meta.yaml, ni $SZH_META/$SZH_PHOTOS). Le message liste chaque clé, son texte et
        # son emplacement, en plus des avertissements [import-avertissement] déjà émis.
        for entree in stats.get('cles_non_reconnues', []):
            print('[pronto-lire] clé non reconnue : « %s » (%s)'
                  % (entree.get('texte', ''), entree.get('lieu', '')), file=sys.stderr)
        print(json.dumps(stats, ensure_ascii=False))
        return 1
    print(json.dumps(stats, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(principal(sys.argv))
