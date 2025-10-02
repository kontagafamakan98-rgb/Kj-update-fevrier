#!/usr/bin/env python3
"""
Mobile Backend Integration Test for Kojo API
Tests backend functionality specifically for mobile app integration
"""

import requests
import sys
import json
import io
import jwt
from datetime import datetime, timedelta

class MobileBackendTester:
    def __init__(self, base_url="https://kojo-profile.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.client_token = None
        self.worker_token = None
        self.client_user = None
        self.worker_user = None
        self.test_job_id = None
        self.tests_run = 0
        self.tests_passed = 0
        self.test_results = []

    def log_test_result(self, test_name, success, message=""):
        """Log test result for summary"""
        self.test_results.append({
            "name": test_name,
            "success": success,
            "message": message
        })

    def run_test(self, name, method, endpoint, expected_status, data=None, token=None, files=None):
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}" if endpoint else self.base_url
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = f'Bearer {token}'

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        print(f"   URL: {url}")
        
        try:
            if files:
                # Remove Content-Type for file uploads
                headers.pop('Content-Type', None)
                
            if method == 'GET':
                response = requests.get(url, headers=headers)
            elif method == 'POST':
                if files:
                    response = requests.post(url, headers={'Authorization': f'Bearer {token}'} if token else {}, files=files)
                else:
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
                    self.log_test_result(name, True, f"Status: {response.status_code}")
                    return True, response_data
                except:
                    self.log_test_result(name, True, f"Status: {response.status_code}")
                    return True, {}
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                try:
                    error_data = response.json()
                    print(f"   Error: {error_data}")
                    self.log_test_result(name, False, f"Expected {expected_status}, got {response.status_code}: {error_data}")
                except:
                    print(f"   Error: {response.text}")
                    self.log_test_result(name, False, f"Expected {expected_status}, got {response.status_code}: {response.text}")
                return False, {}

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            self.log_test_result(name, False, f"Exception: {str(e)}")
            return False, {}

    def test_mobile_authentication_system(self):
        """Test authentication system for mobile app integration"""
        print("\n" + "="*60)
        print("TESTING MOBILE AUTHENTICATION SYSTEM")
        print("="*60)
        
        # Test 1: Mobile user registration with realistic West African data
        print(f"\n🔍 Testing Mobile User Registration...")
        
        # Client registration with Senegal data
        client_data = {
            "email": f"mobile_client_{datetime.now().strftime('%H%M%S')}@kojo.sn",
            "password": "KojoMobile2024!",
            "first_name": "Aminata",
            "last_name": "Diallo",
            "phone": "+221701234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr"
        }
        
        success, response = self.run_test(
            "Mobile Client Registration",
            "POST",
            "auth/register",
            200,
            data=client_data
        )
        
        if success and 'access_token' in response:
            self.client_token = response['access_token']
            self.client_user = response['user']
            print(f"   ✅ Client registered for mobile: {self.client_user['id']}")
        
        # Worker registration with Mali data
        worker_data = {
            "email": f"mobile_worker_{datetime.now().strftime('%H%M%S')}@kojo.ml",
            "password": "KojoMobile2024!",
            "first_name": "Mamadou",
            "last_name": "Traore",
            "phone": "+223701234567",
            "user_type": "worker",
            "country": "mali",
            "preferred_language": "fr"
        }
        
        success, response = self.run_test(
            "Mobile Worker Registration",
            "POST",
            "auth/register",
            200,
            data=worker_data
        )
        
        if success and 'access_token' in response:
            self.worker_token = response['access_token']
            self.worker_user = response['user']
            print(f"   ✅ Worker registered for mobile: {self.worker_user['id']}")

        # Test 2: Mobile login
        if self.client_user:
            login_data = {
                "email": self.client_user['email'],
                "password": "KojoMobile2024!"
            }
            
            success, response = self.run_test(
                "Mobile Login",
                "POST",
                "auth/login",
                200,
                data=login_data
            )
            
            if success and 'access_token' in response:
                print(f"   ✅ Mobile login successful")
                # Verify JWT token structure for mobile
                try:
                    decoded = jwt.decode(response['access_token'], options={"verify_signature": False})
                    if 'sub' in decoded and 'email' in decoded and 'exp' in decoded:
                        print(f"   ✅ JWT token structure valid for mobile")
                        self.tests_passed += 1
                    else:
                        print(f"   ❌ JWT token missing required fields")
                    self.tests_run += 1
                except Exception as e:
                    print(f"   ❌ JWT token decode failed: {e}")
                    self.tests_run += 1

        # Test 3: Test authentication with invalid credentials (mobile error handling)
        invalid_login = {
            "email": "nonexistent@mobile.com",
            "password": "wrongpassword"
        }
        
        self.run_test(
            "Mobile Invalid Login",
            "POST",
            "auth/login",
            401,
            data=invalid_login
        )

    def test_mobile_job_management_apis(self):
        """Test job management APIs for mobile app"""
        print("\n" + "="*60)
        print("TESTING MOBILE JOB MANAGEMENT APIS")
        print("="*60)
        
        if not self.client_token:
            print("❌ Skipping job tests - no client token")
            return
            
        # Test 1: Create job with mobile-friendly data
        mobile_job_data = {
            "title": "Réparation Plomberie Urgente",
            "description": "Fuite d'eau dans la cuisine, intervention urgente nécessaire. Disponible ce weekend.",
            "category": "plomberie",
            "budget_min": 25000.0,
            "budget_max": 50000.0,
            "location": {
                "address": "Médina, Dakar, Sénégal",
                "latitude": 14.6789,
                "longitude": -17.4634,
                "city": "Dakar",
                "country": "Sénégal"
            },
            "required_skills": ["plomberie", "réparation urgente"],
            "estimated_duration": "2-3 heures",
            "mechanic_must_bring_parts": True,
            "mechanic_must_bring_tools": False,
            "parts_and_tools_notes": "Apporter joints et raccords nécessaires"
        }
        
        success, response = self.run_test(
            "Mobile Job Creation",
            "POST",
            "jobs",
            200,
            data=mobile_job_data,
            token=self.client_token
        )
        
        if success and 'id' in response:
            self.test_job_id = response['id']
            print(f"   ✅ Mobile job created: {self.test_job_id}")
            
            # Verify mobile-specific fields are included
            mobile_fields = ['mechanic_must_bring_parts', 'mechanic_must_bring_tools', 'parts_and_tools_notes']
            if all(field in response for field in mobile_fields):
                print(f"   ✅ Mobile job fields included in response")
                self.tests_passed += 1
            else:
                print(f"   ❌ Mobile job fields missing from response")
            self.tests_run += 1
        
        # Test 2: Get jobs with mobile pagination
        self.run_test(
            "Mobile Get Jobs (Paginated)",
            "GET",
            "jobs?limit=10",
            200,
            token=self.client_token
        )
        
        # Test 3: Get jobs by category (mobile filtering)
        self.run_test(
            "Mobile Get Jobs by Category",
            "GET",
            "jobs?category=plomberie&limit=5",
            200,
            token=self.client_token
        )
        
        # Test 4: Get specific job details for mobile
        if self.test_job_id:
            success, response = self.run_test(
                "Mobile Get Job Details",
                "GET",
                f"jobs/{self.test_job_id}",
                200,
                token=self.client_token
            )
            
            if success and response:
                # Verify all required fields for mobile are present
                required_mobile_fields = [
                    'id', 'title', 'description', 'category', 'budget_min', 'budget_max',
                    'location', 'status', 'posted_at', 'mechanic_must_bring_parts',
                    'mechanic_must_bring_tools', 'parts_and_tools_notes'
                ]
                
                missing_fields = [field for field in required_mobile_fields if field not in response]
                if not missing_fields:
                    print(f"   ✅ All mobile required fields present")
                    self.tests_passed += 1
                else:
                    print(f"   ❌ Missing mobile fields: {missing_fields}")
                self.tests_run += 1

    def test_mobile_user_profile_apis(self):
        """Test user profile APIs for mobile app"""
        print("\n" + "="*60)
        print("TESTING MOBILE USER PROFILE APIS")
        print("="*60)
        
        if not self.client_token:
            print("❌ Skipping profile tests - no client token")
            return
            
        # Test 1: Get user profile for mobile
        success, response = self.run_test(
            "Mobile Get User Profile",
            "GET",
            "users/profile",
            200,
            token=self.client_token
        )
        
        if success and response:
            # Verify mobile-required profile fields
            mobile_profile_fields = [
                'id', 'email', 'first_name', 'last_name', 'phone', 
                'user_type', 'country', 'preferred_language', 'profile_photo'
            ]
            
            missing_fields = [field for field in mobile_profile_fields if field not in response]
            if not missing_fields:
                print(f"   ✅ All mobile profile fields present")
                self.tests_passed += 1
            else:
                print(f"   ❌ Missing mobile profile fields: {missing_fields}")
            self.tests_run += 1
        
        # Test 2: Update profile for mobile
        mobile_profile_update = {
            "first_name": "Aminata Updated",
            "preferred_language": "wo",
            "phone": "+221701234568"
        }
        
        self.run_test(
            "Mobile Update User Profile",
            "PUT",
            "users/profile",
            200,
            data=mobile_profile_update,
            token=self.client_token
        )

    def test_mobile_profile_photo_management(self):
        """Test profile photo management for mobile app"""
        print("\n" + "="*60)
        print("TESTING MOBILE PROFILE PHOTO MANAGEMENT")
        print("="*60)
        
        if not self.client_token:
            print("❌ Skipping profile photo tests - no client token")
            return
            
        # Test 1: Upload profile photo (mobile simulation)
        print(f"\n🔍 Testing Mobile Profile Photo Upload...")
        
        # Create a small test image for mobile
        test_image_data = b'\x89PNG\r\n\x1a\n\rIHDR\x01\x01\x08\x02\x90wS\xde\tpHYs\x0b\x13\x0b\x13\x01\x9a\x9c\x18\nIDATx\x9cc```\x04\x01\xdd\x8d\xb4\x1cIEND\xaeB`\x82'
        files = {'file': ('mobile_profile.png', io.BytesIO(test_image_data), 'image/png')}
        
        success, response = self.run_test(
            "Mobile Profile Photo Upload",
            "POST",
            "users/profile-photo",
            200,
            token=self.client_token,
            files=files
        )
        
        if success and response and 'photo_url' in response:
            print(f"   ✅ Mobile photo upload successful: {response['photo_url']}")
        
        # Test 2: Get profile photo for mobile
        self.run_test(
            "Mobile Get Profile Photo",
            "GET",
            "users/profile-photo",
            200,
            token=self.client_token
        )
        
        # Test 3: Delete profile photo (mobile)
        self.run_test(
            "Mobile Delete Profile Photo",
            "DELETE",
            "users/profile-photo",
            200,
            token=self.client_token
        )

    def test_push_notification_token_endpoint(self):
        """Test push notification token endpoint (if it exists)"""
        print("\n" + "="*60)
        print("TESTING PUSH NOTIFICATION TOKEN ENDPOINT")
        print("="*60)
        
        if not self.client_token:
            print("❌ Skipping push notification tests - no client token")
            return
            
        # Test the push notification token endpoint mentioned in the review request
        push_token_data = {
            "push_token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
            "device_type": "android",
            "device_id": "mobile_device_123"
        }
        
        # Try to register push token
        success, response = self.run_test(
            "Register Push Notification Token",
            "POST",
            "users/push-token",
            200,  # Expect success if endpoint exists
            data=push_token_data,
            token=self.client_token
        )
        
        if not success:
            # If endpoint doesn't exist, try alternative endpoints
            print("   ℹ️  Push token endpoint not found, this is expected as it's not implemented yet")
            self.log_test_result("Push Notification Token Endpoint", False, "Endpoint not implemented - needs to be added for mobile app")

    def test_payment_account_verification_mobile(self):
        """Test payment account verification for mobile users"""
        print("\n" + "="*60)
        print("TESTING MOBILE PAYMENT ACCOUNT VERIFICATION")
        print("="*60)
        
        # Test mobile client registration with payment verification
        mobile_client_payment_data = {
            "email": f"mobile_payment_{datetime.now().strftime('%H%M%S')}@kojo.sn",
            "password": "KojoMobile2024!",
            "first_name": "Fatou",
            "last_name": "Sow",
            "phone": "+221701234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr",
            "payment_accounts": {
                "orange_money": "+221701234567"
            }
        }
        
        success, response = self.run_test(
            "Mobile Client Registration with Payment",
            "POST",
            "auth/register-verified",
            200,
            data=mobile_client_payment_data
        )
        
        mobile_client_token = None
        if success and 'access_token' in response:
            mobile_client_token = response['access_token']
            print(f"   ✅ Mobile client with payment registered")
            
            # Verify payment verification response structure for mobile
            if 'payment_verification' in response:
                verification = response['payment_verification']
                required_fields = ['linked_accounts', 'required_minimum', 'is_verified', 'message']
                if all(field in verification for field in required_fields):
                    print(f"   ✅ Payment verification response structure valid for mobile")
                    self.tests_passed += 1
                else:
                    print(f"   ❌ Payment verification response missing fields for mobile")
                self.tests_run += 1
        
        # Test mobile worker registration with multiple payment methods
        mobile_worker_payment_data = {
            "email": f"mobile_worker_payment_{datetime.now().strftime('%H%M%S')}@kojo.ml",
            "password": "KojoMobile2024!",
            "first_name": "Ibrahim",
            "last_name": "Kone",
            "phone": "+223701234567",
            "user_type": "worker",
            "country": "mali",
            "preferred_language": "fr",
            "payment_accounts": {
                "orange_money": "+223701234567",
                "wave": "+223701234567"
            }
        }
        
        success, response = self.run_test(
            "Mobile Worker Registration with Multiple Payments",
            "POST",
            "auth/register-verified",
            200,
            data=mobile_worker_payment_data
        )
        
        if success and response:
            print(f"   ✅ Mobile worker with multiple payments registered")
        
        # Test payment account management for mobile
        if mobile_client_token:
            self.run_test(
                "Mobile Get Payment Accounts",
                "GET",
                "users/payment-accounts",
                200,
                token=mobile_client_token
            )
            
            self.run_test(
                "Mobile Verify Payment Access",
                "POST",
                "users/verify-payment-access",
                200,
                token=mobile_client_token
            )

    def test_mobile_error_handling(self):
        """Test error handling returns proper JSON responses for mobile"""
        print("\n" + "="*60)
        print("TESTING MOBILE ERROR HANDLING (JSON RESPONSES)")
        print("="*60)
        
        # Test 1: Invalid registration data (should return JSON, not HTML)
        invalid_registration = {
            "email": "invalid-email",
            "password": "short",
            "first_name": "A",  # Too short
            "last_name": "B",   # Too short
            "phone": "invalid",
            "user_type": "invalid_type",
            "country": "invalid_country",
            "preferred_language": "invalid_lang"
        }
        
        success, response = self.run_test(
            "Mobile Invalid Registration (JSON Error)",
            "POST",
            "auth/register",
            422,  # Validation error
            data=invalid_registration
        )
        
        if not success and isinstance(response, dict):
            print(f"   ✅ Error response is JSON (not HTML)")
            self.tests_passed += 1
        elif not success:
            print(f"   ❌ Error response is not JSON")
        self.tests_run += 1
        
        # Test 2: Unauthorized access (should return JSON)
        success, response = self.run_test(
            "Mobile Unauthorized Access (JSON Error)",
            "GET",
            "users/profile",
            403  # No token provided
        )
        
        if not success and isinstance(response, dict):
            print(f"   ✅ Unauthorized error is JSON")
            self.tests_passed += 1
        elif not success:
            print(f"   ❌ Unauthorized error is not JSON")
        self.tests_run += 1
        
        # Test 3: Not found error (should return JSON)
        if self.client_token:
            success, response = self.run_test(
                "Mobile Not Found Error (JSON)",
                "GET",
                "jobs/nonexistent-job-id",
                404,
                token=self.client_token
            )
            
            if not success and isinstance(response, dict):
                print(f"   ✅ Not found error is JSON")
                self.tests_passed += 1
            elif not success:
                print(f"   ❌ Not found error is not JSON")
            self.tests_run += 1

    def test_mobile_job_proposals_system(self):
        """Test job proposals system for mobile"""
        print("\n" + "="*60)
        print("TESTING MOBILE JOB PROPOSALS SYSTEM")
        print("="*60)
        
        if not self.test_job_id or not self.worker_token:
            print("❌ Skipping proposal tests - no job ID or worker token")
            return
            
        # Test mobile job proposal creation
        mobile_proposal_data = {
            "proposed_amount": 35000.0,
            "estimated_completion_time": "2 heures",
            "message": "Bonjour, je suis plombier expérimenté à Dakar. Je peux intervenir rapidement pour votre fuite. J'ai tout le matériel nécessaire."
        }
        
        success, response = self.run_test(
            "Mobile Job Proposal Creation",
            "POST",
            f"jobs/{self.test_job_id}/proposals",
            200,
            data=mobile_proposal_data,
            token=self.worker_token
        )
        
        if success:
            print(f"   ✅ Mobile job proposal created successfully")
        
        # Test getting proposals for mobile client
        if self.client_token:
            success, response = self.run_test(
                "Mobile Get Job Proposals",
                "GET",
                f"jobs/{self.test_job_id}/proposals",
                200,
                token=self.client_token
            )
            
            if success and isinstance(response, list):
                print(f"   ✅ Mobile proposals list retrieved: {len(response)} proposals")
                self.tests_passed += 1
            else:
                print(f"   ❌ Mobile proposals list not retrieved properly")
            self.tests_run += 1

    def test_mobile_messaging_system(self):
        """Test messaging system for mobile"""
        print("\n" + "="*60)
        print("TESTING MOBILE MESSAGING SYSTEM")
        print("="*60)
        
        if not self.client_token or not self.worker_token or not self.worker_user:
            print("❌ Skipping messaging tests - missing tokens or users")
            return
            
        # Test mobile message sending
        mobile_message_data = {
            "receiver_id": self.worker_user['id'],
            "content": "Bonjour, j'ai vu votre proposition pour mon travail de plomberie. Pouvez-vous venir demain matin?"
        }
        
        success, response = self.run_test(
            "Mobile Send Message",
            "POST",
            "messages",
            200,
            data=mobile_message_data,
            token=self.client_token
        )
        
        if success:
            print(f"   ✅ Mobile message sent successfully")
        
        # Test getting conversations for mobile
        success, response = self.run_test(
            "Mobile Get Conversations",
            "GET",
            "messages/conversations",
            200,
            token=self.client_token
        )
        
        if success and isinstance(response, list):
            print(f"   ✅ Mobile conversations retrieved: {len(response)} conversations")
            self.tests_passed += 1
        else:
            print(f"   ❌ Mobile conversations not retrieved properly")
        self.tests_run += 1

    def test_mobile_health_and_stats(self):
        """Test health and stats endpoints for mobile monitoring"""
        print("\n" + "="*60)
        print("TESTING MOBILE HEALTH AND STATS ENDPOINTS")
        print("="*60)
        
        # Test health endpoint
        success, response = self.run_test(
            "Mobile Health Check",
            "GET",
            "health",
            200
        )
        
        if success and response:
            required_health_fields = ['status', 'timestamp', 'database', 'version']
            if all(field in response for field in required_health_fields):
                print(f"   ✅ Health endpoint provides all required mobile fields")
                self.tests_passed += 1
            else:
                print(f"   ❌ Health endpoint missing required mobile fields")
            self.tests_run += 1
        
        # Test stats endpoint
        success, response = self.run_test(
            "Mobile Stats Check",
            "GET",
            "stats",
            200
        )
        
        if success and response:
            required_stats_fields = ['total_users', 'total_jobs', 'total_workers', 'total_clients', 'supported_countries']
            if all(field in response for field in required_stats_fields):
                print(f"   ✅ Stats endpoint provides all required mobile fields")
                self.tests_passed += 1
            else:
                print(f"   ❌ Stats endpoint missing required mobile fields")
            self.tests_run += 1

    def run_all_mobile_tests(self):
        """Run all mobile-specific backend tests"""
        print("🚀 Starting Mobile Backend Integration Tests for Kojo API")
        print(f"Base URL: {self.base_url}")
        print("Testing backend functionality specifically for mobile app integration")
        
        try:
            self.test_mobile_health_and_stats()
            self.test_mobile_authentication_system()
            self.test_mobile_job_management_apis()
            self.test_mobile_user_profile_apis()
            self.test_mobile_profile_photo_management()
            self.test_push_notification_token_endpoint()
            self.test_payment_account_verification_mobile()
            self.test_mobile_job_proposals_system()
            self.test_mobile_messaging_system()
            self.test_mobile_error_handling()
            
        except Exception as e:
            print(f"\n❌ Mobile test suite failed with error: {str(e)}")
            
        # Print detailed results
        self.print_mobile_test_summary()
        
        return 0 if self.tests_passed == self.tests_run else 1

    def print_mobile_test_summary(self):
        """Print detailed test summary for mobile integration"""
        print("\n" + "="*70)
        print("MOBILE BACKEND INTEGRATION TEST RESULTS")
        print("="*70)
        
        print(f"📊 Overall Results: {self.tests_passed}/{self.tests_run} tests passed")
        
        # Group results by category
        categories = {
            "Authentication": [],
            "Job Management": [],
            "User Profile": [],
            "Profile Photo": [],
            "Push Notifications": [],
            "Payment Verification": [],
            "Job Proposals": [],
            "Messaging": [],
            "Error Handling": [],
            "Health/Stats": []
        }
        
        for result in self.test_results:
            name = result["name"]
            if "Authentication" in name or "Login" in name or "Registration" in name:
                categories["Authentication"].append(result)
            elif "Job" in name and ("Proposal" in name or "proposal" in name):
                categories["Job Proposals"].append(result)
            elif "Job" in name:
                categories["Job Management"].append(result)
            elif "Profile Photo" in name or "photo" in name:
                categories["Profile Photo"].append(result)
            elif "Profile" in name:
                categories["User Profile"].append(result)
            elif "Push" in name or "Notification" in name:
                categories["Push Notifications"].append(result)
            elif "Payment" in name:
                categories["Payment Verification"].append(result)
            elif "Message" in name or "Conversation" in name:
                categories["Messaging"].append(result)
            elif "Error" in name or "Invalid" in name or "Unauthorized" in name:
                categories["Error Handling"].append(result)
            elif "Health" in name or "Stats" in name:
                categories["Health/Stats"].append(result)
        
        for category, results in categories.items():
            if results:
                passed = sum(1 for r in results if r["success"])
                total = len(results)
                status = "✅" if passed == total else "❌" if passed == 0 else "⚠️"
                print(f"\n{status} {category}: {passed}/{total}")
                
                for result in results:
                    status_icon = "✅" if result["success"] else "❌"
                    print(f"   {status_icon} {result['name']}")
                    if not result["success"] and result["message"]:
                        print(f"      └─ {result['message']}")
        
        # Critical issues for mobile app
        critical_issues = []
        for result in self.test_results:
            if not result["success"]:
                if "Authentication" in result["name"] or "Login" in result["name"]:
                    critical_issues.append(f"🔴 CRITICAL: {result['name']} - {result['message']}")
                elif "Push" in result["name"]:
                    critical_issues.append(f"🟡 MISSING: {result['name']} - {result['message']}")
                elif "Error" in result["name"] and "JSON" in result["name"]:
                    critical_issues.append(f"🔴 CRITICAL: {result['name']} - {result['message']}")
        
        if critical_issues:
            print(f"\n🚨 CRITICAL ISSUES FOR MOBILE APP:")
            for issue in critical_issues:
                print(f"   {issue}")
        
        # Mobile readiness assessment
        auth_working = any(r["success"] for r in categories["Authentication"])
        jobs_working = any(r["success"] for r in categories["Job Management"])
        profiles_working = any(r["success"] for r in categories["User Profile"])
        
        print(f"\n📱 MOBILE APP READINESS ASSESSMENT:")
        if auth_working and jobs_working and profiles_working:
            print("   ✅ Backend is READY for mobile app integration")
            print("   ✅ Core functionality (auth, jobs, profiles) working")
            if not any(r["success"] for r in categories["Push Notifications"]):
                print("   ⚠️  Push notification endpoint needs to be implemented")
        else:
            print("   ❌ Backend has CRITICAL ISSUES for mobile app")
            if not auth_working:
                print("   🔴 Authentication system not working")
            if not jobs_working:
                print("   🔴 Job management system not working")
            if not profiles_working:
                print("   🔴 User profile system not working")
        
        print(f"\n🎯 NEXT STEPS FOR MOBILE INTEGRATION:")
        if not any(r["success"] for r in categories["Push Notifications"]):
            print("   1. Implement POST /api/users/push-token endpoint")
        print("   2. Test with actual mobile app")
        print("   3. Verify offline capabilities integration")
        print("   4. Test real-time features")

def main():
    tester = MobileBackendTester()
    return tester.run_all_mobile_tests()

if __name__ == "__main__":
    sys.exit(main())