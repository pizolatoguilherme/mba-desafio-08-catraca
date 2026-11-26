#!/bin/sh
# npm run down: encerra os containers do produto (o volume do banco é mantido) e
# limpa o projeto -gates, caso tenha sobrado de um gates interrompido.
set -eu

cd "$(dirname "$0")/.."

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 é necessário" >&2
  exit 1
fi

docker compose down --remove-orphans
docker compose -p "${COMPOSE_PROJECT_NAME:-catraca}-gates" -f compose.gates.yaml down -v --remove-orphans
