#!/bin/sh
# npm run gates            -> lint + typecheck + testes (npm run gates:inner) no container "gates"
# npm run gates -- <args>  -> npx vitest run <args> no mesmo container (testes nomeados)
# Projeto Compose isolado: ${COMPOSE_PROJECT_NAME:-catraca}-gates, com Postgres efêmero (tmpfs).
# Ao final (sucesso, falha ou interrupção), tudo do projeto -gates é derrubado com down -v.
set -eu

cd "$(dirname "$0")/.."

PROJECT="${COMPOSE_PROJECT_NAME:-catraca}-gates"

dc() {
  docker compose -p "$PROJECT" -f compose.gates.yaml "$@"
}

cleanup() {
  dc down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 é necessário" >&2
  exit 1
fi

status=0
if [ "$#" -eq 0 ]; then
  dc up --build --attach gates --abort-on-container-exit --exit-code-from gates || status=$?
else
  dc build gates || status=$?
  if [ "$status" -eq 0 ]; then
    dc run --rm -T gates npx vitest run "$@" || status=$?
  fi
fi

if [ "$status" -eq 0 ]; then
  echo "gates: OK"
else
  echo "gates: FALHOU (exit $status)" >&2
fi
exit "$status"
