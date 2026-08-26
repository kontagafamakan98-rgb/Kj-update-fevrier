"""Tests des endpoints géolocalisation centralisée (base + reverse geocoding)."""

import pytest

from kojo_geo_data import GEOGRAPHIC_DATABASE, find_nearest_location
from kojo_routers_geo import detect_country_from_ip, detect_country_from_phone


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


def test_detect_country_from_ip_known_prefix():
    # Préfixes FAI ouest-africains documentés
    assert detect_country_from_ip("41.82.12.34") == "senegal"
    assert detect_country_from_ip("41.73.5.5") == "mali"
    assert detect_country_from_ip("196.28.1.1") == "burkina_faso"
    assert detect_country_from_ip("196.180.0.1") == "cote_divoire"


def test_detect_country_from_ip_unknown_returns_none():
    # Cas None documentés : vide, localhost, préfixe inconnu
    assert detect_country_from_ip("") is None
    assert detect_country_from_ip(None) is None
    assert detect_country_from_ip("127.0.0.1") is None
    assert detect_country_from_ip("localhost") is None
    assert detect_country_from_ip("::1") is None
    assert detect_country_from_ip("8.8.8.8") is None  # Google DNS, hors AO
    assert detect_country_from_ip("192.168.1.1") is None  # IP privée


def test_detect_country_from_phone_known_prefix():
    # Indicatifs documentés, espaces ignorés
    assert detect_country_from_phone("+221 77 123 45 67") == "senegal"
    assert detect_country_from_phone("+22376123456") == "mali"
    assert detect_country_from_phone("+22670123456") == "burkina_faso"
    assert detect_country_from_phone("+22507123456") == "cote_divoire"


def test_detect_country_from_phone_unknown_returns_none():
    # Cas None documentés : vide, indicatif inconnu
    assert detect_country_from_phone("") is None
    assert detect_country_from_phone(None) is None
    assert detect_country_from_phone("+33612345678") is None  # France, hors support
    assert detect_country_from_phone("77123456") is None  # sans indicatif


def test_geographic_database_is_source_of_truth():
    # Garde-fou : la base backend doit contenir les 4 pays avec leur préfixe
    # téléphonique — c'est ce que le frontend utilise pour formater les numéros.
    assert {code: data["phonePrefix"] for code, data in GEOGRAPHIC_DATABASE.items()} == {
        "mali": "+223",
        "senegal": "+221",
        "burkina_faso": "+226",
        "cote_divoire": "+225",
    }
