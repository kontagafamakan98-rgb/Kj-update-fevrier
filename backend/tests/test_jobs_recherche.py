# -*- coding: utf-8 -*-
"""La liste des missions dit COMBIEN, dit DANS QUEL ORDRE, et trouve ce qu'on tape.

Le défaut que ce fichier verrouille (22/10/2026)
------------------------------------------------
`GET /jobs` rendait une page de missions sans jamais dire combien il y en
avait : le client DÉDUISAIT « il en reste » du fait que la page était pleine.
Une page 2 incomplète annonçait donc « fini » alors qu'une mission avait été
clôturée entre-temps — un fait que la page n'avait pas mesuré. Le tri était
`created_at` seul, alors que la première question d'un travailleur est « combien
ça paie ». Et la recherche comparait le texte BRUT : « senegal » ne trouvait
pas « Sénégal », alors que personne ne tape les accents sur un clavier de
téléphone.

Ce qui est jugé ici
-------------------
1. `X-Total-Count` compte le filtre APPLIQUÉ (pays, catégorie, recherche), et
   n'est pas borné par `limit` : c'est un compte, pas une taille de page ;
2. `tri=budget` met le mieux payé en tête, et le tri par défaut reste
   chronologique (comportement historique, que des clients installés suivent) ;
3. un tri inconnu est REFUSÉ (422) au lieu d'être ignoré en silence — un tri
   ignoré ferait croire à un ordre qui n'a pas été appliqué ;
4. la recherche est insensible à la CASSE et aux ACCENTS, dans les deux sens ;
5. elle couvre la catégorie et l'adresse, pas seulement le titre ;
6. elle reste une CHAÎNE à chercher : `.*` ne devient jamais une expression ;
7. la recherche par MOTS passe par l'index texte (jetons pliés, OU entre les
   termes — la sémantique mesurée de `$text`) et retombe sur le fragment quand
   aucun mot ne correspond — une frappe partielle (« plomb ») continue donc de
   trouver « Plomberie » ;
8. une saisie n'est pas une EXPRESSION : le tiret de négation et les
   guillemets de phrase sont retirés avant `$search` (mesuré sur MongoDB
   7.0.14 : `-fuite` ne rend rien, `"fuite evier"` exige l'adjacence) ;
9. `tri=distance` classe du plus proche au plus loin, exige lat/lng, ne
   classe QUE les missions qui portent une position, refuse au-delà du
   plafond de candidats, et ne publie AUCUNE distance (l'ordre seul) — la vue
   publique ne gagne donc aucun champ géographique.
"""
import pytest
from httpx import AsyncClient

from kojo_recherche_missions import MAX_CANDIDATS_DISTANCE, distance_km
from tests.conftest import BASE_USER, auth_headers, db_insert


def _point(lat: float, lng: float):
    """Un point GeoJSON — l'ordre des coordonnées est [longitude, latitude]."""
    return {"type": "Point", "coordinates": [lng, lat]}


def _mission(identifiant: str, **champs):
    """Un document de mission minimal mais VALIDE pour la vue publique."""
    doc = {
        "id": identifiant,
        "title": "Réparer une fuite",
        "description": "Fuite sous l'évier de la cuisine, travail urgent.",
        "category": "plomberie",
        "status": "open",
        "deleted": False,
        "budget_min": 10000,
        "budget_max": 30000,
        "country": "senegal",
        "client_id": f"client-{identifiant}",
        "location": {"address": "Dakar Plateau"},
        "created_at": "2026-10-01T10:00:00+00:00",
    }
    doc.update(champs)
    return doc


async def _liste(client: AsyncClient, entetes=None, **params):
    reponse = await client.get("/api/jobs", headers=entetes, params=params)
    assert reponse.status_code == 200, reponse.text
    return reponse


@pytest.mark.asyncio
class TestTotalPublie:
    async def test_le_total_compte_le_filtre_et_pas_la_page(self, client: AsyncClient):
        for index in range(5):
            await db_insert("jobs", _mission(f"j{index}"))

        reponse = await _liste(client, limit=2)

        assert len(reponse.json()) == 2
        assert reponse.headers["X-Total-Count"] == "5", (
            "le total est un COMPTE du filtre, pas la taille de la page"
        )

    async def test_le_total_suit_les_filtres(self, client: AsyncClient):
        await db_insert("jobs", _mission("j-dakar", category="plomberie"))
        await db_insert("jobs", _mission("j-bamako", category="menage", country="mali"))

        reponse = await _liste(client, category="plomberie")
        assert reponse.headers["X-Total-Count"] == "1"

        reponse = await _liste(client, q="menage")
        assert reponse.headers["X-Total-Count"] == "1"

    async def test_les_missions_supprimees_ne_sont_pas_comptees(self, client: AsyncClient):
        await db_insert("jobs", _mission("visible"))
        await db_insert("jobs", _mission("supprimee", deleted=True))

        reponse = await _liste(client)
        assert reponse.headers["X-Total-Count"] == "1"


@pytest.mark.asyncio
class TestTri:
    async def test_tri_budget_met_le_mieux_paye_en_tete(self, client: AsyncClient):
        await db_insert("jobs", _mission("petit", budget_max=20000))
        await db_insert("jobs", _mission("gros", budget_max=90000))
        await db_insert("jobs", _mission("moyen", budget_max=50000))

        reponse = await _liste(client, tri="budget")

        assert [job["budget_max"] for job in reponse.json()] == [90000, 50000, 20000]

    async def test_le_tri_par_defaut_reste_chronologique(self, client: AsyncClient):
        await db_insert("jobs", _mission("ancienne", created_at="2026-09-01T10:00:00+00:00"))
        await db_insert("jobs", _mission("recente", created_at="2026-10-20T10:00:00+00:00"))

        reponse = await _liste(client)

        assert [job["id"] for job in reponse.json()] == ["recente", "ancienne"]

    async def test_un_tri_inconnu_est_refuse(self, client: AsyncClient):
        reponse = await client.get("/api/jobs", params={"tri": "prix"})

        assert reponse.status_code == 422, (
            "un tri ignoré ferait croire à un ordre qui n'a pas été appliqué"
        )

    async def test_le_tri_par_distance_est_accepte(self, client: AsyncClient):
        await db_insert("jobs", _mission("j1", geo=_point(14.69, -17.44)))

        reponse = await _liste(client, tri="distance", lat=14.69, lng=-17.44)

        assert [job["id"] for job in reponse.json()] == ["j1"], (
            "le tri par distance est une valeur de `tri`, pas un tri inconnu"
        )


@pytest.mark.asyncio
class TestRecherche:
    async def test_sans_accent_trouve_le_texte_accentue(self, client: AsyncClient):
        await db_insert("jobs", _mission("j1", title="Réparation à Sénégal", location={"address": "Thiès"}))
        await db_insert("jobs", _mission("j2", title="Peinture", location={"address": "Bamako"}))

        reponse = await _liste(client, q="senegal")

        assert [job["id"] for job in reponse.json()] == ["j1"]

    async def test_avec_accent_trouve_le_texte_sans_accent(self, client: AsyncClient):
        await db_insert("jobs", _mission("j1", title="Mission au Senegal", location={"address": "Dakar"}))
        await db_insert("jobs", _mission("j2", title="Peinture", location={"address": "Bamako"}))

        reponse = await _liste(client, q="SÉNÉGAL")

        assert [job["id"] for job in reponse.json()] == ["j1"]

    async def test_la_categorie_et_l_adresse_sont_cherchees(self, client: AsyncClient):
        await db_insert("jobs", _mission("plombier", title="Robinet qui fuit", category="plomberie"))
        await db_insert("jobs", _mission(
            "menage", title="Nettoyage", category="menage", location={"address": "Bamako Centre"}
        ))

        reponse = await _liste(client, q="plomberie")
        assert [job["id"] for job in reponse.json()] == ["plombier"]

        reponse = await _liste(client, q="Plateau")
        assert [job["id"] for job in reponse.json()] == ["plombier"]

    async def test_une_expression_reguliere_reste_une_chaine(self, client: AsyncClient):
        await db_insert("jobs", _mission("j1", title="Plomberie", description="Fuite urgente"))

        reponse = await _liste(client, q=".*")

        assert reponse.json() == [], "le motif doit être échappé, jamais interprété"

    async def test_la_recherche_vide_ne_filtre_rien(self, client: AsyncClient):
        await db_insert("jobs", _mission("j1"))
        await db_insert("jobs", _mission("j2", title="Peinture"))

        reponse = await _liste(client, q="   ")

        assert reponse.headers["X-Total-Count"] == "2"


@pytest.mark.asyncio
class TestRechercheConnectee:
    async def test_le_tri_et_le_total_valent_aussi_pour_un_compte(self, client: AsyncClient):
        entetes = await auth_headers(client, BASE_USER)
        await db_insert("jobs", _mission(
            "j1", country=BASE_USER["country"], budget_max=10000
        ))
        await db_insert("jobs", _mission(
            "j2", country=BASE_USER["country"], budget_max=80000
        ))

        reponse = await _liste(client, entetes, tri="budget")

        assert [job["id"] for job in reponse.json()] == ["j2", "j1"]
        assert reponse.headers["X-Total-Count"] == "2"


@pytest.mark.asyncio
class TestRechercheParMots:
    """L'index texte sert les mots ; le fragment reste le repli."""

    async def test_un_mot_trouve_et_le_total_le_compte(self, client: AsyncClient):
        await db_insert("jobs", _mission("j1", title="Réparation à Sénégal"))
        await db_insert("jobs", _mission("j2", title="Peinture salon"))

        reponse = await _liste(client, q="Sénégal")

        assert [job["id"] for job in reponse.json()] == ["j1"]
        assert reponse.headers["X-Total-Count"] == "1"

    async def test_plusieurs_mots_sont_un_OU(self, client: AsyncClient):
        """Mesuré sur MongoDB 7.0.14 : `$text` fait un OU des termes.

        La sonde a rendu, pour « plomberie urgente », une mission qui ne porte
        que « plomberie » (en catégorie) et pas « urgente ». On ne peut donc
        pas promettre un ET ici : la recherche par mots ÉLARGIT.
        """
        await db_insert("jobs", _mission(
            "j1", title="Plomberie", description="Fuite urgente sous l'évier"
        ))
        await db_insert("jobs", _mission(
            "j2", title="Plomberie", description="Installation neuve"
        ))
        await db_insert("jobs", _mission(
            "j3", title="Peinture", description="Deux murs", category="peinture"
        ))

        reponse = await _liste(client, q="plomberie fuite")

        assert {job["id"] for job in reponse.json()} == {"j1", "j2"}, (
            "la mission qui ne porte qu'un des deux termes reste un résultat, et celle "
            "qui n'en porte aucun ne l'est pas"
        )
        assert reponse.headers["X-Total-Count"] == "2"

    async def test_une_frappe_partielle_retombe_sur_le_fragment(self, client: AsyncClient):
        await db_insert("jobs", _mission("j1", title="Plomberie urgente"))

        reponse = await _liste(client, q="plomb")

        assert [job["id"] for job in reponse.json()] == ["j1"], (
            "l'index ne trouve pas « plomb » dans « Plomberie » : le repli doit le faire"
        )

    async def test_un_terme_negatif_n_est_pas_une_negation(self, client: AsyncClient):
        # Mesuré sur MongoDB 7.0.14 : `$search: "-fuite"` ne rend AUCUN document
        # (c'est une négation), et `"fuite evier"` exige l'adjacence. Une saisie
        # n'est pas une expression : les deux signes sont retirés par la découpe.
        await db_insert("jobs", _mission("j1", title="Fuite urgente"))

        reponse = await _liste(client, q="-fuite")

        assert [job["id"] for job in reponse.json()] == ["j1"]

    async def test_le_repli_respecte_le_pays_d_un_compte(self, client: AsyncClient):
        # Le repli est composé en `$and` : un remplacement de `$or` aurait retiré
        # le filtre de pays en silence, et la recherche aurait rendu des missions
        # d'un autre marché.
        entetes = await auth_headers(client, BASE_USER)
        await db_insert("jobs", _mission(
            "ici", country=BASE_USER["country"], title="Plomberie Dakar"
        ))
        await db_insert("jobs", _mission("ailleurs", country="mali", title="Plomberie Bamako"))

        reponse = await _liste(client, entetes, q="plomb")

        assert [job["id"] for job in reponse.json()] == ["ici"]


@pytest.mark.asyncio
class TestTriDistance:
    """Le plus proche d'abord — et aucune distance publiée."""

    async def test_la_plus_proche_d_abord(self, client: AsyncClient):
        # Dakar (14,69 / -17,44) ; Thiès ~55 km ; Bamako ~1 050 km.
        await db_insert("jobs", _mission("bamako", geo=_point(12.64, -8.00)))
        await db_insert("jobs", _mission("thies", geo=_point(14.79, -16.93)))
        await db_insert("jobs", _mission("dakar", geo=_point(14.69, -17.44)))

        reponse = await _liste(client, tri="distance", lat=14.69, lng=-17.44)

        assert [job["id"] for job in reponse.json()] == ["dakar", "thies", "bamako"]

    async def test_sans_position_le_tri_est_refuse(self, client: AsyncClient):
        reponse = await client.get("/api/jobs", params={"tri": "distance"})

        assert reponse.status_code == 400
        assert "lat" in reponse.json()["detail"] and "lng" in reponse.json()["detail"], (
            "un refus qui ne dit pas quoi fournir n'est pas réparable"
        )

    async def test_les_missions_sans_position_sortent_du_tri_et_du_total(self, client: AsyncClient):
        await db_insert("jobs", _mission("avec", geo=_point(14.69, -17.44)))
        await db_insert("jobs", _mission("sans"))

        reponse = await _liste(client, tri="distance", lat=14.69, lng=-17.44)

        assert [job["id"] for job in reponse.json()] == ["avec"], (
            "une mission sans position n'a pas de distance : la mêler à la fin ferait "
            "publier un total que le tri ne tient pas"
        )
        assert reponse.headers["X-Total-Count"] == "1"

    async def test_le_rayon_resserre_le_tri(self, client: AsyncClient):
        await db_insert("jobs", _mission("dakar", geo=_point(14.69, -17.44)))
        await db_insert("jobs", _mission("bamako", geo=_point(12.64, -8.00)))

        reponse = await _liste(client, tri="distance", lat=14.69, lng=-17.44, radius_km=50)

        assert [job["id"] for job in reponse.json()] == ["dakar"]

    async def test_la_vue_publique_ne_publie_ni_position_ni_distance(self, client: AsyncClient):
        await db_insert("jobs", _mission("proche", geo=_point(14.69, -17.44)))

        reponse = await _liste(client, tri="distance", lat=14.69, lng=-17.44)
        job = reponse.json()[0]

        for interdit in ("geo", "distance", "distance_km"):
            assert interdit not in job, (
                f"« {interdit} » sort sur la vue publique : l'ordre seul était la règle"
            )
        location = job.get("location") or {}
        for coordonnee in ("latitude", "longitude", "coordinates"):
            assert coordonnee not in location

    async def test_un_plafond_de_candidats_refuse_plutot_que_de_trier_a_moitie(
        self, client: AsyncClient
    ):
        for index in range(MAX_CANDIDATS_DISTANCE + 1):
            await db_insert("jobs", _mission(f"j{index}", geo=_point(14.69, -17.44)))

        reponse = await client.get(
            "/api/jobs", params={"tri": "distance", "lat": 14.69, "lng": -17.44}
        )

        assert reponse.status_code == 400
        assert "radius_km" in reponse.json()["detail"], (
            "le refus doit nommer le remède qui ramène sous le plafond"
        )

    async def test_une_position_illisible_finit_l_ordre(self, client: AsyncClient):
        await db_insert("jobs", _mission(
            "illisible", geo={"type": "Point", "coordinates": ["x"]}
        ))
        await db_insert("jobs", _mission("lisible", geo=_point(14.69, -17.44)))

        reponse = await _liste(client, tri="distance", lat=14.69, lng=-17.44)

        assert [job["id"] for job in reponse.json()] == ["lisible", "illisible"], (
            "une position illisible ne doit ni faire tomber la liste ni passer pour « très proche » (0 km)"
        )


def test_la_distance_haversine_est_celle_du_rayon():
    """La constante partagée vaut bien ~1 050 km entre Dakar et Bamako."""
    d = distance_km(14.69, -17.44, 12.64, -8.00)
    assert 1000 < d < 1100, (
        f"Dakar→Bamako = {d:.1f} km : le rayon terrestre partagé a dérivé, et le tri "
        "par distance ne désignerait plus le même point que le filtre par rayon"
    )
