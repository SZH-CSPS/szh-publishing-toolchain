#!/usr/bin/env bash
# Construit le rootfs WSL reproductible et l'exporte en .tar.gz, avec son sha256.
# Podman en local, ENGINE=docker sous GitHub Actions.
# Version : premier argument, sinon $DISTRO_VERSION, sinon la valeur par défaut.
set -euo pipefail

DISTRO_VERSION="${1:-${DISTRO_VERSION:-2026.06.1}}"
ENGINE="${ENGINE:-podman}"
PANDOC_VERSION="${PANDOC_VERSION:-3.5}"
FONTS="${FONTS:-fonts-noto fonts-dejavu}"      # filet pour les caractères rares ; la maquette embarque les siennes
IMAGE="szh-publishing:${DISTRO_VERSION}"
OUT="szh-publishing-rootfs-${DISTRO_VERSION}.tar.gz"

echo ">> [${ENGINE}] build ${IMAGE}"
# -f Containerfile : docker ne le détecte pas tout seul, podman si.
"${ENGINE}" build -f Containerfile \
  --build-arg "PANDOC_VERSION=${PANDOC_VERSION}" \
  --build-arg "FONTS=${FONTS}" \
  --build-arg "DISTRO_VERSION=${DISTRO_VERSION}" \
  -t "${IMAGE}" .

echo ">> export rootfs (.tar.gz — accepté nativement par wsl --import)"
cid="$("${ENGINE}" create "${IMAGE}")"
"${ENGINE}" export "${cid}" | gzip -9 > "${OUT}"
"${ENGINE}" rm "${cid}" >/dev/null

echo ">> empreinte"
sha256sum "${OUT}" | tee "${OUT}.sha256"
echo "OK -> ${OUT}"
