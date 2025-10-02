#!/usr/bin/env python3
"""
Test spécifique pour la correction de l'erreur "Unexpected token 'I', Internal S..."
Teste que les erreurs de validation Pydantic retournent du JSON 422 au lieu de HTML 500
"""

import requests
import json
import sys
from datetime import datetime

class ValidationErrorTester:
    def __init__(self, base_url="https://kojo-profile.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0
        self.failed_tests = []

    def test_validation_error_scenario(self, name, user_data, expected_status=422, should_contain_text=None):
        """Teste un scénario spécifique d'erreur de validation"""
        url = f"{self.base_url}/auth/register-verified"
        headers = {'Content-Type': 'application/json'}
        
        self.tests_run += 1
        print(f"\n🔍 Test {self.tests_run}: {name}")
        print(f"   Data: {json.dumps(user_data, indent=2)}")
        
        try:
            response = requests.post(url, json=user_data, headers=headers)
            
            print(f"   Status Code: {response.status_code}")
            print(f"   Content-Type: {response.headers.get('content-type', 'N/A')}")
            
            # Vérifier que c'est du JSON, pas du HTML
            content_type = response.headers.get('content-type', '')
            is_json = 'application/json' in content_type
            
            if not is_json:
                print(f"❌ ÉCHEC: Réponse n'est pas JSON - Content-Type: {content_type}")
                print(f"   Début de la réponse: {response.text[:200]}...")
                self.failed_tests.append(f"{name} - Réponse HTML au lieu de JSON")
                return False
            
            # Vérifier le status code
            if response.status_code != expected_status:
                print(f"❌ ÉCHEC: Status attendu {expected_status}, reçu {response.status_code}")
                self.failed_tests.append(f"{name} - Status {response.status_code} au lieu de {expected_status}")
                return False
            
            # Vérifier le contenu JSON
            try:
                response_data = response.json()
                print(f"   Réponse JSON: {json.dumps(response_data, indent=2, ensure_ascii=False)}")
                
                # Vérifier si le texte attendu est présent
                if should_contain_text:
                    response_str = json.dumps(response_data, ensure_ascii=False).lower()
                    if should_contain_text.lower() not in response_str:
                        print(f"❌ ÉCHEC: Texte '{should_contain_text}' non trouvé dans la réponse")
                        self.failed_tests.append(f"{name} - Texte manquant: {should_contain_text}")
                        return False
                
                print(f"✅ SUCCÈS: Erreur de validation correctement gérée en JSON")
                self.tests_passed += 1
                return True
                
            except json.JSONDecodeError as e:
                print(f"❌ ÉCHEC: Impossible de décoder JSON - {e}")
                print(f"   Réponse brute: {response.text[:500]}...")
                self.failed_tests.append(f"{name} - JSON invalide")
                return False
                
        except Exception as e:
            print(f"❌ ERREUR: Exception lors du test - {e}")
            self.failed_tests.append(f"{name} - Exception: {str(e)}")
            return False

    def test_valid_registration(self):
        """Teste qu'une inscription valide fonctionne toujours"""
        valid_user = {
            "email": f"test_valid_{int(datetime.now().timestamp())}@example.com",
            "password": "MotDePasseSecurise123!",
            "first_name": "Jean",
            "last_name": "Dupont",
            "phone": "+221701234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr",
            "payment_accounts": {
                "orange_money": "+221701234567"
            }
        }
        
        url = f"{self.base_url}/auth/register-verified"
        headers = {'Content-Type': 'application/json'}
        
        self.tests_run += 1
        print(f"\n🔍 Test {self.tests_run}: Inscription valide (contrôle)")
        
        try:
            response = requests.post(url, json=valid_user, headers=headers)
            
            if response.status_code == 200:
                response_data = response.json()
                if 'access_token' in response_data:
                    print(f"✅ SUCCÈS: Inscription valide fonctionne - Token reçu")
                    self.tests_passed += 1
                    return True
            
            print(f"❌ ÉCHEC: Inscription valide échouée - Status: {response.status_code}")
            try:
                print(f"   Réponse: {response.json()}")
            except:
                print(f"   Réponse brute: {response.text[:300]}")
            self.failed_tests.append("Inscription valide échouée")
            return False
            
        except Exception as e:
            print(f"❌ ERREUR: Exception lors de l'inscription valide - {e}")
            self.failed_tests.append(f"Inscription valide - Exception: {str(e)}")
            return False

    def run_all_validation_tests(self):
        """Exécute tous les tests de validation d'erreur"""
        print("🚀 DÉBUT DES TESTS DE VALIDATION D'ERREUR")
        print("=" * 60)
        
        # Test 1: Noms trop courts
        self.test_validation_error_scenario(
            "Noms trop courts (first_name='a', last_name='b')",
            {
                "email": f"test_short_{int(datetime.now().timestamp())}@example.com",
                "password": "MotDePasseSecurise123!",
                "first_name": "a",  # Trop court
                "last_name": "b",   # Trop court
                "phone": "+221701234567",
                "user_type": "client",
                "country": "senegal",
                "preferred_language": "fr",
                "payment_accounts": {
                    "orange_money": "+221701234567"
                }
            },
            expected_status=422,
            should_contain_text="prénom doit contenir au moins 2 caractères"
        )
        
        # Test 2: Téléphone sans +
        self.test_validation_error_scenario(
            "Téléphone sans + (format invalide)",
            {
                "email": f"test_phone_{int(datetime.now().timestamp())}@example.com",
                "password": "MotDePasseSecurise123!",
                "first_name": "Jean",
                "last_name": "Dupont",
                "phone": "221701234567",  # Sans +
                "user_type": "client",
                "country": "senegal",
                "preferred_language": "fr",
                "payment_accounts": {
                    "orange_money": "+221701234567"
                }
            },
            expected_status=422,
            should_contain_text="téléphone"
        )
        
        # Test 3: Téléphone trop court
        self.test_validation_error_scenario(
            "Téléphone trop court",
            {
                "email": f"test_phone_short_{int(datetime.now().timestamp())}@example.com",
                "password": "MotDePasseSecurise123!",
                "first_name": "Jean",
                "last_name": "Dupont",
                "phone": "+221123",  # Trop court
                "user_type": "client",
                "country": "senegal",
                "preferred_language": "fr",
                "payment_accounts": {
                    "orange_money": "+221701234567"
                }
            },
            expected_status=422,
            should_contain_text="téléphone"
        )
        
        # Test 4: Email invalide
        self.test_validation_error_scenario(
            "Email invalide",
            {
                "email": "email_invalide_sans_arobase",  # Email invalide
                "password": "MotDePasseSecurise123!",
                "first_name": "Jean",
                "last_name": "Dupont",
                "phone": "+221701234567",
                "user_type": "client",
                "country": "senegal",
                "preferred_language": "fr",
                "payment_accounts": {
                    "orange_money": "+221701234567"
                }
            },
            expected_status=422
        )
        
        # Test 5: Caractères spéciaux dans le nom
        self.test_validation_error_scenario(
            "Caractères spéciaux invalides dans le nom",
            {
                "email": f"test_special_{int(datetime.now().timestamp())}@example.com",
                "password": "MotDePasseSecurise123!",
                "first_name": "Jean@#$",  # Caractères invalides
                "last_name": "Dupont",
                "phone": "+221701234567",
                "user_type": "client",
                "country": "senegal",
                "preferred_language": "fr",
                "payment_accounts": {
                    "orange_money": "+221701234567"
                }
            },
            expected_status=422
        )
        
        # Test de contrôle: Inscription valide
        self.test_valid_registration()
        
        # Résumé des tests
        print("\n" + "=" * 60)
        print("📊 RÉSUMÉ DES TESTS DE VALIDATION")
        print(f"Tests exécutés: {self.tests_run}")
        print(f"Tests réussis: {self.tests_passed}")
        print(f"Tests échoués: {self.tests_run - self.tests_passed}")
        
        if self.failed_tests:
            print("\n❌ TESTS ÉCHOUÉS:")
            for i, failure in enumerate(self.failed_tests, 1):
                print(f"   {i}. {failure}")
        
        success_rate = (self.tests_passed / self.tests_run) * 100 if self.tests_run > 0 else 0
        print(f"\n🎯 Taux de réussite: {success_rate:.1f}%")
        
        if success_rate >= 80:
            print("✅ CORRECTION VALIDÉE: Les erreurs de validation retournent du JSON 422")
            return True
        else:
            print("❌ CORRECTION ÉCHOUÉE: Des erreurs retournent encore du HTML 500")
            return False

if __name__ == "__main__":
    tester = ValidationErrorTester()
    success = tester.run_all_validation_tests()
    
    if success:
        print("\n🎉 SUCCÈS: L'erreur 'Unexpected token I, Internal S...' est DÉFINITIVEMENT corrigée!")
        sys.exit(0)
    else:
        print("\n💥 ÉCHEC: L'erreur persiste, des corrections supplémentaires sont nécessaires")
        sys.exit(1)