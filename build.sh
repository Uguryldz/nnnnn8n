#!/usr/bin/env bash
#
# Build n8n (compiled/) + Docker image (tek dockerfile)
# Kullanım:
#   ./build.sh              # build + image (varsayılan tag: ihub:latest)
#   ./build.sh v2.0.13     # tag verir (eski: docker build --no-cache -t abradockerhub/ihub:v2.0.13 .)
#   IMAGE_NAME=myreg/ihub ./build.sh v1.0
#
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

IMAGE_NAME="${IMAGE_NAME:-abradockerhub/ihub}"
IMAGE_TAG="${1:-latest}"

echo "===== 1/2 n8n build (compiled/) ====="
pnpm run build:deploy

echo ""
echo "===== 2/2 Docker image ====="
echo "Image: ${IMAGE_NAME}:${IMAGE_TAG}"
docker build --no-cache -f dockerfile -t "${IMAGE_NAME}:${IMAGE_TAG}" .

echo ""
echo "Tamamlandı: ${IMAGE_NAME}:${IMAGE_TAG}"
