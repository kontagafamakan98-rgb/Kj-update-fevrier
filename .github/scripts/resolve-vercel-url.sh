#!/usr/bin/env bash
# Résout l'URL du déploiement Vercel à auditer par Lighthouse CI :
#   - sur pull_request : lit le commentaire posté par l'app Vercel sur la PR
#     (API GitHub, GITHUB_TOKEN automatique — aucun VERCEL_TOKEN requis)
#   - sur push vers main : URL de production
#   - sinon : chaîne vide (le workflow replie sur le build local)
#
# Robustesse : si l'API GitHub échoue (rate-limit HTTP 403, erreur réseau,
# HTTP != 200) ou renvoie un corps inexploitable (JSON invalide, pas une
# liste, aucun commentaire Vercel avec URL), on LOGGUE la cause et on RETOMBE
# proprement sur le build local (LHCI_URL vide) — jamais d'échec de job pour
# une raison d'infrastructure, et le repli est toujours explicite dans les logs.
#
# Sortie : écrit LHCI_URL dans $GITHUB_ENV si résolue, sinon ne fait rien.
set -u

# GH_API_BASE est overridable (tests locaux) ; défaut : API publique GitHub.
GH_API_BASE="${GH_API_BASE:-https://api.github.com}"

LHCI_URL=""
GH_COMMENTS="$(mktemp)"
trap 'rm -f "$GH_COMMENTS"' EXIT

if [ "$GITHUB_EVENT_NAME" = "pull_request" ]; then
  PR_NUMBER="${GITHUB_PR_NUMBER:-}"
  if [ -z "$PR_NUMBER" ]; then
    echo "⚠️  Événement pull_request sans PR number → repli sur le build local"
  else
    # -o : corps dans un fichier temp ; -w : code HTTP sur stdout. Un échec
    # réseau (curl non-zero) est traduit en "000" pour un message explicite.
    HTTP_CODE=$(curl -sS -o "$GH_COMMENTS" -w "%{http_code}" \
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
      LHCI_URL=$(cat "$GH_COMMENTS" | python3 -c "
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
")
      if [ -z "$LHCI_URL" ]; then
        echo "⚠️  Corps GitHub inexploitable (JSON invalide / pas une liste / aucun commentaire Vercel avec URL) → repli sur le build local"
      fi
    fi
  fi
elif [ "$GITHUB_EVENT_NAME" = "push" ] && [ "${GITHUB_REF:-}" = "refs/heads/main" ]; then
  LHCI_URL="https://kj-update-fevrier.vercel.app"
fi

if [ -n "$LHCI_URL" ]; then
  echo "LHCI_URL=$LHCI_URL" >> "$GITHUB_ENV"
  echo "Cible Lighthouse : $LHCI_URL"
else
  echo "URL Vercel non résolue → repli sur le build local"
fi
