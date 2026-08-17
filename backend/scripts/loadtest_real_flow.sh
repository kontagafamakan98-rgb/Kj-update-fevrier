#!/bin/bash
# ============================================================================
# Test de charge du FLUX RÉEL (auth + paiement) sur le backend Kojo.
#
# Valide la machine Fly 256 Mo sur le chemin le plus lourd :
#   - Wave A : POST /auth/login (bcrypt, le CPU le plus coûteux)
#   - Wave B : POST /payments/quote (décomposition commission)
#   - Wave C : POST /payments/checkout avec montant < 200 FCFA
#              → renvoie 400 AVANT tout appel PayDunya : la facture n'est
#                JAMAIS créée, donc aucun risque de paiement réel, même en
#                mode live (PAYDUNYA_MODE=live).
#
# Prérequis :
#   - flyctl dans le PATH (ou définir FLYCTL), app `kojo-backend`
#   - un utilisateur réel existant (email/password) pour la vague login
#   - un jeton (voir KOJO_LT_TOKEN) : générable côté serveur via
#     `flyctl ssh console -C "python -c '...create_access_token...'"` pour
#     ne pas consommer le quota login (20/5min/IP).
#
# Usage :
#   KOJO_LT_EMAIL=... KOJO_LT_PASSWORD=... KOJO_LT_TOKEN=... \
#     bash backend/scripts/loadtest_real_flow.sh
# ============================================================================
set -u
BASE="${KOJO_LT_BASE:-https://kojo-backend.fly.dev}"
FLYCTL="${FLYCTL:-flyctl}"
APP="${KOJO_LT_APP:-kojo-backend}"
OUT=/tmp/lt
rm -rf "$OUT"; mkdir -p "$OUT"

EMAIL="${KOJO_LT_EMAIL:?KOJO_LT_EMAIL requis (utilisateur réel)}"
PASSWORD="${KOJO_LT_PASSWORD:?KOJO_LT_PASSWORD requis}"
TOKEN="${KOJO_LT_TOKEN:-}"

if [ -z "$TOKEN" ]; then
  echo "⚠️  KOJO_LT_TOKEN vide : les vagues B/C seront non authentifiées (403)."
fi

sample_mem() {
  "$FLYCTL" ssh console -a "$APP" -C "sh -c 'grep MemAvailable /proc/meminfo'" 2>/dev/null \
    | grep -o '[0-9]* kB' | head -1
}

echo "=== baseline mem: $(sample_mem) ==="

# Wave A : login (bcrypt) — 19 concurrents (sous la limite 20/5min/IP)
echo "=== wave A: login (bcrypt) — 19 concurrents ==="
for i in $(seq 1 19); do
  ( curl -s -o "$OUT/a_$i.txt" -w "%{http_code}" -X POST "$BASE/api/auth/login" \
      -H "Content-Type: application/json" \
      -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" > "$OUT/a_$i.code" ) &
done
wait
echo "mem A: $(sample_mem)"

# Wave B : quote (auth + commission) — 20 concurrents
echo "=== wave B: quote — 20 concurrents ==="
for i in $(seq 1 20); do
  ( curl -s -o "$OUT/b_$i.txt" -w "%{http_code}" -X POST "$BASE/api/payments/quote" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -d '{"amount":50000,"payment_method":"orange_money","country":"senegal"}' > "$OUT/b_$i.code" ) &
done
wait
echo "mem B: $(sample_mem)"

# Wave C : checkout avec montant < 200 (garde 400 AVANT tout appel PayDunya)
echo "=== wave C: checkout (min-amount guard) — 20 concurrents ==="
for i in $(seq 1 20); do
  ( curl -s -o "$OUT/c_$i.txt" -w "%{http_code}" -X POST "$BASE/api/payments/checkout" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -d '{"amount":100,"payment_method":"orange_money","country":"senegal"}' > "$OUT/c_$i.code" ) &
done
wait
echo "mem C: $(sample_mem)"

echo "=== final mem: $(sample_mem) ==="
echo "=== codes (a=login b=quote c=checkout) ==="
for p in a b c; do
  echo "wave $p: $(cat "$OUT"/${p}_*.code | sort | uniq -c | tr '\n' ' ')"
done
