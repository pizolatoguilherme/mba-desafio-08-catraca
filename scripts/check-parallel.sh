#!/bin/sh
# Prova de paralelismo entre PRs: para cada par (i, j), i != j, exige que o primeiro commit de i
# seja anterior ao último commit de j (datas authoredDate, que não mudam em rebase).
# Uso: scripts/check-parallel.sh <pr> <pr> [...]
# Saída: 0 se todos os pares passam, 1 se algum falha, 2 com menos de 2 PRs ou sem gh no PATH.
set -eu

usage() {
  echo "Uso: scripts/check-parallel.sh <pr> <pr> [...]"
  exit 2
}

[ "$#" -ge 2 ] || usage
command -v gh >/dev/null 2>&1 || usage

TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

for pr in "$@"; do
  if ! dates=$(gh pr view "$pr" --json commits --jq '.commits[].authoredDate'); then
    echo "FALHA: não foi possível ler os commits do PR #$pr"
    exit 1
  fi
  dates=$(printf '%s\n' "$dates" | grep -v '^$' | sort || true)
  if [ -z "$dates" ]; then
    echo "FALHA: o PR #$pr não tem commits"
    exit 1
  fi
  first=$(printf '%s\n' "$dates" | head -n 1)
  last=$(printf '%s\n' "$dates" | tail -n 1)
  echo "$pr $first $last" >> "$TMP"
done

# Comparação lexicográfica das strings ISO UTC (forçada como texto no awk).
before() {
  awk 'BEGIN { exit !((ARGV[1] "") < (ARGV[2] "")) }' "$1" "$2"
}

failed=0
while read -r pi fi_ li_; do
  while read -r pj fj_ lj_; do
    [ "$pi" = "$pj" ] && continue
    if before "$fi_" "$lj_"; then
      echo "OK #$pi primeiro=$fi_ < #$pj último=$lj_"
    else
      echo "FALHA #$pi primeiro=$fi_ >= #$pj último=$lj_"
      failed=1
    fi
  done < "$TMP"
done < "$TMP"

exit "$failed"
