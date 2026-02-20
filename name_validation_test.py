#!/usr/bin/env python3
"""
TEST DE VALIDATION CRITIQUE - CORRECTION DES NOMS AVEC CARACTÈRES SPÉCIAUX

Ce script teste spécifiquement la validation des noms avec underscores, points, 
apostrophes et accents comme demandé dans la review française.

OBJECTIF: Atteindre 99%+ de réussite sur les systèmes critiques en résolvant 
le problème de validation des caractères spéciaux dans les noms.
"""

import requests
import sys
import json
from datetime import datetime

class NameValidationTester:
    def __init__(self, base_url="https://kojo-work.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0
        self.failed_tests = []

    def run_test(self, name, method, endpoint, expected_status, data=None, token=None):
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}"
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = f'Bearer {token}'

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        print(f"   URL: {url}")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    response_data = response.json()
                    if isinstance(response_data, dict) and len(str(response_data)) < 500:
                        print(f"   Response: {response_data}")
                    return True, response_data
                except:
                    return True, {}
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                try:
                    error_data = response.json()
                    print(f"   Error: {error_data}")
                    self.failed_tests.append({
                        'name': name,
                        'expected': expected_status,
                        'actual': response.status_code,
                        'error': error_data,
                        'data': data
                    })
                except:
                    print(f"   Error: {response.text}")
                    self.failed_tests.append({
                        'name': name,
                        'expected': expected_status,
                        'actual': response.status_code,
                        'error': response.text,
                        'data': data
                    })
                return False, {}

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            self.failed_tests.append({
                'name': name,
                'expected': expected_status,
                'actual': 'Exception',
                'error': str(e),
                'data': data
            })
            return False, {}

    def test_noms_avec_underscores(self):
        """TEST DES NOMS AVEC UNDERSCORES"""
        print("\n" + "="*60)
        print("🔍 TEST DES NOMS AVEC UNDERSCORES")
        print("="*60)
        
        # Test cases avec underscores comme demandé
        underscore_test_cases = [
            {
                "first_name": "Burkina_Test",
                "last_name": "Cote_d_Ivoire",
                "country": "burkina_faso",
                "phone": "+226701234567"
            },
            {
                "first_name": "Mali_User", 
                "last_name": "Senegal_Test",
                "country": "mali",
                "phone": "+223701234567"
            },
            {
                "first_name": "Amadou_Traoré",
                "last_name": "Mali_Bamako",
                "country": "mali", 
                "phone": "+223701234568"
            },
            {
                "first_name": "Fatou_Diop",
                "last_name": "Senegal_Dakar",
                "country": "senegal",
                "phone": "+221701234567"
            },
            {
                "first_name": "Ibrahim_Ouédraogo",
                "last_name": "Burkina_Ouaga",
                "country": "burkina_faso",
                "phone": "+226701234568"
            },
            {
                "first_name": "Akissi_Kouamé",
                "last_name": "Cote_Abidjan",
                "country": "ivory_coast",
                "phone": "+225701234567"
            }
        ]
        
        for i, test_case in enumerate(underscore_test_cases):
            user_data = {
                "email": f"underscore_test_{i}_{datetime.now().strftime('%H%M%S')}@test.com",
                "password": "TestPass123!",
                "first_name": test_case["first_name"],
                "last_name": test_case["last_name"],
                "phone": test_case["phone"],
                "user_type": "client",
                "country": test_case["country"],
                "preferred_language": "fr",
                "payment_accounts": {
                    "orange_money": test_case["phone"]
                }
            }
            
            success, response = self.run_test(
                f"Inscription avec underscores: {test_case['first_name']} {test_case['last_name']}",
                "POST",
                "auth/register-verified",
                200,
                data=user_data
            )
            
            if success:
                print(f"   ✅ Nom avec underscores accepté: {test_case['first_name']} {test_case['last_name']}")
            else:
                print(f"   ❌ Nom avec underscores rejeté: {test_case['first_name']} {test_case['last_name']}")

    def test_noms_avec_points(self):
        """TEST DES NOMS AVEC POINTS"""
        print("\n" + "="*60)
        print("🔍 TEST DES NOMS AVEC POINTS")
        print("="*60)
        
        # Test cases avec points comme demandé
        point_test_cases = [
            {
                "first_name": "Jean.Marie",
                "last_name": "N.Diaye",
                "country": "senegal",
                "phone": "+221701234569"
            },
            {
                "first_name": "Marie.Claire",
                "last_name": "A.Traore",
                "country": "mali",
                "phone": "+223701234569"
            },
            {
                "first_name": "Pierre.Paul",
                "last_name": "B.Ouedraogo",
                "country": "burkina_faso",
                "phone": "+226701234569"
            },
            {
                "first_name": "Anne.Sophie",
                "last_name": "C.Kouame",
                "country": "ivory_coast",
                "phone": "+225701234569"
            }
        ]
        
        for i, test_case in enumerate(point_test_cases):
            user_data = {
                "email": f"point_test_{i}_{datetime.now().strftime('%H%M%S')}@test.com",
                "password": "TestPass123!",
                "first_name": test_case["first_name"],
                "last_name": test_case["last_name"],
                "phone": test_case["phone"],
                "user_type": "client",
                "country": test_case["country"],
                "preferred_language": "fr",
                "payment_accounts": {
                    "orange_money": test_case["phone"]
                }
            }
            
            success, response = self.run_test(
                f"Inscription avec points: {test_case['first_name']} {test_case['last_name']}",
                "POST",
                "auth/register-verified",
                200,
                data=user_data
            )
            
            if success:
                print(f"   ✅ Nom avec points accepté: {test_case['first_name']} {test_case['last_name']}")
            else:
                print(f"   ❌ Nom avec points rejeté: {test_case['first_name']} {test_case['last_name']}")

    def test_noms_multi_pays_realistes(self):
        """TEST DES NOMS MULTI-PAYS AVEC NOMS RÉALISTES"""
        print("\n" + "="*60)
        print("🔍 TEST DES NOMS MULTI-PAYS RÉALISTES")
        print("="*60)
        
        # Noms réalistes pour chaque pays comme demandé
        multi_country_test_cases = [
            {
                "first_name": "Amadou_Traoré",
                "last_name": "Mali_Bamako",
                "country": "mali",
                "phone": "+223701234570",
                "description": "Mali: Amadou_Traoré"
            },
            {
                "first_name": "Fatou_Diop",
                "last_name": "Senegal_Dakar", 
                "country": "senegal",
                "phone": "+221701234570",
                "description": "Sénégal: Fatou_Diop"
            },
            {
                "first_name": "Ibrahim_Ouédraogo",
                "last_name": "Burkina_Ouaga",
                "country": "burkina_faso",
                "phone": "+226701234570",
                "description": "Burkina Faso: Ibrahim_Ouédraogo"
            },
            {
                "first_name": "Akissi_Kouamé",
                "last_name": "Cote_Abidjan",
                "country": "ivory_coast",
                "phone": "+225701234570",
                "description": "Côte d'Ivoire: Akissi_Kouamé"
            },
            # Noms avec combinaisons underscores + accents
            {
                "first_name": "Mariama_Bâ",
                "last_name": "Sénégal_Thiès",
                "country": "senegal",
                "phone": "+221701234571",
                "description": "Sénégal: Mariama_Bâ (underscores + accents)"
            },
            {
                "first_name": "Moussa_Traoré",
                "last_name": "Mali_Ségou",
                "country": "mali",
                "phone": "+223701234571",
                "description": "Mali: Moussa_Traoré (underscores + accents)"
            }
        ]
        
        for i, test_case in enumerate(multi_country_test_cases):
            user_data = {
                "email": f"multi_country_{i}_{datetime.now().strftime('%H%M%S')}@test.com",
                "password": "TestPass123!",
                "first_name": test_case["first_name"],
                "last_name": test_case["last_name"],
                "phone": test_case["phone"],
                "user_type": "client",
                "country": test_case["country"],
                "preferred_language": "fr",
                "payment_accounts": {
                    "orange_money": test_case["phone"]
                }
            }
            
            success, response = self.run_test(
                f"Inscription multi-pays: {test_case['description']}",
                "POST",
                "auth/register-verified",
                200,
                data=user_data
            )
            
            if success:
                print(f"   ✅ {test_case['description']} - Inscription réussie")
            else:
                print(f"   ❌ {test_case['description']} - Inscription échouée")

    def test_regression_noms_normaux(self):
        """TEST DE RÉGRESSION - VÉRIFIER QUE LES NOMS NORMAUX FONCTIONNENT TOUJOURS"""
        print("\n" + "="*60)
        print("🔍 TEST DE RÉGRESSION - NOMS NORMAUX")
        print("="*60)
        
        # Test de régression pour s'assurer que les noms normaux fonctionnent toujours
        normal_test_cases = [
            {
                "first_name": "Amadou",
                "last_name": "Traore",
                "country": "mali",
                "phone": "+223701234572",
                "description": "Nom normal sans caractères spéciaux"
            },
            {
                "first_name": "François",
                "last_name": "Dupont",
                "country": "senegal",
                "phone": "+221701234572",
                "description": "Nom avec accent français: François"
            },
            {
                "first_name": "José",
                "last_name": "Martinez",
                "country": "ivory_coast",
                "phone": "+225701234572",
                "description": "Nom avec accent: José"
            },
            {
                "first_name": "O'Connor",
                "last_name": "Smith",
                "country": "burkina_faso",
                "phone": "+226701234572",
                "description": "Nom avec apostrophe: O'Connor"
            },
            {
                "first_name": "D'Almeida",
                "last_name": "Santos",
                "country": "senegal",
                "phone": "+221701234573",
                "description": "Nom avec apostrophe: D'Almeida"
            },
            {
                "first_name": "Jean-Pierre",
                "last_name": "Martin",
                "country": "mali",
                "phone": "+223701234573",
                "description": "Nom avec tiret: Jean-Pierre"
            },
            {
                "first_name": "Marie-Claire",
                "last_name": "Dubois",
                "country": "ivory_coast",
                "phone": "+225701234573",
                "description": "Nom avec tiret: Marie-Claire"
            }
        ]
        
        for i, test_case in enumerate(normal_test_cases):
            user_data = {
                "email": f"regression_{i}_{datetime.now().strftime('%H%M%S')}@test.com",
                "password": "TestPass123!",
                "first_name": test_case["first_name"],
                "last_name": test_case["last_name"],
                "phone": test_case["phone"],
                "user_type": "client",
                "country": test_case["country"],
                "preferred_language": "fr",
                "payment_accounts": {
                    "orange_money": test_case["phone"]
                }
            }
            
            success, response = self.run_test(
                f"Régression: {test_case['description']}",
                "POST",
                "auth/register-verified",
                200,
                data=user_data
            )
            
            if success:
                print(f"   ✅ {test_case['description']} - Fonctionne toujours")
            else:
                print(f"   ❌ {test_case['description']} - Régression détectée!")

    def test_noms_avec_chiffres(self):
        """TEST DES NOMS AVEC CHIFFRES (SUPPORTÉS PAR LE PATTERN)"""
        print("\n" + "="*60)
        print("🔍 TEST DES NOMS AVEC CHIFFRES")
        print("="*60)
        
        # Le pattern backend supporte les chiffres: r'^[a-zA-ZÀ-ÿ\s\-\'0-9_\.]+$'
        number_test_cases = [
            {
                "first_name": "Jean2",
                "last_name": "Dupont3",
                "country": "senegal",
                "phone": "+221701234574",
                "description": "Noms avec chiffres: Jean2 Dupont3"
            },
            {
                "first_name": "Marie_2024",
                "last_name": "Test_123",
                "country": "mali",
                "phone": "+223701234574",
                "description": "Noms avec underscores et chiffres: Marie_2024 Test_123"
            }
        ]
        
        for i, test_case in enumerate(number_test_cases):
            user_data = {
                "email": f"numbers_{i}_{datetime.now().strftime('%H%M%S')}@test.com",
                "password": "TestPass123!",
                "first_name": test_case["first_name"],
                "last_name": test_case["last_name"],
                "phone": test_case["phone"],
                "user_type": "client",
                "country": test_case["country"],
                "preferred_language": "fr",
                "payment_accounts": {
                    "orange_money": test_case["phone"]
                }
            }
            
            success, response = self.run_test(
                f"Noms avec chiffres: {test_case['description']}",
                "POST",
                "auth/register-verified",
                200,
                data=user_data
            )
            
            if success:
                print(f"   ✅ {test_case['description']} - Accepté")
            else:
                print(f"   ❌ {test_case['description']} - Rejeté")

    def test_validation_finale_systemes_paiement(self):
        """VALIDATION FINALE - CONFIRMER QUE LES SYSTÈMES DE PAIEMENT FONCTIONNENT"""
        print("\n" + "="*60)
        print("🔍 VALIDATION FINALE - SYSTÈMES DE PAIEMENT")
        print("="*60)
        
        # Créer un utilisateur avec nom à caractères spéciaux et tester le système de paiement complet
        final_test_user = {
            "email": f"final_validation_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "TestPass123!",
            "first_name": "Mariama_Bâ",
            "last_name": "Sénégal_Thiès",
            "phone": "+221701234575",
            "user_type": "worker",  # Worker pour tester 2+ payment methods
            "country": "senegal",
            "preferred_language": "fr",
            "payment_accounts": {
                "orange_money": "+221701234575",
                "wave": "+221701234575"
            }
        }
        
        success, response = self.run_test(
            "Validation finale: Inscription worker avec noms spéciaux + 2 moyens paiement",
            "POST",
            "auth/register-verified",
            200,
            data=final_test_user
        )
        
        if success and 'access_token' in response:
            token = response['access_token']
            print(f"   ✅ Inscription réussie avec noms à caractères spéciaux")
            
            # Tester l'accès aux comptes de paiement
            success_payment, payment_response = self.run_test(
                "Validation finale: Accès aux comptes de paiement",
                "GET",
                "users/payment-accounts",
                200,
                token=token
            )
            
            if success_payment:
                print(f"   ✅ Système de paiement fonctionne correctement")
                if payment_response and 'is_verified' in payment_response:
                    if payment_response['is_verified']:
                        print(f"   ✅ Utilisateur vérifié avec {payment_response.get('payment_accounts_count', 0)} moyens de paiement")
                    else:
                        print(f"   ❌ Utilisateur non vérifié malgré 2 moyens de paiement")
            else:
                print(f"   ❌ Système de paiement ne fonctionne pas correctement")
        else:
            print(f"   ❌ Inscription échouée - les systèmes de paiement ne peuvent pas être testés")

    def run_all_tests(self):
        """Exécuter tous les tests de validation des noms"""
        print("🚀 DÉMARRAGE DES TESTS DE VALIDATION DES NOMS AVEC CARACTÈRES SPÉCIAUX")
        print("="*80)
        
        # Exécuter tous les tests
        self.test_noms_avec_underscores()
        self.test_noms_avec_points()
        self.test_noms_multi_pays_realistes()
        self.test_regression_noms_normaux()
        self.test_noms_avec_chiffres()
        self.test_validation_finale_systemes_paiement()
        
        # Résultats finaux
        print("\n" + "="*80)
        print("📊 RÉSULTATS FINAUX DES TESTS DE VALIDATION DES NOMS")
        print("="*80)
        
        success_rate = (self.tests_passed / self.tests_run * 100) if self.tests_run > 0 else 0
        
        print(f"✅ Tests réussis: {self.tests_passed}")
        print(f"❌ Tests échoués: {self.tests_run - self.tests_passed}")
        print(f"📈 Total des tests: {self.tests_run}")
        print(f"🎯 Taux de réussite: {success_rate:.1f}%")
        
        if success_rate >= 99:
            print(f"🎉 OBJECTIF ATTEINT! Taux de réussite de {success_rate:.1f}% >= 99%")
            print("✅ Validation des caractères spéciaux dans les noms RÉSOLUE")
        elif success_rate >= 95:
            print(f"⚠️  Presque atteint: {success_rate:.1f}% (objectif: 99%+)")
            print("🔧 Quelques ajustements mineurs nécessaires")
        else:
            print(f"❌ OBJECTIF NON ATTEINT: {success_rate:.1f}% < 99%")
            print("🚨 Problèmes critiques de validation détectés")
        
        # Afficher les tests échoués pour diagnostic
        if self.failed_tests:
            print(f"\n🔍 ANALYSE DES ÉCHECS ({len(self.failed_tests)} tests échoués):")
            for i, failed_test in enumerate(self.failed_tests[:5]):  # Afficher max 5 échecs
                print(f"   {i+1}. {failed_test['name']}")
                print(f"      Attendu: {failed_test['expected']}, Reçu: {failed_test['actual']}")
                if isinstance(failed_test['error'], dict) and 'detail' in failed_test['error']:
                    print(f"      Erreur: {failed_test['error']['detail']}")
                else:
                    print(f"      Erreur: {failed_test['error']}")
                print()
        
        return success_rate >= 99

if __name__ == "__main__":
    print("🇫🇷 TEST DE VALIDATION CRITIQUE - CORRECTION DES NOMS AVEC CARACTÈRES SPÉCIAUX")
    print("🎯 OBJECTIF: Atteindre 99%+ de réussite sur les systèmes critiques")
    print()
    
    tester = NameValidationTester()
    success = tester.run_all_tests()
    
    if success:
        print("\n🎉 MISSION ACCOMPLIE! Les noms avec caractères spéciaux sont maintenant supportés.")
        sys.exit(0)
    else:
        print("\n❌ MISSION INCOMPLÈTE. Des problèmes de validation persistent.")
        sys.exit(1)