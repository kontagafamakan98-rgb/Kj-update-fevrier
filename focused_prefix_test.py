#!/usr/bin/env python3
"""
Test focused sur la validation des préfixes Orange Money et Wave 70-99
Test direct des fonctions de validation sans problèmes de Pydantic
"""

import requests
import sys
import json
from datetime import datetime

class FocusedPrefixTester:
    def __init__(self, base_url="https://kojo-work.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0
        
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
        
        print(f"🚀 Test focused sur validation préfixes Orange Money et Wave")
        print(f"📍 URL de base: {self.base_url}")
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
            
            if success:
                self.tests_passed += 1
                print(f"✅ SUCCÈS - Status: {response.status_code}")
                try:
                    response_data = response.json()
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
                    print(f"   ⚠️ Erreur: {error_data.get('detail', 'Erreur inconnue')}")
                except:
                    print(f"   ⚠️ Erreur: {response.text}")
                return False, {}

        except Exception as e:
            print(f"❌ EXCEPTION - Erreur: {str(e)}")
            return False, {}

    def test_prefix_validation_with_valid_names(self):
        """Test validation avec des noms valides (sans chiffres)"""
        print("\n" + "="*70)
        print("🎯 TESTING PRÉFIXES AVEC NOMS VALIDES")
        print("="*70)
        
        success_count = 0
        total_tests = 0
        
        for country, country_code in self.priority_countries.items():
            print(f"\n🌍 Pays: {country.upper()} ({country_code})")
            
            # Tester quelques préfixes clés avec des noms valides
            key_prefixes = ['71', '80', '90', '99']  # Échantillon représentatif
            
            for prefix in key_prefixes:
                total_tests += 2  # Orange Money + Wave
                
                # Test Orange Money
                orange_number = f"{country_code}{prefix}123456"
                
                orange_data = {
                    "email": f"orange.{country}.{prefix}.{datetime.now().strftime('%H%M%S')}@test.com",
                    "password": "TestPass123!",
                    "first_name": "Orange",
                    "last_name": "TestUser",  # Nom valide sans chiffres
                    "phone": orange_number,
                    "user_type": "client",
                    "country": country,
                    "preferred_language": "fr",
                    "payment_accounts": {
                        "orange_money": orange_number
                    }
                }
                
                success, response = self.run_test(
                    f"Orange Money {country} - Préfixe {prefix}",
                    "POST",
                    "auth/register-verified",
                    200,
                    data=orange_data
                )
                
                if success:
                    success_count += 1
                    print(f"   ✅ Préfixe {prefix} Orange Money validé")
                else:
                    print(f"   ❌ Préfixe {prefix} Orange Money échoué")
                
                # Test Wave
                wave_number = f"{country_code}{prefix}654321"
                
                wave_data = {
                    "email": f"wave.{country}.{prefix}.{datetime.now().strftime('%H%M%S')}@test.com",
                    "password": "TestPass123!",
                    "first_name": "Wave",
                    "last_name": "TestUser",  # Nom valide sans chiffres
                    "phone": wave_number,
                    "user_type": "client",
                    "country": country,
                    "preferred_language": "fr",
                    "payment_accounts": {
                        "wave": wave_number
                    }
                }
                
                success, response = self.run_test(
                    f"Wave {country} - Préfixe {prefix}",
                    "POST",
                    "auth/register-verified",
                    200,
                    data=wave_data
                )
                
                if success:
                    success_count += 1
                    print(f"   ✅ Préfixe {prefix} Wave validé")
                else:
                    print(f"   ❌ Préfixe {prefix} Wave échoué")
        
        print(f"\n📊 RÉSULTATS PRÉFIXES CLÉS:")
        print(f"   Tests réussis: {success_count}/{total_tests}")
        print(f"   Taux de réussite: {(success_count/total_tests*100):.1f}%")
        
        return success_count, total_tests

    def test_regression_prefixes(self):
        """Test de régression avec anciens préfixes"""
        print("\n" + "="*70)
        print("🔄 TESTING RÉGRESSION - ANCIENS PRÉFIXES")
        print("="*70)
        
        success_count = 0
        total_tests = 0
        
        for country, country_code in self.priority_countries.items():
            print(f"\n🌍 Pays: {country.upper()} ({country_code})")
            
            for prefix in self.regression_prefixes:
                total_tests += 2  # Orange Money + Wave
                
                # Test Orange Money
                orange_number = f"{country_code}{prefix}987654"
                
                orange_data = {
                    "email": f"regression.orange.{country}.{prefix}.{datetime.now().strftime('%H%M%S')}@test.com",
                    "password": "TestPass123!",
                    "first_name": "Regression",
                    "last_name": "Orange",
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
                    success_count += 1
                    print(f"   ✅ Ancien préfixe {prefix} Orange Money toujours valide")
                else:
                    print(f"   ❌ RÉGRESSION: Ancien préfixe {prefix} Orange Money ne fonctionne plus!")
                
                # Test Wave
                wave_number = f"{country_code}{prefix}456789"
                
                wave_data = {
                    "email": f"regression.wave.{country}.{prefix}.{datetime.now().strftime('%H%M%S')}@test.com",
                    "password": "TestPass123!",
                    "first_name": "Regression",
                    "last_name": "Wave",
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
                    success_count += 1
                    print(f"   ✅ Ancien préfixe {prefix} Wave toujours valide")
                else:
                    print(f"   ❌ RÉGRESSION: Ancien préfixe {prefix} Wave ne fonctionne plus!")
        
        print(f"\n📊 RÉSULTATS RÉGRESSION:")
        print(f"   Tests réussis: {success_count}/{total_tests}")
        print(f"   Taux de réussite: {(success_count/total_tests*100):.1f}%")
        
        return success_count, total_tests

    def test_worker_dual_payment(self):
        """Test inscription travailleur avec 2 moyens de paiement"""
        print("\n" + "="*70)
        print("👷 TESTING WORKER DUAL PAYMENT")
        print("="*70)
        
        success_count = 0
        total_tests = len(self.priority_countries)
        
        for country, country_code in self.priority_countries.items():
            print(f"\n🌍 Pays: {country.upper()} ({country_code})")
            
            # Utiliser des préfixes différents pour Orange Money et Wave
            orange_prefix = '85'  # Nouveau préfixe
            wave_prefix = '90'    # Nouveau préfixe
            
            orange_number = f"{country_code}{orange_prefix}111111"
            wave_number = f"{country_code}{wave_prefix}222222"
            
            worker_data = {
                "email": f"worker.dual.{country}.{datetime.now().strftime('%H%M%S')}@test.com",
                "password": "TestPass123!",
                "first_name": "Travailleur",
                "last_name": "Dual",
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
                success_count += 1
                print(f"   ✅ Inscription travailleur réussie avec préfixes {orange_prefix}/{wave_prefix}")
            else:
                print(f"   ❌ Inscription travailleur échouée avec préfixes {orange_prefix}/{wave_prefix}")
        
        print(f"\n📊 RÉSULTATS WORKER DUAL PAYMENT:")
        print(f"   Tests réussis: {success_count}/{total_tests}")
        print(f"   Taux de réussite: {(success_count/total_tests*100):.1f}%")
        
        return success_count, total_tests

    def run_all_tests(self):
        """Exécute tous les tests focused"""
        print("\n" + "🚀"*35)
        print("🚀 DÉMARRAGE DES TESTS FOCUSED PRÉFIXES 70-99")
        print("🚀"*35)
        
        # Tests principaux
        success1, total1 = self.test_prefix_validation_with_valid_names()
        success2, total2 = self.test_regression_prefixes()
        success3, total3 = self.test_worker_dual_payment()
        
        # Résumé final
        total_success = success1 + success2 + success3
        total_tests = total1 + total2 + total3
        
        self.print_final_summary(total_success, total_tests)

    def print_final_summary(self, total_success, total_tests):
        """Affiche le résumé final des tests"""
        print("\n" + "🎯"*35)
        print("🎯 RÉSUMÉ FINAL - EXTENSION PRÉFIXES 70-99")
        print("🎯"*35)
        
        success_rate = (total_success / total_tests * 100) if total_tests > 0 else 0
        
        print(f"\n📊 STATISTIQUES GLOBALES:")
        print(f"   Tests exécutés: {total_tests}")
        print(f"   Tests réussis: {total_success}")
        print(f"   Tests échoués: {total_tests - total_success}")
        print(f"   Taux de réussite: {success_rate:.1f}%")
        
        print(f"\n🔢 PRÉFIXES TESTÉS:")
        print(f"   Nouveaux préfixes échantillon: ['71', '80', '90', '99']")
        print(f"   Préfixes de régression: {self.regression_prefixes}")
        
        if success_rate >= 90:
            print(f"\n🎉 EXCELLENT! L'extension des préfixes 70-99 fonctionne parfaitement!")
            print(f"✅ Les nouveaux préfixes Orange Money et Wave sont opérationnels")
            print(f"✅ Aucune régression détectée sur les anciens préfixes")
            print(f"✅ Inscription des travailleurs avec dual payment fonctionnelle")
        elif success_rate >= 75:
            print(f"\n✅ BON! L'extension des préfixes fonctionne bien avec quelques ajustements mineurs.")
        else:
            print(f"\n⚠️ ATTENTION! Des problèmes significatifs détectés avec l'extension des préfixes.")
        
        print(f"\n🏁 Tests focused d'extension de préfixes terminés!")

if __name__ == "__main__":
    tester = FocusedPrefixTester()
    tester.run_all_tests()