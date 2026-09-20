#!/usr/bin/env bash
# Résout l'URL du déploiement Vercel à auditer par Lighthouse CI :
#   - sur pull_request : lit le commentaire posté par l'app Vercel sur la PR
#     (API GitHub, GITHUB_TOKEN automatique — aucun VERCEL_TOKEN requis)
#   - sur push vers main : AUCUNE URL — le job audite la pile locale qu'il
#     contrôle (voir « Pourquoi main n'audite plus le domaine de production »)
#   - sinon : chaîne vide (le workflow replie sur le build local)
#
# ── Pourquoi main n'audite plus le domaine de production ──────────────────────
# Le 20/09/2026, deux runs de `main` sur un arbre INCHANGÉ sont tombés rouges
# avec « Lighthouse was unable to reliably load the page you requested.
# (Status code: 403) », sur /privacy puis sur /dashboard. La cause n'est pas le
# code : l'edge Vercel répond un DÉFI de sécurité à un client qui le sollicite
# en rafale depuis une IP de runner — reproduit à la main le 20/09/2026 :
#   • 45 requêtes d'affilée sur /dashboard → 200 jusqu'à la 33e, puis 403 ;
#   • en-têtes du 403 : `X-Vercel-Mitigated: challenge`,
#     `X-Vercel-Challenge-Token: …`, corps « Vercel Security Checkpoint ».
# Le collect Lighthouse charge ~39 documents (13 pages × 3 runs) plus les
# sous-ressources : il franchit ce seuil vers la fin de sa matrice, donc le
# verdict dépendait d'un quota côté tiers — un rouge au hasard sur main, pire
# qu'aucun gate. Auditer une surface que le job CONTRÔLE (build servi par le
# serveur de rewrites local + backend local) rend le même entrée → même verdict,
# au prix nommé dans CI-COVERAGE.md : le comportement du CDN (cache, HTTP/2,
# compression) n'est plus mesuré par ce job — il reste observé par les sondes de
# production (check-seo-production, check-cors-preflight).

# Robustesse : si l'API GitHub échoue (rate-limit HTTP 403, erreur réseau,
# HTTP != 200) ou renvoie un corps inexploitable (JSON invalide, pas une
# liste, aucun commentaire Vercel avec URL), on LOGGUE la cause et on RETOMBE
# proprement sur le build local (KOJO_LHCI_BASE_URL vide) — jamais d'échec de job pour
# une raison d'infrastructure, et le repli est toujours explicite dans les logs.
#
# Sortie : écrit KOJO_LHCI_BASE_URL dans $GITHUB_ENV si résolue, sinon ne fait rien.
set -u

# GH_API_BASE est overridable (tests locaux) ; défaut : API publique GitHub.
GH_API_BASE="${GH_API_BASE:-https://api.github.com}"

KOJO_LHCI_BASE_URL=""
GH_COMMENTS="$(mktemp)"
trap 'rm -f "$GH_COMMENTS"' EXIT

if [ "$GITHUB_EVENT_NAME" = "pull_request" ]; then
  PR_NUMBER="${GITHUB_PR_NUMBER:-}"
  if [ -z "$PR_NUMBER" ]; then
    echo "⚠️  Événement pull_request sans PR number → repli sur le build local"
  else
    # -o : corps dans un fichier temp ; -w : code HTTP sur stdout. Un échec
    # réseau (curl non-zero) est traduit en "000" pour un message explicite.
    # --max-time/--retry BORNENT l'appel : sans délai, une API qui ne répond
    # pas faisait pendre le job jusqu'au timeout du runner (rouge après des
    # heures, sans diagnostic) au lieu du repli documenté ci-dessous.
    HTTP_CODE=$(curl -sS -o "$GH_COMMENTS" -w "%{http_code}" \
      --max-time 20 --retry 2 --retry-delay 1 --retry-connrefused \
      -H "Authorization: Bearer ${GITHUB_TOKEN:-}" \
      -H "Accept: application/vnd.github+json" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      "$GH_API_BASE/repos/$GITHUB_REPOSITORY/issues/${PR_NUMBER}/comments" 2>/dev/null) || HTTP_CODE="000"

    if [ "$HTTP_CODE" = "000" ]; then
      echo "⚠️  API GitHub injoignable (erreur réseau) → repli sur le build local"
    elif [ "$HTTP_CODE" = "403" ]; then
      echo "⚠️  API GitHub en rate-limit (HTTP 403) → repli sur le build local"
    elif [ "$HTTP_CODE" != "200" ]; then
      echo "⚠️  API GitHub HTTP $HTTP_CODE → repli sur le build local"
    else
      # Corps 200 : doit être une LISTE JSON de commentaires. Corps invalide,
      # structure inattendue ou aucun commentaire Vercel → repli.
      KOJO_LHCI_BASE_URL=$(python3 -c "
import json, re, sys
try:
    data = json.load(sys.stdin)
    if not isinstance(data, list):
        sys.exit()
    for c in data:
        if not isinstance(c, dict):
            continue
        user = c.get('user')
        if not isinstance(user, dict) or user.get('login') != 'vercel[bot]':
            continue
        m = re.search(r'https://[a-z0-9-]+\.vercel\.app', c.get('body') or '')
        if m:
            print(m.group(0))
            sys.exit()
except Exception:
    sys.exit()
" < "$GH_COMMENTS")
      if [ -z "$KOJO_LHCI_BASE_URL" ]; then
        echo "⚠️  Corps GitHub inexploitable (JSON invalide / pas une liste / aucun commentaire Vercel avec URL) → repli sur le build local"
      fi
    fi
  fi
fi
# push vers main : volontairement AUCUNE URL. Le domaine de production répond
# un défi de sécurité à un client qui le sollicite en rafale depuis une IP de
# runner (mesuré, cf. l'en-tête) : le job audite donc la pile locale, déterministe
# et qu'il contrôle de bout en bout.

# ── Détection de la protection de déploiement Vercel (Deployment Protection) ──
# Sur les PR, l'app Vercel peut être protégée (SSO) : toutes les pages servent
# alors l'interstitiel vercel.com (redirect vers vercel.com/login, ou og:image
# "vercel.com/api/product-og?product=protected-deployment") au lieu de l'app.
# Auditer ce mur de login n'a aucune valeur — on RETOMBE sur le build local
# (le code de la PR). La prod (main) n'est jamais protégée : pas de probe.
if [ -n "$KOJO_LHCI_BASE_URL" ] && [ "$GITHUB_EVENT_NAME" = "pull_request" ]; then
  PROBE_BODY="$(mktemp)"
  PROBE_URL="$(curl -sSL -o "$PROBE_BODY" -w "%{url_effective}" --max-time 20 "$KOJO_LHCI_BASE_URL/" 2>/dev/null)" || PROBE_URL=""
  PROTECTED=0
  case "$PROBE_URL" in
    *vercel.com/login*|*vercel.com/accounts*|*product-og*) PROTECTED=1 ;;
  esac
  if grep -q "protected-deployment" "$PROBE_BODY" 2>/dev/null; then PROTECTED=1; fi
  rm -f "$PROBE_BODY"
  if [ "$PROTECTED" = "1" ]; then
    echo "⚠️  Preview Vercel PROTÉGÉE (Deployment Protection active, redirigée vers ${PROBE_URL:-<vide>}) → repli sur le build local (le code de la PR)"
    KOJO_LHCI_BASE_URL=""
  else
    echo "Preview Vercel accessible (aucune protection détectée) : $KOJO_LHCI_BASE_URL"
  fi
fi

if [ -n "$KOJO_LHCI_BASE_URL" ]; then
  echo "KOJO_LHCI_BASE_URL=$KOJO_LHCI_BASE_URL" >> "$GITHUB_ENV"
  echo "Cible Lighthouse : $KOJO_LHCI_BASE_URL"
else
  echo "URL Vercel non résolue → repli sur le build local"
fi
