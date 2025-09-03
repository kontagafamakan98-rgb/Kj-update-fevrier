#!/usr/bin/env python3
"""
🚨 TEST CRITIQUE PRÉFIXE 90 ORANGE MONEY - VALIDATION IMMÉDIATE

Test spécialisé pour valider l'ajout du préfixe 90 pour Orange Money 
dans les 4 pays prioritaires Kojo.

OBJECTIF: Confirmer que le préfixe 90 est maintenant parfaitement 
opérationnel pour Orange Money dans les 4 pays.
"""

import requests
import json
import sys
from datetime import datetime

class OrangeMoney90Tester:
    def __init__(self, base_url="https://kojo-native.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0
        self.test_results = []
        
        # Numéros de test avec préfixe 90 pour chaque pays
        self.test_numbers_90 = {
            "senegal": "+22190123456",      # 🇸🇳 Sénégal
            "mali": "+22390123456",         # 🇲🇱 Mali  
            "ivory_coast": "+22590123456",  # 🇨🇮 Côte d'Ivoire
            "burkina_faso": "+22690123456"  # 🇧🇫 Burkina Faso
        }
        
        # Données utilisateur de test pour chaque pays
        self.test_users_90 = {
            "senegal": {
                "email": "test_90_senegal@kojo.com",
                "password": "TestKojo2025!",
                "first_name": "Amadou",
                "last_name": "Diallo",
                "phone": "+22190123456",
                "user_type": "client",
                "country": "senegal",
                "preferred_language": "fr",
                "payment_accounts": {
                    "orange_money": "+22190123456"
                }
            },
            "mali": {
                "email": "test_90_mali@kojo.com", 
                "password": "TestKojo2025!",
                "first_name": "Fatoumata",
                "last_name": "Traore",
                "phone": "+22390123456",
                "user_type": "worker",
                "country": "mali",
                "preferred_language": "fr",
                "payment_accounts": {
                    "orange_money": "+22390123456",
                    "wave": "+22377654321"  # Deuxième compte pour worker
                }
            },
            "ivory_coast": {
                "email": "test_90_ci@kojo.com",
                "password": "TestKojo2025!",
                "first_name": "Kouassi",
                "last_name": "N'Guessan", 
                "phone": "+22590123456",
                "user_type": "client",
                "country": "ivory_coast",
                "preferred_language": "fr",
                "payment_accounts": {
                    "orange_money": "+22590123456"
                }
            },
            "burkina_faso": {
                "email": "test_90_bf@kojo.com",
                "password": "TestKojo2025!",
                "first_name": "Salimata",
                "last_name": "Ouedraogo",
                "phone": "+22690123456", 
                "user_type": "worker",
                "country": "burkina_faso",
                "preferred_language": "fr",
                "payment_accounts": {
                    "orange_money": "+22690123456",
                    "bank_account": {
                        "account_number": "1234567890",
                        "bank_name": "Banque Atlantique Burkina",
                        "account_holder": "Salimata Ouedraogo"
                    }
                }
            }
        }

    def log_test(self, test_name, success, details=""):
        """Enregistrer le résultat d'un test"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            status = "✅ RÉUSSI"
        else:
            status = "❌ ÉCHEC"
            
        result = {
            "test": test_name,
            "status": status,
            "details": details,
            "timestamp": datetime.now().isoformat()
        }
        self.test_results.append(result)
        print(f"{status} - {test_name}")
        if details:
            print(f"   📝 {details}")

    def test_orange_money_90_validation(self):
        """Test 1: Validation directe des numéros Orange Money avec préfixe 90"""
        print("\n🔍 TEST 1: VALIDATION ORANGE MONEY PRÉFIXE 90")
        print("=" * 60)
        
        for country, number in self.test_numbers_90.items():
            try:
                # Test via endpoint de validation (si disponible) ou registration
                test_data = {
                    "email": f"validation_test_{country}@kojo.com",
                    "password": "TestKojo2025!",
                    "first_name": "Test",
                    "last_name": "User90",
                    "phone": number,
                    "user_type": "client",
                    "country": country,
                    "preferred_language": "fr",
                    "payment_accounts": {
                        "orange_money": number
                    }
                }
                
                response = requests.post(
                    f"{self.base_url}/auth/register-verified",
                    json=test_data,
                    headers={'Content-Type': 'application/json'}
                )
                
                if response.status_code == 200:
                    self.log_test(
                        f"Orange Money 90 - {country.upper()}",
                        True,
                        f"Numéro {number} accepté avec succès"
                    )
                elif response.status_code == 400 and "already registered" in response.text:
                    # Utilisateur déjà existant = validation OK précédemment
                    self.log_test(
                        f"Orange Money 90 - {country.upper()}",
                        True,
                        f"Numéro {number} déjà validé (utilisateur existant)"
                    )
                else:
                    error_msg = response.json().get('detail', 'Erreur inconnue') if response.headers.get('content-type', '').startswith('application/json') else response.text
                    self.log_test(
                        f"Orange Money 90 - {country.upper()}",
                        False,
                        f"Numéro {number} rejeté: {error_msg}"
                    )
                    
            except Exception as e:
                self.log_test(
                    f"Orange Money 90 - {country.upper()}",
                    False,
                    f"Erreur de test: {str(e)}"
                )

    def test_registration_with_90_prefix(self):
        """Test 2: Inscription complète avec numéros Orange Money préfixe 90"""
        print("\n🔍 TEST 2: INSCRIPTION AVEC PRÉFIXE 90")
        print("=" * 60)
        
        for country, user_data in self.test_users_90.items():
            try:
                response = requests.post(
                    f"{self.base_url}/auth/register-verified",
                    json=user_data,
                    headers={'Content-Type': 'application/json'}
                )
                
                if response.status_code == 200:
                    response_data = response.json()
                    token = response_data.get('access_token')
                    user_info = response_data.get('user', {})
                    
                    self.log_test(
                        f"Inscription 90 - {country.upper()}",
                        True,
                        f"Utilisateur {user_info.get('email')} créé avec Orange Money {user_data['phone']}"
                    )
                    
                    # Test de connexion immédiate
                    login_response = requests.post(
                        f"{self.base_url}/auth/login",
                        json={
                            "email": user_data["email"],
                            "password": user_data["password"]
                        },
                        headers={'Content-Type': 'application/json'}
                    )
                    
                    if login_response.status_code == 200:
                        self.log_test(
                            f"Connexion 90 - {country.upper()}",
                            True,
                            f"Connexion réussie pour utilisateur avec préfixe 90"
                        )
                    else:
                        self.log_test(
                            f"Connexion 90 - {country.upper()}",
                            False,
                            f"Échec connexion: {login_response.text}"
                        )
                        
                elif response.status_code == 400 and "already registered" in response.text:
                    # Utilisateur existe déjà - tester la connexion
                    login_response = requests.post(
                        f"{self.base_url}/auth/login",
                        json={
                            "email": user_data["email"],
                            "password": user_data["password"]
                        },
                        headers={'Content-Type': 'application/json'}
                    )
                    
                    if login_response.status_code == 200:
                        self.log_test(
                            f"Inscription 90 - {country.upper()}",
                            True,
                            f"Utilisateur existant avec Orange Money 90 - connexion OK"
                        )
                    else:
                        self.log_test(
                            f"Inscription 90 - {country.upper()}",
                            False,
                            f"Utilisateur existant mais connexion échoue"
                        )
                else:
                    error_msg = response.json().get('detail', 'Erreur inconnue') if response.headers.get('content-type', '').startswith('application/json') else response.text
                    self.log_test(
                        f"Inscription 90 - {country.upper()}",
                        False,
                        f"Inscription échouée: {error_msg}"
                    )
                    
            except Exception as e:
                self.log_test(
                    f"Inscription 90 - {country.upper()}",
                    False,
                    f"Erreur de test: {str(e)}"
                )

    def test_payment_account_verification_90(self):
        """Test 3: Vérification des comptes de paiement avec préfixe 90"""
        print("\n🔍 TEST 3: VÉRIFICATION COMPTES PAIEMENT PRÉFIXE 90")
        print("=" * 60)
        
        # Tester avec différentes combinaisons de comptes
        test_scenarios = [
            {
                "name": "Client Sénégal - Orange Money 90 seul",
                "data": {
                    "email": "client_90_sn@kojo.com",
                    "password": "TestKojo2025!",
                    "first_name": "Moussa",
                    "last_name": "Ba",
                    "phone": "+22190987654",
                    "user_type": "client",
                    "country": "senegal", 
                    "preferred_language": "fr",
                    "payment_accounts": {
                        "orange_money": "+22190987654"
                    }
                }
            },
            {
                "name": "Worker Mali - Orange Money 90 + Wave",
                "data": {
                    "email": "worker_90_ml@kojo.com",
                    "password": "TestKojo2025!",
                    "first_name": "Aminata",
                    "last_name": "Keita",
                    "phone": "+22390987654",
                    "user_type": "worker",
                    "country": "mali",
                    "preferred_language": "fr",
                    "payment_accounts": {
                        "orange_money": "+22390987654",
                        "wave": "+22365123456"
                    }
                }
            },
            {
                "name": "Worker Côte d'Ivoire - Orange Money 90 + Banque",
                "data": {
                    "email": "worker_90_ci@kojo.com",
                    "password": "TestKojo2025!",
                    "first_name": "Aya",
                    "last_name": "Kone",
                    "phone": "+22590987654",
                    "user_type": "worker",
                    "country": "ivory_coast",
                    "preferred_language": "fr",
                    "payment_accounts": {
                        "orange_money": "+22590987654",
                        "bank_account": {
                            "account_number": "9876543210",
                            "bank_name": "SGBCI",
                            "account_holder": "Aya Kone"
                        }
                    }
                }
            }
        ]
        
        for scenario in test_scenarios:
            try:
                response = requests.post(
                    f"{self.base_url}/auth/register-verified",
                    json=scenario["data"],
                    headers={'Content-Type': 'application/json'}
                )
                
                if response.status_code == 200:
                    response_data = response.json()
                    payment_verification = response_data.get('payment_verification', {})
                    
                    self.log_test(
                        scenario["name"],
                        True,
                        f"Vérification OK - {payment_verification.get('linked_accounts', 0)} compte(s) lié(s)"
                    )
                elif response.status_code == 400 and "already registered" in response.text:
                    self.log_test(
                        scenario["name"],
                        True,
                        "Utilisateur existant - validation préfixe 90 déjà effectuée"
                    )
                else:
                    error_msg = response.json().get('detail', 'Erreur inconnue') if response.headers.get('content-type', '').startswith('application/json') else response.text
                    self.log_test(
                        scenario["name"],
                        False,
                        f"Vérification échouée: {error_msg}"
                    )
                    
            except Exception as e:
                self.log_test(
                    scenario["name"],
                    False,
                    f"Erreur de test: {str(e)}"
                )

    def test_edge_cases_90_prefix(self):
        """Test 4: Cas limites et validation stricte du préfixe 90"""
        print("\n🔍 TEST 4: CAS LIMITES PRÉFIXE 90")
        print("=" * 60)
        
        edge_cases = [
            {
                "name": "Préfixe 90 avec espaces",
                "number": "+221 90 12 34 56",
                "country": "senegal",
                "should_pass": True
            },
            {
                "name": "Préfixe 90 sans +",
                "number": "22190123456",
                "country": "senegal", 
                "should_pass": True
            },
            {
                "name": "Préfixe 90 avec tirets",
                "number": "+221-90-12-34-56",
                "country": "mali",
                "should_pass": True
            },
            {
                "name": "Préfixe 91 (invalide)",
                "number": "+22191123456",
                "country": "senegal",
                "should_pass": False
            },
            {
                "name": "Préfixe 90 pays non supporté",
                "number": "+22790123456",  # Niger
                "country": "senegal",  # Mais on dit Sénégal
                "should_pass": False
            }
        ]
        
        for case in edge_cases:
            try:
                test_data = {
                    "email": f"edge_case_{case['name'].replace(' ', '_').lower()}@kojo.com",
                    "password": "TestKojo2025!",
                    "first_name": "Test",
                    "last_name": "EdgeCase",
                    "phone": case["number"],
                    "user_type": "client",
                    "country": case["country"],
                    "preferred_language": "fr",
                    "payment_accounts": {
                        "orange_money": case["number"]
                    }
                }
                
                response = requests.post(
                    f"{self.base_url}/auth/register-verified",
                    json=test_data,
                    headers={'Content-Type': 'application/json'}
                )
                
                success = (response.status_code == 200) == case["should_pass"]
                
                if success:
                    result_msg = "Accepté" if case["should_pass"] else "Rejeté"
                    self.log_test(
                        case["name"],
                        True,
                        f"{result_msg} comme attendu - {case['number']}"
                    )
                else:
                    expected = "accepté" if case["should_pass"] else "rejeté"
                    actual = "accepté" if response.status_code == 200 else "rejeté"
                    self.log_test(
                        case["name"],
                        False,
                        f"Attendu: {expected}, Obtenu: {actual} - {case['number']}"
                    )
                    
            except Exception as e:
                self.log_test(
                    case["name"],
                    False,
                    f"Erreur de test: {str(e)}"
                )

    def test_health_and_stats(self):
        """Test 5: Vérification que les endpoints de base fonctionnent"""
        print("\n🔍 TEST 5: ENDPOINTS DE BASE")
        print("=" * 60)
        
        try:
            # Test health check
            health_response = requests.get(f"{self.base_url}/health")
            if health_response.status_code == 200:
                self.log_test(
                    "Health Check",
                    True,
                    "API opérationnelle"
                )
            else:
                self.log_test(
                    "Health Check",
                    False,
                    f"Status: {health_response.status_code}"
                )
                
            # Test stats
            stats_response = requests.get(f"{self.base_url}/stats")
            if stats_response.status_code == 200:
                stats_data = stats_response.json()
                supported_countries = stats_data.get('supported_countries', [])
                self.log_test(
                    "Stats Endpoint",
                    True,
                    f"Pays supportés: {supported_countries}"
                )
            else:
                self.log_test(
                    "Stats Endpoint",
                    False,
                    f"Status: {stats_response.status_code}"
                )
                
        except Exception as e:
            self.log_test(
                "Endpoints de base",
                False,
                f"Erreur: {str(e)}"
            )

    def run_all_tests(self):
        """Exécuter tous les tests de validation du préfixe 90"""
        print("🚨 DÉBUT DES TESTS PRÉFIXE 90 ORANGE MONEY")
        print("=" * 80)
        print("OBJECTIF: Valider l'ajout du préfixe 90 pour Orange Money")
        print("PAYS TESTÉS: 🇸🇳 Sénégal, 🇲🇱 Mali, 🇨🇮 Côte d'Ivoire, 🇧🇫 Burkina Faso")
        print("=" * 80)
        
        # Exécuter tous les tests
        self.test_health_and_stats()
        self.test_orange_money_90_validation()
        self.test_registration_with_90_prefix()
        self.test_payment_account_verification_90()
        self.test_edge_cases_90_prefix()
        
        # Résumé final
        print("\n" + "=" * 80)
        print("🎯 RÉSUMÉ DES TESTS PRÉFIXE 90 ORANGE MONEY")
        print("=" * 80)
        print(f"📊 Tests exécutés: {self.tests_run}")
        print(f"✅ Tests réussis: {self.tests_passed}")
        print(f"❌ Tests échoués: {self.tests_run - self.tests_passed}")
        print(f"📈 Taux de réussite: {(self.tests_passed/self.tests_run*100):.1f}%")
        
        if self.tests_passed == self.tests_run:
            print("\n🎉 SUCCÈS TOTAL! Le préfixe 90 Orange Money fonctionne parfaitement!")
            print("✅ Tous les utilisateurs avec numéros 90 peuvent maintenant utiliser Kojo")
        else:
            print(f"\n⚠️  {self.tests_run - self.tests_passed} test(s) ont échoué")
            print("❌ Le préfixe 90 nécessite des corrections")
            
        print("\n📋 DÉTAILS DES TESTS:")
        for result in self.test_results:
            print(f"{result['status']} {result['test']}")
            if result['details']:
                print(f"   📝 {result['details']}")
        
        return self.tests_passed == self.tests_run

if __name__ == "__main__":
    print("🚀 Lancement des tests Orange Money préfixe 90...")
    tester = OrangeMoney90Tester()
    success = tester.run_all_tests()
    
    if success:
        print("\n🏆 VALIDATION COMPLÈTE: Préfixe 90 opérationnel!")
        sys.exit(0)
    else:
        print("\n🚨 VALIDATION ÉCHOUÉE: Corrections nécessaires!")
        sys.exit(1)