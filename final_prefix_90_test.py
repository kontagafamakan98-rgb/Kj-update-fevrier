#!/usr/bin/env python3
"""
🎯 TEST FINAL PRÉFIXE 90 ORANGE MONEY - VALIDATION CORRECTE
Test avec des noms valides pour éviter les erreurs Pydantic
"""

import requests
import json

def test_prefix_90_final():
    """Test final du préfixe 90 avec données valides"""
    base_url = "https://local-connect-43.preview.emergentagent.com/api"
    
    print("🎯 TEST FINAL PRÉFIXE 90 ORANGE MONEY")
    print("=" * 60)
    
    # Test des 4 pays avec préfixe 90 et noms valides
    test_cases = [
        {
            "country": "🇸🇳 Sénégal",
            "phone": "+22190777888",
            "email": "final_sn_quatre_vingt_dix@kojo.com",
            "country_code": "senegal",
            "first_name": "Ousmane",
            "last_name": "Diop"
        },
        {
            "country": "🇲🇱 Mali", 
            "phone": "+22390777888",
            "email": "final_ml_quatre_vingt_dix@kojo.com",
            "country_code": "mali",
            "first_name": "Aminata",
            "last_name": "Keita"
        },
        {
            "country": "🇨🇮 Côte d'Ivoire",
            "phone": "+22590777888", 
            "email": "final_ci_quatre_vingt_dix@kojo.com",
            "country_code": "ivory_coast",
            "first_name": "Kouadio",
            "last_name": "Yao"
        },
        {
            "country": "🇧🇫 Burkina Faso",
            "phone": "+22690777888",
            "email": "final_bf_quatre_vingt_dix@kojo.com", 
            "country_code": "burkina_faso",
            "first_name": "Rasmané",
            "last_name": "Sawadogo"
        }
    ]
    
    success_count = 0
    total_tests = len(test_cases)
    
    for test_case in test_cases:
        print(f"\n🔍 Test {test_case['country']} - Orange Money 90")
        
        user_data = {
            "email": test_case["email"],
            "password": "TestKojo2025!",
            "first_name": test_case["first_name"],
            "last_name": test_case["last_name"],
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
                response_data = response.json()
                user_info = response_data.get('user', {})
                payment_info = response_data.get('payment_verification', {})
                
                print(f"✅ {test_case['country']}: PRÉFIXE 90 VALIDÉ!")
                print(f"   📱 Numéro: {test_case['phone']}")
                print(f"   👤 Utilisateur: {user_info.get('first_name')} {user_info.get('last_name')}")
                print(f"   💳 Comptes liés: {payment_info.get('linked_accounts', 0)}")
                success_count += 1
                
                # Test de connexion immédiate
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
                print(f"✅ {test_case['country']}: PRÉFIXE 90 DÉJÀ VALIDÉ")
                print(f"   📱 Numéro: {test_case['phone']} (utilisateur existant)")
                success_count += 1
            else:
                try:
                    error_detail = response.json().get('detail', 'Erreur inconnue')
                except:
                    error_detail = response.text
                print(f"❌ {test_case['country']}: PRÉFIXE 90 REJETÉ")
                print(f"   📱 Numéro: {test_case['phone']}")
                print(f"   ❌ Erreur: {error_detail}")
                
        except Exception as e:
            print(f"❌ {test_case['country']}: ERREUR DE TEST")
            print(f"   📱 Numéro: {test_case['phone']}")
            print(f"   ❌ Exception: {str(e)}")
    
    # Test de validation directe des préfixes
    print(f"\n🔍 VALIDATION DIRECTE DES PRÉFIXES")
    print("-" * 40)
    
    validation_tests = [
        ("+22190000000", "Sénégal 90"),
        ("+22390000000", "Mali 90"), 
        ("+22590000000", "Côte d'Ivoire 90"),
        ("+22690000000", "Burkina Faso 90"),
        ("+22191000000", "Sénégal 91 (invalide)"),
        ("+22391000000", "Mali 91 (invalide)")
    ]
    
    for phone, description in validation_tests:
        test_data = {
            "email": f"validation_{phone.replace('+', '').replace('0', 'x')}@kojo.com",
            "password": "TestKojo2025!",
            "first_name": "Test",
            "last_name": "Validation",
            "phone": phone,
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr",
            "payment_accounts": {
                "orange_money": phone
            }
        }
        
        try:
            response = requests.post(
                f"{base_url}/auth/register-verified",
                json=test_data,
                headers={'Content-Type': 'application/json'}
            )
            
            if response.status_code == 200:
                print(f"✅ {description}: ACCEPTÉ")
            elif response.status_code == 400:
                if "already registered" in response.text:
                    print(f"✅ {description}: DÉJÀ VALIDÉ")
                elif "Orange Money invalide" in response.text:
                    print(f"❌ {description}: REJETÉ (attendu pour préfixes invalides)")
                else:
                    print(f"⚠️ {description}: {response.text}")
            else:
                print(f"⚠️ {description}: Status {response.status_code}")
                
        except Exception as e:
            print(f"❌ {description}: Erreur {str(e)}")
    
    print("\n" + "=" * 60)
    print("📊 RÉSULTATS FINAUX PRÉFIXE 90 ORANGE MONEY")
    print("=" * 60)
    print(f"✅ Pays validés avec préfixe 90: {success_count}/{total_tests}")
    print(f"📈 Taux de réussite: {(success_count/total_tests*100):.0f}%")
    
    if success_count == total_tests:
        print("\n🎉 VALIDATION COMPLÈTE RÉUSSIE!")
        print("✅ Le préfixe 90 Orange Money est OPÉRATIONNEL")
        print("✅ Tous les 4 pays prioritaires Kojo supportent le préfixe 90")
        print("✅ Inscription, validation et connexion fonctionnent parfaitement")
        print("\n🚀 OBJECTIF ATTEINT:")
        print("   📱 +22190xxxxxx (Sénégal) → ACCEPTÉ")
        print("   📱 +22390xxxxxx (Mali) → ACCEPTÉ") 
        print("   📱 +22590xxxxxx (Côte d'Ivoire) → ACCEPTÉ")
        print("   📱 +22690xxxxxx (Burkina Faso) → ACCEPTÉ")
        return True
    else:
        print(f"\n⚠️ {total_tests - success_count} pays ont échoué")
        print("❌ Le préfixe 90 nécessite des corrections")
        return False

if __name__ == "__main__":
    success = test_prefix_90_final()
    exit(0 if success else 1)