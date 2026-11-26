#!/bin/sh
# npm run up: constrói as imagens e sobe db + app. Só retorna quando o app está healthy
# (o entrypoint roda migrate -> seed -> server, e o healthcheck chama /healthz).
set -eu

cd "$(dirname "$0")/.."

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 é necessário" >&2
  exit 1
fi

if docker compose up -d --build --wait --wait-timeout 300; then
  echo "Catraca no ar: http://localhost:${CATRACA_PORT:-3000}"
else
  status=$?
  echo "A Catraca não ficou saudável. Últimas linhas do log do app:" >&2
  docker compose logs --tail 100 app >&2 || true
  exit "$status"
fi
