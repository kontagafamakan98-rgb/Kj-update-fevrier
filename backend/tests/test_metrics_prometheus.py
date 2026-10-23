# -*- coding: utf-8 -*-
"""Métriques Prometheus : ce que `/metrics` publie, et à qui.

Ce qui est mesuré ici, et pourquoi chaque cas existe :

  • SANS jeton configuré, la route REFUSE (503 nommée) et ne publie aucun nom de
    métrique — un endpoint de métriques ouvert est une surface aveugle de plus,
    pas une observation ;
  • un jeton absent, faux ou d'un autre schéma ne publie RIEN (401) : la
    comparaison est celle du jeton, pas la présence d'un en-tête ;
  • avec le jeton, le texte est celui que Prometheus lit (`version=0.0.4`) et
    les valeurs sont CELLES DES COMPTEURS, lues par les accesseurs des modules
    propriétaires — la preuve est faite sur les compteurs réels, pas seulement
    sur des doublures ;
  • une date ne sort JAMAIS en étiquette (cardinalité) mais en secondes epoch,
    et une date illisible vaut 0 — « jamais », pas « maintenant » ;
  • la collecte est DÉCLARÉE : chaque famille publiée est nommée dans
    `backend/METRIQUES.md`, qui porte aussi le bloc de scrape. Une métrique que
    personne ne collecte ne mesure rien, et une doc qui prend du retard sur le
    code est une doc qui ment.
"""
from datetime import datetime, timezone
from pathlib import Path

from httpx import AsyncClient

import kojo_metrics
from kojo_live import active_streams, bus_actif, bus_stats, partage_stats
from kojo_rate_limit import rate_limit_en_redis, rate_limit_stats
from kojo_auth_core import revocation_stats

JETON = "jeton-de-mesure-de-test"
ENTETE = {"Authorization": f"Bearer {JETON}"}


def _racine_backend() -> Path:
    return Path(__file__).resolve().parents[1]


async def _lire(client: AsyncClient, entetes=None) -> str:
    reponse = await client.get("/metrics", headers=entetes)
    assert reponse.status_code == 200, reponse.text
    return reponse.text


def _valeur(texte: str, nom: str) -> str:
    """Valeur publiée pour une famille (une ligne, sans étiquette)."""
    lignes = [ligne for ligne in texte.splitlines() if ligne.startswith(nom + " ")]
    assert len(lignes) == 1, f"famille {nom!r} absente ou dupliquée : {lignes}"
    return lignes[0].split(" ", 1)[1]


class TestProtection:
    async def test_sans_jeton_configure_la_route_refuse_en_nommant_la_cause(
        self, client: AsyncClient, monkeypatch
    ):
        monkeypatch.setattr(kojo_metrics, "METRICS_TOKEN", "")

        reponse = await client.get("/metrics")

        assert reponse.status_code == 503
        detail = reponse.json()["detail"]
        # Le refus DIT quoi poser : « interdit » sans cause renvoie au code.
        assert "METRICS_TOKEN" in detail
        assert "kojo_" not in reponse.text

    async def test_un_jeton_absent_ou_faux_ne_publie_aucune_metrique(
        self, client: AsyncClient, monkeypatch
    ):
        monkeypatch.setattr(kojo_metrics, "METRICS_TOKEN", JETON)

        for entetes in (
            None,
            {"Authorization": "Bearer faux"},
            {"Authorization": JETON},  # pas de schéma : ce n'est pas un en-tête Bearer
            {"Authorization": "Basic " + JETON},
            # Un jeton SUIVI d'un autre mot n'est pas le jeton : la comparaison
            # porte sur la valeur entière, pas sur un préfixe. (Un espace de fin
            # seul est rogné — les intermédiaires HTTP le font aussi.)
            {"Authorization": f"Bearer {JETON} extra"},
            {"X-Metrics-Token": JETON},  # un autre en-tête n'est pas le contrat
        ):
            reponse = await client.get("/metrics", headers=entetes)
            assert reponse.status_code == 401, (entetes, reponse.text)
            assert "kojo_" not in reponse.text
            # Le client sait quel schéma présenter.
            assert reponse.headers.get("www-authenticate") == "Bearer"

    async def test_le_jeton_configure_ouvre_en_temps_constant(self, client: AsyncClient, monkeypatch):
        monkeypatch.setattr(kojo_metrics, "METRICS_TOKEN", JETON)

        reponse = await client.get("/metrics", headers=ENTETE)

        assert reponse.status_code == 200
        assert reponse.headers.get("cache-control") == "no-store"

    async def test_head_est_servi_comme_get_jamais_405(self, client: AsyncClient, monkeypatch):
        """Un scrape qui teste la cible en HEAD ne doit pas lire un refus de route."""
        monkeypatch.setattr(kojo_metrics, "METRICS_TOKEN", JETON)

        reponse = await client.head("/metrics", headers=ENTETE)

        assert reponse.status_code == 200
        assert reponse.content == b""

    def test_la_comparaison_est_celle_du_jeton_et_jamais_un_prefixe(self, monkeypatch):
        monkeypatch.setattr(kojo_metrics, "METRICS_TOKEN", JETON)

        assert kojo_metrics.jeton_valide(f"Bearer {JETON}") is True
        assert kojo_metrics.jeton_valide(f"bearer {JETON}") is True
        assert kojo_metrics.jeton_valide(f"Bearer {JETON[:-1]}") is False
        assert kojo_metrics.jeton_valide(f"Bearer {JETON}x") is False
        assert kojo_metrics.jeton_valide("Bearer ") is False
        assert kojo_metrics.jeton_valide(None) is False
        # Sans jeton configuré, RIEN n'est valide (même un en-tête vide).
        monkeypatch.setattr(kojo_metrics, "METRICS_TOKEN", "")
        assert kojo_metrics.jeton_valide("Bearer ") is False


class TestFormat:
    async def test_le_texte_est_celui_de_prometheus_et_porte_les_valeurs_des_compteurs(
        self, client: AsyncClient, monkeypatch
    ):
        monkeypatch.setattr(kojo_metrics, "METRICS_TOKEN", JETON)
        monkeypatch.setattr(
            kojo_metrics, "bus_stats", lambda: {
                "publies": 42, "recus": 7, "echo": 3, "illisibles": 1,
                "repli": 2, "perdus": 0, "ecoutes": 4, "reprises": 5, "resyncs": 6,
            }
        )
        monkeypatch.setattr(kojo_metrics, "bus_actif", lambda: True)
        monkeypatch.setattr(kojo_metrics, "partage_stats", lambda: {
            "reserves": 11, "refus": 1, "repli": 2,
        })
        monkeypatch.setattr(kojo_metrics, "rate_limit_stats", lambda: {
            "replis": 3, "en_memoire": True, "derniere_panne": None,
            "alerte_envoyee_le": None,
        })
        monkeypatch.setattr(kojo_metrics, "rate_limit_en_redis", lambda: False)
        monkeypatch.setattr(kojo_metrics, "revocation_stats", lambda: {
            "verifications": 20, "echecs": 1, "dernier_echec": None,
        })

        reponse = await client.get("/metrics", headers=ENTETE)

        assert reponse.status_code == 200
        assert reponse.headers["content-type"] == "text/plain; version=0.0.4; charset=utf-8"
        texte = reponse.text
        assert texte.endswith("\n")

        assert "# TYPE kojo_live_bus_publies_total counter" in texte
        assert _valeur(texte, "kojo_live_bus_publies_total") == "42"
        assert _valeur(texte, "kojo_live_bus_perdus_total") == "0"
        assert _valeur(texte, "kojo_live_bus_actif") == "1"
        assert _valeur(texte, "kojo_live_flux_reserves_total") == "11"
        assert _valeur(texte, "kojo_rate_limit_replis_total") == "3"
        assert _valeur(texte, "kojo_rate_limit_en_memoire") == "1"
        assert _valeur(texte, "kojo_rate_limit_en_redis") == "0"
        assert _valeur(texte, "kojo_revocation_verifications_total") == "20"
        assert _valeur(texte, "kojo_revocation_echecs_total") == "1"

        # Chaque famille annonce son TYPE : un compteur qui redescend est un
        # bug, une jauge qui bouge n'en est pas un — le tableau de bord en
        # dépend, et un `# HELP` sans `# TYPE` la ferait deviner.
        familles = [ligne.split(" ")[2] for ligne in texte.splitlines() if ligne.startswith("# TYPE ")]
        assert len(familles) == len(set(familles)), "famille déclarée deux fois"
        assert {ligne.split(" ")[3] for ligne in texte.splitlines() if ligne.startswith("# TYPE ")} == {
            "counter", "gauge"
        }

    async def test_une_date_sort_en_secondes_epoch_et_jamais_en_etiquette(
        self, client: AsyncClient, monkeypatch
    ):
        monkeypatch.setattr(kojo_metrics, "METRICS_TOKEN", JETON)
        # Une date ISO en étiquette créerait une série par valeur : elle doit
        # sortir en jauge, et l'ISO ne doit apparaître NULLE PART dans le corps.
        monkeypatch.setattr(kojo_metrics, "revocation_stats", lambda: {
            "verifications": 1, "echecs": 1,
            "dernier_echec": "2026-10-20T09:00:00+00:00",
        })
        monkeypatch.setattr(kojo_metrics, "rate_limit_stats", lambda: {
            "replis": 1, "en_memoire": True,
            "derniere_panne": "2026-10-20T08:30:00+00:00",
            "alerte_envoyee_le": 1792485000.0,
        })

        texte = await _lire(client, ENTETE)

        attendu = str(int(datetime(2026, 10, 20, 9, tzinfo=timezone.utc).timestamp()))
        assert _valeur(texte, "kojo_revocation_dernier_echec_timestamp_seconds") == attendu
        assert _valeur(texte, "kojo_rate_limit_derniere_panne_timestamp_seconds") == str(
            int(datetime(2026, 10, 20, 8, 30, tzinfo=timezone.utc).timestamp())
        )
        assert _valeur(texte, "kojo_rate_limit_alerte_envoyee_timestamp_seconds") == "1792485000"
        assert "2026-10-20T" not in texte
        assert "{" not in texte, "aucune famille ne doit porter d'étiquette libre"

    async def test_une_date_illisible_vaut_jamais_pas_maintenant(
        self, client: AsyncClient, monkeypatch
    ):
        monkeypatch.setattr(kojo_metrics, "METRICS_TOKEN", JETON)
        monkeypatch.setattr(kojo_metrics, "revocation_stats", lambda: {
            "verifications": 0, "echecs": 0, "dernier_echec": "pas-une-date",
        })

        texte = await _lire(client, ENTETE)

        # 0 = « jamais ». La dater d'office ferait croire à une panne récente
        # qui n'a pas eu lieu.
        assert _valeur(texte, "kojo_revocation_dernier_echec_timestamp_seconds") == "0"


class TestBranchement:
    async def test_les_valeurs_publiees_sont_celles_des_compteurs_reels(
        self, client: AsyncClient, monkeypatch
    ):
        """Sans doublure : le texte suit les accesseurs, il ne les recopie pas."""
        monkeypatch.setattr(kojo_metrics, "METRICS_TOKEN", JETON)

        texte = await _lire(client, ENTETE)

        bus = bus_stats()
        for cle in ("publies", "perdus", "repli", "resyncs"):
            assert _valeur(texte, f"kojo_live_bus_{cle}_total") == str(int(bus[cle]))
        partage = partage_stats()
        for cle in ("reserves", "refus", "repli"):
            assert _valeur(texte, f"kojo_live_flux_{cle}_total") == str(int(partage[cle]))
        assert _valeur(texte, "kojo_live_flux_actifs") == str(active_streams())
        assert _valeur(texte, "kojo_live_bus_actif") == ("1" if bus_actif() else "0")
        assert _valeur(texte, "kojo_rate_limit_en_redis") == ("1" if rate_limit_en_redis() else "0")
        assert _valeur(texte, "kojo_rate_limit_replis_total") == str(
            int(rate_limit_stats()["replis"])
        )
        assert _valeur(texte, "kojo_revocation_echecs_total") == str(
            int(revocation_stats()["echecs"])
        )


class TestCorpus:
    """La mesure qui manquait : une place de marché VIDE se publie.

    Le 23/10/2026, la production comptait zéro mission ouverte sans qu'aucun
    tableau de bord ne le dise — et les sondes de SEO rendaient des prémisses
    depuis onze jours. Le chiffre vient de la base (une lecture par scrape) ;
    une lecture en panne l'OMET au lieu d'inventer zéro, sinon une panne de
    base se lirait comme une place vide.
    """

    async def test_la_jauge_compte_les_missions_vivantes_seulement(
        self, client: AsyncClient, monkeypatch
    ):
        monkeypatch.setattr(kojo_metrics, "METRICS_TOKEN", JETON)
        from tests.conftest import db_insert

        await db_insert("jobs", {"id": "ouverte-1", "status": "open"})
        await db_insert("jobs", {"id": "ouverte-2", "status": "open"})
        await db_insert("jobs", {"id": "supprimee", "status": "open", "deleted": True})
        await db_insert("jobs", {"id": "en-cours", "status": "in_progress"})

        texte = await _lire(client, ENTETE)

        assert _valeur(texte, "kojo_missions_ouvertes") == "2"

    async def test_une_lecture_en_panne_omet_la_jauge_sans_inventer_zero(
        self, client: AsyncClient, monkeypatch
    ):
        monkeypatch.setattr(kojo_metrics, "METRICS_TOKEN", JETON)
        import server as serveur

        async def _panne(*args, **kwargs):
            raise RuntimeError("base injoignable")

        monkeypatch.setattr(serveur.db.jobs, "count_documents", _panne)

        texte = await _lire(client, ENTETE)

        assert "kojo_missions_ouvertes" not in texte
        # Les compteurs mémoire restent publiés : une panne de base ne rend pas
        # l'exposition muette.
        assert "kojo_live_bus_publies_total" in texte


class TestCollecteDeclaree:
    """Une famille non documentée est une famille que personne ne collecte."""

    async def test_chaque_famille_publiee_est_nommee_dans_la_doc_de_collecte(
        self, client: AsyncClient, monkeypatch
    ):
        monkeypatch.setattr(kojo_metrics, "METRICS_TOKEN", JETON)
        texte = await _lire(client, ENTETE)

        doc = (_racine_backend() / "METRIQUES.md").read_text(encoding="utf-8")
        familles = [
            ligne.split(" ")[2]
            for ligne in texte.splitlines()
            if ligne.startswith("# TYPE ")
        ]
        assert len(familles) >= 20, "l'exposition ne couvre plus les compteurs attendus"
        manquantes = [nom for nom in familles if nom not in doc]
        assert manquantes == [], (
            "famille(s) exposée(s) mais absente(s) de backend/METRIQUES.md : %s" % manquantes
        )

    def test_la_doc_declare_comment_la_route_est_collectee_et_protegee(self):
        doc = (_racine_backend() / "METRIQUES.md").read_text(encoding="utf-8")

        # Le scrape : chemin, schéma porteur, cadence. Sans ces trois
        # informations, la doc décrit un endpoint que personne ne sait brancher.
        assert "scrape_configs" in doc
        assert "metrics_path: /metrics" in doc
        assert "Authorization: Bearer" in doc
        assert "credentials_file" in doc
        assert "scrape_interval" in doc
        # Le secret, et ce qu'il advient quand il manque (503 nommée).
        assert "METRICS_TOKEN" in doc
        assert "503" in doc and "401" in doc
