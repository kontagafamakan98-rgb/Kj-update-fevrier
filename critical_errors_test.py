#!/usr/bin/env python3
"""
TEST FINAL - VÉRIFICATION DES CORRECTIONS D'ERREURS CRITIQUES
Focused testing for critical error corrections as requested in French review.
"""

import requests
import json
import time
import sys
from datetime import datetime

class CriticalErrorsTester:
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
            print(f"✅ {test_name}: PASSED")
        else:
            print(f"❌ {test_name}: FAILED - {details}")
            self.critical_failures.append(f"{test_name}: {details}")
        if details:
            print(f"   Details: {details}")
    
    def test_validation_error_correction(self):
        """1. VÉRIFICATION CORRECTION VALIDATIONERROR - Test /api/auth/register with invalid data"""
        print("\n🔍 1. TESTING VALIDATIONERROR CORRECTION")
        print("=" * 60)
        
        # Test cases for ValidationError correction
        test_cases = [
            {
                "name": "Empty first_name",
                "data": {
                    "email": "test@example.com",
                    "password": "password123",
                    "first_name": "",
                    "last_name": "Test",
                    "phone": "+221701234567",
                    "user_type": "client",
                    "country": "senegal",
                    "preferred_language": "fr"
                },
                "expected_status": 422,
                "expected_error_pattern": "prénom"
            },
            {
                "name": "Short first_name (1 char)",
                "data": {
                    "email": "test2@example.com",
                    "password": "password123",
                    "first_name": "a",
                    "last_name": "Test",
                    "phone": "+221701234567",
                    "user_type": "client",
                    "country": "senegal",
                    "preferred_language": "fr"
                },
                "expected_status": 422,
                "expected_error_pattern": "prénom"
            },
            {
                "name": "Short last_name (1 char)",
                "data": {
                    "email": "test3@example.com",
                    "password": "password123",
                    "first_name": "Test",
                    "last_name": "b",
                    "phone": "+221701234567",
                    "user_type": "client",
                    "country": "senegal",
                    "preferred_language": "fr"
                },
                "expected_status": 422,
                "expected_error_pattern": "nom"
            },
            {
                "name": "Invalid phone format (no +)",
                "data": {
                    "email": "test4@example.com",
                    "password": "password123",
                    "first_name": "Test",
                    "last_name": "User",
                    "phone": "221701234567",
                    "user_type": "client",
                    "country": "senegal",
                    "preferred_language": "fr"
                },
                "expected_status": 422,
                "expected_error_pattern": "téléphone"
            },
            {
                "name": "Phone too short",
                "data": {
                    "email": "test5@example.com",
                    "password": "password123",
                    "first_name": "Test",
                    "last_name": "User",
                    "phone": "+221123",
                    "user_type": "client",
                    "country": "senegal",
                    "preferred_language": "fr"
                },
                "expected_status": 422,
                "expected_error_pattern": "téléphone"
            }
        ]
        
        validation_tests_passed = 0
        for test_case in test_cases:
            try:
                start_time = time.time()
                response = requests.post(
                    f"{self.base_url}/auth/register",
                    json=test_case["data"],
                    headers={'Content-Type': 'application/json'}
                )
                response_time = time.time() - start_time
                
                # Check if returns 422 instead of 500
                status_correct = response.status_code == test_case["expected_status"]
                
                # Check if response is JSON (not HTML)
                is_json = False
                french_error = False
                try:
                    response_data = response.json()
                    is_json = True
                    # Check for French error messages
                    response_text = json.dumps(response_data).lower()
                    french_error = test_case["expected_error_pattern"] in response_text
                except:
                    response_data = response.text
                
                # Performance check (<2s)
                performance_ok = response_time < 2.0
                
                all_checks_passed = status_correct and is_json and french_error and performance_ok
                
                if all_checks_passed:
                    validation_tests_passed += 1
                    self.log_result(
                        f"ValidationError - {test_case['name']}", 
                        True, 
                        f"Status: {response.status_code}, JSON: {is_json}, French: {french_error}, Time: {response_time:.2f}s"
                    )
                else:
                    self.log_result(
                        f"ValidationError - {test_case['name']}", 
                        False, 
                        f"Status: {response.status_code} (expected {test_case['expected_status']}), JSON: {is_json}, French: {french_error}, Time: {response_time:.2f}s"
                    )
                    
            except Exception as e:
                self.log_result(f"ValidationError - {test_case['name']}", False, f"Exception: {str(e)}")
        
        print(f"\n📊 ValidationError Tests: {validation_tests_passed}/{len(test_cases)} passed")
        return validation_tests_passed == len(test_cases)
    
    def test_email_security_correction(self):
        """2. VÉRIFICATION SÉCURITÉ EMAIL - Test dangerous email characters and SQL patterns"""
        print("\n🔍 2. TESTING EMAIL SECURITY CORRECTION")
        print("=" * 60)
        
        # Test cases for email security
        dangerous_emails = [
            {
                "name": "SQL Injection Pattern 1",
                "email": "admin'/**/OR/**/1=1#@test.com",
                "expected_status": 400
            },
            {
                "name": "SQL Injection Pattern 2", 
                "email": "test@SELECT.com",
                "expected_status": 400
            },
            {
                "name": "SQL Injection Pattern 3",
                "email": "user@OR.com",
                "expected_status": 400
            },
            {
                "name": "Dangerous Characters - Asterisk",
                "email": "test*@example.com",
                "expected_status": 400
            },
            {
                "name": "Dangerous Characters - Slash",
                "email": "test/@example.com",
                "expected_status": 400
            },
            {
                "name": "Dangerous Characters - Hash",
                "email": "test#@example.com",
                "expected_status": 400
            },
            {
                "name": "SQL Keywords - INSERT",
                "email": "INSERT@test.com",
                "expected_status": 400
            },
            {
                "name": "SQL Keywords - UPDATE",
                "email": "UPDATE@test.com",
                "expected_status": 400
            }
        ]
        
        security_tests_passed = 0
        for test_case in dangerous_emails:
            try:
                start_time = time.time()
                test_data = {
                    "email": test_case["email"],
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
                response_time = time.time() - start_time
                
                # Should reject with 400 error
                status_correct = response.status_code == test_case["expected_status"]
                performance_ok = response_time < 2.0
                
                if status_correct and performance_ok:
                    security_tests_passed += 1
                    self.log_result(
                        f"Email Security - {test_case['name']}", 
                        True, 
                        f"Correctly rejected with status {response.status_code}, Time: {response_time:.2f}s"
                    )
                else:
                    self.log_result(
                        f"Email Security - {test_case['name']}", 
                        False, 
                        f"Status: {response.status_code} (expected {test_case['expected_status']}), Time: {response_time:.2f}s"
                    )
                    
            except Exception as e:
                self.log_result(f"Email Security - {test_case['name']}", False, f"Exception: {str(e)}")
        
        print(f"\n📊 Email Security Tests: {security_tests_passed}/{len(dangerous_emails)} passed")
        return security_tests_passed == len(dangerous_emails)
    
    def test_regression_normal_functionality(self):
        """3. TEST DE RÉGRESSION - Verify normal registrations and other endpoints still work"""
        print("\n🔍 3. TESTING REGRESSION - NORMAL FUNCTIONALITY")
        print("=" * 60)
        
        regression_tests_passed = 0
        total_regression_tests = 0
        
        # Test 1: Normal registration should still work
        total_regression_tests += 1
        try:
            start_time = time.time()
            normal_registration_data = {
                "email": f"normal_user_{int(datetime.now().timestamp())}@example.com",
                "password": "SecurePassword123!",
                "first_name": "Jean",
                "last_name": "Dupont",
                "phone": "+221701234567",
                "user_type": "client",
                "country": "senegal",
                "preferred_language": "fr"
            }
            
            response = requests.post(
                f"{self.base_url}/auth/register",
                json=normal_registration_data,
                headers={'Content-Type': 'application/json'}
            )
            response_time = time.time() - start_time
            
            if response.status_code == 200 and response_time < 2.0:
                regression_tests_passed += 1
                self.log_result("Normal Registration", True, f"Status: {response.status_code}, Time: {response_time:.2f}s")
                
                # Extract token for further tests
                try:
                    response_data = response.json()
                    self.test_token = response_data.get('access_token')
                except:
                    self.test_token = None
            else:
                self.log_result("Normal Registration", False, f"Status: {response.status_code}, Time: {response_time:.2f}s")
                
        except Exception as e:
            self.log_result("Normal Registration", False, f"Exception: {str(e)}")
        
        # Test 2: Health endpoint
        total_regression_tests += 1
        try:
            start_time = time.time()
            response = requests.get(f"{self.base_url}/health")
            response_time = time.time() - start_time
            
            if response.status_code == 200 and response_time < 2.0:
                regression_tests_passed += 1
                self.log_result("Health Endpoint", True, f"Status: {response.status_code}, Time: {response_time:.2f}s")
            else:
                self.log_result("Health Endpoint", False, f"Status: {response.status_code}, Time: {response_time:.2f}s")
                
        except Exception as e:
            self.log_result("Health Endpoint", False, f"Exception: {str(e)}")
        
        # Test 3: Stats endpoint
        total_regression_tests += 1
        try:
            start_time = time.time()
            response = requests.get(f"{self.base_url}/stats")
            response_time = time.time() - start_time
            
            if response.status_code == 200 and response_time < 2.0:
                regression_tests_passed += 1
                self.log_result("Stats Endpoint", True, f"Status: {response.status_code}, Time: {response_time:.2f}s")
            else:
                self.log_result("Stats Endpoint", False, f"Status: {response.status_code}, Time: {response_time:.2f}s")
                
        except Exception as e:
            self.log_result("Stats Endpoint", False, f"Exception: {str(e)}")
        
        # Test 4: Login functionality (if we have a token from registration)
        if hasattr(self, 'test_token') and self.test_token:
            total_regression_tests += 1
            try:
                start_time = time.time()
                response = requests.get(
                    f"{self.base_url}/users/profile",
                    headers={'Authorization': f'Bearer {self.test_token}'}
                )
                response_time = time.time() - start_time
                
                if response.status_code == 200 and response_time < 2.0:
                    regression_tests_passed += 1
                    self.log_result("Profile Access", True, f"Status: {response.status_code}, Time: {response_time:.2f}s")
                else:
                    self.log_result("Profile Access", False, f"Status: {response.status_code}, Time: {response_time:.2f}s")
                    
            except Exception as e:
                self.log_result("Profile Access", False, f"Exception: {str(e)}")
        
        print(f"\n📊 Regression Tests: {regression_tests_passed}/{total_regression_tests} passed")
        return regression_tests_passed == total_regression_tests
    
    def test_global_validation(self):
        """4. VALIDATION GLOBALE - Performance and error logging validation"""
        print("\n🔍 4. TESTING GLOBAL VALIDATION")
        print("=" * 60)
        
        global_tests_passed = 0
        total_global_tests = 0
        
        # Test multiple endpoints for performance (<2s requirement)
        endpoints_to_test = [
            ("GET", "", "Root endpoint"),
            ("GET", "health", "Health check"),
            ("GET", "stats", "Statistics"),
        ]
        
        for method, endpoint, name in endpoints_to_test:
            total_global_tests += 1
            try:
                start_time = time.time()
                if method == "GET":
                    response = requests.get(f"{self.base_url}/{endpoint}")
                response_time = time.time() - start_time
                
                # Performance requirement: <2s
                performance_ok = response_time < 2.0
                status_ok = response.status_code in [200, 201]
                
                if performance_ok and status_ok:
                    global_tests_passed += 1
                    self.log_result(f"Performance - {name}", True, f"Time: {response_time:.2f}s, Status: {response.status_code}")
                else:
                    self.log_result(f"Performance - {name}", False, f"Time: {response_time:.2f}s, Status: {response.status_code}")
                    
            except Exception as e:
                self.log_result(f"Performance - {name}", False, f"Exception: {str(e)}")
        
        print(f"\n📊 Global Validation Tests: {global_tests_passed}/{total_global_tests} passed")
        return global_tests_passed == total_global_tests
    
    def run_all_critical_tests(self):
        """Run all critical error correction tests"""
        print("🚨 DÉMARRAGE DES TESTS CRITIQUES - VÉRIFICATION DES CORRECTIONS")
        print("=" * 80)
        print(f"Backend URL: {self.base_url}")
        print(f"Test Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("=" * 80)
        
        # Run all test categories
        validation_passed = self.test_validation_error_correction()
        security_passed = self.test_email_security_correction()
        regression_passed = self.test_regression_normal_functionality()
        global_passed = self.test_global_validation()
        
        # Final summary
        print("\n" + "=" * 80)
        print("🏆 RÉSULTATS FINAUX - CORRECTIONS D'ERREURS CRITIQUES")
        print("=" * 80)
        
        categories = [
            ("ValidationError Correction", validation_passed),
            ("Email Security Correction", security_passed),
            ("Regression Tests", regression_passed),
            ("Global Validation", global_passed)
        ]
        
        all_passed = True
        for category, passed in categories:
            status = "✅ RÉUSSI" if passed else "❌ ÉCHEC"
            print(f"{category}: {status}")
            if not passed:
                all_passed = False
        
        print(f"\nTests Total: {self.tests_run}")
        print(f"Tests Réussis: {self.tests_passed}")
        print(f"Taux de Réussite: {(self.tests_passed/self.tests_run*100):.1f}%")
        
        if self.critical_failures:
            print(f"\n🚨 ÉCHECS CRITIQUES ({len(self.critical_failures)}):")
            for failure in self.critical_failures:
                print(f"   - {failure}")
        
        if all_passed:
            print("\n🎉 OBJECTIF ATTEINT: 100% de réussite sur tous les tests critiques!")
            print("✅ Les deux erreurs identifiées sont complètement résolues.")
        else:
            print("\n⚠️ OBJECTIF NON ATTEINT: Des corrections supplémentaires sont nécessaires.")
        
        return all_passed

if __name__ == "__main__":
    tester = CriticalErrorsTester()
    success = tester.run_all_critical_tests()
    sys.exit(0 if success else 1)