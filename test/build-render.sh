#!/bin/bash
# Build PDF + capture PNG de chaque page, pour tous les articles de test, puis les trois
# verdicts d'ensemble : PDF/UA-1 du banc, corpus d'accessibilité, reproductibilité des
# polices.
# À lancer depuis WSL (distro SZH-Publishing) :
#   bash /mnt/c/.../szh-publishing-toolchain/test/build-render.sh [slug]
# Prérequis rendu PNG : un venv Python avec pypdfium2 + Pillow (voir README.md),
# chemin dans $SZH_RENDER (défaut : ~/pdfvenv/bin/python).
# Prérequis du contrôle des polices : fontTools, présent dans le venv WeasyPrint
# (/opt/weasyprint/bin/python) ; surchargeable par $SZH_FONTTOOLS.
#
# Ordre des trois verdicts, et pourquoi celui-là : le contrôle des polices vient en
# dernier, parce qu'il lit les PDF des DEUX dossiers de sorties — le banc et le corpus
# d'accessibilité. Le passer avant la construction du corpus, c'est ne contrôler que la
# moitié des PDF, et c'est justement le corpus qui porte les diacritiques polonais, turcs
# et serbes.
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
RENDER="${SZH_RENDER:-$HOME/pdfvenv/bin/python}"
FONTPY="${SZH_FONTTOOLS:-/opt/weasyprint/bin/python}"
cd "$REPO/test" || exit 1
only="${1:-}"
echec=0
for d in articles/*/; do
  slug="$(basename "$d")"
  [ -n "$only" ] && [ "$only" != "$slug" ] && continue
  echo "=== $slug ==="
  rm -rf "out/$slug"
  journal="out/$slug-build.log"
  mkdir -p out
  # Le code de sortie est celui de make, pas celui du grep qui suit : sinon un
  # échec dont le message ne contient aucun des mots cherchés passe pour un succès.
  if make -f "$REPO/pipeline/Makefile" "out/$slug/$slug.pdf" > "$journal" 2>&1; then
    # « [niveaux] » : un saut de niveau de titre écrasé par szh-niveaux.lua se dit là et
    # nulle part ailleurs, et le mot « warning » n'apparaît pas dans un message français.
    grep -iE "nonempty|error|traceback|warning|\[niveaux\]" "$journal" || echo "  build ok"
  else
    echo "  ÉCHEC du build :"
    sed -n '1,40p' "$journal" | sed 's/^/    /'
    echec=1
    continue
  fi
  if [ -x "$RENDER" ] || command -v "$RENDER" >/dev/null 2>&1; then
    "$RENDER" render-all.py "out/$slug/$slug.pdf" "out/$slug/page" 1.15 \
      && echo "  PNG -> out/$slug/page-*.png"
  else
    echo "  (rendu PNG ignoré : renderer introuvable en $RENDER)"
  fi
  # Aucune légende de figure ne doit rester seule sur sa page : un défaut que le PDF ne
  # signale pas et que la porte PDF/UA laisse passer.
  if [ -x "$FONTPY" ] || command -v "$FONTPY" >/dev/null 2>&1; then
    "$FONTPY" figures-check.py "out/$slug/$slug.html" | sed 's/^/  /' || echec=1
  fi
done

# Verdict PDF/UA-1 sur tout le banc, la même porte que `make verifier-ua` — c'est elle qui
# garde l'export d'un vrai numéro. Un défaut de balisage ne se voit sur aucun PNG : sans ce
# passage, une régression de conformité traverserait le banc sans un mot.
# Sur un slug isolé, on ne valide pas : la porte prend le numéro entier.
if [ -z "$only" ] && [ $echec -eq 0 ]; then
  echo "=== PDF/UA-1 ==="
  # Journal puis sed, et non un tube : dans un tube, le code retenu serait celui du sed,
  # et un PDF non conforme passerait pour un succès. Même piège que ci-dessus.
  journal="out/.pdfua-banc.log"
  make -f "$REPO/pipeline/Makefile" verifier-ua > "$journal" 2>&1 || echec=1
  sed 's/^/  /' "$journal"
fi

# Corpus d'accessibilité : un second dossier de NUMÉRO, à part du banc — voir la longue
# note de tête de accessibilite/ausgabe.yaml. Deux attentes, chacune une assertion :
#   * sa porte PDF/UA doit rendre 0, comme celle du banc. Aucun de ses articles n'est
#     volontairement non conforme ; c'est un choix, expliqué là-bas.
#   * la paire française / allemande y diverge à dessein d'une légende de figure :
#     verifier-numerotation DOIT donc rendre 1. S'il rend 0, la comparaison ne compare
#     plus rien — un contrôle qui ne peut plus échouer est un contrôle mort.
if [ -z "$only" ]; then
  echo "=== Corpus d'accessibilité ==="
  cd "$REPO/test/accessibilite" || exit 1
  rm -rf out
  mkdir -p "$REPO/test/out"
  journal="$REPO/test/out/.a11y.log"
  if make -f "$REPO/pipeline/Makefile" all > "$journal" 2>&1; then
    # « nonempty <title> » est attendu : la chaîne d'aperçu (commonmark_x) n'a pas de
    # template, le Makefile lui pose un titre de repli. On l'écarte pour que la sortie du
    # corpus ne montre que ce qui mérite un regard.
    grep -iE "error|traceback|\[niveaux\]" "$journal" | grep -v "nonempty" | sed 's/^/  /'
    if make -f "$REPO/pipeline/Makefile" verifier-ua >> "$journal" 2>&1; then
      echo "  porte PDF/UA du corpus : conforme (attendu)"
    else
      echo "  ✗ la porte PDF/UA du corpus échoue — journal ci-dessous :"
      sed -n '1,40p' "$journal" | sed 's/^/    /'
      echec=1
    fi
    if make -f "$REPO/pipeline/Makefile" verifier-numerotation \
         A=out/participation-fr/participation-fr.html \
         B=out/teilhabe-de/teilhabe-de.html > "$journal.num" 2>&1; then
      echo "  ✗ l'écart de numérotation voulu entre les deux langues n'est PLUS signalé :"
      echo "    la paire du corpus diverge d'une légende de figure, le contrôle doit le dire."
      sed 's/^/    /' "$journal.num"
      echec=1
    else
      echo "  écart de numérotation entre les deux langues : signalé (attendu)"
      sed -n '/✗/p' "$journal.num" | sed 's/^/    /'
    fi
  else
    echo "  ÉCHEC du build du corpus :"
    sed -n '1,40p' "$journal" | sed 's/^/    /'
    echec=1
  fi
  cd "$REPO/test" || exit 1
fi

# Reproductibilité des polices : aucun PDF ne doit embarquer une police absente de
# pipeline/fonts/. Sans ce passage, un caractère non couvert par les faces livrées est
# comblé par fontconfig avec ce qu'il trouve sur la machine, et le PDF cesse d'être le
# même d'un poste à l'autre — sans que rien ne le dise. Aucun PNG ne le montrerait.
# En dernier, et sur les deux dossiers de sorties : voir la note de tête.
if [ -z "$only" ]; then
  echo "=== Polices ==="
  if [ -x "$FONTPY" ] || command -v "$FONTPY" >/dev/null 2>&1; then
    journal="out/.polices.log"
    PYTHONIOENCODING=utf-8 "$FONTPY" polices-check.py out accessibilite/out > "$journal" 2>&1 || echec=1
    sed 's/^/  /' "$journal"
  else
    echo "  (contrôle ignoré : interpréteur fontTools introuvable en $FONTPY)"
  fi
fi
exit $echec
