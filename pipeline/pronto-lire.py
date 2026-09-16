#!/usr/bin/env python3
# pronto-lire.py — CLI UNIQUE du lecteur du gabarit « Pronto — modèle d'article » (.docx ET
# .odt). Renifle l'extension, appelle le bon lecteur (pronto_docx.lire() ou pronto_odt.lire()),
# passe le modèle neutre qu'il rend à pronto_modele.principal(). Toutes les RÈGLES du gabarit
# vivent dans pronto_modele.py ; toute la lecture du format vit dans pronto_docx.py /
# pronto_odt.py ; ce fichier ne fait que les brancher l'un à l'autre.
#
#   python3 pronto-lire.py <fichier.docx|.odt> <slug> <dossier-article>
#
# Reprend EXACTEMENT le contrat de sortie de l'ancien pipeline/docx-pronto.py (git log), lui
# -même écrit pour remplacer un jour pipeline/docx-meta.py : même <dossier-article>/<slug>.
# meta.yaml (jamais écrasé, propriété du formulaire du cockpit), même ligne JSON de stats sur
# stdout, mêmes fichiers d'instructions pour les maillons suivants si $SZH_META / $SZH_PHOTOS
# sont posées, une ligne « LETTRE<TAB>valeur » par instruction (Y type, L langue, T tableau
# consommé, B/BT bibliographie) — voir l'en-tête de pronto_modele.py pour le détail complet
# de ces instructions et pour ce que ce lecteur n'émet JAMAIS (P, G, F : dans le gabarit
# Pronto, titre, sous-titre, résumé, type, langue, autrices/auteurs et légende de figure ou
# de tableau vivent tous DANS un tableau, jamais en paragraphe libre).
#
# N'ES APPELÉ PAR AUCUN AUTRE FICHIER pour l'instant (comme l'était docx-pronto.py, qu'il
# remplace) : pas encore branché sur la chaîne d'import réelle.
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


def principal(argv):
    if len(argv) != 4:
        print('usage : pronto-lire.py <fichier.docx|.odt> <slug> <dossier-article>',
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

    stats = pronto_modele.principal(blocs, chemin, slug, dossier)
    print(json.dumps(stats, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(principal(sys.argv))
