#!/usr/bin/env bash
# Construit le rootfs WSL reproductible et l'exporte en .tar.gz, avec son sha256.
# Podman en local, ENGINE=docker sous GitHub Actions.
# Version : premier argument, sinon $DISTRO_VERSION, sinon la valeur par défaut.
# Le profil CMJN se déchiffre avec ICC_GPG_PASSPHRASE ou ICC_GPG_PASSPHRASE_FILE
# (icc/dechiffrer.sh) ; sans phrase de passe, la construction s'arrête.
set -euo pipefail

cd "$(dirname "$0")"

DISTRO_VERSION="${1:-${DISTRO_VERSION:-2026.06.1}}"
ENGINE="${ENGINE:-podman}"
PANDOC_VERSION="${PANDOC_VERSION:-3.7.0.2}"
FONTS="${FONTS:-fonts-noto fonts-dejavu}"      # filet pour les caractères rares ; la maquette embarque les siennes
IMAGE="szh-publishing:${DISTRO_VERSION}"
OUT="szh-publishing-rootfs-${DISTRO_VERSION}.tar.gz"
ICC_CLAIR="icc/PSOuncoated_v3_FOGRA52.icc"

echo ">> déchiffrement du profil CMJN"
trap 'rm -f "${ICC_CLAIR}"' EXIT
bash icc/dechiffrer.sh icc

echo ">> [${ENGINE}] build ${IMAGE}"
# -f Containerfile : docker ne le détecte pas tout seul, podman si.
"${ENGINE}" build -f Containerfile \
  --build-arg "PANDOC_VERSION=${PANDOC_VERSION}" \
  --build-arg "FONTS=${FONTS}" \
  --build-arg "DISTRO_VERSION=${DISTRO_VERSION}" \
  -t "${IMAGE}" .
rm -f "${ICC_CLAIR}"

echo ">> export rootfs (.tar.gz — accepté nativement par wsl --import)"
cid="$("${ENGINE}" create "${IMAGE}")"
"${ENGINE}" export "${cid}" | gzip -9 > "${OUT}"
"${ENGINE}" rm "${cid}" >/dev/null

echo ">> empreinte"
sha256sum "${OUT}" | tee "${OUT}.sha256"
echo "OK -> ${OUT}"
