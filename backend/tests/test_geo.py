"""Tests des endpoints géolocalisation centralisée (base + reverse geocoding)."""

import pytest

from kojo_geo_data import GEOGRAPHIC_DATABASE, find_nearest_location


@pytest.mark.asyncio
async def test_cities_returns_full_database(client):
    resp = await client.get("/api/geolocation/cities")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 4
    assert set(data["countries"].keys()) == {
        "mali", "senegal", "burkina_faso", "cote_divoire"
    }
    # Structure attendue par le frontend (helpers getCountryByCode, suggestions)
    mali = data["countries"]["mali"]
    assert mali["phonePrefix"] == "+223"
    assert mali["nameFrench"] == "Mali"
    assert mali["bounds"]["north"] > mali["bounds"]["south"]
    assert any(city["name"] == "Bamako" for city in mali["majorCities"])
    bamako = next(c for c in mali["majorCities"] if c["name"] == "Bamako")
    assert bamako["coordinates"]["lat"] == 12.6392
    assert len(bamako["districts"]) > 0


@pytest.mark.asyncio
async def test_cities_filters_by_country(client):
    resp = await client.get("/api/geolocation/cities", params={"country": "senegal"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["country"] == "senegal"
    assert data["data"]["phonePrefix"] == "+221"


@pytest.mark.asyncio
async def test_cities_unknown_country_404(client):
    resp = await client.get("/api/geolocation/cities", params={"country": "narnia"})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_reverse_geocode_inside_west_africa(client):
    # Plateau, Dakar (Sénégal) — doit résoudre vers Dakar
    resp = await client.get("/api/geolocation/reverse", params={"lat": 14.6928, "lng": -17.4467})
    assert resp.status_code == 200
    data = resp.json()
    assert data["address"]["country_code"] == "senegal"
    assert data["address"]["city"] == "Dakar"
    assert data["address"]["suburb"]  # un quartier de Dakar
    assert "Dakar" in data["display_name"]


@pytest.mark.asyncio
async def test_reverse_geocode_outside_zone_returns_fallback(client):
    # Paris — hors base ouest-africaine
    resp = await client.get("/api/geolocation/reverse", params={"lat": 48.8566, "lng": 2.3522})
    assert resp.status_code == 200
    data = resp.json()
    assert data["address"] == {}
    assert "48.856600" in data["display_name"]


@pytest.mark.asyncio
async def test_reverse_geocode_mali(client):
    resp = await client.get("/api/geolocation/reverse", params={"lat": 12.6392, "lng": -8.0029})
    assert resp.status_code == 200
    data = resp.json()
    assert data["address"]["country_code"] == "mali"
    assert data["address"]["city"] == "Bamako"


def test_find_nearest_location_happy_path():
    match = find_nearest_location(14.6928, -17.4467)
    assert match is not None
    assert match["country_code"] == "senegal"
    assert match["city"] == "Dakar"
    assert match["distance_km"] == 0.0  # coordonnées exactes de la ville


def test_find_nearest_location_outside_zone():
    assert find_nearest_location(48.8566, 2.3522) is None


def test_geographic_database_is_source_of_truth():
    # Garde-fou : la base backend doit contenir les 4 pays avec leur préfixe
    # téléphonique — c'est ce que le frontend utilise pour formater les numéros.
    assert {code: data["phonePrefix"] for code, data in GEOGRAPHIC_DATABASE.items()} == {
        "mali": "+223",
        "senegal": "+221",
        "burkina_faso": "+226",
        "cote_divoire": "+225",
    }
