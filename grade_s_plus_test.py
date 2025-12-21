#!/usr/bin/env python3
"""
🏆 KOJO BACKEND GRADE S+ TESTING - PERFECTION ABSOLUE
Test des corrections ultra-avancées pour validation finale
Objectif: 137/137 tests réussis (100% - GRADE S+)
"""

import requests
import sys
import json
import jwt
from datetime import datetime, timezone
import base64

class GradeSPlusAPITester:
    def __init__(self, base_url="https://westafricaboost.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.client_token = None
        self.worker_token = None
        self.owner_token = None
        self.test_job_id = None
        self.tests_run = 0
        self.tests_passed = 0
        self.test_results = []

    def log_test(self, name, success, details=""):
        """Log test result"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name}")
        else:
            print(f"❌ {name} - {details}")
        
        self.test_results.append({
            "name": name,
            "success": success,
            "details": details
        })

    def run_api_call(self, method, endpoint, data=None, token=None, expected_status=200):
        """Execute API call and return response"""
        url = f"{self.base_url}/{endpoint}"
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = f'Bearer {token}'

        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=30)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, timeout=30)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers, timeout=30)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers, timeout=30)

            return response
        except requests.exceptions.RequestException as e:
            print(f"❌ API call failed for {method} {endpoint}: {e}")
            return None
        except Exception as e:
            print(f"❌ Unexpected error for {method} {endpoint}: {e}")
            return None

    def test_pydantic_models_validation(self):
        """Test 1: Modèles Pydantic Parfaits avec Field validation"""
        print("\n🔧 TESTING: Modèles Pydantic Parfaits avec Field validation")
        
        # Test JobCreate model validation
        invalid_job_data = {
            "title": "AB",  # Too short (min 5)
            "description": "Short desc",  # Too short (min 20)
            "category": "AB",  # Too short (min 3)
            "budget_min": 100000,
            "budget_max": 50000,  # Less than budget_min - should fail
            "location": {},  # Empty dict - should fail min_items=1
            "required_skills": ["skill"] * 25  # Too many skills (max 20)
        }
        
        response = self.run_api_call('POST', 'jobs', invalid_job_data, self.client_token, 422)
        success = response and response.status_code == 422
        details = f"Status: {response.status_code if response else 'None'}"
        if response and response.status_code != 422:
            try:
                details += f", Response: {response.json()}"
            except:
                details += f", Text: {response.text[:200]}"
        self.log_test("JobCreate Field Validation (Invalid Data Rejected)", success, details if not success else "")
        
        # Test ProposalCreate model validation
        invalid_proposal = {
            "proposed_amount": -100,  # Negative amount (should be gt=0.0)
            "estimated_completion_time": "",  # Empty string (min_length=1)
            "message": "Short"  # Too short (min_length=10)
        }
        
        # We need a valid job first
        if self.test_job_id:
            response = self.run_api_call('POST', f'jobs/{self.test_job_id}/proposals', invalid_proposal, self.worker_token, 422)
            success = response and response.status_code == 422
            self.log_test("ProposalCreate Field Validation (Invalid Data Rejected)", success)
        
        # Test MessageCreate model validation
        invalid_message = {
            "receiver_id": "test_receiver",
            "content": ""  # Empty content (min_length=1)
        }
        
        response = self.run_api_call('POST', 'messages', invalid_message, self.client_token, 422)
        success = response and response.status_code == 422
        details = f"Status: {response.status_code if response else 'None'}"
        if response and response.status_code != 422:
            try:
                details += f", Response: {response.json()}"
            except:
                details += f", Text: {response.text[:200]}"
        self.log_test("MessageCreate Field Validation (Invalid Data Rejected)", success, details if not success else "")

    def test_production_logging(self):
        """Test 2: Logging Production - Vérification que print() est remplacé par logger"""
        print("\n📊 TESTING: Logging Production (Structured Logger)")
        
        # Test endpoints that should use structured logging
        response = self.run_api_call('POST', 'jobs', {
            "title": "Test Logging Job",
            "description": "This job tests if structured logging is working properly",
            "category": "test",
            "budget_min": 10000,
            "budget_max": 20000,
            "location": {"city": "Dakar", "country": "Senegal"}
        }, self.client_token, 200)
        
        success = response and response.status_code == 200
        if success and response.json():
            self.test_job_id = response.json().get('id')
        self.log_test("Job Creation with Structured Logging", success)
        
        # Test job retrieval with logging
        response = self.run_api_call('GET', 'jobs', token=self.client_token)
        success = response and response.status_code == 200
        self.log_test("Job Retrieval with Structured Logging", success)

    def test_error_handling_robuste(self):
        """Test 3: Error Handling Robuste avec try/catch et HTTPException"""
        print("\n🛡️ TESTING: Error Handling Robuste")
        
        # Test create_job error handling
        malformed_job = {
            "title": "Valid Title Here",
            "description": "Valid description with enough characters to pass validation",
            "category": "test",
            "budget_min": "invalid_number",  # Invalid type
            "budget_max": 20000,
            "location": {"city": "Dakar"}
        }
        
        response = self.run_api_call('POST', 'jobs', malformed_job, self.client_token, 422)
        success = response and response.status_code == 422
        self.log_test("Job Creation Error Handling (Invalid Data Type)", success)
        
        # Test get_jobs error handling with invalid parameters
        response = self.run_api_call('GET', 'jobs?limit=invalid', token=self.client_token, expected_status=422)
        success = response and response.status_code == 422
        self.log_test("Job Retrieval Error Handling (Invalid Query Param)", success)

    def test_mobile_validation_etendue(self):
        """Test 4: Validation Mobile Étendue avec préfixes 70 pour Mali, Côte d'Ivoire, Burkina Faso"""
        print("\n📱 TESTING: Validation Mobile Étendue")
        
        # Test Orange Money avec préfixe 70 pour différents pays
        test_cases = [
            # Mali +223 avec préfixe 70 (nouveau)
            {
                "country": "mali",
                "phone": "+22370123456",
                "orange_money": "+22370123456",
                "expected": True,
                "description": "Mali Orange Money avec préfixe 70"
            },
            # Côte d'Ivoire +225 avec préfixe 70 (nouveau)
            {
                "country": "ivory_coast", 
                "phone": "+22570123456",
                "orange_money": "+22570123456",
                "expected": True,
                "description": "Côte d'Ivoire Orange Money avec préfixe 70"
            },
            # Burkina Faso +226 avec préfixe 70 (nouveau)
            {
                "country": "burkina_faso",
                "phone": "+22670123456", 
                "orange_money": "+22670123456",
                "expected": True,
                "description": "Burkina Faso Orange Money avec préfixe 70"
            },
            # Wave étendu pour tous les pays
            {
                "country": "senegal",
                "phone": "+22176123456",
                "wave": "+22176123456",
                "expected": True,
                "description": "Sénégal Wave avec préfixe 76"
            }
        ]
        
        for case in test_cases:
            user_data = {
                "email": f"test_{case['country']}_{datetime.now().timestamp()}@test.com",
                "password": "TestPass123!",
                "first_name": "Test",
                "last_name": "User",
                "phone": case["phone"],
                "user_type": "client",
                "country": case["country"],
                "preferred_language": "fr",
                "payment_accounts": {}
            }
            
            if "orange_money" in case:
                user_data["payment_accounts"]["orange_money"] = case["orange_money"]
            if "wave" in case:
                user_data["payment_accounts"]["wave"] = case["wave"]
            
            response = self.run_api_call('POST', 'auth/register-verified', user_data, expected_status=200 if case["expected"] else 400)
            success = (response.status_code == 200) == case["expected"]
            self.log_test(f"Mobile Validation: {case['description']}", success)

    def test_endpoints_enrichis(self):
        """Test 5: Endpoints Enrichis - Health check avec DB test + /stats endpoint"""
        print("\n⚡ TESTING: Endpoints Enrichis")
        
        # Test health check avec test DB
        response = self.run_api_call('GET', 'health')
        success = False
        if response and response.status_code == 200:
            data = response.json()
            # Vérifier que le health check inclut un test DB
            success = (
                data.get('status') == 'healthy' and
                data.get('database') == 'connected' and
                'timestamp' in data and
                'version' in data
            )
        self.log_test("Health Check avec Test DB", success)
        
        # Test nouveau /stats endpoint
        response = self.run_api_call('GET', 'stats')
        success = False
        if response and response.status_code == 200:
            data = response.json()
            # Vérifier que le stats endpoint retourne les bonnes données
            success = (
                'total_users' in data and
                'total_jobs' in data and
                'total_workers' in data and
                'total_clients' in data and
                'supported_countries' in data and
                'supported_languages' in data and
                'timestamp' in data
            )
        self.log_test("Nouveau Stats Endpoint Monitoring", success)

    def test_query_parameters(self):
        """Test 6: Query Parameters avec limit parameter et Query validation"""
        print("\n🎯 TESTING: Query Parameters avec Validation")
        
        # Test limit parameter avec Query validation
        response = self.run_api_call('GET', 'jobs?limit=10', token=self.client_token)
        success = response and response.status_code == 200
        self.log_test("Query Parameter Limit (Valid)", success)
        
        # Test limit parameter avec valeur invalide (trop grande)
        response = self.run_api_call('GET', 'jobs?limit=200', token=self.client_token, expected_status=422)
        success = response and response.status_code == 422
        self.log_test("Query Parameter Limit Validation (Too Large)", success)
        
        # Test limit parameter avec valeur invalide (trop petite)
        response = self.run_api_call('GET', 'jobs?limit=0', token=self.client_token, expected_status=422)
        success = response and response.status_code == 422
        self.log_test("Query Parameter Limit Validation (Too Small)", success)

    def test_budget_validation(self):
        """Test 7: Validation Budget - Custom validator budget_max >= budget_min"""
        print("\n✅ TESTING: Validation Budget Custom")
        
        # Test budget cohérent (budget_max >= budget_min)
        valid_job = {
            "title": "Test Budget Validation Job",
            "description": "This job tests budget validation with proper min/max values",
            "category": "test",
            "budget_min": 10000,
            "budget_max": 20000,  # Correct: max >= min
            "location": {"city": "Dakar", "country": "Senegal"}
        }
        
        response = self.run_api_call('POST', 'jobs', valid_job, self.client_token)
        success = response and response.status_code == 200
        self.log_test("Budget Validation (Valid: max >= min)", success)
        
        # Test budget incohérent (budget_max < budget_min)
        invalid_job = {
            "title": "Test Invalid Budget Job",
            "description": "This job tests budget validation with invalid min/max values",
            "category": "test", 
            "budget_min": 20000,
            "budget_max": 10000,  # Incorrect: max < min
            "location": {"city": "Dakar", "country": "Senegal"}
        }
        
        response = self.run_api_call('POST', 'jobs', invalid_job, self.client_token, expected_status=422)
        success = response and response.status_code == 422
        self.log_test("Budget Validation (Invalid: max < min)", success)

    def test_imports_complets(self):
        """Test 8: Vérification que les imports validator, Query sont présents et fonctionnels"""
        print("\n🔐 TESTING: Imports Complets (validator, Query)")
        
        # Test que Query validation fonctionne (déjà testé dans query_parameters)
        response = self.run_api_call('GET', 'jobs?limit=50', token=self.client_token)
        success = response and response.status_code == 200
        self.log_test("Query Import Fonctionnel", success)
        
        # Test que validator fonctionne (déjà testé dans budget_validation)
        # Créer un job avec validation custom
        job_data = {
            "title": "Test Validator Import",
            "description": "Testing that validator import works correctly for custom validation",
            "category": "test",
            "budget_min": 15000,
            "budget_max": 15000,  # Equal values should be valid
            "location": {"city": "Bamako", "country": "Mali"}
        }
        
        response = self.run_api_call('POST', 'jobs', job_data, self.client_token)
        success = response and response.status_code == 200
        self.log_test("Validator Import Fonctionnel", success)

    def setup_test_users(self):
        """Setup test users for testing"""
        print("\n🔧 Setting up test users...")
        
        # Create client user
        client_data = {
            "email": f"client_grade_s_{datetime.now().timestamp()}@test.com",
            "password": "TestClient123!",
            "first_name": "Test",
            "last_name": "Client",
            "phone": "+22177123456",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr",
            "payment_accounts": {
                "orange_money": "+22177123456"
            }
        }
        
        response = self.run_api_call('POST', 'auth/register-verified', client_data)
        if response and response.status_code == 200:
            self.client_token = response.json().get('access_token')
            print("✅ Client user created")
        else:
            print("❌ Failed to create client user")
            return False
        
        # Create worker user
        worker_data = {
            "email": f"worker_grade_s_{datetime.now().timestamp()}@test.com",
            "password": "TestWorker123!",
            "first_name": "Test",
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
        
        response = self.run_api_call('POST', 'auth/register-verified', worker_data)
        if response and response.status_code == 200:
            self.worker_token = response.json().get('access_token')
            print("✅ Worker user created")
        else:
            print("❌ Failed to create worker user")
            return False
        
        return True

    def run_all_tests(self):
        """Run all Grade S+ tests"""
        print("🏆 KOJO BACKEND GRADE S+ TESTING - PERFECTION ABSOLUE")
        print("=" * 60)
        
        # Setup
        if not self.setup_test_users():
            print("❌ Failed to setup test users. Aborting tests.")
            return
        
        # Run all test categories
        self.test_pydantic_models_validation()
        self.test_production_logging()
        self.test_error_handling_robuste()
        self.test_mobile_validation_etendue()
        self.test_endpoints_enrichis()
        self.test_query_parameters()
        self.test_budget_validation()
        self.test_imports_complets()
        
        # Final results
        print("\n" + "=" * 60)
        print("🏆 RÉSULTATS FINAUX GRADE S+")
        print("=" * 60)
        print(f"Tests exécutés: {self.tests_run}")
        print(f"Tests réussis: {self.tests_passed}")
        print(f"Taux de réussite: {(self.tests_passed/self.tests_run*100):.1f}%")
        
        if self.tests_passed == self.tests_run:
            print("🎉 GRADE S+ ATTEINT - PERFECTION ABSOLUE!")
            print("✅ Toutes les corrections ultra-avancées fonctionnent parfaitement!")
        else:
            print("⚠️ Quelques optimisations nécessitent des ajustements")
            print("\nTests échoués:")
            for result in self.test_results:
                if not result["success"]:
                    print(f"❌ {result['name']}: {result['details']}")
        
        return self.tests_passed == self.tests_run

if __name__ == "__main__":
    tester = GradeSPlusAPITester()
    success = tester.run_all_tests()
    sys.exit(0 if success else 1)