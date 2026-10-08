#!/bin/bash
# Banc de rendu : compile chaque article de test en PDF et en PNG par page, puis contrôle
# PDF/UA-1, le corpus d'accessibilité, les livres, le CMJN, l'EPUB et les polices.
# Dans la WSL SZH-Publishing :
#   bash /mnt/c/.../szh-publishing-toolchain/test/build-render.sh [slug]
# Rendu PNG : un venv avec pypdfium2 et Pillow, dans $SZH_RENDER (défaut ~/pdfvenv/bin/python).
# Polices, pypdf : le venv WeasyPrint (/opt/weasyprint/bin/python), ou $SZH_FONTTOOLS.
#
# Le contrôle des polices vient en dernier : il lit les PDF du banc et ceux du corpus
# d'accessibilité, qui porte les diacritiques polonais, turcs et serbes.
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
RENDER="${SZH_RENDER:-$HOME/pdfvenv/bin/python}"
FONTPY="${SZH_FONTTOOLS:-/opt/weasyprint/bin/python}"
VERAPDF="${VERAPDF:-/opt/verapdf-cli/verapdf}"
VERAPDF_JAVA="${VERAPDF_JAVA:-/opt/jre-min}"
# Fiches Kirby du banc (docs/FORMAT-DOCUMENTATION-KIRBY.md). test/ n'est pas sous Revue\
# ni Zeitschrift\ : la racine _NewsUndActu ne peut pas être trouvée seule, on la donne.
export SZH_NEWS_RACINE="$REPO/test/news-racine"
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
  # On teste le code de sortie de make, pas celui du grep : un échec dont le message ne
  # contient aucun mot cherché passerait sinon pour un succès.
  if make -f "$REPO/pipeline/Makefile" "out/$slug/$slug.pdf" > "$journal" 2>&1; then
    # « [niveaux] » : szh-niveaux.lua signale ainsi un saut de niveau de titre corrigé.
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
  # Aucune légende de figure ne doit rester seule sur sa page ; ni WeasyPrint ni veraPDF
  # ne le signalent.
  if [ -x "$FONTPY" ] || command -v "$FONTPY" >/dev/null 2>&1; then
    "$FONTPY" figures-check.py "out/$slug/$slug.html" | sed 's/^/  /' || echec=1
  fi
done

# PDF/UA-1 sur tout le banc, par `make verifier-ua`, le contrôle de l'export d'un numéro.
# Un défaut de balisage ne se voit sur aucun PNG. Sauté pour un slug isolé : la cible
# prend le numéro entier.
if [ -z "$only" ] && [ $echec -eq 0 ]; then
  echo "=== PDF/UA-1 ==="
  # Journal puis sed, et non un tube : dans un tube, le code retenu serait celui du sed.
  journal="out/.pdfua-banc.log"
  make -f "$REPO/pipeline/Makefile" verifier-ua > "$journal" 2>&1 || echec=1
  sed 's/^/  /' "$journal"
fi

# Corpus d'accessibilité : un second numéro, à part du banc (voir
# accessibilite/ausgabe.yaml). Deux attentes :
#   * verifier-ua rend 0 ;
#   * la paire française / allemande diffère exprès d'une légende de figure, donc
#     verifier-numerotation doit rendre 1. S'il rend 0, ce contrôle ne détecte plus rien.
if [ -z "$only" ]; then
  echo "=== Corpus d'accessibilité ==="
  cd "$REPO/test/accessibilite" || exit 1
  rm -rf out
  mkdir -p "$REPO/test/out"
  journal="$REPO/test/out/.a11y.log"
  if make -f "$REPO/pipeline/Makefile" all > "$journal" 2>&1; then
    # « nonempty <title> » est attendu : l'aperçu (commonmark_x) n'a pas de template et le
    # Makefile lui pose un titre de repli.
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

# Les deux livres du banc : une monographie allemande en maquette « normal », un collectif
# français en maquette FALC. Ils couvrent ce que la revue n'a pas : numérotation continue
# entre chapitres, sommaire paginé, ouverture sur belle page, auteur·e·s d'un collectif,
# et PDF/UA sur plusieurs chapitres, qu'un tableau mal placé suffit à casser sans erreur
# visible (voir filters/szh-tableau-boite.lua). Un échec fait échouer le banc.
if [ -z "$only" ]; then
  echo "=== Livres ==="
  for livre in livre-normal livre-falc; do
    echo "--- $livre"
    ( cd "$REPO/test/$livre" || exit 1
      rm -rf out
      journal="$REPO/test/out/.$livre.log"
      mkdir -p "$REPO/test/out"
      # Toutes les sorties : la couverture lit le PDF intérieur pour calculer le dos.
      if make -f "$REPO/pipeline/Makefile" livre livre-imprimeur livre-couverture livre-html-web livre-epub > "$journal" 2>&1; then
        grep -iE "error|traceback|warning|non balis" "$journal" | sed 's/^/    /' || true
      else
        echo "    ÉCHEC du build :"
        sed -n '1,40p' "$journal" | sed 's/^/      /'
        exit 1
      fi
      # « non balisé » dans le journal : WeasyPrint a échoué à baliser et le Makefile a
      # produit un PDF sans balises. Il existe mais n'est plus conforme.
      if grep -q "non balisé" "$journal"; then
        echo "    ✗ le PDF est sorti NON BALISÉ — la conformité PDF/UA est perdue :"
        grep -A 4 "non balisé" "$journal" | sed 's/^/      /'
        exit 1
      fi
      # Verdict lu sur l'absence de FAIL : veraPDF rend une ligne par fichier, et un seul
      # PASS ne dit rien des autres. Le journal passe par un fichier, pas par un tube, pour
      # garder le code de sortie de veraPDF.
      if [ -x "$VERAPDF" ]; then
        ua="$REPO/test/out/.$livre.pdfua"
        # Sauf la couverture d'impression, en PDF/X-4 (WeasyPrint ne pose qu'une variante
        # par PDF) ; livre-sorties-check.py la contrôle.
        JAVA_HOME="$VERAPDF_JAVA" "$VERAPDF" --flavour ua1 --format text \
          $(ls out/*.pdf | grep -v -- '-couverture-impression\.pdf$') > "$ua" 2>&1
        if grep -q "^FAIL" "$ua" || ! grep -q "^PASS" "$ua"; then
          echo "    ✗ PDF/UA-1 : NON conforme"
          sed 's/^/      /' "$ua"
          exit 1
        fi
        echo "    PDF/UA-1 : conforme ($(grep -c '^PASS' "$ua") fichier(s))"
      else
        echo "    (PDF/UA ignoré : veraPDF introuvable en $VERAPDF)"
      fi
      # Folios, métadonnées, couverture d'impression, PNG, EPUB : livre-sorties-check.py.
      if [ -x "$FONTPY" ] || command -v "$FONTPY" >/dev/null 2>&1; then
        for c in chapitres/*/; do
          make -f "$REPO/pipeline/Makefile" livre-chapitre-pdf CHAPITRE="$(basename "$c")" >> "$journal" 2>&1 || exit 1
        done
        sorties="$REPO/test/out/.$livre.sorties"
        "$FONTPY" "$REPO/test/livre-sorties-check.py" . > "$sorties" 2>&1
        if grep -q "^FAIL" "$sorties" || ! grep -q "^ok" "$sorties"; then
          echo "    ✗ sorties du livre :"
          grep -v "^ok" "$sorties" | sed 's/^/      /'
          exit 1
        fi
        echo "    sorties : conformes ($(grep -c '^ok' "$sorties") contrôle(s))"
      fi
      if [ -x "$RENDER" ] || command -v "$RENDER" >/dev/null 2>&1; then
        for pdf in out/*.pdf; do
          "$RENDER" "$REPO/test/render-all.py" "$pdf" "out/page" 1.15 >/dev/null             && echo "    PNG -> $livre/out/page-*.png"
        done
      fi
    ) || echec=1
  done
fi

# CMJN du PDF imprimeur, sur une copie de livre-normal sous test/out/ : le banc garde
# `profil-cmjn: ""`, et la copie reçoit le profil ICC de l'image (image/Containerfile).
# cmjn-check.py relit le PDF produit. Sauté si Ghostscript ou le profil manquent (CI).
if [ -z "$only" ]; then
  echo "=== CMJN (PDF imprimeur, noir K seul) ==="
  ICC_DIR="${SZH_ICC_DIR:-/opt/icc}"
  ICC_NOM="${SZH_ICC_NOM:-PSOuncoated_v3_FOGRA52.icc}"
  ICC="$ICC_DIR/$ICC_NOM"
  if command -v gs >/dev/null 2>&1 && [ -f "$ICC" ]; then
    copie="$REPO/test/out/.cmjn-livre-normal"
    rm -rf "$copie"
    mkdir -p "$REPO/test/out"
    cp -r "$REPO/test/livre-normal" "$copie"
    rm -rf "$copie/out"
    sed -i "s/^\([[:space:]]*profil-cmjn:\).*/\1 \"$ICC_NOM\"/" "$copie/buch.yaml"
    journal="$REPO/test/out/.cmjn.log"
    if ( cd "$copie" && make -f "$REPO/pipeline/Makefile" livre-imprimeur ) > "$journal" 2>&1; then
      pdf="$copie/out/$(basename "$copie")-imprimeur.pdf"
      if [ -f "$pdf" ]; then
        if [ -x "$FONTPY" ] || command -v "$FONTPY" >/dev/null 2>&1; then
          "$FONTPY" "$REPO/test/cmjn-check.py" "$pdf" | sed 's/^/  /' || echec=1
        else
          echo "  (cmjn-check ignoré : interpréteur pypdf introuvable en $FONTPY)"
        fi
      else
        echo "  ✗ livre-imprimeur n'a pas produit $pdf :"
        sed -n '1,20p' "$journal" | sed 's/^/    /'
        echec=1
      fi
    else
      echo "  ✗ ÉCHEC de la compilation CMJN :"
      sed -n '1,40p' "$journal" | sed 's/^/    /'
      echec=1
    fi
  else
    echo "  (contrôle CMJN ignoré : gs ou le profil ICC introuvable en $ICC)"
  fi
fi

# Modèles de couverture recherche et prospectrum (livre-normal porte classique, livre-falc
# le FALC). Sur une copie de livre-normal, sous le même nom de dossier (les sorties en
# prennent le nom), où seul le bloc `couverture:` change. Mêmes contrôles que les livres.
if [ -z "$only" ]; then
  echo "=== Modèles de couverture ==="
  for modele in recherche prospectrum; do
    copie="$REPO/test/out/couv-$modele/livre-normal"
    rm -rf "$REPO/test/out/couv-$modele"
    mkdir -p "$REPO/test/out/couv-$modele"
    cp -a "$REPO/test/livre-normal" "$copie"
    if [ "$modele" = recherche ]; then
      bloc='couverture:\n  modele: recherche'
      # Illustration en JPEG CMJN, comme en exportent InDesign et Photoshop : le PDF écran
      # doit la recevoir en RGB (livre-sorties-check.py).
      "$FONTPY" -c "import sys; from PIL import Image; Image.open(sys.argv[1]).convert('CMYK').save(sys.argv[2], quality=90)" \
        "$REPO/test/livre-falc/couverture/illustration.jpg" "$copie/couverture/illustration.jpg"
    else
      bloc='couverture:\n  modele: prospectrum\n  titre-2: "Un banc // pour la machine"\n  sous-titre-2: "Second titre"'
      sed -i 's/^couleur-impression:.*/couleur-impression: sapin/' "$copie/buch.yaml"
    fi
    sed -i "s|^\(couleur-impression:.*\)$|\1\n$bloc|" "$copie/buch.yaml"
    journal="$REPO/test/out/.couv-$modele.log"
    if ( cd "$copie" && make -f "$REPO/pipeline/Makefile" livre-couverture ) > "$journal" 2>&1; then
      echo "  $modele : compilé"
    else
      echo "  ✗ $modele : ÉCHEC de la couverture"
      sed -n '1,40p' "$journal" | sed 's/^/    /'
      echec=1
      continue
    fi
    if [ -x "$VERAPDF" ]; then
      ua="$REPO/test/out/.couv-$modele.pdfua"
      JAVA_HOME="$VERAPDF_JAVA" "$VERAPDF" --flavour ua1 --format text \
        "$copie/out/livre-normal-couverture.pdf" > "$ua" 2>&1
      if grep -q "^FAIL" "$ua" || ! grep -q "^PASS" "$ua"; then
        echo "  ✗ $modele : PDF/UA-1 NON conforme"
        sed 's/^/    /' "$ua"
        echec=1
      fi
    fi
    if [ -x "$FONTPY" ] || command -v "$FONTPY" >/dev/null 2>&1; then
      sorties="$REPO/test/out/.couv-$modele.sorties"
      "$FONTPY" "$REPO/test/livre-sorties-check.py" "$copie" > "$sorties" 2>&1
      if grep -q "^FAIL" "$sorties" || ! grep -q "^ok" "$sorties"; then
        echo "  ✗ $modele : sorties du livre"
        grep -v "^ok" "$sorties" | sed 's/^/    /'
        echec=1
      else
        echo "  $modele : sorties conformes ($(grep -c '^ok' "$sorties") contrôle(s))"
      fi
    fi
  done
fi

# Maquette normal : le banc livre-collectif (réglages de la HfH-Reihe), puis les cotes des
# deux bancs normal comparées aux livres de référence (livre-cotes-check.py).
if [ -z "$only" ]; then
  echo "=== Maquette normal (livre-collectif, cotes) ==="
  ( cd "$REPO/test/livre-collectif" || exit 1
    rm -rf out
    journal="$REPO/test/out/.livre-collectif.log"
    if ! make -f "$REPO/pipeline/Makefile" livre livre-html-web livre-epub > "$journal" 2>&1; then
      echo "  ✗ livre-collectif : ÉCHEC du build"
      sed -n '1,40p' "$journal" | sed 's/^/    /'
      exit 1
    fi
    if grep -q "non balisé" "$journal"; then
      echo "  ✗ livre-collectif : le PDF est sorti NON BALISÉ"
      exit 1
    fi
    if [ -x "$VERAPDF" ]; then
      ua="$REPO/test/out/.livre-collectif.pdfua"
      JAVA_HOME="$VERAPDF_JAVA" "$VERAPDF" --flavour ua1 --format text out/*.pdf > "$ua" 2>&1
      if grep -q "^FAIL" "$ua" || ! grep -q "^PASS" "$ua"; then
        echo "  ✗ livre-collectif : PDF/UA-1 NON conforme"
        sed 's/^/    /' "$ua"
        exit 1
      fi
      echo "  livre-collectif : PDF/UA-1 conforme ($(grep -c '^PASS' "$ua") fichier(s))"
    fi
  ) || echec=1
  if [ -x "$FONTPY" ] || command -v "$FONTPY" >/dev/null 2>&1; then
    for livre in livre-normal livre-collectif; do
      cotes="$REPO/test/out/.$livre.cotes"
      "$FONTPY" "$REPO/test/livre-cotes-check.py" "$REPO/test/$livre" > "$cotes" 2>&1
      if grep -q "^FAIL" "$cotes" || ! grep -q "^ok" "$cotes"; then
        echo "  ✗ $livre : cotes de la maquette"
        grep -v "^ok" "$cotes" | sed 's/^/    /'
        echec=1
      else
        echo "  $livre : $(grep '^ok' "$cotes" | sed 's/^ok *| //')"
      fi
    done
  fi
fi

# EPUB : contrôle de structure sans dépendance externe (voir epub-check.py).
if [ -z "$only" ] && [ -f "$REPO/test/epub-check.py" ]; then
  echo "=== EPUB (structure) ==="
  for livre in livre-normal livre-falc; do
    for epub in "$REPO/test/$livre"/out/*.epub; do
      [ -f "$epub" ] || continue
      python3 "$REPO/test/epub-check.py" "$epub" | sed 's/^/  /' || echec=1
    done
  done
fi

# Polices : aucun PDF ne doit embarquer une police absente de pipeline/fonts/. Sinon un
# caractère non couvert est remplacé par fontconfig avec une police du poste, et le PDF
# change d'un poste à l'autre. En dernier, sur les deux dossiers de sorties.
if [ -z "$only" ]; then
  echo "=== Polices ==="
  if [ -x "$FONTPY" ] || command -v "$FONTPY" >/dev/null 2>&1; then
    journal="out/.polices.log"
    PYTHONIOENCODING=utf-8 "$FONTPY" polices-check.py out accessibilite/out > "$journal" 2>&1 || echec=1
    sed 's/^/  /' "$journal"
  else
    echo "  (contrôle ignoré : interpréteur fontTools introuvable en $FONTPY)"
  fi
  # Les deux `--verifier` : un glyphe qui manque après une réinstanciation des faces, ou
  # une face de titre dont les métriques ont changé (escalier des titres).
  if [ -x "$FONTPY" ] || command -v "$FONTPY" >/dev/null 2>&1; then
    journal="out/.glyphes-manquants.log"
    "$FONTPY" "$REPO/pipeline/fonts/glyphes-manquants.py" --verifier > "$journal" 2>&1 || echec=1
    sed 's/^/  /' "$journal"
  else
    echo "  (glyphes manquants : contrôle ignoré, interpréteur fontTools introuvable en $FONTPY)"
  fi
  # Sans dépendance : python3 suffit.
  if command -v python3 >/dev/null 2>&1; then
    journal="out/.metriques-titre.log"
    python3 metriques-titre.py --verifier > "$journal" 2>&1 || echec=1
    sed 's/^/  /' "$journal"
  else
    echo "  (métriques du titre : contrôle ignoré, python3 introuvable)"
  fi
fi
exit $echec
