# -*- coding: utf-8 -*-
"""En-têtes de sécurité : sur CHAQUE réponse, y compris les refus.

Deux choses se mesurent ici, et la seconde est celle qui manquait :

  1. la politique est posée par le middleware (`WestAfricaSecurityMiddleware`),
     donc elle doit accompagner aussi un 404 et un refus — pas seulement la
     réponse heureuse qu'on regarde en développement. Un en-tête absent sur la
     page d'erreur est un en-tête absent là où un attaquant travaille ;
  2. `Cross-Origin-Resource-Policy` ferme le chargement d'une réponse d'API
     comme ressource d'un autre site, et `X-Permitted-Cross-Domain-Policies`
     ferme les politiques cross-domain héritées de Flash/PDF.

Le fichier `security.txt` (RFC 9116) est jugé ici aussi : un `Expires` dépassé
rend la politique de divulgation CADUQUE, et rien d'autre ne le dirait — le
fichier resterait servi, l'air valide, deux ans après.
"""
from datetime import datetime, timezone
from pathlib import Path

import pytest
from httpx import AsyncClient

EN_TETES_ATTENDUS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-site",
    "X-Permitted-Cross-Domain-Policies": "none",
}


def _racine_depot() -> Path:
    return Path(__file__).resolve().parents[2]


@pytest.mark.asyncio
class TestEnTetes:
    async def test_une_reponse_normale_porte_toute_la_politique(self, client: AsyncClient):
        reponse = await client.get("/health")

        assert reponse.status_code in (200, 503), reponse.text
        for entete, valeur in EN_TETES_ATTENDUS.items():
            assert reponse.headers.get(entete) == valeur, (
                f"{entete} absent ou inattendu sur une réponse saine : "
                f"{reponse.headers.get(entete)!r}"
            )

    async def test_une_route_inconnue_porte_aussi_la_politique(self, client: AsyncClient):
        """Le 404 est la réponse qu'un scanner reçoit en premier."""
        reponse = await client.get("/api/cette-route-n-existe-pas")

        assert reponse.status_code == 404
        for entete, valeur in EN_TETES_ATTENDUS.items():
            assert reponse.headers.get(entete) == valeur

    async def test_hsts_et_csp_sont_publies(self, client: AsyncClient):
        reponse = await client.get("/health")

        hsts = reponse.headers.get("Strict-Transport-Security", "")
        assert "max-age=" in hsts and "includeSubDomains" in hsts
        csp = reponse.headers.get("Content-Security-Policy", "")
        # Les deux directives qui empêchent une injection de cadre et de base.
        assert "frame-ancestors 'none'" in csp
        assert "base-uri 'self'" in csp
        assert "object-src 'none'" in csp


class TestSecurityTxt:
    """RFC 9116 : Contact obligatoire, Expires obligatoire et FUTUR."""

    @staticmethod
    def _champs() -> dict:
        chemin = _racine_depot() / "frontend" / "public" / ".well-known" / "security.txt"
        assert chemin.is_file(), (
            "security.txt absent : aucune politique de divulgation n'est servie"
        )
        champs = {}
        for ligne in chemin.read_text(encoding="utf-8").splitlines():
            if not ligne.strip() or ligne.startswith("#"):
                continue
            nom, _, valeur = ligne.partition(":")
            champs.setdefault(nom.strip().lower(), []).append(valeur.strip())
        return champs

    def test_contact_et_expires_sont_presents(self):
        champs = self._champs()
        assert champs.get("contact"), "security.txt sans Contact : aucun canal de signalement"
        assert champs["contact"][0].startswith("mailto:")
        assert champs.get("expires"), "security.txt sans Expires : caducité non déclarée"

    def test_la_date_d_expiration_est_dans_le_futur(self):
        expiration = datetime.fromisoformat(
            self._champs()["expires"][0].replace("Z", "+00:00")
        )
        assert expiration > datetime.now(timezone.utc), (
            "security.txt a expiré : la politique de divulgation est caduque, "
            "il faut la renouveler (et c'est le fichier qui le dit, pas un souvenir)"
        )

    def test_la_canonical_designe_l_adresse_publique(self):
        canonical = self._champs().get("canonical", [""])[0]
        assert canonical.startswith("https://"), canonical
        assert "/.well-known/security.txt" in canonical, canonical
