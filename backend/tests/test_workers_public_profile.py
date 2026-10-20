# -*- coding: utf-8 -*-
"""Le profil public d'un travailleur : ce qu'il publie, et ce qu'il TAIRE.

Ces cas mesurent deux choses que la lecture du routeur ne prouve pas :

  1. la FORME de la réponse — un ensemble de clés EXACT, pas « l'email n'est
     pas là ». Une denylist qui oublierait un champ futur passerait un test
     d'absence ; l'égalité d'ensembles, non. C'est la garantie qu'un champ
     ajouté demain au modèle `User` (identifiant de paiement, coordonnée)
     reste privé tant que personne ne l'a PUBLIÉ ici ;
  2. la RÉPUTATION — missions terminées, moyenne et avis, y compris le cas
     « aucun avis encore » qui doit rendre `None` et non `0.0`, parce qu'un
     profil neuf affiché « 0 étoile » se lit comme un mauvais avis.

Un troisième cas garde l'ORDRE d'enregistrement des routes : `/workers/profile`
(authentifiée, déclarée par `kojo_routers_jobs_workers`) doit continuer de
gagner sur `/workers/{worker_id}`. Si l'ordre change, un utilisateur connecté
qui demande SON profil reçoit un 404 de profil public — et rien d'autre ne le
dirait.
"""
from httpx import AsyncClient

from tests.conftest import db_insert

# Les clés PUBLIÉES, écrites une fois. Un champ ajouté au routeur sans être
# déclaré ici rougit : c'est la revue de la surface publique, pas un oubli.
CLES_PUBLIEES = {
    "id",
    "first_name",
    "last_name",
    "user_type",
    "photo_url",
    "city",
    "country",
    "created_at",
    "skills",
    "bio",
    "languages",
    "verified",
    "member_since",
    "stats",
    "reviews",
}

# Les valeurs que la fixture met dans le document et qui ne doivent JAMAIS
# ressortir. On les cherche dans la réponse SÉRIALISÉE : une valeur peut fuir
# par un sous-objet sans que sa clé soit au premier niveau.
EMAIL_FIXTURE = "awa.profil@kojo.sn"
TELEPHONE_FIXTURE = "+221771112233"
COMPTE_PAIEMENT_FIXTURE = "+221779998877"

IDENTIFIANT = "worker-profil-1"


async def _travailleur(**remplacements):
    """Document travailleur réaliste, avec toutes les PII que la fixture porte."""
    doc = {
        "id": IDENTIFIANT,
        "email": EMAIL_FIXTURE,
        "phone": TELEPHONE_FIXTURE,
        "password_hash": "$2b$12$" + "x" * 53,
        "password_version": 3,
        "google_sub": "google-sub-secret",
        "first_name": "Awa",
        "last_name": "Diop",
        "user_type": "worker",
        "country": "senegal",
        "city": "Dakar",
        "preferred_language": "fr",
        "created_at": "2024-05-17T10:00:00+00:00",
        "skills": ["plomberie", "soudure"],
        "bio": "Artisan plombier depuis dix ans.",
        "languages": ["fr", "wo"],
        "is_verified": True,
        "rating": 4.6666,
        "total_reviews": 2,
        "profile_photo": "https://res.cloudinary.com/kojo/image/upload/awa.jpg",
        "payment_accounts": {
            "orange_money": COMPTE_PAIEMENT_FIXTURE,
            "wave": COMPTE_PAIEMENT_FIXTURE,
        },
        "payment_accounts_count": 2,
        "geo": {"type": "Point", "coordinates": [-17.44, 14.69]},
        "permissions": ["admin_access"],
        "referral_reward_balance": 5000.0,
    }
    doc.update(remplacements)
    await db_insert("users", doc)
    return doc


async def _avis(reviewer_id: str, rating: int, comment: str, created_at: str):
    await db_insert("reviews", {
        "id": f"avis-{reviewer_id}-{rating}",
        "reviewee_id": IDENTIFIANT,
        "reviewer_id": reviewer_id,
        "job_id": "mission-1",
        "rating": rating,
        "comment": comment,
        "created_at": created_at,
    })


async def test_le_profil_complet_publie_la_reputation_et_les_avis(client: AsyncClient):
    """Nominal : identité professionnelle, compteurs, moyenne et avis."""
    await _travailleur()
    # Deux missions terminées (une supprimée : elle ne compte pas) et une
    # ouverte (elle ne compte pas non plus).
    await db_insert("jobs", {"id": "m1", "assigned_worker_id": IDENTIFIANT, "status": "completed"})
    await db_insert("jobs", {"id": "m2", "assigned_worker_id": IDENTIFIANT, "status": "completed"})
    await db_insert("jobs", {"id": "m3", "assigned_worker_id": IDENTIFIANT, "status": "completed", "deleted": True})
    await db_insert("jobs", {"id": "m4", "assigned_worker_id": IDENTIFIANT, "status": "open"})
    await db_insert("users", {"id": "client-1", "first_name": "Moussa", "last_name": "Ba", "user_type": "client"})
    await db_insert("users", {"id": "client-2", "first_name": "Fatou", "last_name": "Sow", "user_type": "client"})
    await _avis("client-1", 5, "Travail impeccable.", "2025-01-02T09:00:00+00:00")
    await _avis("client-2", 4, "Bon contact.", "2025-03-04T09:00:00+00:00")

    response = await client.get(f"/api/workers/{IDENTIFIANT}")

    assert response.status_code == 200, response.text
    corps = response.json()
    assert corps["first_name"] == "Awa"
    assert corps["user_type"] == "worker"
    assert corps["member_since"] == 2024
    assert corps["verified"] is True
    assert corps["skills"] == ["plomberie", "soudure"]
    assert corps["stats"] == {
        "missions_completed": 2,
        "rating_average": 4.7,
        "rating_count": 2,
    }
    # Le plus récent d'abord, et seulement le PRÉNOM du réviseur.
    assert [avis["rating"] for avis in corps["reviews"]] == [4, 5]
    assert corps["reviews"][0]["reviewer_first_name"] == "Fatou"
    assert corps["reviews"][0]["comment"] == "Bon contact."


async def test_aucune_donnee_personnelle_ne_sort_du_profil_public(client: AsyncClient):
    """La réponse ne publie QUE les clés déclarées — ni email, ni téléphone,
    ni compte de paiement, ni position, même présents dans le document."""
    import json

    await _travailleur()

    corps = (await client.get(f"/api/workers/{IDENTIFIANT}")).json()

    assert set(corps) == CLES_PUBLIEES, (
        f"clé(s) publiée(s) hors allowlist : {sorted(set(corps) - CLES_PUBLIEES)} ; "
        f"clé(s) déclarée(s) mais absente(s) : {sorted(CLES_PUBLIEES - set(corps))}"
    )
    serialise = json.dumps(corps, ensure_ascii=False)
    for interdit in (EMAIL_FIXTURE, TELEPHONE_FIXTURE, COMPTE_PAIEMENT_FIXTURE,
                     "google-sub-secret", "password_hash", "-17.44"):
        assert interdit not in serialise, (
            f"« {interdit} » apparaît dans le profil public : une donnée "
            f"d'identité ou de paiement sort par la réponse"
        )


async def test_un_profil_sans_avis_ne_s_affiche_pas_zero_etoile(client: AsyncClient):
    """Aucun avis : `rating_average` vaut None, et non 0.0."""
    await _travailleur(rating=0.0, total_reviews=0)

    corps = (await client.get(f"/api/workers/{IDENTIFIANT}")).json()

    assert corps["stats"]["rating_average"] is None
    assert corps["stats"]["rating_count"] == 0
    assert corps["reviews"] == []


async def test_un_client_n_a_pas_de_profil_public_de_travailleur(client: AsyncClient):
    """404 (et non 403) : on n'apprend pas au visiteur quels comptes existent."""
    await db_insert("users", {
        "id": "client-public-1", "first_name": "Moussa", "last_name": "Ba",
        "user_type": "client", "country": "senegal",
    })

    response = await client.get("/api/workers/client-public-1")

    assert response.status_code == 404
    assert response.json()["detail"] == "Travailleur introuvable"


async def test_un_compte_supprime_n_a_plus_de_profil_public(client: AsyncClient):
    """Un compte supprimé (soft delete RGPD) disparaît de la surface publique."""
    await _travailleur(deleted=True)

    response = await client.get(f"/api/workers/{IDENTIFIANT}")

    assert response.status_code == 404


async def test_une_photo_hors_cloudinary_n_est_pas_publiee(client: AsyncClient):
    """Une URL d'image qui n'est pas Cloudinary rend None, jamais le lien brut."""
    await _travailleur(profile_photo="https://exemple.test/awa.jpg")

    corps = (await client.get(f"/api/workers/{IDENTIFIANT}")).json()

    assert corps["photo_url"] is None


async def test_la_route_workers_profile_garde_sa_priorite(client: AsyncClient):
    """`/workers/profile` reste la route authentifiée : elle refuse la session
    absente (401/403), elle ne tombe pas dans le profil public (404)."""
    response = await client.get("/api/workers/profile")

    assert response.status_code in (401, 403), (
        f"`/api/workers/profile` a répondu {response.status_code} : la route "
        f"publique `/workers/{{worker_id}}` a été enregistrée avant elle et "
        f"capture le mot « profile » comme un identifiant"
    )
