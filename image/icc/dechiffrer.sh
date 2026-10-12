#!/usr/bin/env bash
# Déchiffre le profil CMJN PSOuncoated_v3_FOGRA52.icc et vérifie son empreinte.
#
#   bash image/icc/dechiffrer.sh [dossier]      (par défaut : image/icc/)
#
# La phrase de passe est lue dans ICC_GPG_PASSPHRASE, sinon dans le fichier désigné par
# ICC_GPG_PASSPHRASE_FILE. Sans l'une ni l'autre, le script s'arrête avec le code 2.
#
# La licence de l'ECI interdit de distribuer ce profil : le dépôt, public, n'en garde que la
# copie chiffrée. Le fichier en clair n'est jamais suivi (.gitignore).
set -euo pipefail

ICI="$(cd "$(dirname "$0")" && pwd)"
NOM=PSOuncoated_v3_FOGRA52.icc
DEST="${1:-$ICI}"

if [ -z "${ICC_GPG_PASSPHRASE:-}" ] && [ -n "${ICC_GPG_PASSPHRASE_FILE:-}" ]; then
  [ -r "$ICC_GPG_PASSPHRASE_FILE" ] || { echo "dechiffrer.sh : $ICC_GPG_PASSPHRASE_FILE illisible" >&2; exit 2; }
  ICC_GPG_PASSPHRASE="$(head -n 1 "$ICC_GPG_PASSPHRASE_FILE" | tr -d '\r')"
fi
if [ -z "${ICC_GPG_PASSPHRASE:-}" ]; then
  echo "dechiffrer.sh : phrase de passe absente (ICC_GPG_PASSPHRASE ou ICC_GPG_PASSPHRASE_FILE)" >&2
  exit 2
fi

mkdir -p "$DEST"
# Un GNUPGHOME jetable : gpg-agent ne garde pas la phrase en cache sur la machine.
GNUPGHOME="$(mktemp -d)"
export GNUPGHOME
trap 'gpgconf --kill gpg-agent >/dev/null 2>&1 || true; rm -rf "$GNUPGHOME"' EXIT

printf '%s' "$ICC_GPG_PASSPHRASE" \
  | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 0 \
        -o "$DEST/$NOM" -d "$ICI/$NOM.gpg"

if ! (cd "$DEST" && sha256sum -c --quiet "$ICI/$NOM.sha256"); then
  rm -f "$DEST/$NOM"
  echo "dechiffrer.sh : empreinte inattendue, profil effacé" >&2
  exit 1
fi
echo "dechiffrer.sh : $DEST/$NOM"
