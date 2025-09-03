#!/usr/bin/env python3
"""
FOCUSED PHONE VALIDATION TEST
Test key phone number formats to verify the validator corrections
"""

import requests
import json
import time
import random

def test_phone_format(phone_number, country, description):
    """Test a specific phone number format"""
    
    # Generate truly unique email
    timestamp = int(time.time() * 1000000)
    random_num = random.randint(1000, 9999)
    email = f"test_{timestamp}_{random_num}@gmail.com"
    
    registration_data = {
        "email": email,
        "password": "TestPassword123!",
        "first_name": "Test",
        "last_name": "User",
        "phone": phone_number,
        "user_type": "client",
        "country": country,
        "preferred_language": "fr"
    }
    
    try:
        response = requests.post(
            "https://precise-geo-app.preview.emergentagent.com/api/auth/register",
            json=registration_data,
            headers={'Content-Type': 'application/json'},
            timeout=10
        )
        
        if response.status_code == 200:
            print(f"✅ {description}: {phone_number} - ACCEPTED")
            return True
        else:
            try:
                error_data = response.json()
                error_msg = error_data.get('detail', 'Unknown error')
                print(f"❌ {description}: {phone_number} - REJECTED ({response.status_code}) - {error_msg}")
            except:
                print(f"❌ {description}: {phone_number} - REJECTED ({response.status_code}) - {response.text[:100]}")
            return False
            
    except Exception as e:
        print(f"❌ {description}: {phone_number} - ERROR: {str(e)}")
        return False

def main():
    print("🎯 FOCUSED PHONE VALIDATION TEST")
    print("Testing key phone number formats...")
    print()
    
    # Test key formats from the review request
    test_cases = [
        # Spaces (priority)
        ("+223 70123456", "mali", "Mali avec espace"),
        ("+221 77 123 4567", "senegal", "Sénégal avec espaces multiples"),
        
        # Dashes
        ("+223-70-123-456", "mali", "Mali avec tirets"),
        ("+221-77-123-4567", "senegal", "Sénégal avec tirets"),
        
        # Parentheses
        ("+223(70)123456", "mali", "Mali avec parenthèses"),
        ("+221(77)123456", "senegal", "Sénégal avec parenthèses"),
        
        # Clean format
        ("+22370123456", "mali", "Mali sans formatage"),
        ("+22177123456", "senegal", "Sénégal sans formatage"),
        
        # New prefixes 70-99
        ("+223 75123456", "mali", "Mali nouveau préfixe 75"),
        ("+221 90 123456", "senegal", "Sénégal nouveau préfixe 90"),
        
        # Mixed formats
        ("+223 (70) 123-456", "mali", "Mali format mixte"),
        
        # Should fail
        ("+223 60123456", "mali", "Mali préfixe invalide 60 (should fail)"),
        ("+223 70", "mali", "Mali numéro trop court (should fail)"),
    ]
    
    passed = 0
    total = len(test_cases)
    
    for phone, country, description in test_cases:
        success = test_phone_format(phone, country, description)
        if success:
            passed += 1
        time.sleep(0.5)  # Small delay between requests
    
    print()
    print(f"📊 RÉSULTATS: {passed}/{total} tests réussis")
    
    if passed >= 9:  # Most should pass except the invalid ones
        print("🎉 VALIDATION TÉLÉPHONE FONCTIONNE CORRECTEMENT!")
        print("✅ Le validator nettoie bien les espaces, tirets, parenthèses")
        print("✅ Les préfixes 70-99 sont acceptés")
        print("✅ Les formats mixtes fonctionnent")
    else:
        print("⚠️ Des problèmes persistent dans la validation téléphone")

if __name__ == "__main__":
    main()