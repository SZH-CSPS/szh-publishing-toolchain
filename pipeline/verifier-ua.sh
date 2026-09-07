#!/bin/bash
# Logique de la porte PDF/UA-1 (cible `verifier-ua` du Makefile) : garde-fous d'outillage,
# appel de veraPDF, traduction du rapport par rapport-ua.py. Voir le commentaire du Makefile
# pour le pourquoi des deux pièges de codes de sortie ; ici, seulement le comment faire.
#
# Usage : verifier-ua.sh <xml|-> <pdf>...
#   <xml> : chemin du rapport XML de veraPDF à écrire (et à garder), ou « - » pour un
#           fichier temporaire (mktemp) effacé à la fin — c'est ce que le cockpit demande
#           quand il valide en tâche de fond, sans dossier out/ à salir.
#
# Sortie : 0 tous les PDF sont conformes PDF/UA-1, 1 au moins un ne l'est pas (verdict),
# 2 panne d'outillage (validateur ou runtime absent, veraPDF en échec, rapport illisible).
set -u

VERAPDF="${VERAPDF:-/opt/verapdf-cli/verapdf}"
VERAPDF_JAVA="${VERAPDF_JAVA:-/opt/jre-min}"
PIPELINE_DIR="${PIPELINE_DIR:-$(cd "$(dirname "$0")" && pwd)}"

xml_arg="$1"
shift

if [ ! -x "$VERAPDF" ]; then
  echo "[pdf-ua] ✗ Validateur PDF/UA introuvable : $VERAPDF"
  echo "[pdf-ua]   À faire : mettre l'image WSL à jour (elle embarque veraPDF), ou poser VERAPDF=<chemin>."
  echo "[pdf-ua] [de] ✗ PDF/UA-Prüfer nicht gefunden: $VERAPDF"
  echo "[pdf-ua] [de]   Zu tun: WSL-Abbild aktualisieren (es enthält veraPDF), oder VERAPDF=<Pfad> setzen."
  exit 2
fi
if [ -n "$VERAPDF_JAVA" ] && [ ! -x "$VERAPDF_JAVA/bin/java" ]; then
  echo "[pdf-ua] ✗ Le runtime Java du validateur est introuvable : $VERAPDF_JAVA/bin/java"
  echo "[pdf-ua]   Pourquoi on s'arrête ici : sans lui, veraPDF sort en code 1, celui qui veut dire « PDF non conforme ». La porte accuserait des PDF parfaits."
  echo "[pdf-ua]   À faire : mettre l'image WSL à jour (elle embarque le runtime), ou poser VERAPDF_JAVA=<dossier du JRE> — vide si la commande java est déjà dans le PATH."
  echo "[pdf-ua] [de] ✗ Die Java-Laufzeit des Prüfers fehlt: $VERAPDF_JAVA/bin/java"
  echo "[pdf-ua] [de]   Warum hier abgebrochen wird: ohne sie endet veraPDF mit Code 1, dem Code für « PDF nicht konform ». Die Kontrolle würde einwandfreie PDF beschuldigen."
  echo "[pdf-ua] [de]   Zu tun: WSL-Abbild aktualisieren (es enthält die Laufzeit), oder VERAPDF_JAVA=<JRE-Ordner> setzen — leer, wenn java schon im PATH liegt."
  exit 2
fi

tmp_dir=""
if [ "$xml_arg" = "-" ]; then
  tmp_dir=$(mktemp -d)
  xml="$tmp_dir/pdfua.xml"
  err="$tmp_dir/pdfua.err"
else
  xml="$xml_arg"
  err="${xml_arg%.xml}.err"
fi
nettoyer() { [ -n "$tmp_dir" ] && rm -rf "$tmp_dir"; }
trap nettoyer EXIT

JAVA_HOME="$VERAPDF_JAVA" "$VERAPDF" --flavour ua1 --format xml "$@" > "$xml" 2> "$err"
code=$?
if [ "$code" -gt 1 ]; then
  echo "[pdf-ua] ✗ Le validateur PDF/UA n'a pas pu rendre de verdict (code $code) — ce n'est pas un PDF conforme, c'est une panne d'outillage."
  echo "[pdf-ua] [de] ✗ Der PDF/UA-Prüfer konnte kein Urteil abgeben (Code $code) — das ist kein konformes PDF, sondern eine Werkzeugstörung."
  sed -n '1,10p' "$err" | sed 's/^/[pdf-ua]   /'
  exit 2
fi

PYTHONIOENCODING=utf-8 python3 "$PIPELINE_DIR/rapport-ua.py" "$xml"
rc=$?
if [ "$rc" -gt 1 ]; then
  echo "[pdf-ua]   Sortie d'erreur du validateur, telle quelle :"
  echo "[pdf-ua] [de]   Fehlerausgabe des Prüfers, unverändert:"
  sed -n '1,10p' "$err" | sed 's/^/[pdf-ua]   /'
fi
exit $rc
