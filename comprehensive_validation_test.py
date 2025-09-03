#!/usr/bin/env python3
"""
Tests complets pour vérifier que toutes les corrections de validation sont fonctionnelles
"""

import requests
import json
import sys
from datetime import datetime

class ComprehensiveValidationTester:
    def __init__(self, base_url="https://precise-geo-app.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0
        self.failed_tests = []

    def test_scenario(self, name, user_data, expected_status, should_contain_text=None, should_not_contain_text=None):
        """Teste un scénario spécifique"""
        url = f"{self.base_url}/auth/register-verified"
        headers = {'Content-Type': 'application/json'}
        
        self.tests_run += 1
        print(f"\n🔍 Test {self.tests_run}: {name}")
        
        try:
            response = requests.post(url, json=user_data, headers=headers)
            
            print(f"   Status: {response.status_code} (attendu: {expected_status})")
            
            # Vérifier le status code
            if response.status_code != expected_status:
                print(f"❌ ÉCHEC: Status incorrect")
                self.failed_tests.append(f"{name} - Status {response.status_code} au lieu de {expected_status}")
                return False
            
            # Vérifier que c'est du JSON
            content_type = response.headers.get('content-type', '')
            if 'application/json' not in content_type:
                print(f"❌ ÉCHEC: Réponse n'est pas JSON - Content-Type: {content_type}")
                self.failed_tests.append(f"{name} - Réponse HTML au lieu de JSON")
                return False
            
            # Vérifier le contenu
            try:
                response_data = response.json()
                response_str = json.dumps(response_data, ensure_ascii=False).lower()
                
                if should_contain_text and should_contain_text.lower() not in response_str:
                    print(f"❌ ÉCHEC: Texte '{should_contain_text}' non trouvé")
                    self.failed_tests.append(f"{name} - Texte manquant: {should_contain_text}")
                    return False
                
                if should_not_contain_text and should_not_contain_text.lower() in response_str:
                    print(f"❌ ÉCHEC: Texte '{should_not_contain_text}' trouvé (ne devrait pas être présent)")
                    self.failed_tests.append(f"{name} - Texte indésirable: {should_not_contain_text}")
                    return False
                
                print(f"✅ SUCCÈS: Test validé")
                self.tests_passed += 1
                return True
                
            except json.JSONDecodeError as e:
                print(f"❌ ÉCHEC: JSON invalide - {e}")
                self.failed_tests.append(f"{name} - JSON invalide")
                return False
                
        except Exception as e:
            print(f"❌ ERREUR: Exception - {e}")
            self.failed_tests.append(f"{name} - Exception: {str(e)}")
            return False

    def run_all_tests(self):
        """Exécute tous les tests de validation"""
        print("🚀 TESTS COMPLETS DE VALIDATION D'ERREUR")
        print("=" * 60)
        
        # Test 1: Noms trop courts - SCÉNARIO PRINCIPAL
        self.test_scenario(
            "Noms trop courts (first_name='a', last_name='b')",
            {
                "email": f"test_short_{int(datetime.now().timestamp())}@example.com",
                "password": "MotDePasseSecurise123!",
                "first_name": "a",
                "last_name": "b",
                "phone": "+221701234567",
                "user_type": "client",
                "country": "senegal",
                "preferred_language": "fr",
                "payment_accounts": {"orange_money": "+221701234567"}
            },
            expected_status=422,
            should_contain_text="prénom doit contenir au moins 2 caractères",
            should_not_contain_text="Internal Server Error"
        )
        
        # Test 2: Téléphone sans + - SCÉNARIO PRINCIPAL
        self.test_scenario(
            "Téléphone sans + (223701234567)",
            {
                "email": f"test_phone_{int(datetime.now().timestamp())}@example.com",
                "password": "MotDePasseSecurise123!",
                "first_name": "Jean",
                "last_name": "Dupont",
                "phone": "223701234567",
                "user_type": "client",
                "country": "senegal",
                "preferred_language": "fr",
                "payment_accounts": {"orange_money": "+221701234567"}
            },
            expected_status=422,
            should_contain_text="téléphone",
            should_not_contain_text="Internal Server Error"
        )
        
        # Test 3: Email déjà existant - doit retourner 400, pas 500
        # D'abord créer un utilisateur
        test_email = f"existing_user_{int(datetime.now().timestamp())}@example.com"
        self.test_scenario(
            "Création utilisateur pour test email existant",
            {
                "email": test_email,
                "password": "MotDePasseSecurise123!",
                "first_name": "Jean",
                "last_name": "Dupont",
                "phone": "+221701234567",
                "user_type": "client",
                "country": "senegal",
                "preferred_language": "fr",
                "payment_accounts": {"orange_money": "+221701234567"}
            },
            expected_status=200
        )
        
        # Maintenant tester avec le même email
        self.test_scenario(
            "Email déjà existant",
            {
                "email": test_email,
                "password": "MotDePasseSecurise123!",
                "first_name": "Marie",
                "last_name": "Martin",
                "phone": "+221701234568",
                "user_type": "client",
                "country": "senegal",
                "preferred_language": "fr",
                "payment_accounts": {"orange_money": "+221701234568"}
            },
            expected_status=400,
            should_contain_text="Cette adresse email est déjà utilisée",
            should_not_contain_text="Internal Server Error"
        )
        
        # Test 4: Inscription normale valide - doit retourner 200 avec token
        self.test_scenario(
            "Inscription normale valide",
            {
                "email": f"valid_user_{int(datetime.now().timestamp())}@example.com",
                "password": "MotDePasseSecurise123!",
                "first_name": "Jean",
                "last_name": "Dupont",
                "phone": "+221701234567",
                "user_type": "client",
                "country": "senegal",
                "preferred_language": "fr",
                "payment_accounts": {"orange_money": "+221701234567"}
            },
            expected_status=200,
            should_contain_text="access_token",
            should_not_contain_text="erreur"
        )
        
        # Test 5: Formats téléphone invalides variés
        invalid_phones = [
            ("Téléphone trop court", "+221123"),
            ("Téléphone trop long", "+2217012345678901234"),
            ("Téléphone avec lettres", "+221abc234567"),
            ("Téléphone vide", ""),
        ]
        
        for phone_test_name, invalid_phone in invalid_phones:
            self.test_scenario(
                f"Format téléphone invalide: {phone_test_name}",
                {
                    "email": f"test_phone_{int(datetime.now().timestamp())}_{len(invalid_phone)}@example.com",
                    "password": "MotDePasseSecurise123!",
                    "first_name": "Jean",
                    "last_name": "Dupont",
                    "phone": invalid_phone,
                    "user_type": "client",
                    "country": "senegal",
                    "preferred_language": "fr",
                    "payment_accounts": {"orange_money": "+221701234567"}
                },
                expected_status=422,
                should_not_contain_text="Internal Server Error"
            )
        
        # Test 6: Messages d'erreur en français
        self.test_scenario(
            "Vérification messages français",
            {
                "email": f"test_french_{int(datetime.now().timestamp())}@example.com",
                "password": "MotDePasseSecurise123!",
                "first_name": "J",  # Trop court
                "last_name": "Dupont",
                "phone": "+221701234567",
                "user_type": "client",
                "country": "senegal",
                "preferred_language": "fr",
                "payment_accounts": {"orange_money": "+221701234567"}
            },
            expected_status=422,
            should_contain_text="prénom doit contenir au moins 2 caractères",
            should_not_contain_text="string_too_short"  # Pas de message technique anglais
        )
        
        # Résumé
        print("\n" + "=" * 60)
        print("📊 RÉSUMÉ COMPLET DES TESTS")
        print(f"Tests exécutés: {self.tests_run}")
        print(f"Tests réussis: {self.tests_passed}")
        print(f"Tests échoués: {self.tests_run - self.tests_passed}")
        
        if self.failed_tests:
            print("\n❌ TESTS ÉCHOUÉS:")
            for i, failure in enumerate(self.failed_tests, 1):
                print(f"   {i}. {failure}")
        
        success_rate = (self.tests_passed / self.tests_run) * 100 if self.tests_run > 0 else 0
        print(f"\n🎯 Taux de réussite: {success_rate:.1f}%")
        
        if success_rate >= 90:
            print("✅ CORRECTION COMPLÈTEMENT VALIDÉE")
            print("🎉 L'erreur 'Unexpected token I, Internal S...' est DÉFINITIVEMENT éliminée!")
            return True
        else:
            print("❌ CORRECTION INCOMPLÈTE")
            return False

if __name__ == "__main__":
    tester = ComprehensiveValidationTester()
    success = tester.run_all_tests()
    
    if success:
        print("\n🏆 SUCCÈS TOTAL: Toutes les corrections de validation fonctionnent parfaitement!")
        sys.exit(0)
    else:
        print("\n💥 ÉCHEC: Des corrections supplémentaires sont nécessaires")
        sys.exit(1)