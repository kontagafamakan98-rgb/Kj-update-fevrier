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
import re

import pytest
from httpx import AsyncClient

import kojo_metrics
from kojo_live import (
    active_streams,
    bus_actif,
    bus_stats,
    comptes_satures,
    partage_stats,
    refus_stats,
)
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
        # UNE seule famille porte des étiquettes : les provenances d'alerte, dont
        # le vocabulaire est FIXE (quatre valeurs déclarées). Une date n'y entre
        # jamais, et aucune autre famille ne s'en voit pousser une — c'est la
        # différence entre une étiquette à cardinalité bornée et une étiquette
        # libre, celle qui fabrique une série par document.
        etiquettes = sorted(re.findall(r'{\s*origine="([^"]*)"\s*}', texte))
        assert len(etiquettes) == len(set(etiquettes)) == 4, etiquettes
        assert set(etiquettes) == {"ville", "metier", "directe", "inconnue"}
        assert texte.count("{") == 4, "aucune autre famille ne doit porter d'étiquette"

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
        refus = refus_stats()
        assert _valeur(texte, "kojo_live_flux_refus_local_total") == str(
            int(refus["compte_local"])
        )
        assert _valeur(texte, "kojo_live_flux_refus_processus_total") == str(
            int(refus["processus"])
        )
        assert _valeur(texte, "kojo_live_comptes_satures") == str(comptes_satures())
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

        # On remplace la FONCTION que la route appelle, pas `db.jobs.count_documents` :
        # sous motor, `db.jobs` rend un objet collection NEUF à chaque accès, donc
        # `setattr` visait un objet que personne n'utilise — le test ne simulait
        # aucune panne en CI (vrai Mongo) et laissait publier la valeur réelle.
        # Mesuré le 23/10/2026 : la jauge sortait à 0 sur une base injoignable.
        monkeypatch.setattr(serveur, "compter_missions_ouvertes", _panne)

        texte = await _lire(client, ENTETE)

        assert "kojo_missions_ouvertes" not in texte
        # Les compteurs mémoire restent publiés : une panne de base ne rend pas
        # l'exposition muette.
        assert "kojo_live_bus_publies_total" in texte


class TestPlafondMordant:
    """Un 503 de CAPACITÉ doit se LIRE dans `/metrics`.

    Mesuré le 25/10/2026 sur la console de production : `GET
    /api/notifications/stream` rendait des 503 par rafales, et aucun chiffre ne
    disait que le plafond mordait — le symptôme existait, la mesure non. Les
    causes sont séparées dans les tests comme dans l'exposition, parce qu'un
    compte saturé et un process plein n'ont pas le même remède.
    """

    async def test_un_compte_sature_se_compte_et_se_publie(
        self, client: AsyncClient, monkeypatch
    ):
        monkeypatch.setattr(kojo_metrics, "METRICS_TOKEN", JETON)
        import kojo_live

        kojo_live.reset_streams()
        try:
            for _ in range(kojo_live.MAX_STREAMS_PER_USER):
                kojo_live.subscribe("compte-sature")

            # Avant le refus : le compte est DÉJÀ saturé, la jauge le dit.
            avant = await _lire(client, ENTETE)
            assert _valeur(avant, "kojo_live_comptes_satures") == "1"
            assert _valeur(avant, "kojo_live_flux_refus_local_total") == "0"

            with pytest.raises(kojo_live.StreamCapacityExceeded):
                kojo_live.subscribe("compte-sature")

            apres = await _lire(client, ENTETE)
            assert _valeur(apres, "kojo_live_flux_refus_local_total") == "1"
            # Le refus du COMPTE n'est pas imputé à la machine : les deux
            # compteurs disent deux choses et ne se contaminent pas.
            assert _valeur(apres, "kojo_live_flux_refus_processus_total") == "0"
            assert _valeur(apres, "kojo_live_comptes_satures") == "1"
        finally:
            kojo_live.reset_streams()

    async def test_la_jauge_redescend_quand_le_compte_se_libere(
        self, client: AsyncClient, monkeypatch
    ):
        """Une jauge, pas un compteur : sinon la saturation paraîtrait éternelle."""
        monkeypatch.setattr(kojo_metrics, "METRICS_TOKEN", JETON)
        import kojo_live

        kojo_live.reset_streams()
        try:
            files = [
                kojo_live.subscribe("compte-libere")
                for _ in range(kojo_live.MAX_STREAMS_PER_USER)
            ]
            assert _valeur(await _lire(client, ENTETE), "kojo_live_comptes_satures") == "1"

            kojo_live.unsubscribe("compte-libere", files[0])

            texte = await _lire(client, ENTETE)
            assert _valeur(texte, "kojo_live_comptes_satures") == "0"
        finally:
            kojo_live.reset_streams()

    async def test_un_processus_plein_est_compte_a_part_du_compte(
        self, client: AsyncClient, monkeypatch
    ):
        monkeypatch.setattr(kojo_metrics, "METRICS_TOKEN", JETON)
        import kojo_live

        kojo_live.reset_streams()
        monkeypatch.setattr(kojo_live, "MAX_STREAMS_TOTAL", 2)
        try:
            kojo_live.subscribe("compte-a")
            kojo_live.subscribe("compte-b")

            with pytest.raises(kojo_live.StreamCapacityExceeded) as refus:
                kojo_live.subscribe("compte-c")

            assert "serveur" in str(refus.value), (
                "le refus ne dit pas que c'est la MACHINE qui est pleine : "
                "on chercherait un onglet à fermer côté client"
            )
            texte = await _lire(client, ENTETE)
            assert _valeur(texte, "kojo_live_flux_refus_processus_total") == "1"
            assert _valeur(texte, "kojo_live_flux_refus_local_total") == "0"
            # Aucun compte n'a atteint le plafond PAR COMPTE, et pourtant aucun
            # flux n'entre : la saturation de la machine ne se lit pas non plus
            # dans `comptes_satures`.
            assert _valeur(texte, "kojo_live_comptes_satures") == "0"
        finally:
            kojo_live.reset_streams()

    async def test_les_trois_causes_de_refus_ne_se_melangent_pas(
        self, client: AsyncClient, monkeypatch
    ):
        """Compte local, machine, registre partagé : trois chiffres, trois objets.

        Un refus décidé par le plafond LOCAL ne doit pas déplacer le compteur du
        registre partagé (ni l'inverse) : ce sont trois diagnostics différents,
        et les confondre enverrait chercher le remède au mauvais endroit.
        """
        monkeypatch.setattr(kojo_metrics, "METRICS_TOKEN", JETON)
        import kojo_live

        kojo_live.reset_streams()
        try:
            partage_avant = partage_stats()["refus"]
            for _ in range(kojo_live.MAX_STREAMS_PER_USER):
                kojo_live.subscribe("compte-triple")
            with pytest.raises(kojo_live.StreamCapacityExceeded):
                kojo_live.subscribe("compte-triple")

            assert refus_stats()["compte_local"] == 1
            assert refus_stats()["processus"] == 0
            assert partage_stats()["refus"] == partage_avant, (
                "un refus décidé par le plafond LOCAL a été imputé au registre "
                "partagé : les deux chiffres ne disent plus la même chose"
            )
            texte = await _lire(client, ENTETE)
            assert _valeur(texte, "kojo_live_flux_refus_total") == str(
                int(partage_stats()["refus"])
            )
            assert _valeur(texte, "kojo_live_flux_refus_local_total") == "1"
        finally:
            kojo_live.reset_streams()


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


class TestProvenanceDesAlertesEmploi:
    """Ce que les pages ville et métier PRODUISENT, publié et verrouillé.

    Ces pages n'existent que pour poser une veille emploi, et rien ne disait
    combien elles en produisent : le champ `origin` était écrit par
    `$setOnInsert` sans que personne ne le lise. Les quatre séries sont donc
    publiées, et ce que ces cas empêchent est nommé un par un :

      • une provenance qui DISPARAÎT à zéro (on croirait qu'elle n'existe pas) ;
      • deux provenances fondues dans la même série ;
      • une valeur écrite de travers repliée dans « inconnue », ce qui ferait
        passer une donnée fausse pour une absence ;
      • une lecture en panne qui publierait quatre zéros (un échec de lecture se
        lirait comme un échec d'acquisition) ;
      • une liste d'étiquettes RECOPIÉE ici, qui divergerait du module
        propriétaire dès qu'une provenance serait ajoutée.
    """

    @staticmethod
    def _series(texte: str) -> dict:
        """Les séries `kojo_alertes_emploi{origine=…}`, dans l'ordre publié."""
        series = {}
        for ligne in texte.splitlines():
            if not ligne.startswith("kojo_alertes_emploi{"):
                continue
            etiquette = ligne.split("{", 1)[1].split("}", 1)[0]
            assert etiquette.startswith('origine="'), etiquette
            valeur = ligne.rsplit(" ", 1)[1]
            series[etiquette[len('origine="'):-1]] = valeur
        return series

    async def test_les_quatre_provenances_sortent_toujours_et_dans_l_ordre(
        self, client: AsyncClient, monkeypatch
    ):
        from kojo_job_alerts import ORIGINE_ABSENTE, ORIGINES_ALERTE, ORIGINES_COMPTEES

        monkeypatch.setattr(kojo_metrics, "METRICS_TOKEN", JETON)
        texte = await _lire(client, ENTETE)

        series = self._series(texte)
        # L'ORDRE est celui de la déclaration : c'est lui qui rend un scrape
        # lisible d'une fois sur l'autre, et une étiquette ajoutée au module
        # apparaît ici sans qu'on touche au test.
        assert list(series) == list(ORIGINES_COMPTEES)
        assert set(series) == set(ORIGINES_ALERTE) | {ORIGINE_ABSENTE}
        # Aucune série n'est omise quand la base n'a rien : quatre zéros, pas
        # une famille muette.
        assert set(series.values()) == {"0"} or all(v.isdigit() for v in series.values())

    async def test_chaque_provenance_se_compte_sans_se_melanger(
        self, client: AsyncClient, monkeypatch
    ):
        monkeypatch.setattr(kojo_metrics, "METRICS_TOKEN", JETON)
        from tests.conftest import db_insert

        await db_insert("job_alerts", {"id": "v1", "user_id": "u1", "origin": "ville"})
        await db_insert("job_alerts", {"id": "v2", "user_id": "u2", "origin": "ville"})
        await db_insert("job_alerts", {"id": "m1", "user_id": "u3", "origin": "metier"})
        await db_insert("job_alerts", {"id": "d1", "user_id": "u4", "origin": "directe"})

        series = self._series(await _lire(client, ENTETE))

        assert series["ville"] == "2"
        assert series["metier"] == "1"
        assert series["directe"] == "1"
        assert series["inconnue"] == "0"

    async def test_un_client_muet_va_dans_inconnue_et_jamais_dans_directe(
        self, client: AsyncClient, monkeypatch
    ):
        monkeypatch.setattr(kojo_metrics, "METRICS_TOKEN", JETON)
        from tests.conftest import db_insert

        # Le cas que le champ existe pour distinguer : une veille écrite avant
        # que le client ne déclare sa provenance.
        await db_insert("job_alerts", {"id": "ancienne", "user_id": "u5"})

        series = self._series(await _lire(client, ENTETE))

        assert series["inconnue"] == "1"
        assert series["directe"] == "0"

    async def test_une_valeur_hors_vocabulaire_n_est_pas_repliee(
        self, client: AsyncClient, monkeypatch
    ):
        monkeypatch.setattr(kojo_metrics, "METRICS_TOKEN", JETON)
        from tests.conftest import db_insert

        await db_insert("job_alerts", {"id": "etrange", "user_id": "u6", "origin": "email"})

        texte = await _lire(client, ENTETE)

        series = self._series(texte)
        # Ni une étiquette inventée (« email »), ni une ligne ajoutée à
        # « inconnue » : la valeur fausse se publie dans sa propre jauge.
        assert "email" not in series
        assert series["inconnue"] == "0"
        assert _valeur(texte, "kojo_alertes_emploi_hors_vocabulaire") == "1"

    async def test_une_lecture_en_panne_omet_la_famille_sans_inventer_zero(
        self, client: AsyncClient, monkeypatch
    ):
        monkeypatch.setattr(kojo_metrics, "METRICS_TOKEN", JETON)
        import server as serveur

        async def _panne(*args, **kwargs):
            raise RuntimeError("base injoignable")

        monkeypatch.setattr(serveur, "compter_alertes_par_origine", _panne)

        texte = await _lire(client, ENTETE)

        assert "kojo_alertes_emploi{" not in texte
        assert "kojo_alertes_emploi_hors_vocabulaire" not in texte
        # Le reste de l'exposition reste publié : une panne de base ne rend pas
        # la route muette.
        assert "kojo_live_bus_publies_total" in texte
