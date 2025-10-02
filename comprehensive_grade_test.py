#!/usr/bin/env python3
"""
🏆 COMPREHENSIVE GRADE S+ TESTING - PERFECTION ABSOLUE
Test complet des corrections ultra-avancées avec authentification
"""

import requests
import json
from datetime import datetime

class ComprehensiveGradeTester:
    def __init__(self):
        self.base_url = "https://kojo-profile.preview.emergentagent.com/api"
        self.client_token = None
        self.worker_token = None
        self.tests_passed = 0
        self.tests_total = 0

    def log_test(self, name, success, details=""):
        self.tests_total += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name}")
        else:
            print(f"❌ {name} - {details}")

    def setup_users(self):
        """Create test users with payment verification"""
        print("🔧 Setting up authenticated test users...")
        
        # Create client user
        client_data = {
            "email": f"grade_client_{int(datetime.now().timestamp())}@test.com",
            "password": "TestClient123!",
            "first_name": "Grade",
            "last_name": "Client",
            "phone": "+22177123456",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr",
            "payment_accounts": {
                "orange_money": "+22177123456"
            }
        }
        
        try:
            response = requests.post(f"{self.base_url}/auth/register-verified", 
                                   json=client_data, timeout=10)
            if response.status_code == 200:
                self.client_token = response.json().get('access_token')
                print("✅ Client user created and authenticated")
            else:
                print(f"❌ Client creation failed: {response.status_code}")
                return False
        except Exception as e:
            print(f"❌ Client creation error: {e}")
            return False
        
        # Create worker user
        worker_data = {
            "email": f"grade_worker_{int(datetime.now().timestamp())}@test.com",
            "password": "TestWorker123!",
            "first_name": "Grade",
            "last_name": "Worker",
            "phone": "+22178123456",
            "user_type": "worker",
            "country": "senegal",
            "preferred_language": "fr",
            "payment_accounts": {
                "orange_money": "+22178123456",
                "wave": "+22176123456"
            }
        }
        
        try:
            response = requests.post(f"{self.base_url}/auth/register-verified", 
                                   json=worker_data, timeout=10)
            if response.status_code == 200:
                self.worker_token = response.json().get('access_token')
                print("✅ Worker user created and authenticated")
            else:
                print(f"❌ Worker creation failed: {response.status_code}")
                return False
        except Exception as e:
            print(f"❌ Worker creation error: {e}")
            return False
        
        return True

    def test_endpoints_enrichis(self):
        """Test enriched endpoints"""
        print("\n⚡ TESTING: Endpoints Enrichis")
        
        # Test health check with DB
        try:
            response = requests.get(f"{self.base_url}/health", timeout=10)
            success = (response.status_code == 200 and 
                      response.json().get('database') == 'connected')
            self.log_test("Health Check avec Test DB", success)
        except Exception as e:
            self.log_test("Health Check avec Test DB", False, str(e))
        
        # Test stats endpoint
        try:
            response = requests.get(f"{self.base_url}/stats", timeout=10)
            success = (response.status_code == 200 and 
                      'total_users' in response.json())
            self.log_test("Stats Endpoint Monitoring", success)
        except Exception as e:
            self.log_test("Stats Endpoint Monitoring", False, str(e))

    def test_query_parameters(self):
        """Test query parameter validation"""
        print("\n🎯 TESTING: Query Parameters avec Validation")
        
        headers = {'Authorization': f'Bearer {self.client_token}'}
        
        # Test valid limit
        try:
            response = requests.get(f"{self.base_url}/jobs?limit=10", 
                                  headers=headers, timeout=10)
            success = response.status_code == 200
            self.log_test("Query Parameter Limit (Valid)", success)
        except Exception as e:
            self.log_test("Query Parameter Limit (Valid)", False, str(e))
        
        # Test invalid limit (too large)
        try:
            response = requests.get(f"{self.base_url}/jobs?limit=200", 
                                  headers=headers, timeout=10)
            success = response.status_code == 422
            self.log_test("Query Parameter Limit Validation (Too Large)", success)
        except Exception as e:
            self.log_test("Query Parameter Limit Validation (Too Large)", False, str(e))

    def test_pydantic_validation(self):
        """Test Pydantic model validation"""
        print("\n🔧 TESTING: Modèles Pydantic avec Field Validation")
        
        headers = {'Authorization': f'Bearer {self.client_token}'}
        
        # Test invalid job data
        invalid_job = {
            "title": "AB",  # Too short (min 5)
            "description": "Short desc",  # Too short (min 20)
            "category": "AB",  # Too short (min 3)
            "budget_min": 100000,
            "budget_max": 50000,  # Less than budget_min
            "location": {},  # Empty dict
            "required_skills": ["skill"] * 25  # Too many skills
        }
        
        try:
            response = requests.post(f"{self.base_url}/jobs", 
                                   json=invalid_job, headers=headers, timeout=10)
            success = response.status_code == 422
            self.log_test("JobCreate Field Validation (Invalid Data Rejected)", success)
        except Exception as e:
            self.log_test("JobCreate Field Validation (Invalid Data Rejected)", False, str(e))

    def test_budget_validation(self):
        """Test budget validation"""
        print("\n✅ TESTING: Validation Budget Custom")
        
        headers = {'Authorization': f'Bearer {self.client_token}'}
        
        # Test valid budget
        valid_job = {
            "title": "Test Budget Validation Job",
            "description": "This job tests budget validation with proper min/max values",
            "category": "test",
            "budget_min": 10000,
            "budget_max": 20000,
            "location": {"city": "Dakar", "country": "Senegal"}
        }
        
        try:
            response = requests.post(f"{self.base_url}/jobs", 
                                   json=valid_job, headers=headers, timeout=10)
            success = response.status_code == 200
            self.log_test("Budget Validation (Valid: max >= min)", success)
        except Exception as e:
            self.log_test("Budget Validation (Valid: max >= min)", False, str(e))
        
        # Test invalid budget
        invalid_job = {
            "title": "Test Invalid Budget Job",
            "description": "This job tests budget validation with invalid min/max values",
            "category": "test",
            "budget_min": 20000,
            "budget_max": 10000,  # max < min
            "location": {"city": "Dakar", "country": "Senegal"}
        }
        
        try:
            response = requests.post(f"{self.base_url}/jobs", 
                                   json=invalid_job, headers=headers, timeout=10)
            success = response.status_code == 422
            self.log_test("Budget Validation (Invalid: max < min)", success)
        except Exception as e:
            self.log_test("Budget Validation (Invalid: max < min)", False, str(e))

    def test_mobile_validation(self):
        """Test mobile validation with new prefixes"""
        print("\n📱 TESTING: Validation Mobile Étendue")
        
        # Test cases for new 70 prefix support
        test_cases = [
            {
                "country": "mali",
                "phone": "+22370123456",
                "orange_money": "+22370123456",
                "description": "Mali Orange Money avec préfixe 70"
            },
            {
                "country": "ivory_coast",
                "phone": "+22570123456", 
                "orange_money": "+22570123456",
                "description": "Côte d'Ivoire Orange Money avec préfixe 70"
            },
            {
                "country": "burkina_faso",
                "phone": "+22670123456",
                "orange_money": "+22670123456",
                "description": "Burkina Faso Orange Money avec préfixe 70"
            }
        ]
        
        for i, case in enumerate(test_cases):
            user_data = {
                "email": f"mobile_test_{i}_{int(datetime.now().timestamp())}@test.com",
                "password": "TestMobile123!",
                "first_name": "Mobile",
                "last_name": "Test",
                "phone": case["phone"],
                "user_type": "client",
                "country": case["country"],
                "preferred_language": "fr",
                "payment_accounts": {
                    "orange_money": case["orange_money"]
                }
            }
            
            try:
                response = requests.post(f"{self.base_url}/auth/register-verified", 
                                       json=user_data, timeout=10)
                success = response.status_code == 200
                self.log_test(f"Mobile Validation: {case['description']}", success)
            except Exception as e:
                self.log_test(f"Mobile Validation: {case['description']}", False, str(e))

    def test_error_handling(self):
        """Test error handling"""
        print("\n🛡️ TESTING: Error Handling Robuste")
        
        headers = {'Authorization': f'Bearer {self.client_token}'}
        
        # Test malformed job data
        malformed_job = {
            "title": "Valid Title Here",
            "description": "Valid description with enough characters to pass validation",
            "category": "test",
            "budget_min": "invalid_number",  # Invalid type
            "budget_max": 20000,
            "location": {"city": "Dakar"}
        }
        
        try:
            response = requests.post(f"{self.base_url}/jobs", 
                                   json=malformed_job, headers=headers, timeout=10)
            success = response.status_code == 422
            self.log_test("Job Creation Error Handling (Invalid Data Type)", success)
        except Exception as e:
            self.log_test("Job Creation Error Handling (Invalid Data Type)", False, str(e))

    def run_all_tests(self):
        """Run all comprehensive tests"""
        print("🏆 COMPREHENSIVE GRADE S+ TESTING - PERFECTION ABSOLUE")
        print("=" * 60)
        
        # Setup
        if not self.setup_users():
            print("❌ Failed to setup test users. Aborting tests.")
            return False
        
        # Run all tests
        self.test_endpoints_enrichis()
        self.test_query_parameters()
        self.test_pydantic_validation()
        self.test_budget_validation()
        self.test_mobile_validation()
        self.test_error_handling()
        
        # Results
        print("\n" + "=" * 60)
        print("🏆 RÉSULTATS FINAUX GRADE S+")
        print("=" * 60)
        print(f"Tests exécutés: {self.tests_total}")
        print(f"Tests réussis: {self.tests_passed}")
        print(f"Taux de réussite: {(self.tests_passed/self.tests_total*100):.1f}%")
        
        if self.tests_passed == self.tests_total:
            print("🎉 GRADE S+ ATTEINT - PERFECTION ABSOLUE!")
            print("✅ Toutes les corrections ultra-avancées fonctionnent parfaitement!")
            return True
        else:
            print("⚠️ Quelques optimisations nécessitent des ajustements")
            return False

if __name__ == "__main__":
    tester = ComprehensiveGradeTester()
    success = tester.run_all_tests()
    print(f"\n🎯 Test Status: {'SUCCESS' if success else 'NEEDS IMPROVEMENT'}")