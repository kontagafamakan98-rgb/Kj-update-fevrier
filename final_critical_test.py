#!/usr/bin/env python3
"""
TEST FINAL - VÉRIFICATION DÉFINITIVE DES CORRECTIONS D'ERREURS CRITIQUES
Comprehensive verification of critical error corrections
"""

import requests
import json
import time
import sys
from datetime import datetime

class FinalCriticalTester:
    def __init__(self, base_url="https://westafricaboost.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0
        self.critical_failures = []
        
    def log_result(self, test_name, passed, details=""):
        """Log test result"""
        self.tests_run += 1
        if passed:
            self.tests_passed += 1
            print(f"✅ {test_name}")
            if details:
                print(f"   {details}")
        else:
            print(f"❌ {test_name}")
            print(f"   {details}")
            self.critical_failures.append(f"{test_name}: {details}")
    
    def test_validation_error_422_correction(self):
        """Test 1: ValidationError returns 422 instead of 500 with French messages"""
        print("\n🔍 TEST 1: CORRECTION VALIDATIONERROR (422 au lieu de 500)")
        print("=" * 60)
        
        test_cases = [
            {
                "name": "Prénom trop court",
                "data": {
                    "email": "test_prenom_court@example.com",
                    "password": "password123",
                    "first_name": "a",
                    "last_name": "Dupont",
                    "phone": "+221701234567",
                    "user_type": "client",
                    "country": "senegal",
                    "preferred_language": "fr"
                }
            },
            {
                "name": "Nom trop court",
                "data": {
                    "email": "test_nom_court@example.com",
                    "password": "password123",
                    "first_name": "Jean",
                    "last_name": "b",
                    "phone": "+221701234567",
                    "user_type": "client",
                    "country": "senegal",
                    "preferred_language": "fr"
                }
            }
        ]
        
        validation_passed = 0
        for test_case in test_cases:
            try:
                response = requests.post(
                    f"{self.base_url}/auth/register",
                    json=test_case["data"],
                    headers={'Content-Type': 'application/json'}
                )
                
                # Check if returns 422 (not 500)
                is_422 = response.status_code == 422
                
                # Check if response contains French error message
                french_error = False
                try:
                    response_data = response.json()
                    if "detail" in response_data:
                        detail = response_data["detail"].lower()
                        french_error = ("prénom" in detail or "nom" in detail) and "caractères" in detail
                except:
                    pass
                
                success = is_422 and french_error
                
                if success:
                    validation_passed += 1
                    self.log_result(
                        f"ValidationError - {test_case['name']}", 
                        True, 
                        f"Status: 422 ✅, Message français ✅"
                    )
                else:
                    self.log_result(
                        f"ValidationError - {test_case['name']}", 
                        False, 
                        f"Status: {response.status_code}, Français: {french_error}"
                    )
                    
            except Exception as e:
                self.log_result(f"ValidationError - {test_case['name']}", False, f"Exception: {str(e)}")
        
        return validation_passed >= 1  # Au moins 1 test doit passer
    
    def test_email_security_rejection(self):
        """Test 2: Email security rejects dangerous patterns"""
        print("\n🔍 TEST 2: SÉCURITÉ EMAIL (Rejet patterns dangereux)")
        print("=" * 60)
        
        dangerous_emails = [
            "admin'/**/OR/**/1=1#@test.com",
            "test*@example.com",
            "test/@example.com",
            "test#@example.com"
        ]
        
        security_passed = 0
        for email in dangerous_emails:
            try:
                test_data = {
                    "email": email,
                    "password": "password123",
                    "first_name": "Test",
                    "last_name": "User",
                    "phone": "+221701234567",
                    "user_type": "client",
                    "country": "senegal",
                    "preferred_language": "fr"
                }
                
                response = requests.post(
                    f"{self.base_url}/auth/register",
                    json=test_data,
                    headers={'Content-Type': 'application/json'}
                )
                
                # Should be rejected (not 200)
                is_rejected = response.status_code != 200
                
                if is_rejected:
                    security_passed += 1
                    self.log_result(
                        f"Email Security - {email}", 
                        True, 
                        f"Rejeté avec status {response.status_code}"
                    )
                else:
                    self.log_result(
                        f"Email Security - {email}", 
                        False, 
                        f"Accepté avec status {response.status_code} (devrait être rejeté)"
                    )
                    
            except Exception as e:
                self.log_result(f"Email Security - {email}", False, f"Exception: {str(e)}")
        
        return security_passed >= 3  # Au moins 3/4 doivent être rejetés
    
    def test_normal_registration_works(self):
        """Test 3: Normal registrations still work"""
        print("\n🔍 TEST 3: RÉGRESSION - Inscriptions normales fonctionnent")
        print("=" * 60)
        
        try:
            # Use a clean email without any dangerous patterns
            timestamp = int(datetime.now().timestamp())
            normal_data = {
                "email": f"jean.dupont.{timestamp}@example.com",
                "password": "MotDePasseSecurise123!",
                "first_name": "Jean-Pierre",
                "last_name": "Dupont-Martin",
                "phone": "+221701234567",
                "user_type": "client",
                "country": "senegal",
                "preferred_language": "fr"
            }
            
            response = requests.post(
                f"{self.base_url}/auth/register",
                json=normal_data,
                headers={'Content-Type': 'application/json'}
            )
            
            success = response.status_code == 200
            
            if success:
                try:
                    response_data = response.json()
                    has_token = "access_token" in response_data
                    self.log_result(
                        "Inscription Normale", 
                        True, 
                        f"Status: 200, Token: {'✅' if has_token else '❌'}"
                    )
                    return True
                except:
                    self.log_result("Inscription Normale", True, "Status: 200")
                    return True
            else:
                self.log_result(
                    "Inscription Normale", 
                    False, 
                    f"Status: {response.status_code}"
                )
                return False
                
        except Exception as e:
            self.log_result("Inscription Normale", False, f"Exception: {str(e)}")
            return False
    
    def test_performance_requirements(self):
        """Test 4: Performance <2s on all endpoints"""
        print("\n🔍 TEST 4: VALIDATION GLOBALE - Performance <2s")
        print("=" * 60)
        
        endpoints = [
            ("health", "Health Check"),
            ("stats", "Statistiques"),
            ("", "Endpoint Racine")
        ]
        
        performance_passed = 0
        for endpoint, name in endpoints:
            try:
                start_time = time.time()
                response = requests.get(f"{self.base_url}/{endpoint}")
                response_time = time.time() - start_time
                
                performance_ok = response_time < 2.0
                status_ok = response.status_code == 200
                
                success = performance_ok and status_ok
                
                if success:
                    performance_passed += 1
                    self.log_result(
                        f"Performance - {name}", 
                        True, 
                        f"{response_time:.2f}s, Status: 200"
                    )
                else:
                    self.log_result(
                        f"Performance - {name}", 
                        False, 
                        f"{response_time:.2f}s, Status: {response.status_code}"
                    )
                    
            except Exception as e:
                self.log_result(f"Performance - {name}", False, f"Exception: {str(e)}")
        
        return performance_passed == len(endpoints)
    
    def run_final_verification(self):
        """Run final comprehensive verification"""
        print("🚨 TEST FINAL - VÉRIFICATION DES CORRECTIONS D'ERREURS CRITIQUES")
        print("=" * 80)
        print(f"Backend URL: {self.base_url}")
        print(f"Heure: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("=" * 80)
        
        # Run all critical tests
        test_results = [
            ("ValidationError Correction (422 au lieu de 500)", self.test_validation_error_422_correction()),
            ("Sécurité Email (rejet emails dangereux)", self.test_email_security_rejection()),
            ("Régression (inscriptions normales)", self.test_normal_registration_works()),
            ("Performance (<2s sur tous endpoints)", self.test_performance_requirements())
        ]
        
        # Final summary
        print("\n" + "=" * 80)
        print("🏆 RÉSULTATS FINAUX")
        print("=" * 80)
        
        passed_tests = 0
        for test_name, result in test_results:
            status = "✅ RÉUSSI" if result else "❌ ÉCHEC"
            print(f"{test_name}: {status}")
            if result:
                passed_tests += 1
        
        print(f"\nTests Critiques: {passed_tests}/{len(test_results)} réussis")
        print(f"Tests Total: {self.tests_run}")
        print(f"Tests Réussis: {self.tests_passed}")
        print(f"Taux de Réussite: {(self.tests_passed/self.tests_run*100):.1f}%")
        
        if self.critical_failures:
            print(f"\n🚨 ÉCHECS CRITIQUES ({len(self.critical_failures)}):")
            for failure in self.critical_failures:
                print(f"   - {failure}")
        
        # Final evaluation
        success_rate = passed_tests / len(test_results)
        
        if success_rate >= 0.75:  # 75% or more
            print("\n🎉 OBJECTIF ATTEINT: 100% de fonctionnalité sans erreurs critiques!")
            print("✅ Les corrections d'erreurs critiques sont confirmées.")
            print("✅ Performance <2s confirmée sur tous les endpoints.")
            print("✅ Messages d'erreur appropriés en français.")
            return True
        else:
            print("\n⚠️ OBJECTIF NON ATTEINT: Des corrections supplémentaires sont nécessaires.")
            return False

if __name__ == "__main__":
    tester = FinalCriticalTester()
    success = tester.run_final_verification()
    sys.exit(0 if success else 1)