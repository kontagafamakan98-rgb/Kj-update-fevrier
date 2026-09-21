# -*- coding: utf-8 -*-
"""Validation et assainissement des entrees utilisateur (comptes de paiement,
numeros mobile money, IBAN, images, email) et refus journalise.

Tout ce qui REFUSE une entree est ici : les regles par pays, les prefixes
mobile money, la somme de controle des cartes, et le masquage de ce qui ne doit
pas ressortir en clair.

Extrait de `kojo_core`, qui n'en garde que la facade : le nom continue d'y
etre servi (`from kojo_core import X`) pour ses importeurs. La surface
publique de la facade est figee par `tests/test_core_surface.py`.
"""
from fastapi import HTTPException
from kojo_models import PaymentAccount, WA_PHONE_RULES
from kojo_settings import logger
from typing import Optional

def validate_payment_accounts(payment_accounts: PaymentAccount, user_type: str, country: Optional[str] = None) -> dict:
    """Valide les comptes de paiement selon le type d'utilisateur.

    `country` (optionnel, si connu) : Wave n'est OPÉRÉ que au Sénégal et en
    Côte d'Ivoire (canaux PayDunya réels) — un compte malien/burkinabé qui ne
    lierait que Wave serait validé ici puis bloqué au moment du paiement.
    """
    if country:
        country_value = getattr(country, "value", str(country)).lower().replace(' ', '_')
    else:
        country_value = None
    if (
        country_value
        and payment_accounts.wave
        and country_value not in ("senegal", "cote_divoire")
    ):
        raise HTTPException(
            status_code=400,
            detail="Wave n'est pas disponible dans ce pays : utilisez Orange Money ou une carte bancaire."
        )
    
    # Compter le nombre de comptes liés
    linked_accounts = 0
    account_details = {}
    
    if payment_accounts.orange_money:
        if not validate_orange_money_number(payment_accounts.orange_money):
            raise HTTPException(status_code=400, detail="Numéro Orange Money invalide")
        linked_accounts += 1
        account_details['orange_money'] = payment_accounts.orange_money
    
    if payment_accounts.wave:
        if not validate_wave_number(payment_accounts.wave):
            raise HTTPException(status_code=400, detail="Numéro Wave invalide")
        linked_accounts += 1
        account_details['wave'] = payment_accounts.wave
    
    if payment_accounts.bank_account:
        if not validate_bank_account(payment_accounts.bank_account):
            raise HTTPException(status_code=400, detail="Informations de compte bancaire invalides")
        linked_accounts += 1
        account_details['bank_account'] = mask_bank_account_info(payment_accounts.bank_account)
    
    # Validation selon le type d'utilisateur
    if user_type == "client":
        if linked_accounts < 1:
            raise HTTPException(
                status_code=400, 
                detail="Les clients doivent lier au moins 1 moyen de paiement (Orange Money, Wave ou Compte bancaire)"
            )
    elif user_type == "worker":
        if linked_accounts < 2:
            raise HTTPException(
                status_code=400,
                detail="Les travailleurs doivent lier au minimum 2 moyens de paiement sur 3 disponibles (Orange Money, Wave, Compte bancaire)"
            )
    
    return {
        "linked_accounts_count": linked_accounts,
        "account_details": account_details,
        "is_verified": True
    }
ALL_PREFIXES_70_99 = [str(i) for i in range(70, 100)]
COTE_DIVOIRE_ALL_MOBILE_PREFIXES = (
    ['01', '05', '07', '08', '09'] +  # Nouveaux préfixes 10 chiffres
    [str(i).zfill(2) for i in range(40, 60)] +  # MTN 40-59
    [str(i) for i in range(70, 100)]  # Orange 70-99
)
KOJO_PRIORITY_COUNTRIES = {
    # Sénégal (+221) - Pays principal
    '221': {
        'country': 'Sénégal',
        'orange_prefixes': ALL_PREFIXES_70_99,  # Orange Sénégal - tous préfixes 70-99
        'wave_prefixes': ALL_PREFIXES_70_99,  # Wave Sénégal - tous préfixes 70-99
        'other_operators': ['76', '75', '33'],  # Tigo, Expresso
        'currency': 'FCFA',
        'primary_language': 'français'
    },
    # Mali (+223) - Pays prioritaire  
    '223': {
        'country': 'Mali',
        'orange_prefixes': ALL_PREFIXES_70_99,  # Orange Mali - tous préfixes 70-99
        'wave_prefixes': ALL_PREFIXES_70_99,  # Wave Mali - tous préfixes 70-99
        'other_operators': ['65', '66', '67', '68'],  # Malitel
        'currency': 'FCFA',
        'primary_language': 'français'
    },
    # Côte d'Ivoire (+225) - Pays prioritaire avec tous les préfixes mobiles
    '225': {
        'country': "Côte d'Ivoire", 
        'orange_prefixes': COTE_DIVOIRE_ALL_MOBILE_PREFIXES,  # Orange + tous préfixes mobiles CI
        'wave_prefixes': COTE_DIVOIRE_ALL_MOBILE_PREFIXES,  # Wave + tous préfixes mobiles CI
        'other_operators': ['58', '59', '48', '49'],  # MTN
        'currency': 'FCFA',
        'primary_language': 'français'
    },
    # Burkina Faso (+226) - Pays prioritaire
    '226': {
        'country': 'Burkina Faso',
        'orange_prefixes': ALL_PREFIXES_70_99,  # Orange Burkina Faso - tous préfixes 70-99
        'wave_prefixes': ALL_PREFIXES_70_99,  # Wave Burkina Faso - tous préfixes 70-99
        'other_operators': ['70', '71', '51', '52'],  # Telmob
        'currency': 'FCFA',
        'primary_language': 'français'
    }
}
def _phone_local_digits_valid(country_code: str, local_digits: str) -> bool:
    """Longueur du numéro local selon le pays (CI : 8-10, autres : 8-9)."""
    rules = WA_PHONE_RULES.get(country_code)
    if not rules:
        return False
    return rules["local_min"] <= len(local_digits) <= rules["local_max"]
def validate_orange_money_number(number: str) -> bool:
    """Valide un numéro Orange Money avec précision par pays"""
    try:
        if not number or not isinstance(number, str):
            logger.warning(f"Invalid Orange Money number format: {number}")
            return False
            
        # Nettoyage et validation basique
        clean_number = ''.join(filter(str.isdigit, number.replace('+', '')))
        logger.debug(f"Orange Money validation - Original: {number}, Cleaned: {clean_number}")
        
        country_code = clean_number[:3]
        local_digits = clean_number[len(country_code):]
        operator_prefix = local_digits[:2]
        logger.debug(f"Orange Money validation - Country: {country_code}, Prefix: {operator_prefix}")
        
        if country_code not in KOJO_PRIORITY_COUNTRIES:
            logger.info(f"Orange Money not supported for country code: {country_code}")
            return False

        # Longueur locale selon le pays (la Côte d'Ivoire utilise aussi le
        # nouveau format à 10 chiffres : +225 + 10 chiffres = 13 au total).
        if not _phone_local_digits_valid(country_code, local_digits):
            logger.info(f"Orange Money number length invalid: {len(clean_number)} digits for {clean_number}")
            return False
            
        # Vérification sécurisée des préfixes
        country_data = KOJO_PRIORITY_COUNTRIES.get(country_code, {})
        valid_prefixes = country_data.get('orange_prefixes', [])
        
        if not valid_prefixes:
            logger.error(f"No Orange Money prefixes defined for country {country_code}")
            return False
            
        is_valid = operator_prefix in valid_prefixes
        
        if not is_valid:
            logger.info(f"Invalid Orange Money prefix {operator_prefix} for country {country_code}. Valid: {valid_prefixes[:5]}...")
        else:
            logger.info(f"✅ Valid Orange Money number validated for {country_data.get('country', country_code)}")
            
        return is_valid
        
    except KeyError as e:
        logger.error(f"KeyError in Orange Money validation: {e}")
        return False
    except Exception as e:
        logger.error(f"Unexpected error validating Orange Money number: {e}")
        return False
def validate_wave_number(number: str) -> bool:
    """Valide un numéro Wave - 4 pays prioritaires Kojo"""
    try:
        if not number or not isinstance(number, str):
            logger.warning(f"Invalid Wave number format: {number}")
            return False
            
        # Nettoyage et validation basique
        clean_number = ''.join(filter(str.isdigit, number.replace('+', '')))
        
        country_code = clean_number[:3]
        local_digits = clean_number[len(country_code):]
        operator_prefix = local_digits[:2]
        
        if country_code not in KOJO_PRIORITY_COUNTRIES:
            logger.info(f"Wave not supported for country code: {country_code}")
            return False

        # Longueur locale selon le pays (CI : nouveau format 10 chiffres)
        if not _phone_local_digits_valid(country_code, local_digits):
            logger.info(f"Wave number length invalid: {len(clean_number)} digits")
            return False
            
        valid_prefixes = KOJO_PRIORITY_COUNTRIES[country_code]['wave_prefixes']
        is_valid = operator_prefix in valid_prefixes
        
        if not is_valid:
            logger.info(f"Invalid Wave prefix {operator_prefix} for country {country_code}")
        else:
            logger.info(f"Valid Wave number validated for {KOJO_PRIORITY_COUNTRIES[country_code]['country']}")
            
        return is_valid
        
    except Exception as e:
        logger.error(f"Error validating Wave number: {e}")
        return False
def validate_bank_card(card_number: str) -> bool:
    """Valide basiquement un numéro de carte bancaire"""
    # Supprimer les espaces et tirets
    clean_card = ''.join(filter(str.isdigit, card_number))
    
    # Vérifier la longueur (16 chiffres généralement)
    if len(clean_card) not in [15, 16]:
        return False
    
    # Algorithme de Luhn simplifié
    return luhn_check(clean_card)
def luhn_check(card_number: str) -> bool:
    """Algorithme de Luhn pour validation carte bancaire"""
    def digits_of(n):
        return [int(d) for d in str(n)]
    
    digits = digits_of(card_number)
    odd_digits = digits[-1::-2]
    even_digits = digits[-2::-2]
    checksum = sum(odd_digits)
    for d in even_digits:
        checksum += sum(digits_of(d*2))
    return checksum % 10 == 0
def mask_bank_card(card_number: str) -> str:
    """Masque le numéro de carte bancaire"""
    clean_card = ''.join(filter(str.isdigit, card_number))
    if len(clean_card) >= 16:
        return f"****-****-****-{clean_card[-4:]}"
    elif len(clean_card) >= 15:
        return f"****-****-***-{clean_card[-4:]}"
    return "****-****-****"
def validate_bank_account(bank_account: dict) -> bool:
    """Valide les informations de compte bancaire"""
    if not isinstance(bank_account, dict):
        return False
    
    # Vérifier les champs obligatoires
    required_fields = ["account_number", "bank_name", "account_holder"]
    for field in required_fields:
        if not bank_account.get(field):
            return False
    
    # Valider le numéro de compte (au moins 8 chiffres)
    account_number = ''.join(filter(str.isdigit, bank_account["account_number"]))
    if len(account_number) < 8:
        return False
    
    # Valider le nom de la banque (au moins 3 caractères)
    if len(bank_account["bank_name"].strip()) < 3:
        return False
    
    # Valider le nom du titulaire (au moins 2 caractères)
    if len(bank_account["account_holder"].strip()) < 2:
        return False
    
    return True
def is_valid_image_content(data: bytes) -> bool:
    """Vérifie les magic bytes d'une image (JPEG/PNG/GIF/WebP).

    Le content-type envoyé par le client est spoofable ; vérifier la signature
    réelle du fichier évite de stocker/envoyer n'importe quel contenu vers
    Cloudinary (coût/DoS).
    """
    if not isinstance(data, (bytes, bytearray)) or len(data) < 12:
        return False
    data = bytes(data)
    return (
        data.startswith(b'\xff\xd8\xff')                  # JPEG
        or data.startswith(b'\x89PNG\r\n\x1a\n')          # PNG
        or data.startswith(b'GIF87a')
        or data.startswith(b'GIF89a')
        or (data[:4] == b'RIFF' and data[8:12] == b'WEBP')  # WebP
    )
def mask_bank_account_info(bank_account: dict) -> dict:
    """Masque les informations sensibles du compte bancaire"""
    if not isinstance(bank_account, dict):
        return {}
    
    masked_account = bank_account.copy()
    
    # Masquer le numéro de compte
    account_number = bank_account.get("account_number", "")
    clean_account = ''.join(filter(str.isdigit, account_number))
    if len(clean_account) >= 8:
        masked_account["account_number"] = f"****{clean_account[-4:]}"
    else:
        masked_account["account_number"] = "****"
    
    # Garder les autres informations non sensibles
    return {
        "account_number": masked_account["account_number"],
        "bank_name": bank_account.get("bank_name", ""),
        "account_holder": bank_account.get("account_holder", ""),
        "bank_code": bank_account.get("bank_code", ""),
        "branch": bank_account.get("branch", "")
    }
def log_and_raise_http_exception(status_code: int, detail: str, logger_instance=None):
    """Enregistre l'erreur et lève une HTTPException de manière centralisée"""
    if logger_instance is None:
        logger_instance = logger
    
    logger_instance.error(f"HTTP {status_code}: {detail}")
    raise HTTPException(status_code=status_code, detail=detail)
def sanitize_email(email: str) -> str:
    """Nettoie une adresse email (minuscules, espaces, caractères de contrôle).

    PAS de détection d'"injection SQL" ici : la base est MongoDB (pas de SQL),
    et EmailStr valide déjà le format côté Pydantic. Les anciens filtres de
    mots-clés SQL (SELECT, UNION, OR…) rejetaient des emails légitimes
    (ex: union@example.com) sans aucun bénéfice de sécurité — ils ont été
    retirés.
    """
    if not email:
        raise ValueError("Email cannot be empty")

    clean = email.strip().lower()
    if len(clean) > 254:
        raise ValueError("Email too long")

    if any(ord(char) < 32 for char in clean):
        raise ValueError("Email contains invalid characters")

    return clean
def sanitize_input_string(input_str: str, field_name: str = "field") -> str:
    """Sanitize general string inputs"""
    if not input_str:
        return ""
    
    # Remove control characters
    sanitized = ''.join(char for char in input_str if ord(char) >= 32 or char in '\n\t')
    
    # Limit length to prevent buffer overflow attacks
    if len(sanitized) > 1000:
        raise ValueError(f"{field_name} is too long (max 1000 characters)")
    
    return sanitized.strip()
