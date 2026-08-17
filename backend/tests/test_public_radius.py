"""Tests des endpoints publics (stats landing) et de la recherche par rayon
côté serveur (GET /jobs?lat=&lng=&radius_km=)."""

from tests.conftest import (
    BASE_USER,
    auth_headers,
    db_insert,
)


async def _create_job(client, headers, title, lat, lng, address="Dakar Plateau"):
    resp = await client.post("/api/jobs", headers=headers, json={
        "title": title,
        "description": f"Description détaillée pour {title}, travail sérieux et rapide.",
        "category": "plomberie",
        "budget_min": 10000,
        "budget_max": 30000,
        "location": {
            "address": address,
            "latitude": lat,
            "longitude": lng,
        },
    })
    assert resp.status_code == 200, f"create_job failed: {resp.status_code} {resp.text}"
    return resp.json()


async def test_public_stats_returns_real_counts(client):
    # Deux travailleurs + un job ouvert + un job terminé + un avis
    await db_insert("users", {"id": "w1", "user_type": "worker", "email": "w1@kojo.sn"})
    await db_insert("users", {"id": "w2", "user_type": "worker", "email": "w2@kojo.sn"})
    await db_insert("users", {"id": "c1", "user_type": "client", "email": "c1@kojo.sn"})
    await db_insert("jobs", {"id": "j1", "status": "open", "deleted": False})
    await db_insert("jobs", {"id": "j2", "status": "completed", "deleted": False})
    await db_insert("reviews", {"id": "r1", "rating": 5})

    resp = await client.get("/api/public/stats")
    assert resp.status_code == 200
    data = resp.json()
    assert data["workers"] == 2
    assert data["clients"] == 1
    assert data["open_jobs"] == 1
    assert data["completed_jobs"] == 1
    assert data["reviews"] == 1
    assert data["countries"] == 4


async def test_public_stats_excludes_deleted_jobs(client):
    await db_insert("jobs", {"id": "j1", "status": "open", "deleted": False})
    await db_insert("jobs", {"id": "j2", "status": "open", "deleted": True})

    resp = await client.get("/api/public/stats")
    assert resp.status_code == 200
    assert resp.json()["open_jobs"] == 1


async def test_radius_search_filters_by_distance(client):
    headers = await auth_headers(client, BASE_USER)

    # Dakar (~14.69, -17.44) et Bamako (~12.64, -8.00) : ~1050 km
    await _create_job(client, headers, "Fuite à Dakar", 14.69, -17.44, "Dakar Plateau")
    await _create_job(client, headers, "Fuite à Bamako", 12.64, -8.00, "Bamako Centre")

    # Rayon 50 km autour de Dakar → seul le job de Dakar
    resp = await client.get("/api/jobs", headers=headers, params={
        "lat": 14.69, "lng": -17.44, "radius_km": 50,
    })
    assert resp.status_code == 200
    titles = [j["title"] for j in resp.json()]
    assert "Fuite à Dakar" in titles
    assert "Fuite à Bamako" not in titles

    # Rayon 2000 km autour de Dakar → les deux
    resp = await client.get("/api/jobs", headers=headers, params={
        "lat": 14.69, "lng": -17.44, "radius_km": 2000,
    })
    assert resp.status_code == 200
    assert len(resp.json()) == 2


async def test_radius_search_excludes_jobs_without_geo(client):
    headers = await auth_headers(client, BASE_USER)

    await _create_job(client, headers, "Avec coordonnées", 14.69, -17.44, "Dakar Plateau")
    # Job sans latitude/longitude → pas de point geo → exclu quand le rayon est actif
    resp = await client.post("/api/jobs", headers=headers, json={
        "title": "Sans coordonnées",
        "description": "Job sans coordonnées GPS, description assez longue pour passer.",
        "category": "general",
        "budget_min": 5000,
        "budget_max": 10000,
        "location": {"address": "Adresse texte seule"},
    })
    assert resp.status_code == 200

    resp = await client.get("/api/jobs", headers=headers, params={
        "lat": 14.69, "lng": -17.44, "radius_km": 50,
    })
    assert resp.status_code == 200
    titles = [j["title"] for j in resp.json()]
    assert "Avec coordonnées" in titles
    assert "Sans coordonnées" not in titles

    # Sans rayon : le job sans coordonnées reste visible
    resp = await client.get("/api/jobs", headers=headers)
    assert resp.status_code == 200
    titles = [j["title"] for j in resp.json()]
    assert "Sans coordonnées" in titles
