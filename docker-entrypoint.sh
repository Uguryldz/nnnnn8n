#!/bin/sh
set -e
# Docker-compose worker: command ["./bin/n8n", "worker"] uyumluluğu (binary /usr/local/bin/n8n'de)
case "$1" in
  ./bin/n8n|bin/n8n|n8n) shift ;;
esac
exec /usr/local/bin/n8n "$@"
