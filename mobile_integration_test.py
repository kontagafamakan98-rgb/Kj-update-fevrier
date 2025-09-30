#!/usr/bin/env python3
"""
Mobile Integration Tests for Kojo API
Tests specific scenarios that the mobile app will encounter
"""

import requests
import json
from datetime import datetime, timedelta

class MobileIntegrationTester:
    def __init__(self, base_url="https://kojo-service-hub.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.test_results = []
        
    def log_test(self, test_name, success, details=""):
        """Log test results"""
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status} {test_name}")
        if details:
            print(f"    {details}")
        self.test_results.append({
            "test": test_name,
            "success": success,
            "details": details
        })
        
    def test_mobile_auth_flow(self):
        """Test complete mobile authentication flow"""
        print("\n🔐 TESTING MOBILE AUTHENTICATION FLOW")
        print("="*50)
        
        # Test 1: Register new mobile user
        mobile_user_data = {
            "email": f"mobile_user_{datetime.now().strftime('%H%M%S')}@kojo.app",
            "password": "MobilePass123!",
            "first_name": "Aminata",
            "last_name": "Diallo",
            "phone": "+221771234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr"
        }
        
        try:
            response = requests.post(
                f"{self.base_url}/auth/register",
                json=mobile_user_data,
                headers={'Content-Type': 'application/json'}
            )
            
            if response.status_code == 200:
                data = response.json()
                token = data.get('access_token')
                user = data.get('user')
                
                self.log_test(
                    "Mobile User Registration",
                    True,
                    f"User ID: {user['id']}, Token received: {bool(token)}"
                )
                
                # Test 2: Verify token format and structure
                if token:
                    import jwt
                    try:
                        # Decode without verification to check structure
                        decoded = jwt.decode(token, options={"verify_signature": False})
                        has_sub = 'sub' in decoded
                        has_exp = 'exp' in decoded
                        
                        self.log_test(
                            "JWT Token Structure",
                            has_sub and has_exp,
                            f"Has 'sub': {has_sub}, Has 'exp': {has_exp}"
                        )
                    except Exception as e:
                        self.log_test("JWT Token Structure", False, f"Token decode error: {str(e)}")
                
                # Test 3: Use token for authenticated request
                profile_response = requests.get(
                    f"{self.base_url}/users/profile",
                    headers={'Authorization': f'Bearer {token}'}
                )
                
                self.log_test(
                    "Token Authentication",
                    profile_response.status_code == 200,
                    f"Profile fetch status: {profile_response.status_code}"
                )
                
                # Test 4: Login with same credentials
                login_response = requests.post(
                    f"{self.base_url}/auth/login",
                    json={"email": mobile_user_data["email"], "password": mobile_user_data["password"]},
                    headers={'Content-Type': 'application/json'}
                )
                
                self.log_test(
                    "Mobile User Login",
                    login_response.status_code == 200,
                    f"Login status: {login_response.status_code}"
                )
                
                return token, user
                
            else:
                self.log_test("Mobile User Registration", False, f"Status: {response.status_code}")
                return None, None
                
        except Exception as e:
            self.log_test("Mobile User Registration", False, f"Error: {str(e)}")
            return None, None
    
    def test_job_search_scenarios(self, token):
        """Test job search scenarios mobile app will use"""
        print("\n🔍 TESTING JOB SEARCH SCENARIOS")
        print("="*50)
        
        if not token:
            self.log_test("Job Search Tests", False, "No authentication token available")
            return
            
        headers = {'Authorization': f'Bearer {token}'}
        
        # Test 1: Get all jobs
        try:
            response = requests.get(f"{self.base_url}/jobs", headers=headers)
            self.log_test(
                "Get All Jobs",
                response.status_code == 200,
                f"Status: {response.status_code}, Jobs count: {len(response.json()) if response.status_code == 200 else 'N/A'}"
            )
        except Exception as e:
            self.log_test("Get All Jobs", False, f"Error: {str(e)}")
        
        # Test 2: Filter by category
        categories = ["plumbing", "electrical", "cleaning", "construction"]
        for category in categories:
            try:
                response = requests.get(
                    f"{self.base_url}/jobs?category={category}",
                    headers=headers
                )
                self.log_test(
                    f"Filter Jobs by {category.title()}",
                    response.status_code == 200,
                    f"Status: {response.status_code}"
                )
            except Exception as e:
                self.log_test(f"Filter Jobs by {category.title()}", False, f"Error: {str(e)}")
        
        # Test 3: Filter by status
        statuses = ["open", "in_progress", "completed"]
        for status in statuses:
            try:
                response = requests.get(
                    f"{self.base_url}/jobs?status={status}",
                    headers=headers
                )
                self.log_test(
                    f"Filter Jobs by {status.title()} Status",
                    response.status_code == 200,
                    f"Status: {response.status_code}"
                )
            except Exception as e:
                self.log_test(f"Filter Jobs by {status.title()} Status", False, f"Error: {str(e)}")
    
    def test_mobile_job_creation(self, token, user):
        """Test job creation from mobile app"""
        print("\n📝 TESTING MOBILE JOB CREATION")
        print("="*50)
        
        if not token or not user:
            self.log_test("Mobile Job Creation", False, "No authentication token or user available")
            return None
            
        # Only clients can create jobs
        if user.get('user_type') != 'client':
            self.log_test("Mobile Job Creation", False, "User is not a client")
            return None
            
        headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}
        
        # Test realistic mobile job creation
        mobile_job_data = {
            "title": "Réparation de climatisation - Dakar",
            "description": "Ma climatisation ne fonctionne plus. J'ai besoin d'un technicien expérimenté pour la réparer rapidement.",
            "category": "electrical",
            "budget_min": 25000.0,
            "budget_max": 50000.0,
            "location": {
                "address": "Plateau, Dakar, Sénégal",
                "latitude": 14.6928,
                "longitude": -17.4467
            },
            "required_skills": ["climatisation", "électricité", "réparation"],
            "estimated_duration": "2-4 heures"
        }
        
        try:
            response = requests.post(
                f"{self.base_url}/jobs",
                json=mobile_job_data,
                headers=headers
            )
            
            if response.status_code == 200:
                job_data = response.json()
                job_id = job_data.get('id')
                
                self.log_test(
                    "Create Mobile Job",
                    True,
                    f"Job ID: {job_id}, Title: {job_data.get('title', 'N/A')}"
                )
                
                # Test job retrieval
                if job_id:
                    get_response = requests.get(
                        f"{self.base_url}/jobs/{job_id}",
                        headers=headers
                    )
                    
                    self.log_test(
                        "Retrieve Created Job",
                        get_response.status_code == 200,
                        f"Status: {get_response.status_code}"
                    )
                
                return job_id
            else:
                self.log_test("Create Mobile Job", False, f"Status: {response.status_code}, Error: {response.text}")
                return None
                
        except Exception as e:
            self.log_test("Create Mobile Job", False, f"Error: {str(e)}")
            return None
    
    def test_worker_registration_and_profile(self):
        """Test worker registration and profile creation"""
        print("\n👷 TESTING WORKER REGISTRATION & PROFILE")
        print("="*50)
        
        # Register worker
        worker_data = {
            "email": f"worker_mobile_{datetime.now().strftime('%H%M%S')}@kojo.app",
            "password": "WorkerPass123!",
            "first_name": "Mamadou",
            "last_name": "Keita",
            "phone": "+223701234567",
            "user_type": "worker",
            "country": "mali",
            "preferred_language": "fr"
        }
        
        try:
            response = requests.post(
                f"{self.base_url}/auth/register",
                json=worker_data,
                headers={'Content-Type': 'application/json'}
            )
            
            if response.status_code == 200:
                data = response.json()
                worker_token = data.get('access_token')
                worker_user = data.get('user')
                
                self.log_test(
                    "Worker Registration",
                    True,
                    f"Worker ID: {worker_user['id']}"
                )
                
                # Create worker profile
                if worker_token:
                    profile_data = {
                        "user_id": worker_user['id'],
                        "specialties": ["plomberie", "électricité", "climatisation"],
                        "experience_years": 8,
                        "hourly_rate": 12000.0,
                        "availability": True,
                        "description": "Technicien expérimenté en plomberie et électricité à Bamako. Disponible 7j/7."
                    }
                    
                    profile_response = requests.post(
                        f"{self.base_url}/workers/profile",
                        json=profile_data,
                        headers={
                            'Authorization': f'Bearer {worker_token}',
                            'Content-Type': 'application/json'
                        }
                    )
                    
                    self.log_test(
                        "Worker Profile Creation",
                        profile_response.status_code == 200,
                        f"Status: {profile_response.status_code}"
                    )
                    
                    # Get worker profile
                    get_profile_response = requests.get(
                        f"{self.base_url}/workers/profile",
                        headers={'Authorization': f'Bearer {worker_token}'}
                    )
                    
                    self.log_test(
                        "Get Worker Profile",
                        get_profile_response.status_code == 200,
                        f"Status: {get_profile_response.status_code}"
                    )
                
                return worker_token, worker_user
            else:
                self.log_test("Worker Registration", False, f"Status: {response.status_code}")
                return None, None
                
        except Exception as e:
            self.log_test("Worker Registration", False, f"Error: {str(e)}")
            return None, None
    
    def test_api_response_formats(self, token):
        """Test API response formats for mobile compatibility"""
        print("\n📱 TESTING API RESPONSE FORMATS")
        print("="*50)
        
        if not token:
            self.log_test("API Response Format Tests", False, "No authentication token available")
            return
            
        headers = {'Authorization': f'Bearer {token}'}
        
        # Test endpoints and verify JSON responses
        endpoints = [
            ("GET", "users/profile", "User Profile"),
            ("GET", "jobs", "Jobs List"),
            ("GET", "health", "Health Check")
        ]
        
        for method, endpoint, name in endpoints:
            try:
                if method == "GET":
                    response = requests.get(f"{self.base_url}/{endpoint}", headers=headers)
                
                # Check if response is valid JSON
                try:
                    json_data = response.json()
                    is_json = True
                    has_proper_structure = isinstance(json_data, (dict, list))
                except:
                    is_json = False
                    has_proper_structure = False
                
                self.log_test(
                    f"{name} JSON Response",
                    is_json and has_proper_structure and response.status_code == 200,
                    f"Status: {response.status_code}, Valid JSON: {is_json}, Proper Structure: {has_proper_structure}"
                )
                
            except Exception as e:
                self.log_test(f"{name} JSON Response", False, f"Error: {str(e)}")
    
    def test_error_handling(self):
        """Test error handling for mobile app"""
        print("\n⚠️  TESTING ERROR HANDLING")
        print("="*50)
        
        # Test 1: Invalid endpoint
        try:
            response = requests.get(f"{self.base_url}/invalid-endpoint")
            self.log_test(
                "Invalid Endpoint Handling",
                response.status_code == 404,
                f"Status: {response.status_code}"
            )
        except Exception as e:
            self.log_test("Invalid Endpoint Handling", False, f"Error: {str(e)}")
        
        # Test 2: Invalid JSON
        try:
            response = requests.post(
                f"{self.base_url}/auth/login",
                data="invalid json",
                headers={'Content-Type': 'application/json'}
            )
            self.log_test(
                "Invalid JSON Handling",
                response.status_code in [400, 422],
                f"Status: {response.status_code}"
            )
        except Exception as e:
            self.log_test("Invalid JSON Handling", False, f"Error: {str(e)}")
        
        # Test 3: Missing required fields
        try:
            response = requests.post(
                f"{self.base_url}/auth/register",
                json={"email": "test@test.com"},  # Missing required fields
                headers={'Content-Type': 'application/json'}
            )
            self.log_test(
                "Missing Fields Handling",
                response.status_code == 422,
                f"Status: {response.status_code}"
            )
        except Exception as e:
            self.log_test("Missing Fields Handling", False, f"Error: {str(e)}")
    
    def run_all_mobile_tests(self):
        """Run all mobile integration tests"""
        print("🚀 STARTING MOBILE INTEGRATION TESTS")
        print(f"Base URL: {self.base_url}")
        print("="*60)
        
        try:
            # Test authentication flow
            client_token, client_user = self.test_mobile_auth_flow()
            
            # Test job search
            self.test_job_search_scenarios(client_token)
            
            # Test job creation
            job_id = self.test_mobile_job_creation(client_token, client_user)
            
            # Test worker registration
            worker_token, worker_user = self.test_worker_registration_and_profile()
            
            # Test API response formats
            self.test_api_response_formats(client_token)
            
            # Test error handling
            self.test_error_handling()
            
        except Exception as e:
            print(f"\n❌ Test suite failed with error: {str(e)}")
        
        # Print summary
        print("\n" + "="*60)
        print("MOBILE INTEGRATION TEST SUMMARY")
        print("="*60)
        
        total_tests = len(self.test_results)
        passed_tests = sum(1 for result in self.test_results if result['success'])
        
        print(f"📊 Tests passed: {passed_tests}/{total_tests}")
        
        if passed_tests == total_tests:
            print("🎉 All mobile integration tests passed!")
            print("✅ API is ready for mobile app integration")
            return 0
        else:
            print(f"⚠️  {total_tests - passed_tests} tests failed")
            print("❌ Some issues need to be addressed before mobile integration")
            
            # Show failed tests
            failed_tests = [result for result in self.test_results if not result['success']]
            if failed_tests:
                print("\nFailed tests:")
                for test in failed_tests:
                    print(f"  - {test['test']}: {test['details']}")
            
            return 1

def main():
    tester = MobileIntegrationTester()
    return tester.run_all_mobile_tests()

if __name__ == "__main__":
    exit(main())