from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from kojo_geo_data import GEOGRAPHIC_DATABASE, find_nearest_location


router = APIRouter()


@router.get("/geolocation/cities")
async def get_cities(country: Optional[str] = None):
    """
    Base géographique des villes/quartiers ouest-africains (source de vérité).

    Le frontend charge cette base au démarrage (et la met en cache) au lieu
    d'embarquer une copie complète dans le bundle. Le paramètre `country`
    (code : mali, senegal, burkina_faso, cote_divoire) filtre sur un seul pays.

    Returns:
        - countries: dict code -> données complètes (bounds, majorCities,
          districts avec coordonnées) — ou `data` si `country` est fourni.
    """
    if country:
        code = country.strip().lower().replace(" ", "_")
        data = GEOGRAPHIC_DATABASE.get(code)
        if not data:
            raise HTTPException(status_code=404, detail="Pays inconnu")
        return {"country": code, "data": data}

    return {
        "countries": GEOGRAPHIC_DATABASE,
        "total": len(GEOGRAPHIC_DATABASE),
    }


@router.get("/geolocation/reverse")
async def reverse_geocode(lat: float, lng: float):
    """
    Reverse geocoding local (Afrique de l'Ouest) — remplace l'appel navigateur
    à nominatim.openstreetmap.org.

    Retourne une structure compatible avec ce que le frontend attendait de
    Nominatim (display_name + address) pour que les parseurs frontend
    (`buildPreciseAddressFromReverseData`, `jobLocationRuntime.reverseGeocode`)
    fonctionnent sans changement.

    Args:
        lat: Latitude
        lng: Longitude

    Returns:
        - display_name: str - Adresse formatée
        - address: dict - Champs détaillés (suburb, city, country, country_code)
        - lat/lon: float - Coordonnées écho
    """
    match = find_nearest_location(lat, lng)

    if not match:
        # Hors zone (hors Afrique de l'Ouest) : pas de ville connue, on
        # retourne les coordonnées brutes — le frontend bascule alors sur
        # son fallback (coordonnées ou pays du profil).
        return {
            "display_name": f"{lat:.6f}, {lng:.6f}",
            "address": {},
            "lat": lat,
            "lon": lng,
        }

    district = match["district"]
    city = match["city"]
    country_name = match["country_name"]
    if district:
        display = f"{district}, {city}, {country_name}"
    else:
        display = f"{city}, {country_name}"

    return {
        "display_name": display,
        "address": {
            "road": "",
            "suburb": district,
            "city": city,
            "country": country_name,
            "country_code": match["country_code"],
            "postcode": "",
        },
        "lat": lat,
        "lon": lng,
    }

WEST_AFRICA_COUNTRIES = {
    "senegal": {
        "code": "senegal",
        "name": "Sénégal",
        "nameFrench": "Sénégal",
        "nameEnglish": "Senegal",
        "flag": "🇸🇳",
        "phonePrefix": "+221",
        "phonePrefixes": ["+221"],
        "currency": "XOF",
        "currencySymbol": "FCFA",
        "capital": "Dakar",
        "languages": ["fr", "wo"],
        "primaryLanguage": "fr",
        "localLanguage": "wo",
        "timezone": "Africa/Dakar",
        "coordinates": {"lat": 14.6928, "lng": -17.4467}
    },
    "mali": {
        "code": "mali",
        "name": "Mali",
        "nameFrench": "Mali",
        "nameEnglish": "Mali",
        "flag": "🇲🇱",
        "phonePrefix": "+223",
        "phonePrefixes": ["+223"],
        "currency": "XOF",
        "currencySymbol": "FCFA",
        "capital": "Bamako",
        "languages": ["fr", "bm"],
        "primaryLanguage": "fr",
        "localLanguage": "bm",
        "timezone": "Africa/Bamako",
        "coordinates": {"lat": 12.6392, "lng": -8.0029}
    },
    "burkina_faso": {
        "code": "burkina_faso",
        "name": "Burkina Faso",
        "nameFrench": "Burkina Faso",
        "nameEnglish": "Burkina Faso",
        "flag": "🇧🇫",
        "phonePrefix": "+226",
        "phonePrefixes": ["+226"],
        "currency": "XOF",
        "currencySymbol": "FCFA",
        "capital": "Ouagadougou",
        "languages": ["fr", "mos"],
        "primaryLanguage": "fr",
        "localLanguage": "mos",
        "timezone": "Africa/Ouagadougou",
        "coordinates": {"lat": 12.3714, "lng": -1.5197}
    },
    "cote_divoire": {
        "code": "cote_divoire",
        "name": "Côte d'Ivoire",
        "nameFrench": "Côte d'Ivoire",
        "nameEnglish": "Ivory Coast",
        "flag": "🇨🇮",
        "phonePrefix": "+225",
        "phonePrefixes": ["+225"],
        "currency": "XOF",
        "currencySymbol": "FCFA",
        "capital": "Abidjan",
        "languages": ["fr", "en"],
        "primaryLanguage": "fr",
        "localLanguage": "fr",
        "timezone": "Africa/Abidjan",
        "coordinates": {"lat": 5.3600, "lng": -4.0083}
    }
}

IP_COUNTRY_HINTS = {
    # Sénégal ISPs
    "41.82.": "senegal", "41.83.": "senegal", "196.1.": "senegal", "196.206.": "senegal",
    # Mali ISPs
    "41.73.": "mali", "217.64.": "mali", "196.200.": "mali",
    # Burkina Faso ISPs
    "41.78.": "burkina_faso", "196.28.": "burkina_faso", "41.203.": "burkina_faso",
    # Côte d'Ivoire ISPs
    "41.66.": "cote_divoire", "196.180.": "cote_divoire", "41.207.": "cote_divoire"
}

def detect_country_from_ip(ip_address: str) -> Optional[str]:
    """Détecte le pays à partir de l'adresse IP (préfixes FAI ouest-africains).

    Retourne le code pays (ex: 'senegal', 'mali') ou None si la détection est
    impossible : adresse vide, localhost (127.0.0.1, ::1, localhost) ou préfixe
    inconnu (hors Afrique de l'Ouest / IP privée). Les appelants doivent
    traiter None comme « pays non détecté » — ne PAS forcer un défaut ici.
    """
    if not ip_address or ip_address in ["127.0.0.1", "localhost", "::1"]:
        return None
    
    # Vérifier les préfixes IP connus
    for prefix, country in IP_COUNTRY_HINTS.items():
        if ip_address.startswith(prefix):
            return country
    
    return None

def detect_country_from_phone(phone: str) -> Optional[str]:
    """Détecte le pays à partir du numéro de téléphone (indicatif pays).

    Retourne le code pays (ex: 'senegal', 'mali') ou None si la détection est
    impossible : numéro vide ou indicatif inconnu (hors +221/+223/+226/+225).
    Les espaces sont ignorés avant comparaison. Les appelants doivent traiter
    None comme « pays non détecté » — ne PAS forcer un défaut ici.
    """
    if not phone:
        return None
    
    phone = phone.strip().replace(" ", "")
    
    phone_to_country = {
        "+221": "senegal",
        "+223": "mali",
        "+226": "burkina_faso",
        "+225": "cote_divoire"
    }
    
    for prefix, country in phone_to_country.items():
        if phone.startswith(prefix):
            return country
    
    return None

@router.get("/geolocation/available-countries")
async def get_available_countries():
    """Liste compacte des pays supportés (id, nom, drapeau, langues).

    Returns:
        dict: {countries: [{id, name, flag, languages}]}.
    """
    return {
        "countries": [
            {"id": "mali", "name": "Mali", "flag": "🇲🇱", "languages": ["fr", "en", "bm"]},
            {"id": "senegal", "name": "Sénégal", "flag": "🇸🇳", "languages": ["fr", "en", "wo"]},
            {"id": "cote_divoire", "name": "Côte d'Ivoire", "flag": "🇨🇮", "languages": ["fr", "en"]},
            {"id": "burkina_faso", "name": "Burkina Faso", "flag": "🇧🇫", "languages": ["fr", "en", "mos"]}
        ]
    }

@router.get("/geolocation/detect")
async def detect_geolocation(request: Request, phone: Optional[str] = None):
    """
    Détecter automatiquement le pays de l'utilisateur.
    
    Méthodes de détection (par ordre de priorité):
    1. Numéro de téléphone (si fourni)
    2. Adresse IP

    Aucune détection fiable : on ne force pas un pays par défaut — le client
    (page d'inscription) laisse alors l'utilisateur choisir son pays.

    Returns:
        - detected: bool - Si la détection a réussi
        - method: str - Méthode utilisée (phone, ip, none)
        - country: dict|None - Informations complètes du pays (None si non détecté)
        - supported_countries: list - Liste des pays supportés
    """
    detected_country = None
    detection_method = "default"
    
    # 1. Détection via numéro de téléphone
    if phone:
        detected_country = detect_country_from_phone(phone)
        if detected_country:
            detection_method = "phone"
    
    # 2. Détection via IP
    if not detected_country:
        # Obtenir l'IP du client
        client_ip = request.client.host if request.client else None
        
        # Vérifier les headers de proxy
        forwarded_for = request.headers.get("X-Forwarded-For")
        if forwarded_for:
            client_ip = forwarded_for.split(",")[0].strip()
        
        real_ip = request.headers.get("X-Real-IP")
        if real_ip:
            client_ip = real_ip
        
        if client_ip:
            detected_country = detect_country_from_ip(client_ip)
            if detected_country:
                detection_method = "ip"
    
    # 3. Aucune détection fiable : ne pas inventer de pays (ex. Sénégal)
    if not detected_country:
        return {
            "detected": False,
            "method": "none",
            "country": None,
            "supported_countries": list(WEST_AFRICA_COUNTRIES.values()),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

    country_info = WEST_AFRICA_COUNTRIES.get(detected_country)

    return {
        "detected": True,
        "method": detection_method,
        "country": country_info,
        "supported_countries": list(WEST_AFRICA_COUNTRIES.values()),
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

@router.get("/geolocation/countries")
async def get_supported_countries():
    """
    Obtenir la liste des pays supportés par Kojo.
    
    Returns:
        - countries: list - Liste complète des pays avec leurs informations
        - total: int - Nombre total de pays
    """
    return {
        "countries": list(WEST_AFRICA_COUNTRIES.values()),
        "total": len(WEST_AFRICA_COUNTRIES),
        "default_country": "senegal"
    }

class PhoneValidationRequest(BaseModel):
    phone: str = Field(..., description="Numéro de téléphone à valider")
    country: Optional[str] = Field(None, description="Code du pays à vérifier (optionnel)")

@router.post("/geolocation/validate-phone")
async def validate_phone_for_country(request: PhoneValidationRequest):
    """
    Valider un numéro de téléphone et détecter/vérifier le pays.
    
    Args:
        phone: Numéro de téléphone à valider
        country: Code du pays à vérifier (optionnel)
    
    Returns:
        - valid: bool - Si le numéro est valide
        - detected_country: str - Pays détecté
        - matches_country: bool - Si le numéro correspond au pays spécifié
        - formatted: str - Numéro formaté
    """
    phone = request.phone
    country = request.country
    
    if not phone:
        raise HTTPException(status_code=400, detail="Numéro de téléphone requis")
    
    phone = phone.strip().replace(" ", "").replace("-", "")
    detected = detect_country_from_phone(phone)
    
    # Validation du format
    is_valid = False
    if detected:
        # Vérifier la longueur (préfixe + 8-10 chiffres selon le pays)
        country_info = WEST_AFRICA_COUNTRIES.get(detected)
        if country_info:
            prefix = country_info["phonePrefix"]
            local_number = phone[len(prefix):]
            # Côte d'Ivoire a 10 chiffres, autres pays 8-9
            if detected == "cote_divoire":
                is_valid = len(local_number) >= 8 and len(local_number) <= 10 and local_number.isdigit()
            else:
                is_valid = len(local_number) >= 8 and len(local_number) <= 9 and local_number.isdigit()
    
    matches = True
    if country and detected:
        matches = detected == country
    
    return {
        "valid": is_valid,
        "phone": phone,
        "detected_country": detected,
        "country_info": WEST_AFRICA_COUNTRIES.get(detected) if detected else None,
        "matches_country": matches,
        "formatted": phone if is_valid else None
    }
