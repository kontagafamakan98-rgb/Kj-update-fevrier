"""
Base géographique de l'Afrique de l'Ouest — source de vérité Kojo.

Portée depuis l'ancien `preciseGeolocationService.js` du frontend : la base
n'est plus embarquée dans le bundle navigateur (qui n'en garde qu'un
fallback compact). Elle est servie par le backend via
`/api/geolocation/cities` et utilisée pour le reverse geocoding
(`/api/geolocation/reverse`) — le navigateur n'appelle plus de services
tiers (ipapi, ipinfo, nominatim).

Structure d'un pays :
    code -> {
        country, nameFrench, flag, phonePrefix, currency, language,
        bounds: {north, south, east, west},
        majorCities: [
            { name, coordinates: {lat, lng},
              districts: [ { name, coords: {lat, lng} } ] }
        ]
    }
"""

GEOGRAPHIC_DATABASE = {
    "mali": {
        "country": "Mali",
        "nameFrench": "Mali",
        "flag": "🇲🇱",
        "phonePrefix": "+223",
        "currency": "XOF",
        "language": "fr",
        "bounds": {"north": 25.000000, "south": 10.159970, "east": 4.270000, "west": -12.242200},
        "majorCities": [
            {
                "name": "Bamako",
                "coordinates": {"lat": 12.6392, "lng": -8.0029},
                "districts": [
                    {"name": "Commune I (Centre)", "coords": {"lat": 12.6465, "lng": -8.0038}},
                    {"name": "Commune II (Badalabougou)", "coords": {"lat": 12.6528, "lng": -7.9881}},
                    {"name": "Commune III (Point G)", "coords": {"lat": 12.6683, "lng": -7.9847}},
                    {"name": "Commune IV (Lafiabougou)", "coords": {"lat": 12.6245, "lng": -7.9532}},
                    {"name": "Commune V (Baco-Djicoroni)", "coords": {"lat": 12.6089, "lng": -8.0156}},
                    {"name": "Commune VI (Sénou)", "coords": {"lat": 12.5338, "lng": -7.9503}},
                    {"name": "ACI 2000", "coords": {"lat": 12.6158, "lng": -7.9922}},
                    {"name": "Hippodrome", "coords": {"lat": 12.6347, "lng": -8.0183}},
                    {"name": "Plateau du Koulouba", "coords": {"lat": 12.6528, "lng": -8.0094}},
                    {"name": "Heremakono", "coords": {"lat": 12.6712, "lng": -7.9623}},
                ],
            },
            {
                "name": "Sikasso",
                "coordinates": {"lat": 11.3176, "lng": -5.6670},
                "districts": [
                    {"name": "Centre-Ville", "coords": {"lat": 11.3198, "lng": -5.6692}},
                    {"name": "Médina", "coords": {"lat": 11.3234, "lng": -5.6578}},
                    {"name": "Lafiabougou", "coords": {"lat": 11.3089, "lng": -5.6734}},
                ],
            },
            {
                "name": "Ségou",
                "coordinates": {"lat": 13.4317, "lng": -6.2633},
                "districts": [
                    {"name": "Centre", "coords": {"lat": 13.4317, "lng": -6.2633}},
                    {"name": "Pelengana", "coords": {"lat": 13.4256, "lng": -6.2789}},
                ],
            },
            {
                "name": "Mopti",
                "coordinates": {"lat": 14.4843, "lng": -4.1960},
                "districts": [
                    {"name": "Centre", "coords": {"lat": 14.4843, "lng": -4.1960}},
                    {"name": "Komoguel", "coords": {"lat": 14.4912, "lng": -4.1823}},
                    {"name": "Sévaré", "coords": {"lat": 14.3937, "lng": -4.1735}},
                ],
            },
        ],
    },
    "senegal": {
        "country": "Senegal",
        "nameFrench": "Sénégal",
        "flag": "🇸🇳",
        "phonePrefix": "+221",
        "currency": "XOF",
        "language": "fr",
        "bounds": {"north": 16.691700, "south": 12.307500, "east": -11.355700, "west": -17.535400},
        "majorCities": [
            {
                "name": "Dakar",
                "coordinates": {"lat": 14.6928, "lng": -17.4467},
                "districts": [
                    {"name": "Plateau", "coords": {"lat": 14.6928, "lng": -17.4467}},
                    {"name": "Médina", "coords": {"lat": 14.6789, "lng": -17.4634}},
                    {"name": "Grand Dakar", "coords": {"lat": 14.7167, "lng": -17.4667}},
                    {"name": "Parcelles Assainies", "coords": {"lat": 14.7645, "lng": -17.3972}},
                    {"name": "Liberté 6", "coords": {"lat": 14.7456, "lng": -17.4728}},
                    {"name": "Point E", "coords": {"lat": 14.7123, "lng": -17.4689}},
                    {"name": "Almadies", "coords": {"lat": 14.7456, "lng": -17.5234}},
                    {"name": "Ouakam", "coords": {"lat": 14.7389, "lng": -17.4894}},
                    {"name": "Yoff", "coords": {"lat": 14.7578, "lng": -17.4711}},
                    {"name": "Ngor", "coords": {"lat": 14.7622, "lng": -17.5089}},
                ],
            },
            {
                "name": "Thiès",
                "coordinates": {"lat": 14.7886, "lng": -16.9246},
                "districts": [
                    {"name": "Centre", "coords": {"lat": 14.7886, "lng": -16.9246}},
                    {"name": "Randoulène", "coords": {"lat": 14.7967, "lng": -16.9123}},
                    {"name": "Hersent", "coords": {"lat": 14.7823, "lng": -16.9389}},
                ],
            },
            {
                "name": "Kaolack",
                "coordinates": {"lat": 14.1514, "lng": -16.0726},
                "districts": [
                    {"name": "Médina Baye", "coords": {"lat": 14.1589, "lng": -16.0678}},
                    {"name": "Dialègne", "coords": {"lat": 14.1478, "lng": -16.0823}},
                    {"name": "Ndangane", "coords": {"lat": 14.1456, "lng": -16.0634}},
                ],
            },
        ],
    },
    "burkina_faso": {
        "country": "Burkina Faso",
        "nameFrench": "Burkina Faso",
        "flag": "🇧🇫",
        "phonePrefix": "+226",
        "currency": "XOF",
        "language": "fr",
        "bounds": {"north": 15.084100, "south": 9.401100, "east": 2.405000, "west": -5.518900},
        "majorCities": [
            {
                "name": "Ouagadougou",
                "coordinates": {"lat": 12.3714, "lng": -1.5197},
                "districts": [
                    {"name": "Zone du Bois", "coords": {"lat": 12.3456, "lng": -1.5089}},
                    {"name": "Cissin", "coords": {"lat": 12.3534, "lng": -1.5456}},
                    {"name": "Gounghin", "coords": {"lat": 12.3823, "lng": -1.5234}},
                    {"name": "Kamsaoghin", "coords": {"lat": 12.3567, "lng": -1.4967}},
                    {"name": "Bogodogo", "coords": {"lat": 12.4012, "lng": -1.4823}},
                    {"name": "Dassasgho", "coords": {"lat": 12.3289, "lng": -1.5378}},
                    {"name": "Tampouy", "coords": {"lat": 12.4156, "lng": -1.5089}},
                    {"name": "Patte d'Oie", "coords": {"lat": 12.3678, "lng": -1.5456}},
                ],
            },
            {
                "name": "Bobo-Dioulasso",
                "coordinates": {"lat": 11.1781, "lng": -4.2978},
                "districts": [
                    {"name": "Secteur 1", "coords": {"lat": 11.1823, "lng": -4.2934}},
                    {"name": "Secteur 15", "coords": {"lat": 11.1689, "lng": -4.3123}},
                    {"name": "Koko", "coords": {"lat": 11.1756, "lng": -4.2823}},
                ],
            },
            {
                "name": "Koudougou",
                "coordinates": {"lat": 12.2518, "lng": -2.3648},
                "districts": [
                    {"name": "Centre", "coords": {"lat": 12.2518, "lng": -2.3648}},
                    {"name": "Issouka", "coords": {"lat": 12.2456, "lng": -2.3723}},
                    {"name": "Dapoya", "coords": {"lat": 12.2589, "lng": -2.3567}},
                ],
            },
        ],
    },
    "cote_divoire": {
        "country": "Ivory Coast",
        "nameFrench": "Côte d'Ivoire",
        "flag": "🇨🇮",
        "phonePrefix": "+225",
        "currency": "XOF",
        "language": "fr",
        "bounds": {"north": 10.740200, "south": 4.357100, "east": -2.494700, "west": -8.602400},
        "majorCities": [
            {
                "name": "Abidjan",
                "coordinates": {"lat": 5.3600, "lng": -4.0083},
                "districts": [
                    {"name": "Plateau", "coords": {"lat": 5.3167, "lng": -4.0333}},
                    {"name": "Cocody", "coords": {"lat": 5.3578, "lng": -3.9889}},
                    {"name": "Marcory", "coords": {"lat": 5.2978, "lng": -4.0156}},
                    {"name": "Treichville", "coords": {"lat": 5.2856, "lng": -4.0267}},
                    {"name": "Yopougon", "coords": {"lat": 5.3556, "lng": -4.0889}},
                    {"name": "Adjamé", "coords": {"lat": 5.3678, "lng": -4.0234}},
                    {"name": "Abobo", "coords": {"lat": 5.4178, "lng": -4.0156}},
                    {"name": "Koumassi", "coords": {"lat": 5.2889, "lng": -3.9767}},
                    {"name": "Port-Bouët", "coords": {"lat": 5.2356, "lng": -3.9234}},
                ],
            },
            {
                "name": "Yamoussoukro",
                "coordinates": {"lat": 6.8276, "lng": -5.2893},
                "districts": [
                    {"name": "Centre", "coords": {"lat": 6.8276, "lng": -5.2893}},
                    {"name": "Habitat", "coords": {"lat": 6.8234, "lng": -5.2756}},
                    {"name": "Millionnaire", "coords": {"lat": 6.8356, "lng": -5.2967}},
                ],
            },
            {
                "name": "Bouaké",
                "coordinates": {"lat": 7.6906, "lng": -5.0300},
                "districts": [
                    {"name": "Centre", "coords": {"lat": 7.6906, "lng": -5.0300}},
                    {"name": "Air France 2", "coords": {"lat": 7.6834, "lng": -5.0234}},
                    {"name": "Koko", "coords": {"lat": 7.6978, "lng": -5.0423}},
                ],
            },
        ],
    },
}


def _haversine_km(lat1, lng1, lat2, lng2):
    """Distance en km entre deux points (formule de Haversine)."""
    import math

    radius = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    )
    return radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def find_nearest_location(lat, lng):
    """Trouve la ville/quartier le plus proche des coordonnées.

    Retourne un dict {country_code, country_name, city, district, distance_km}
    ou None si les coordonnées sont hors des limites de la base (Afrique de
    l'Ouest).
    """
    best = None  # (distance, code, name_french, city_name, district_name)
    for code, data in GEOGRAPHIC_DATABASE.items():
        bounds = data["bounds"]
        if not (bounds["south"] <= lat <= bounds["north"] and bounds["west"] <= lng <= bounds["east"]):
            continue
        for city in data["majorCities"]:
            coords = city["coordinates"]
            distance = _haversine_km(lat, lng, coords["lat"], coords["lng"])
            if best is None or distance < best[0]:
                best = (distance, code, data["nameFrench"], city["name"], "")
            for district in city.get("districts", []):
                dcoords = district["coords"]
                ddistance = _haversine_km(lat, lng, dcoords["lat"], dcoords["lng"])
                # <= : à distance égale (ex. coordonnées exactes d'un quartier
                # confondues avec le centre-ville), le quartier gagne — plus précis.
                if best is None or ddistance <= best[0]:
                    best = (ddistance, code, data["nameFrench"], city["name"], district["name"])
    if best is None:
        return None
    return {
        "country_code": best[1],
        "country_name": best[2],
        "city": best[3],
        "district": best[4],
        "distance_km": round(best[0], 2),
    }
