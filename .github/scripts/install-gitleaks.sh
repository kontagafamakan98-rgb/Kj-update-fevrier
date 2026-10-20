#!/bin/sh
# Installe gitleaks dans un répertoire dédié — VERSION ÉPINGLÉE ET EMPREINTE
# VÉRIFIÉE, jamais « la dernière ».
#
# ── Pourquoi ce script existe ───────────────────────────────────────────────
# Le dépôt épingle déjà ses `uses:` (cf. check-workflow-pins.py) : une action
# non résoluble ou déplacée fait rougir un job AVANT ses étapes. Un binaire
# téléchargé à la volée a le même défaut, en pire — rien ne vérifie qu'il est
# celui qu'on croit. Ici la version est une CONSTANTE, l'archive est comparée à
# l'empreinte SHA-256 publiée par la même release, et un désaccord ARRÊTE le
# job : un scanner qui ne s'installe pas n'est pas un scanner qui laisse passer.
#
# La source unique du numéro de version et de l'empreinte est CE FICHIER (le
# job de PR et la passe d'historique l'appellent tous les deux) : deux copies
# divergeraient en silence, exactement comme les deux seuils de temps du flux.
#
# ── Ce qu'il ne fait pas ────────────────────────────────────────────────────
# Il n'installe que la variante linux x64, celle des runners GitHub : ce n'est
# pas un installeur multiplateforme. Sur un poste, prendre l'archive de sa
# plateforme dans la même release et la vérifier de la même façon.
#
# Usage : sh .github/scripts/install-gitleaks.sh [répertoire_destination]
#         (ajoute le répertoire à GITHUB_PATH quand la variable est posée)
set -eu

GITLEAKS_VERSION="8.30.1"
# Empreinte de `gitleaks_8.30.1_linux_x64.tar.gz`, telle que publiée dans
# `gitleaks_8.30.1_checksums.txt` de la même release.
GITLEAKS_SHA256="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"

DEST="${1:-${RUNNER_TEMP:-/tmp}/gitleaks-bin}"
ARCHIVE_NAME="gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
URL="https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${ARCHIVE_NAME}"

mkdir -p "$DEST"
ARCHIVE="$DEST/$ARCHIVE_NAME"

echo "gitleaks ${GITLEAKS_VERSION} → ${DEST} (empreinte vérifiée)"
curl -fsSL --retry 3 --retry-delay 2 -o "$ARCHIVE" "$URL"

# `sha256sum -c` sort en 1 sur un désaccord : avec `set -e`, le job s'arrête ici
# plutôt que d'exécuter un binaire dont l'origine n'est plus prouvée.
printf '%s  %s\n' "$GITLEAKS_SHA256" "$ARCHIVE" | sha256sum -c -

tar -xzf "$ARCHIVE" -C "$DEST" gitleaks
chmod +x "$DEST/gitleaks"
rm -f "$ARCHIVE"

"$DEST/gitleaks" version

if [ -n "${GITHUB_PATH:-}" ]; then
  printf '%s\n' "$DEST" >> "$GITHUB_PATH"
fi
