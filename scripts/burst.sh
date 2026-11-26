#!/bin/sh
# Rajada de concorrência (passo 15 do Fluxo do avaliador).
# Em cada rodada: cria um evento novo, publicado, com lotação 5 e preço R$ 10,00 (org A),
# e dispara 30 compras simultâneas pela API de parceiros. Esperado: 5 x 202 e 25 x 409.
# Uso: scripts/burst.sh [rodadas]   (default: 2)
# Variáveis: API (default http://localhost:${CATRACA_PORT:-3000}), KEY (default $PARTNER_API_KEY ou catraca-parceiro-2026).
set -eu

usage() {
  echo "Uso: scripts/burst.sh [rodadas]"
}

case "${1:-}" in
  -h | --help)
    usage
    echo "Cria um evento novo (lotação 5) por rodada e dispara 30 compras simultâneas; espera 5 x 202 e 25 x 409."
    exit 0
    ;;
esac

if [ "$#" -gt 1 ]; then
  usage
  exit 2
fi

ROUNDS="${1:-2}"
case "$ROUNDS" in
  '' | *[!0-9]*)
    usage
    exit 2
    ;;
esac
if [ "$ROUNDS" -lt 1 ]; then
  usage
  exit 2
fi

cd "$(dirname "$0")/.."

API="${API:-http://localhost:${CATRACA_PORT:-3000}}"
KEY="${KEY:-${PARTNER_API_KEY:-catraca-parceiro-2026}}"

failed=0
n=1
while [ "$n" -le "$ROUNDS" ]; do
  E=$(docker compose exec -T db psql -U catraca -d catraca -Atc "INSERT INTO events (id, organizer_id, name, venue, starts_at, capacity, price_cents, status, published_at) SELECT 'evt_' || substr(md5(random()::text), 1, 10), id, 'Rajada $n', 'Local Rajada', now() + interval '7 days', 5, 1000, 'published', now() FROM users WHERE email = 'org.a@catraca.dev' RETURNING id" 2>/dev/null | grep -E '^evt_' | head -n 1 || true)

  if [ -z "$E" ]; then
    echo "Rodada $n (?): não foi possível criar o evento (o produto está no ar? rode npm run up) — FALHOU"
    failed=1
    n=$((n + 1))
    continue
  fi

  # Comando literal do passo 15 do brief, contra o evento recém-criado.
  OUT=$(seq 30 | xargs -P 30 -I{} curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST "$API/api/partner/events/$E/purchases" \
    -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
    -d '{"buyerEmail":"carga{}@example.com","cardNumber":"4000000000000001"}' | sort | uniq -c)

  echo "$OUT"
  c202=$(echo "$OUT" | awk '$2 == "202" { print $1 }')
  c409=$(echo "$OUT" | awk '$2 == "409" { print $1 }')
  c202=${c202:-0}
  c409=${c409:-0}

  if [ "$c202" -eq 5 ] && [ "$c409" -eq 25 ]; then
    result=OK
  else
    result=FALHOU
    failed=1
  fi
  echo "Rodada $n ($E): $c202 x 202, $c409 x 409 — $result"
  n=$((n + 1))
done

exit "$failed"
