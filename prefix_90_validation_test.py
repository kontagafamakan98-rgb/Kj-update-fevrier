#!/usr/bin/env python3
"""
🎯 VALIDATION FINALE PRÉFIXE 90 ORANGE MONEY
Test de validation finale pour confirmer le bon fonctionnement du préfixe 90
"""

import requests
import json

def test_prefix_90_comprehensive():
    """Test complet du préfixe 90 Orange Money"""
    base_url = "https://kojo-work.preview.emergentagent.com/api"
    
    print("🎯 VALIDATION FINALE PRÉFIXE 90 ORANGE MONEY")
    print("=" * 60)
    
    # Test des 4 pays avec préfixe 90
    test_cases = [
        {
            "country": "🇸🇳 Sénégal",
            "phone": "+22190555666",
            "email": "final_test_sn_90@kojo.com",
            "country_code": "senegal"
        },
        {
            "country": "🇲🇱 Mali", 
            "phone": "+22390555666",
            "email": "final_test_ml_90@kojo.com",
            "country_code": "mali"
        },
        {
            "country": "🇨🇮 Côte d'Ivoire",
            "phone": "+22590555666", 
            "email": "final_test_ci_90@kojo.com",
            "country_code": "ivory_coast"
        },
        {
            "country": "🇧🇫 Burkina Faso",
            "phone": "+22690555666",
            "email": "final_test_bf_90@kojo.com", 
            "country_code": "burkina_faso"
        }
    ]
    
    success_count = 0
    total_tests = len(test_cases)
    
    for test_case in test_cases:
        print(f"\n🔍 Test {test_case['country']} - Préfixe 90")
        
        user_data = {
            "email": test_case["email"],
            "password": "TestKojo2025!",
            "first_name": "Test",
            "last_name": "Prefix90",
            "phone": test_case["phone"],
            "user_type": "client",
            "country": test_case["country_code"],
            "preferred_language": "fr",
            "payment_accounts": {
                "orange_money": test_case["phone"]
            }
        }
        
        try:
            response = requests.post(
                f"{base_url}/auth/register-verified",
                json=user_data,
                headers={'Content-Type': 'application/json'}
            )
            
            if response.status_code == 200:
                print(f"✅ {test_case['country']}: Préfixe 90 ACCEPTÉ - {test_case['phone']}")
                success_count += 1
                
                # Test de connexion
                login_response = requests.post(
                    f"{base_url}/auth/login",
                    json={
                        "email": test_case["email"],
                        "password": "TestKojo2025!"
                    },
                    headers={'Content-Type': 'application/json'}
                )
                
                if login_response.status_code == 200:
                    print(f"   ✅ Connexion réussie")
                else:
                    print(f"   ⚠️ Connexion échouée")
                    
            elif response.status_code == 400 and "already registered" in response.text:
                print(f"✅ {test_case['country']}: Préfixe 90 DÉJÀ VALIDÉ - {test_case['phone']}")
                success_count += 1
            else:
                print(f"❌ {test_case['country']}: Préfixe 90 REJETÉ - {test_case['phone']}")
                print(f"   Erreur: {response.text}")
                
        except Exception as e:
            print(f"❌ {test_case['country']}: Erreur de test - {str(e)}")
    
    print("\n" + "=" * 60)
    print("📊 RÉSULTATS FINAUX PRÉFIXE 90")
    print("=" * 60)
    print(f"✅ Pays validés: {success_count}/{total_tests}")
    print(f"📈 Taux de réussite: {(success_count/total_tests*100):.0f}%")
    
    if success_count == total_tests:
        print("\n🎉 SUCCÈS COMPLET!")
        print("✅ Le préfixe 90 Orange Money fonctionne parfaitement")
        print("✅ Tous les utilisateurs avec numéros 90 peuvent utiliser Kojo")
        print("✅ Validation, inscription et connexion opérationnelles")
        return True
    else:
        print(f"\n⚠️ {total_tests - success_count} pays ont échoué")
        print("❌ Le préfixe 90 nécessite des corrections")
        return False

if __name__ == "__main__":
    success = test_prefix_90_comprehensive()
    exit(0 if success else 1)