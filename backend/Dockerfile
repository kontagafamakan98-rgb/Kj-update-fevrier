# -*- Dockerfile -*-
# Kojo Backend — image de production (FastAPI + uvicorn)
# Utilisée par Fly.io via backend/fly.toml. Fonctionne aussi sur tout hôte Docker.
#
# Runtime : Python 3.11 (même version que le déploiement Render actuel).
# Note : requirements.txt contient aussi les outils de dev (pytest, black, mypy…).
#        Ils ne gênent pas le fonctionnement et évitent de dupliquer le fichier
#        de dépendances ; on pourra alléger l'image plus tard si besoin.

FROM python:3.11-slim

# Python en mode conteneur : pas de .pyc, sortie non bufferisée, pip silencieux
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# --- Dépendances (couche séparée : mise en cache des builds) ---
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# --- Polices DejaVu pour les cartes Open Graph dynamiques (/api/og/jobs/:id)
# --- rendues avec Pillow : sans police système, le texte serait illisible
# --- (les wheels Pillow embarquent le codec PNG mais aucune police).
RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# --- Code applicatif (le backend vit à plat dans /app) ---
COPY kojo_*.py server.py ./

# --- Utilisateur non-root (sécurité) ---
RUN useradd --create-home --shell /usr/sbin/nologin kojo \
    && chown -R kojo:kojo /app
USER kojo

EXPOSE 8080

# $PORT est injecté par Fly.io (8080 par défaut) ; défaut local 8080.
# Un seul worker : la RAM de l'instance est limitée, et l'API est async
# (Motor/asyncpg-style), donc un seul process suffit largement.
CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-8080} --workers ${WEB_CONCURRENCY:-1}"]
