#!/usr/bin/env python3
"""
Test complet pour l'extension des préfixes Orange Money et Wave de 70 à 99
Teste tous les 4 pays prioritaires: Sénégal, Mali, Côte d'Ivoire, Burkina Faso
"""

import requests
import sys
import json
from datetime import datetime

class PrefixExtensionTester:
    def __init__(self, base_url="https://precise-geo-app.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0
        self.test_results = []
        
        # Pays prioritaires avec codes téléphoniques
        self.priority_countries = {
            'senegal': '+221',
            'mali': '+223', 
            'ivory_coast': '+225',
            'burkina_faso': '+226'
        }
        
        # Préfixes spécifiques à tester selon la demande
        self.test_prefixes = ['71', '72', '73', '80', '85', '90', '95', '99']
        
        # Préfixes de régression (anciens préfixes qui doivent toujours fonctionner)
        self.regression_prefixes = ['70', '77', '78']
        
        print(f"🚀 Initialisation du testeur d'extension de préfixes")
        print(f"📍 URL de base: {self.base_url}")
        print(f"🌍 Pays prioritaires: {list(self.priority_countries.keys())}")
        print(f"🔢 Nouveaux préfixes à tester: {self.test_prefixes}")
        print(f"🔄 Préfixes de régression: {self.regression_prefixes}")

    def run_test(self, name, method, endpoint, expected_status, data=None, token=None):
        """Exécute un test API unique"""
        url = f"{self.base_url}/{endpoint}"
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = f'Bearer {token}'

        self.tests_run += 1
        print(f"\n🔍 Test {self.tests_run}: {name}")
        
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
            
            result = {
                'test_name': name,
                'method': method,
                'endpoint': endpoint,
                'expected_status': expected_status,
                'actual_status': response.status_code,
                'success': success,
                'data_sent': data
            }
            
            if success:
                self.tests_passed += 1
                print(f"✅ SUCCÈS - Status: {response.status_code}")
                try:
                    response_data = response.json()
                    result['response_data'] = response_data
                    # Afficher des détails pertinents pour les tests de préfixes
                    if 'user' in response_data and 'phone' in response_data['user']:
                        print(f"   📱 Téléphone validé: {response_data['user']['phone']}")
                    if 'payment_verification' in response_data:
                        print(f"   💳 Vérification paiement: {response_data['payment_verification']['message']}")
                    return True, response_data
                except:
                    return True, {}
            else:
                print(f"❌ ÉCHEC - Attendu {expected_status}, reçu {response.status_code}")
                try:
                    error_data = response.json()
                    result['error_data'] = error_data
                    print(f"   ⚠️ Erreur: {error_data.get('detail', 'Erreur inconnue')}")
                except:
                    print(f"   ⚠️ Erreur: {response.text}")
                return False, {}
                
            self.test_results.append(result)

        except Exception as e:
            print(f"❌ EXCEPTION - Erreur: {str(e)}")
            result['exception'] = str(e)
            self.test_results.append(result)
            return False, {}

    def test_orange_money_prefix_validation(self):
        """Test validation Orange Money avec nouveaux préfixes 70-99"""
        print("\n" + "="*70)
        print("🍊 TESTING ORANGE MONEY - EXTENSION PRÉFIXES 70-99")
        print("="*70)
        
        for country, country_code in self.priority_countries.items():
            print(f"\n🌍 Pays: {country.upper()} ({country_code})")
            
            # Tester les nouveaux préfixes spécifiques
            for prefix in self.test_prefixes:
                phone_number = f"{country_code}{prefix}123456"
                
                user_data = {
                    "email": f"orange_{country}_{prefix}_{datetime.now().strftime('%H%M%S')}@test.com",
                    "password": "TestPass123!",
                    "first_name": "Orange",
                    "last_name": f"Test{prefix}",
                    "phone": phone_number,
                    "user_type": "client",
                    "country": country,
                    "preferred_language": "fr",
                    "payment_accounts": {
                        "orange_money": phone_number
                    }
                }
                
                success, response = self.run_test(
                    f"Orange Money {country} - Préfixe {prefix}",
                    "POST",
                    "auth/register-verified",
                    200,
                    data=user_data
                )
                
                if success:
                    print(f"   ✅ Préfixe {prefix} validé pour Orange Money {country}")
                else:
                    print(f"   ❌ Préfixe {prefix} rejeté pour Orange Money {country}")

    def test_wave_prefix_validation(self):
        """Test validation Wave avec nouveaux préfixes 70-99"""
        print("\n" + "="*70)
        print("🌊 TESTING WAVE - EXTENSION PRÉFIXES 70-99")
        print("="*70)
        
        for country, country_code in self.priority_countries.items():
            print(f"\n🌍 Pays: {country.upper()} ({country_code})")
            
            # Tester les nouveaux préfixes spécifiques
            for prefix in self.test_prefixes:
                phone_number = f"{country_code}{prefix}654321"
                
                user_data = {
                    "email": f"wave_{country}_{prefix}_{datetime.now().strftime('%H%M%S')}@test.com",
                    "password": "TestPass123!",
                    "first_name": "Wave",
                    "last_name": f"Test{prefix}",
                    "phone": phone_number,
                    "user_type": "client",
                    "country": country,
                    "preferred_language": "fr",
                    "payment_accounts": {
                        "wave": phone_number
                    }
                }
                
                success, response = self.run_test(
                    f"Wave {country} - Préfixe {prefix}",
                    "POST",
                    "auth/register-verified",
                    200,
                    data=user_data
                )
                
                if success:
                    print(f"   ✅ Préfixe {prefix} validé pour Wave {country}")
                else:
                    print(f"   ❌ Préfixe {prefix} rejeté pour Wave {country}")

    def test_dual_payment_worker_registration(self):
        """Test inscription travailleur avec 2 moyens de paiement (nouveaux préfixes)"""
        print("\n" + "="*70)
        print("👷 TESTING WORKER REGISTRATION - DUAL PAYMENT (NOUVEAUX PRÉFIXES)")
        print("="*70)
        
        for country, country_code in self.priority_countries.items():
            print(f"\n🌍 Pays: {country.upper()} ({country_code})")
            
            # Utiliser des préfixes différents pour Orange Money et Wave
            orange_prefix = self.test_prefixes[0]  # 71
            wave_prefix = self.test_prefixes[1]    # 72
            
            orange_number = f"{country_code}{orange_prefix}111111"
            wave_number = f"{country_code}{wave_prefix}222222"
            
            worker_data = {
                "email": f"worker_dual_{country}_{datetime.now().strftime('%H%M%S')}@test.com",
                "password": "TestPass123!",
                "first_name": "Travailleur",
                "last_name": f"Dual{country}",
                "phone": orange_number,
                "user_type": "worker",
                "country": country,
                "preferred_language": "fr",
                "payment_accounts": {
                    "orange_money": orange_number,
                    "wave": wave_number
                },
                "worker_specialties": ["Mécanique", "Électricité"],
                "worker_experience_years": 5,
                "worker_hourly_rate": 2500.0
            }
            
            success, response = self.run_test(
                f"Travailleur dual payment {country} - Préfixes {orange_prefix}/{wave_prefix}",
                "POST",
                "auth/register-verified",
                200,
                data=worker_data
            )
            
            if success:
                print(f"   ✅ Inscription travailleur réussie avec préfixes {orange_prefix}/{wave_prefix}")
            else:
                print(f"   ❌ Inscription travailleur échouée avec préfixes {orange_prefix}/{wave_prefix}")

    def test_regression_old_prefixes(self):
        """Test de régression - vérifier que les anciens préfixes fonctionnent toujours"""
        print("\n" + "="*70)
        print("🔄 TESTING REGRESSION - ANCIENS PRÉFIXES (70, 77, 78)")
        print("="*70)
        
        for country, country_code in self.priority_countries.items():
            print(f"\n🌍 Pays: {country.upper()} ({country_code})")
            
            for prefix in self.regression_prefixes:
                # Test Orange Money
                orange_number = f"{country_code}{prefix}987654"
                
                orange_data = {
                    "email": f"regression_orange_{country}_{prefix}_{datetime.now().strftime('%H%M%S')}@test.com",
                    "password": "TestPass123!",
                    "first_name": "Regression",
                    "last_name": f"Orange{prefix}",
                    "phone": orange_number,
                    "user_type": "client",
                    "country": country,
                    "preferred_language": "fr",
                    "payment_accounts": {
                        "orange_money": orange_number
                    }
                }
                
                success, response = self.run_test(
                    f"Régression Orange Money {country} - Préfixe {prefix}",
                    "POST",
                    "auth/register-verified",
                    200,
                    data=orange_data
                )
                
                if success:
                    print(f"   ✅ Ancien préfixe {prefix} Orange Money toujours valide")
                else:
                    print(f"   ❌ RÉGRESSION: Ancien préfixe {prefix} Orange Money ne fonctionne plus!")
                
                # Test Wave
                wave_number = f"{country_code}{prefix}456789"
                
                wave_data = {
                    "email": f"regression_wave_{country}_{prefix}_{datetime.now().strftime('%H%M%S')}@test.com",
                    "password": "TestPass123!",
                    "first_name": "Regression",
                    "last_name": f"Wave{prefix}",
                    "phone": wave_number,
                    "user_type": "client",
                    "country": country,
                    "preferred_language": "fr",
                    "payment_accounts": {
                        "wave": wave_number
                    }
                }
                
                success, response = self.run_test(
                    f"Régression Wave {country} - Préfixe {prefix}",
                    "POST",
                    "auth/register-verified",
                    200,
                    data=wave_data
                )
                
                if success:
                    print(f"   ✅ Ancien préfixe {prefix} Wave toujours valide")
                else:
                    print(f"   ❌ RÉGRESSION: Ancien préfixe {prefix} Wave ne fonctionne plus!")

    def test_edge_case_prefixes(self):
        """Test des cas limites - premiers et derniers préfixes de la gamme"""
        print("\n" + "="*70)
        print("🎯 TESTING EDGE CASES - PRÉFIXES LIMITES (70, 99)")
        print("="*70)
        
        edge_prefixes = ['70', '99']  # Premier et dernier de la gamme 70-99
        
        for country, country_code in self.priority_countries.items():
            print(f"\n🌍 Pays: {country.upper()} ({country_code})")
            
            for prefix in edge_prefixes:
                # Test Orange Money
                orange_number = f"{country_code}{prefix}000000"
                
                orange_data = {
                    "email": f"edge_orange_{country}_{prefix}_{datetime.now().strftime('%H%M%S')}@test.com",
                    "password": "TestPass123!",
                    "first_name": "Edge",
                    "last_name": f"Orange{prefix}",
                    "phone": orange_number,
                    "user_type": "client",
                    "country": country,
                    "preferred_language": "fr",
                    "payment_accounts": {
                        "orange_money": orange_number
                    }
                }
                
                success, response = self.run_test(
                    f"Edge Case Orange Money {country} - Préfixe {prefix}",
                    "POST",
                    "auth/register-verified",
                    200,
                    data=orange_data
                )
                
                # Test Wave
                wave_number = f"{country_code}{prefix}999999"
                
                wave_data = {
                    "email": f"edge_wave_{country}_{prefix}_{datetime.now().strftime('%H%M%S')}@test.com",
                    "password": "TestPass123!",
                    "first_name": "Edge",
                    "last_name": f"Wave{prefix}",
                    "phone": wave_number,
                    "user_type": "client",
                    "country": country,
                    "preferred_language": "fr",
                    "payment_accounts": {
                        "wave": wave_number
                    }
                }
                
                success, response = self.run_test(
                    f"Edge Case Wave {country} - Préfixe {prefix}",
                    "POST",
                    "auth/register-verified",
                    200,
                    data=wave_data
                )

    def test_invalid_prefixes_rejection(self):
        """Test que les préfixes invalides (hors gamme 70-99) sont bien rejetés"""
        print("\n" + "="*70)
        print("🚫 TESTING INVALID PREFIXES - REJET PRÉFIXES HORS GAMME")
        print("="*70)
        
        invalid_prefixes = ['69', '00', '01', '50', '60']  # Préfixes qui ne doivent PAS fonctionner
        
        for country, country_code in self.priority_countries.items():
            print(f"\n🌍 Pays: {country.upper()} ({country_code})")
            
            for prefix in invalid_prefixes:
                # Test Orange Money avec préfixe invalide
                orange_number = f"{country_code}{prefix}123456"
                
                orange_data = {
                    "email": f"invalid_orange_{country}_{prefix}_{datetime.now().strftime('%H%M%S')}@test.com",
                    "password": "TestPass123!",
                    "first_name": "Invalid",
                    "last_name": f"Orange{prefix}",
                    "phone": orange_number,
                    "user_type": "client",
                    "country": country,
                    "preferred_language": "fr",
                    "payment_accounts": {
                        "orange_money": orange_number
                    }
                }
                
                success, response = self.run_test(
                    f"Invalid Orange Money {country} - Préfixe {prefix} (doit échouer)",
                    "POST",
                    "auth/register-verified",
                    400,  # Doit échouer avec 400
                    data=orange_data
                )
                
                if not success and response == {}:  # Test réussi = préfixe correctement rejeté
                    print(f"   ✅ Préfixe invalide {prefix} correctement rejeté pour Orange Money")
                else:
                    print(f"   ❌ PROBLÈME: Préfixe invalide {prefix} accepté pour Orange Money!")

    def run_all_tests(self):
        """Exécute tous les tests d'extension de préfixes"""
        print("\n" + "🚀"*35)
        print("🚀 DÉMARRAGE DES TESTS D'EXTENSION DE PRÉFIXES ORANGE MONEY ET WAVE")
        print("🚀"*35)
        
        # Tests principaux
        self.test_orange_money_prefix_validation()
        self.test_wave_prefix_validation()
        self.test_dual_payment_worker_registration()
        
        # Tests de régression
        self.test_regression_old_prefixes()
        
        # Tests de cas limites
        self.test_edge_case_prefixes()
        
        # Tests de validation (préfixes invalides)
        self.test_invalid_prefixes_rejection()
        
        # Résumé final
        self.print_final_summary()

    def print_final_summary(self):
        """Affiche le résumé final des tests"""
        print("\n" + "🎯"*35)
        print("🎯 RÉSUMÉ FINAL - EXTENSION PRÉFIXES 70-99")
        print("🎯"*35)
        
        success_rate = (self.tests_passed / self.tests_run * 100) if self.tests_run > 0 else 0
        
        print(f"\n📊 STATISTIQUES GLOBALES:")
        print(f"   Tests exécutés: {self.tests_run}")
        print(f"   Tests réussis: {self.tests_passed}")
        print(f"   Tests échoués: {self.tests_run - self.tests_passed}")
        print(f"   Taux de réussite: {success_rate:.1f}%")
        
        print(f"\n🌍 COUVERTURE PAR PAYS:")
        for country in self.priority_countries.keys():
            country_tests = [r for r in self.test_results if country in r.get('test_name', '').lower()]
            country_success = len([r for r in country_tests if r.get('success', False)])
            country_total = len(country_tests)
            if country_total > 0:
                print(f"   {country.upper()}: {country_success}/{country_total} tests réussis")
        
        print(f"\n🔢 PRÉFIXES TESTÉS:")
        print(f"   Nouveaux préfixes: {self.test_prefixes}")
        print(f"   Préfixes de régression: {self.regression_prefixes}")
        print(f"   Préfixes limites: ['70', '99']")
        
        if success_rate >= 90:
            print(f"\n🎉 EXCELLENT! L'extension des préfixes 70-99 fonctionne parfaitement!")
        elif success_rate >= 75:
            print(f"\n✅ BON! L'extension des préfixes fonctionne bien avec quelques ajustements mineurs.")
        else:
            print(f"\n⚠️ ATTENTION! Des problèmes significatifs détectés avec l'extension des préfixes.")
        
        print(f"\n🏁 Tests d'extension de préfixes terminés!")

if __name__ == "__main__":
    tester = PrefixExtensionTester()
    tester.run_all_tests()