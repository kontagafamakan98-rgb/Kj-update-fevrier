import requests
import sys
import json
import io
import jwt
from datetime import datetime, timedelta

class KojoAPITester:
    def __init__(self, base_url="https://worker-pay-portal.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.client_token = None
        self.worker_token = None
        self.owner_token = None
        self.client_user = None
        self.worker_user = None
        self.owner_user = None
        self.test_job_id = None
        self.tests_run = 0
        self.tests_passed = 0

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
                except:
                    print(f"   Error: {response.text}")
                return False, {}

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            return False, {}

    def test_health_check(self):
        """Test basic health endpoints"""
        print("\n" + "="*50)
        print("TESTING HEALTH ENDPOINTS")
        print("="*50)
        
        self.run_test("Root endpoint", "GET", "", 200)
        self.run_test("Health check", "GET", "health", 200)

    def test_user_registration(self):
        """Test user registration for both client and worker"""
        print("\n" + "="*50)
        print("TESTING USER REGISTRATION")
        print("="*50)
        
        # Test client registration
        client_data = {
            "email": f"client_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "TestPass123!",
            "first_name": "Test",
            "last_name": "Client",
            "phone": "+221701234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr"
        }
        
        success, response = self.run_test(
            "Client Registration",
            "POST",
            "auth/register",
            200,
            data=client_data
        )
        
        if success and 'access_token' in response:
            self.client_token = response['access_token']
            self.client_user = response['user']
            print(f"   Client ID: {self.client_user['id']}")
        
        # Test worker registration with new countries
        worker_data = {
            "email": f"worker_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "TestPass123!",
            "first_name": "Test",
            "last_name": "Worker",
            "phone": "+223701234567",
            "user_type": "worker",
            "country": "burkina_faso",
            "preferred_language": "fr"
        }
        
        success, response = self.run_test(
            "Worker Registration (Burkina Faso)",
            "POST",
            "auth/register",
            200,
            data=worker_data
        )
        
        if success and 'access_token' in response:
            self.worker_token = response['access_token']
            self.worker_user = response['user']
            print(f"   Worker ID: {self.worker_user['id']}")

        # Test registration with Ivory Coast
        ivory_coast_data = {
            "email": f"ivory_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "TestPass123!",
            "first_name": "Test",
            "last_name": "IvoryCoast",
            "phone": "+225701234567",
            "user_type": "client",
            "country": "ivory_coast",
            "preferred_language": "fr"
        }
        
        self.run_test(
            "Client Registration (Ivory Coast)",
            "POST",
            "auth/register",
            200,
            data=ivory_coast_data
        )

        # Test duplicate email registration
        self.run_test(
            "Duplicate Email Registration",
            "POST",
            "auth/register",
            400,
            data=client_data
        )

    def test_user_login(self):
        """Test user login"""
        print("\n" + "="*50)
        print("TESTING USER LOGIN")
        print("="*50)
        
        if not self.client_user:
            print("❌ Skipping login tests - no registered users")
            return
            
        # Test valid login
        login_data = {
            "email": self.client_user['email'],
            "password": "TestPass123!"
        }
        
        self.run_test(
            "Valid Login",
            "POST",
            "auth/login",
            200,
            data=login_data
        )
        
        # Test invalid login
        invalid_login = {
            "email": self.client_user['email'],
            "password": "wrongpassword"
        }
        
        self.run_test(
            "Invalid Login",
            "POST",
            "auth/login",
            401,
            data=invalid_login
        )

    def test_user_profile(self):
        """Test user profile endpoints"""
        print("\n" + "="*50)
        print("TESTING USER PROFILE")
        print("="*50)
        
        if not self.client_token:
            print("❌ Skipping profile tests - no client token")
            return
            
        # Test get profile
        self.run_test(
            "Get User Profile",
            "GET",
            "users/profile",
            200,
            token=self.client_token
        )
        
        # Test update profile
        update_data = {
            "first_name": "Updated",
            "preferred_language": "wo"
        }
        
        self.run_test(
            "Update User Profile",
            "PUT",
            "users/profile",
            200,
            data=update_data,
            token=self.client_token
        )

    def test_worker_profile(self):
        """Test worker profile endpoints"""
        print("\n" + "="*50)
        print("TESTING WORKER PROFILE")
        print("="*50)
        
        if not self.worker_token:
            print("❌ Skipping worker profile tests - no worker token")
            return
            
        # Test create worker profile
        worker_profile_data = {
            "user_id": self.worker_user['id'],
            "specialties": ["plumbing", "electrical"],
            "experience_years": 5,
            "hourly_rate": 15000.0,
            "availability": True,
            "description": "Experienced worker in Mali"
        }
        
        self.run_test(
            "Create Worker Profile",
            "POST",
            "workers/profile",
            200,
            data=worker_profile_data,
            token=self.worker_token
        )
        
        # Test get worker profile
        self.run_test(
            "Get Worker Profile",
            "GET",
            "workers/profile",
            200,
            token=self.worker_token
        )
        
        # Test client trying to create worker profile (should fail)
        if self.client_token:
            self.run_test(
                "Client Create Worker Profile (Should Fail)",
                "POST",
                "workers/profile",
                403,
                data=worker_profile_data,
                token=self.client_token
            )

    def test_job_management(self):
        """Test job creation and management"""
        print("\n" + "="*50)
        print("TESTING JOB MANAGEMENT")
        print("="*50)
        
        if not self.client_token:
            print("❌ Skipping job tests - no client token")
            return
            
        # Test create job
        job_data = {
            "title": "Fix Kitchen Plumbing",
            "description": "Need to fix leaking pipes in kitchen",
            "category": "plumbing",
            "budget_min": 50000.0,
            "budget_max": 100000.0,
            "location": {
                "address": "Dakar, Senegal",
                "latitude": 14.6937,
                "longitude": -17.4441
            },
            "required_skills": ["plumbing", "pipe repair"],
            "estimated_duration": "2-3 hours"
        }
        
        success, response = self.run_test(
            "Create Job",
            "POST",
            "jobs",
            200,
            data=job_data,
            token=self.client_token
        )
        
        if success and 'id' in response:
            self.test_job_id = response['id']
            print(f"   Job ID: {self.test_job_id}")
        
        # Test worker trying to create job (should fail)
        if self.worker_token:
            self.run_test(
                "Worker Create Job (Should Fail)",
                "POST",
                "jobs",
                403,
                data=job_data,
                token=self.worker_token
            )
        
        # Test get all jobs
        self.run_test(
            "Get All Jobs",
            "GET",
            "jobs",
            200,
            token=self.client_token
        )
        
        # Test get jobs with filters
        self.run_test(
            "Get Jobs by Category",
            "GET",
            "jobs?category=plumbing",
            200,
            token=self.client_token
        )
        
        # Test get specific job
        if self.test_job_id:
            self.run_test(
                "Get Specific Job",
                "GET",
                f"jobs/{self.test_job_id}",
                200,
                token=self.client_token
            )

    def test_job_proposals(self):
        """Test job proposal system"""
        print("\n" + "="*50)
        print("TESTING JOB PROPOSALS")
        print("="*50)
        
        if not self.test_job_id or not self.worker_token:
            print("❌ Skipping proposal tests - no job ID or worker token")
            return
            
        # Test create proposal
        proposal_data = {
            "proposed_amount": 75000.0,
            "estimated_completion_time": "2 hours",
            "message": "I have 5 years experience in plumbing. I can fix this quickly."
        }
        
        self.run_test(
            "Create Job Proposal",
            "POST",
            f"jobs/{self.test_job_id}/proposals",
            200,
            data=proposal_data,
            token=self.worker_token
        )
        
        # Test duplicate proposal (should fail)
        self.run_test(
            "Duplicate Proposal (Should Fail)",
            "POST",
            f"jobs/{self.test_job_id}/proposals",
            400,
            data=proposal_data,
            token=self.worker_token
        )
        
        # Test client trying to create proposal (should fail)
        if self.client_token:
            self.run_test(
                "Client Create Proposal (Should Fail)",
                "POST",
                f"jobs/{self.test_job_id}/proposals",
                403,
                data=proposal_data,
                token=self.client_token
            )
        
        # Test get job proposals (as job owner)
        if self.client_token:
            self.run_test(
                "Get Job Proposals",
                "GET",
                f"jobs/{self.test_job_id}/proposals",
                200,
                token=self.client_token
            )

    def test_messaging(self):
        """Test messaging system"""
        print("\n" + "="*50)
        print("TESTING MESSAGING SYSTEM")
        print("="*50)
        
        if not self.client_token or not self.worker_token or not self.worker_user:
            print("❌ Skipping messaging tests - missing tokens or users")
            return
            
        # Test send message
        message_data = {
            "receiver_id": self.worker_user['id'],
            "content": "Hello, I saw your proposal for my plumbing job."
        }
        
        self.run_test(
            "Send Message",
            "POST",
            "messages",
            200,
            data=message_data,
            token=self.client_token
        )
        
        # Test get conversations
        self.run_test(
            "Get Conversations",
            "GET",
            "messages/conversations",
            200,
            token=self.client_token
        )

    def test_profile_photo_management(self):
        """Test profile photo upload, retrieval, and deletion"""
        print("\n" + "="*50)
        print("TESTING PROFILE PHOTO MANAGEMENT")
        print("="*50)
        
        if not self.client_token:
            print("❌ Skipping profile photo tests - no client token")
            return
            
        # Test 1: Get profile photo when none exists (should return 404)
        print(f"\n🔍 Testing Get Profile Photo (No Photo)...")
        url = f"{self.base_url}/users/profile-photo"
        headers = {'Authorization': f'Bearer {self.client_token}'}
        
        try:
            response = requests.get(url, headers=headers)
            if response.status_code == 404:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code} (No photo found as expected)")
            else:
                print(f"❌ Failed - Expected 404, got {response.status_code}")
            self.tests_run += 1
        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            self.tests_run += 1
        
        # Test 2: Upload profile photo with valid image
        print(f"\n🔍 Testing Upload Profile Photo (Valid Image)...")
        url = f"{self.base_url}/users/profile-photo"
        headers = {'Authorization': f'Bearer {self.client_token}'}
        
        # Create a small test image (1x1 pixel PNG)
        test_image_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\tpHYs\x00\x00\x0b\x13\x00\x00\x0b\x13\x01\x00\x9a\x9c\x18\x00\x00\x00\nIDATx\x9cc```\x00\x00\x00\x04\x00\x01\xdd\x8d\xb4\x1c\x00\x00\x00\x00IEND\xaeB`\x82'
        
        files = {'file': ('test_photo.png', io.BytesIO(test_image_data), 'image/png')}
        
        try:
            response = requests.post(url, headers={'Authorization': f'Bearer {self.client_token}'}, files=files)
            if response.status_code == 200:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    response_data = response.json()
                    print(f"   Response: {response_data}")
                    if 'photo_url' in response_data:
                        print(f"   Photo URL: {response_data['photo_url']}")
                except:
                    pass
            else:
                print(f"❌ Failed - Expected 200, got {response.status_code}")
                try:
                    error_data = response.json()
                    print(f"   Error: {error_data}")
                except:
                    print(f"   Error: {response.text}")
            self.tests_run += 1
        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            self.tests_run += 1
        
        # Test 3: Get profile photo after upload (should return 200)
        print(f"\n🔍 Testing Get Profile Photo (After Upload)...")
        url = f"{self.base_url}/users/profile-photo"
        headers = {'Authorization': f'Bearer {self.client_token}'}
        
        try:
            response = requests.get(url, headers=headers)
            if response.status_code == 200:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    response_data = response.json()
                    print(f"   Response: {response_data}")
                except:
                    pass
            else:
                print(f"❌ Failed - Expected 200, got {response.status_code}")
                try:
                    error_data = response.json()
                    print(f"   Error: {error_data}")
                except:
                    print(f"   Error: {response.text}")
            self.tests_run += 1
        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            self.tests_run += 1
        
        # Test 4: Test file size validation (upload large file)
        print(f"\n🔍 Testing Upload Large File (Should Fail)...")
        url = f"{self.base_url}/users/profile-photo"
        
        # Create a large file (6MB - exceeds 5MB limit)
        large_file_data = b'x' * (6 * 1024 * 1024)
        files = {'file': ('large_photo.jpg', io.BytesIO(large_file_data), 'image/jpeg')}
        
        try:
            response = requests.post(url, headers={'Authorization': f'Bearer {self.client_token}'}, files=files)
            if response.status_code == 400:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code} (File too large as expected)")
                try:
                    error_data = response.json()
                    print(f"   Error: {error_data}")
                except:
                    pass
            else:
                print(f"❌ Failed - Expected 400, got {response.status_code}")
            self.tests_run += 1
        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            self.tests_run += 1
        
        # Test 5: Test file type validation (upload non-image file)
        print(f"\n🔍 Testing Upload Non-Image File (Should Fail)...")
        url = f"{self.base_url}/users/profile-photo"
        
        text_file_data = b'This is not an image file'
        files = {'file': ('document.txt', io.BytesIO(text_file_data), 'text/plain')}
        
        try:
            response = requests.post(url, headers={'Authorization': f'Bearer {self.client_token}'}, files=files)
            if response.status_code == 400:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code} (Non-image file rejected as expected)")
                try:
                    error_data = response.json()
                    print(f"   Error: {error_data}")
                except:
                    pass
            else:
                print(f"❌ Failed - Expected 400, got {response.status_code}")
            self.tests_run += 1
        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            self.tests_run += 1
        
        # Test 6: Test authentication requirement (no token)
        print(f"\n🔍 Testing Upload Without Authentication (Should Fail)...")
        url = f"{self.base_url}/users/profile-photo"
        
        files = {'file': ('test_photo.png', io.BytesIO(test_image_data), 'image/png')}
        
        try:
            response = requests.post(url, files=files)  # No auth header
            if response.status_code == 403:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code} (Authentication required as expected)")
            else:
                print(f"❌ Failed - Expected 403, got {response.status_code}")
            self.tests_run += 1
        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            self.tests_run += 1
        
        # Test 7: Test profile integration (check if profile_photo field is updated)
        print(f"\n🔍 Testing Profile Integration (Profile Photo in User Profile)...")
        url = f"{self.base_url}/users/profile"
        headers = {'Authorization': f'Bearer {self.client_token}'}
        
        try:
            response = requests.get(url, headers=headers)
            if response.status_code == 200:
                response_data = response.json()
                if 'profile_photo' in response_data and response_data['profile_photo']:
                    self.tests_passed += 1
                    print(f"✅ Passed - Profile photo URL found in user profile")
                    print(f"   Profile Photo: {response_data['profile_photo']}")
                else:
                    print(f"❌ Failed - Profile photo not found in user profile")
            else:
                print(f"❌ Failed - Could not get user profile: {response.status_code}")
            self.tests_run += 1
        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            self.tests_run += 1
        
        # Test 8: Delete profile photo
        print(f"\n🔍 Testing Delete Profile Photo...")
        url = f"{self.base_url}/users/profile-photo"
        headers = {'Authorization': f'Bearer {self.client_token}'}
        
        try:
            response = requests.delete(url, headers=headers)
            if response.status_code == 200:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    response_data = response.json()
                    print(f"   Response: {response_data}")
                except:
                    pass
            else:
                print(f"❌ Failed - Expected 200, got {response.status_code}")
                try:
                    error_data = response.json()
                    print(f"   Error: {error_data}")
                except:
                    print(f"   Error: {response.text}")
            self.tests_run += 1
        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            self.tests_run += 1
        
        # Test 9: Try to delete profile photo again (should return 404)
        print(f"\n🔍 Testing Delete Non-Existent Profile Photo (Should Fail)...")
        url = f"{self.base_url}/users/profile-photo"
        headers = {'Authorization': f'Bearer {self.client_token}'}
        
        try:
            response = requests.delete(url, headers=headers)
            if response.status_code == 404:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code} (No photo to delete as expected)")
            else:
                print(f"❌ Failed - Expected 404, got {response.status_code}")
            self.tests_run += 1
        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            self.tests_run += 1
        
        # Test 10: Verify profile photo is removed from user profile
        print(f"\n🔍 Testing Profile Integration After Deletion...")
        url = f"{self.base_url}/users/profile"
        headers = {'Authorization': f'Bearer {self.client_token}'}
        
        try:
            response = requests.get(url, headers=headers)
            if response.status_code == 200:
                response_data = response.json()
                if not response_data.get('profile_photo'):
                    self.tests_passed += 1
                    print(f"✅ Passed - Profile photo removed from user profile")
                else:
                    print(f"❌ Failed - Profile photo still exists in user profile: {response_data.get('profile_photo')}")
            else:
                print(f"❌ Failed - Could not get user profile: {response.status_code}")
            self.tests_run += 1
        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            self.tests_run += 1

    def test_unauthorized_access(self):
        """Test unauthorized access to protected endpoints"""
        print("\n" + "="*50)
        print("TESTING UNAUTHORIZED ACCESS")
        print("="*50)
        
        # Test accessing protected endpoints without token
        self.run_test(
            "Get Profile Without Token",
            "GET",
            "users/profile",
            403  # Changed from 401 to 403 as FastAPI returns 403 for missing auth
        )
        
        self.run_test(
            "Get Jobs Without Token",
            "GET",
            "jobs",
            403  # Changed from 401 to 403 as FastAPI returns 403 for missing auth
        )
        
        # Test profile photo endpoints without token
        self.run_test(
            "Get Profile Photo Without Token",
            "GET",
            "users/profile-photo",
            403
        )
        
        print(f"\n🔍 Testing Delete Profile Photo Without Token...")
        url = f"{self.base_url}/users/profile-photo"
        
        try:
            response = requests.delete(url)  # No auth header
            if response.status_code == 403:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
            else:
                print(f"❌ Failed - Expected 403, got {response.status_code}")
            self.tests_run += 1
        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            self.tests_run += 1
    def test_owner_authorization_system(self):
        """Test the Famakan Kontaga Master authorization system"""
        print("\n" + "="*50)
        print("TESTING FAMAKAN KONTAGA MASTER AUTHORIZATION SYSTEM")
        print("="*50)
        
        # Test 1: Famakan Account Login
        print(f"\n🔍 Testing Famakan Kontaga Master Account Login...")
        owner_login_data = {
            "email": "kontagamakan@gmail.com",
            "password": "FamakanKojo2024@Master!"
        }
        
        success, response = self.run_test(
            "Famakan Kontaga Master Login",
            "POST",
            "auth/login",
            200,
            data=owner_login_data
        )
        
        if success and 'access_token' in response:
            self.owner_token = response['access_token']
            self.owner_user = response['user']
            print(f"   Owner ID: {self.owner_user['id']}")
            print(f"   Owner Email: {self.owner_user['email']}")
            
            # Verify Famakan account details
            if (self.owner_user['id'] == 'famakan_kontaga_master_2024' and 
                self.owner_user['email'] == 'kontagamakan@gmail.com'):
                print("✅ Famakan Kontaga Master account details verified correctly")
            else:
                print("❌ Famakan Kontaga Master account details incorrect")
                print(f"   Expected ID: famakan_kontaga_master_2024, Got: {self.owner_user['id']}")
                print(f"   Expected Email: kontagamakan@gmail.com, Got: {self.owner_user['email']}")
        else:
            print("❌ Failed to login as Famakan Kontaga Master - cannot continue owner tests")
            return
        
        # Test 2: Owner-Only Endpoints Access
        print(f"\n🔍 Testing Famakan-Only Endpoints Access...")
        
        # Test commission stats endpoint
        success, response = self.run_test(
            "Famakan Commission Stats Access",
            "GET",
            "owner/commission-stats",
            200,
            token=self.owner_token
        )
        
        if success and response:
            print(f"   ✅ Commission stats accessible to Famakan")
            if 'owner_email' in response and response['owner_email'] == 'kontagamakan@gmail.com':
                print(f"   ✅ Response confirms Famakan's email: {response['owner_email']}")
        
        # Test debug info endpoint
        success, response = self.run_test(
            "Famakan Debug Info Access",
            "GET",
            "owner/debug-info",
            200,
            token=self.owner_token
        )
        
        if success and response:
            print(f"   ✅ Debug info accessible to Famakan")
            if 'access_level' in response and response['access_level'] == 'OWNER_FULL_ACCESS':
                print(f"   ✅ Access level confirmed: {response['access_level']}")
        
        # Test users management endpoint
        success, response = self.run_test(
            "Famakan Users Management Access",
            "GET",
            "owner/users-management",
            200,
            token=self.owner_token
        )
        
        if success and response:
            print(f"   ✅ Users management accessible to Famakan")
            if 'access_level' in response and response['access_level'] == 'OWNER_FULL_ACCESS':
                print(f"   ✅ Access level confirmed: {response['access_level']}")
        
        # Test commission settings update endpoint
        commission_settings = {
            "commission_rate": 15,
            "owner_accounts": {
                "orange_money": "+223701234567",
                "wave": "+223701234567",
                "bank_card": "1234567890123456"
            }
        }
        
        self.run_test(
            "Famakan Update Commission Settings",
            "POST",
            "owner/update-commission-settings",
            200,
            data=commission_settings,
            token=self.owner_token
        )
        
        # Test 3: Regular User Access to Owner Endpoints (Should Fail with Specific Message)
        print(f"\n🔍 Testing Regular User Access to Owner Endpoints (Should Fail with Specific Message)...")
        
        if self.client_token:
            # Test client access to owner endpoints - should get specific French error message
            success, response = self.run_test(
                "Client Access Commission Stats (Should Fail)",
                "GET",
                "owner/commission-stats",
                403,
                token=self.client_token
            )
            
            if not success and response and 'detail' in response:
                expected_message = "Accès interdit: Fonctionnalité réservée à Famakan Kontaga Master uniquement"
                if response['detail'] == expected_message:
                    print(f"   ✅ Correct French error message received: {response['detail']}")
                else:
                    print(f"   ❌ Incorrect error message. Expected: {expected_message}")
                    print(f"       Got: {response['detail']}")
            
            success, response = self.run_test(
                "Client Access Debug Info (Should Fail)",
                "GET",
                "owner/debug-info",
                403,
                token=self.client_token
            )
            
            if not success and response and 'detail' in response:
                expected_message = "Accès interdit: Fonctionnalité réservée à Famakan Kontaga Master uniquement"
                if response['detail'] == expected_message:
                    print(f"   ✅ Correct French error message received: {response['detail']}")
            
            self.run_test(
                "Client Access Users Management (Should Fail)",
                "GET",
                "owner/users-management",
                403,
                token=self.client_token
            )
            
            self.run_test(
                "Client Update Commission Settings (Should Fail)",
                "POST",
                "owner/update-commission-settings",
                403,
                data=commission_settings,
                token=self.client_token
            )
        
        if self.worker_token:
            # Test worker access to owner endpoints
            success, response = self.run_test(
                "Worker Access Commission Stats (Should Fail)",
                "GET",
                "owner/commission-stats",
                403,
                token=self.worker_token
            )
            
            if not success and response and 'detail' in response:
                expected_message = "Accès interdit: Fonctionnalité réservée à Famakan Kontaga Master uniquement"
                if response['detail'] == expected_message:
                    print(f"   ✅ Correct French error message received: {response['detail']}")
            
            self.run_test(
                "Worker Access Debug Info (Should Fail)",
                "GET",
                "owner/debug-info",
                403,
                token=self.worker_token
            )
        
        # Test 4: Unauthorized Access to Owner Endpoints
        print(f"\n🔍 Testing Unauthorized Access to Owner Endpoints...")
        
        self.run_test(
            "No Token Access Commission Stats (Should Fail)",
            "GET",
            "owner/commission-stats",
            403
        )
        
        self.run_test(
            "No Token Access Debug Info (Should Fail)",
            "GET",
            "owner/debug-info",
            403
        )
        
        # Test 5: Verify Regular Authentication Still Works
        print(f"\n🔍 Testing Regular Authentication Still Works...")
        
        if self.client_token:
            self.run_test(
                "Client Profile Access (Should Work)",
                "GET",
                "users/profile",
                200,
                token=self.client_token
            )
        
        if self.worker_token:
            self.run_test(
                "Worker Profile Access (Should Work)",
                "GET",
                "users/profile",
                200,
                token=self.worker_token
            )
        
        # Test 6: Famakan Access to Regular Endpoints
        print(f"\n🔍 Testing Famakan Access to Regular Endpoints...")
        
        if self.owner_token:
            self.run_test(
                "Famakan Profile Access (Should Work)",
                "GET",
                "users/profile",
                200,
                token=self.owner_token
            )
            
            self.run_test(
                "Famakan Jobs Access (Should Work)",
                "GET",
                "jobs",
                200,
                token=self.owner_token
            )
        
        # Test 7: JWT Token Verification for Famakan
        print(f"\n🔍 Testing JWT Token Content for Famakan...")
        if self.owner_token:
            import jwt
            try:
                # Decode without verification to check content (for testing purposes only)
                decoded = jwt.decode(self.owner_token, options={"verify_signature": False})
                
                if decoded.get('sub') == 'famakan_kontaga_master_2024':
                    print(f"   ✅ JWT contains correct user_id: {decoded.get('sub')}")
                    self.tests_passed += 1
                else:
                    print(f"   ❌ JWT user_id incorrect. Expected: famakan_kontaga_master_2024, Got: {decoded.get('sub')}")
                
                if decoded.get('email') == 'kontagamakan@gmail.com':
                    print(f"   ✅ JWT contains correct email: {decoded.get('email')}")
                    self.tests_passed += 1
                else:
                    print(f"   ❌ JWT email incorrect. Expected: kontagamakan@gmail.com, Got: {decoded.get('email')}")
                
                self.tests_run += 2
                
            except Exception as e:
                print(f"   ❌ Failed to decode JWT token: {e}")
                self.tests_run += 1

    def test_owner_account_creation_verification(self):
        """Verify Famakan Kontaga Master account was created on startup"""
        print("\n" + "="*50)
        print("TESTING FAMAKAN KONTAGA MASTER ACCOUNT CREATION")
        print("="*50)
        
        # Test that we can login with the expected Famakan credentials
        print(f"\n🔍 Testing Famakan Kontaga Master Account Exists...")
        owner_login_data = {
            "email": "kontagamakan@gmail.com",
            "password": "FamakanKojo2024@Master!"
        }
        
        success, response = self.run_test(
            "Verify Famakan Kontaga Master Account Creation",
            "POST",
            "auth/login",
            200,
            data=owner_login_data
        )
        
        if success and response:
            user = response.get('user', {})
            
            # Verify Famakan account details
            expected_id = 'famakan_kontaga_master_2024'
            expected_email = 'kontagamakan@gmail.com'
            expected_name = 'Famakan Kontaga Master'
            
            if user.get('id') == expected_id:
                print(f"✅ Famakan ID verified: {user.get('id')}")
                self.tests_passed += 1
            else:
                print(f"❌ Famakan ID incorrect. Expected: {expected_id}, Got: {user.get('id')}")
            
            if user.get('email') == expected_email:
                print(f"✅ Famakan email verified: {user.get('email')}")
                self.tests_passed += 1
            else:
                print(f"❌ Famakan email incorrect. Expected: {expected_email}, Got: {user.get('email')}")
            
            # Check name components
            if (user.get('first_name') == 'Famakan' and 
                user.get('last_name') == 'Kontaga Master'):
                print(f"✅ Famakan name verified: {user.get('first_name')} {user.get('last_name')}")
                self.tests_passed += 1
            else:
                print(f"❌ Famakan name incorrect. Expected: Famakan Kontaga Master, Got: {user.get('first_name')} {user.get('last_name')}")
            
            # Check if owner has special properties
            if user.get('user_type') == 'owner' or user.get('is_owner'):
                print(f"✅ Owner type verified: {user.get('user_type')}")
                self.tests_passed += 1
            else:
                print(f"❌ Owner type not set correctly. Got: {user.get('user_type')}")
            
            self.tests_run += 4  # We ran 4 verification checks
        else:
            print("❌ Could not verify Famakan Kontaga Master account creation")
            self.tests_run += 1

    def test_payment_account_verification_system(self):
        """Test the new payment account verification system"""
        print("\n" + "="*50)
        print("TESTING PAYMENT ACCOUNT VERIFICATION SYSTEM")
        print("="*50)
        
        # Test 1: Client registration with 1 payment method (should succeed)
        print(f"\n🔍 Testing Client Registration with 1 Payment Method (Should Succeed)...")
        client_payment_data = {
            "email": f"client_payment_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "TestPass123!",
            "first_name": "Aminata",
            "last_name": "Diallo",
            "phone": "+221701234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr",
            "payment_accounts": {
                "orange_money": "+221701234567"
            }
        }
        
        success, response = self.run_test(
            "Client Registration with 1 Payment Method",
            "POST",
            "auth/register-verified",
            200,
            data=client_payment_data
        )
        
        client_verified_token = None
        if success and 'access_token' in response:
            client_verified_token = response['access_token']
            print(f"   ✅ Client registered with payment verification")
            if 'payment_verification' in response:
                verification = response['payment_verification']
                print(f"   Payment verification: {verification}")
        
        # Test 2: Client registration with 0 payment methods (should fail)
        print(f"\n🔍 Testing Client Registration with 0 Payment Methods (Should Fail)...")
        client_no_payment_data = {
            "email": f"client_no_payment_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "TestPass123!",
            "first_name": "Fatou",
            "last_name": "Sow",
            "phone": "+221701234568",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr",
            "payment_accounts": {}
        }
        
        self.run_test(
            "Client Registration with 0 Payment Methods",
            "POST",
            "auth/register-verified",
            400,
            data=client_no_payment_data
        )
        
        # Test 3: Worker registration with 2+ payment methods (should succeed)
        print(f"\n🔍 Testing Worker Registration with 2+ Payment Methods (Should Succeed)...")
        worker_payment_data = {
            "email": f"worker_payment_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "TestPass123!",
            "first_name": "Mamadou",
            "last_name": "Traore",
            "phone": "+223701234567",
            "user_type": "worker",
            "country": "mali",
            "preferred_language": "fr",
            "payment_accounts": {
                "orange_money": "+223701234567",
                "wave": "+221701234567"
            }
        }
        
        success, response = self.run_test(
            "Worker Registration with 2+ Payment Methods",
            "POST",
            "auth/register-verified",
            200,
            data=worker_payment_data
        )
        
        worker_verified_token = None
        if success and 'access_token' in response:
            worker_verified_token = response['access_token']
            print(f"   ✅ Worker registered with payment verification")
        
        # Test 4: Worker registration with 1 payment method (should fail)
        print(f"\n🔍 Testing Worker Registration with 1 Payment Method (Should Fail)...")
        worker_insufficient_data = {
            "email": f"worker_insufficient_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "TestPass123!",
            "first_name": "Ibrahim",
            "last_name": "Kone",
            "phone": "+223701234568",
            "user_type": "worker",
            "country": "mali",
            "preferred_language": "fr",
            "payment_accounts": {
                "orange_money": "+223701234568"
            }
        }
        
        self.run_test(
            "Worker Registration with 1 Payment Method",
            "POST",
            "auth/register-verified",
            400,
            data=worker_insufficient_data
        )
        
        # Test 5: Orange Money validation tests
        print(f"\n🔍 Testing Orange Money Number Validation...")
        
        # Valid Orange Money numbers
        valid_orange_tests = [
            {"orange_money": "+223701234567", "country": "mali"},      # Mali
            {"orange_money": "+221701234567", "country": "senegal"},   # Senegal
            {"orange_money": "+226701234567", "country": "burkina_faso"}, # Burkina Faso
            {"orange_money": "+225701234567", "country": "ivory_coast"}   # Ivory Coast
        ]
        
        for i, test_data in enumerate(valid_orange_tests):
            test_user_data = {
                "email": f"orange_valid_{i}_{datetime.now().strftime('%H%M%S')}@test.com",
                "password": "TestPass123!",
                "first_name": "Test",
                "last_name": "Orange",
                "phone": test_data["orange_money"],
                "user_type": "client",
                "country": test_data["country"],
                "preferred_language": "fr",
                "payment_accounts": {
                    "orange_money": test_data["orange_money"]
                }
            }
            
            self.run_test(
                f"Valid Orange Money {test_data['country']} ({test_data['orange_money']})",
                "POST",
                "auth/register-verified",
                200,
                data=test_user_data
            )
        
        # Invalid Orange Money numbers
        invalid_orange_data = {
            "email": f"orange_invalid_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "TestPass123!",
            "first_name": "Test",
            "last_name": "Invalid",
            "phone": "+1234567890",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr",
            "payment_accounts": {
                "orange_money": "+1234567890"  # Invalid prefix
            }
        }
        
        self.run_test(
            "Invalid Orange Money Number",
            "POST",
            "auth/register-verified",
            400,
            data=invalid_orange_data
        )
        
        # Test 6: Wave validation tests - NOW AVAILABLE ACROSS ALL WEST AFRICA
        print(f"\n🔍 Testing Wave Number Validation - All West African Countries...")
        
        # Valid Wave numbers (ALL West African countries now supported)
        valid_wave_tests = [
            {"wave": "+221701234567", "country": "senegal"},      # Senegal
            {"wave": "+223701234567", "country": "mali"},         # Mali  
            {"wave": "+224701234567", "country": "guinea"},       # Guinea
            {"wave": "+225701234567", "country": "ivory_coast"},  # Ivory Coast
            {"wave": "+226701234567", "country": "burkina_faso"}, # Burkina Faso
            {"wave": "+227701234567", "country": "niger"},        # Niger
            {"wave": "+228701234567", "country": "togo"},         # Togo
            {"wave": "+229701234567", "country": "benin"}         # Benin
        ]
        
        for i, test_data in enumerate(valid_wave_tests):
            test_user_data = {
                "email": f"wave_valid_{i}_{datetime.now().strftime('%H%M%S')}@test.com",
                "password": "TestPass123!",
                "first_name": "Test",
                "last_name": "Wave",
                "phone": test_data["wave"],
                "user_type": "client",
                "country": test_data["country"],
                "preferred_language": "fr",
                "payment_accounts": {
                    "wave": test_data["wave"]
                }
            }
            
            self.run_test(
                f"Valid Wave {test_data['country']} ({test_data['wave']})",
                "POST",
                "auth/register-verified",
                200,
                data=test_user_data
            )
        
        # Invalid Wave number (should fail with invalid prefix)
        invalid_wave_data = {
            "email": f"wave_invalid_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "TestPass123!",
            "first_name": "Test",
            "last_name": "InvalidWave",
            "phone": "+1234567890",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr",
            "payment_accounts": {
                "wave": "+1234567890"  # Invalid prefix (not West African)
            }
        }
        
        self.run_test(
            "Invalid Wave Number (Non-West African prefix)",
            "POST",
            "auth/register-verified",
            400,
            data=invalid_wave_data
        )
        
        # Test 7: Bank account validation (NEW - not bank cards)
        print(f"\n🔍 Testing Bank Account Validation (NEW Structure)...")
        
        # Valid bank account with complete information
        valid_bank_account_data = {
            "email": f"bank_valid_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "TestPass123!",
            "first_name": "Mariam",
            "last_name": "Kone",
            "phone": "+223701234567",
            "user_type": "client",
            "country": "mali",
            "preferred_language": "fr",
            "payment_accounts": {
                "bank_account": {
                    "account_number": "12345678901234",
                    "bank_name": "Banque Atlantique Mali",
                    "account_holder": "Mariam Kone",
                    "bank_code": "BK001",
                    "branch": "Bamako Plateau"
                }
            }
        }
        
        self.run_test(
            "Valid Bank Account (Complete Information)",
            "POST",
            "auth/register-verified",
            200,
            data=valid_bank_account_data
        )
        
        # Valid bank account with minimum required fields only
        valid_bank_minimal_data = {
            "email": f"bank_minimal_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "TestPass123!",
            "first_name": "Fatou",
            "last_name": "Diarra",
            "phone": "+221701234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr",
            "payment_accounts": {
                "bank_account": {
                    "account_number": "87654321",
                    "bank_name": "Ecobank Senegal",
                    "account_holder": "Fatou Diarra"
                }
            }
        }
        
        self.run_test(
            "Valid Bank Account (Minimum Required Fields)",
            "POST",
            "auth/register-verified",
            200,
            data=valid_bank_minimal_data
        )
        
        # Invalid bank account - missing required field (account_number)
        invalid_bank_missing_account_data = {
            "email": f"bank_invalid_1_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "TestPass123!",
            "first_name": "Test",
            "last_name": "Invalid",
            "phone": "+221701234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr",
            "payment_accounts": {
                "bank_account": {
                    "bank_name": "Test Bank",
                    "account_holder": "Test Invalid"
                }
            }
        }
        
        self.run_test(
            "Invalid Bank Account (Missing Account Number)",
            "POST",
            "auth/register-verified",
            400,
            data=invalid_bank_missing_account_data
        )
        
        # Invalid bank account - account number too short (less than 8 digits)
        invalid_bank_short_account_data = {
            "email": f"bank_invalid_2_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "TestPass123!",
            "first_name": "Test",
            "last_name": "Invalid",
            "phone": "+221701234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr",
            "payment_accounts": {
                "bank_account": {
                    "account_number": "1234567",  # Only 7 digits
                    "bank_name": "Test Bank",
                    "account_holder": "Test Invalid"
                }
            }
        }
        
        self.run_test(
            "Invalid Bank Account (Account Number Too Short)",
            "POST",
            "auth/register-verified",
            400,
            data=invalid_bank_short_account_data
        )
        
        # Invalid bank account - missing bank_name
        invalid_bank_missing_name_data = {
            "email": f"bank_invalid_3_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "TestPass123!",
            "first_name": "Test",
            "last_name": "Invalid",
            "phone": "+221701234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr",
            "payment_accounts": {
                "bank_account": {
                    "account_number": "12345678",
                    "account_holder": "Test Invalid"
                }
            }
        }
        
        self.run_test(
            "Invalid Bank Account (Missing Bank Name)",
            "POST",
            "auth/register-verified",
            400,
            data=invalid_bank_missing_name_data
        )
        
        # Invalid bank account - missing account_holder
        invalid_bank_missing_holder_data = {
            "email": f"bank_invalid_4_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "TestPass123!",
            "first_name": "Test",
            "last_name": "Invalid",
            "phone": "+221701234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr",
            "payment_accounts": {
                "bank_account": {
                    "account_number": "12345678",
                    "bank_name": "Test Bank"
                }
            }
        }
        
        self.run_test(
            "Invalid Bank Account (Missing Account Holder)",
            "POST",
            "auth/register-verified",
            400,
            data=invalid_bank_missing_holder_data
        )
        
        # Test 8: GET /api/users/payment-accounts
        if client_verified_token:
            print(f"\n🔍 Testing GET Payment Accounts...")
            self.run_test(
                "Get User Payment Accounts",
                "GET",
                "users/payment-accounts",
                200,
                token=client_verified_token
            )
        
        # Test 9: PUT /api/users/payment-accounts
        if client_verified_token:
            print(f"\n🔍 Testing PUT Payment Accounts...")
            update_payment_data = {
                "orange_money": "+221701234567",
                "wave": "+221701234567"
            }
            
            self.run_test(
                "Update User Payment Accounts",
                "PUT",
                "users/payment-accounts",
                200,
                data=update_payment_data,
                token=client_verified_token
            )
        
        # Test 10: POST /api/users/verify-payment-access
        if client_verified_token:
            print(f"\n🔍 Testing Payment Access Verification...")
            self.run_test(
                "Verify Payment Access",
                "POST",
                "users/verify-payment-access",
                200,
                token=client_verified_token
            )
        
        # Test 11: Worker with 3 payment methods (Orange Money + Wave + Bank Account)
        print(f"\n🔍 Testing Worker with All 3 Payment Methods (Orange Money + Wave + Bank Account)...")
        worker_all_payments_data = {
            "email": f"worker_all_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "TestPass123!",
            "first_name": "Ousmane",
            "last_name": "Diop",
            "phone": "+221701234567",
            "user_type": "worker",
            "country": "senegal",
            "preferred_language": "fr",
            "payment_accounts": {
                "orange_money": "+221701234567",
                "wave": "+221701234567",
                "bank_account": {
                    "account_number": "98765432101234",
                    "bank_name": "Ecobank Senegal",
                    "account_holder": "Ousmane Diop",
                    "bank_code": "ECO001",
                    "branch": "Dakar Plateau"
                }
            }
        }
        
        self.run_test(
            "Worker Registration with All 3 Payment Methods (Orange Money + Wave + Bank Account)",
            "POST",
            "auth/register-verified",
            200,
            data=worker_all_payments_data
        )
        
        # Test 12: Test bank account masking in responses
        print(f"\n🔍 Testing Bank Account Masking in Responses...")
        if client_verified_token:
            # First, update user with bank account
            bank_account_update = {
                "bank_account": {
                    "account_number": "12345678901234",
                    "bank_name": "Banque Atlantique",
                    "account_holder": "Test User",
                    "bank_code": "BA001",
                    "branch": "Dakar Centre"
                }
            }
            
            success, response = self.run_test(
                "Update User with Bank Account",
                "PUT",
                "users/payment-accounts",
                200,
                data=bank_account_update,
                token=client_verified_token
            )
            
            # Then get payment accounts to verify masking
            success, response = self.run_test(
                "Get Payment Accounts (Check Bank Account Masking)",
                "GET",
                "users/payment-accounts",
                200,
                token=client_verified_token
            )
            
            if success and response and 'payment_accounts' in response:
                payment_accounts = response['payment_accounts']
                if 'bank_account' in payment_accounts:
                    bank_account = payment_accounts['bank_account']
                    account_number = bank_account.get('account_number', '')
                    if account_number.startswith('****') and account_number.endswith('1234'):
                        print(f"   ✅ Bank account number properly masked: {account_number}")
                        self.tests_passed += 1
                    else:
                        print(f"   ❌ Bank account number not properly masked: {account_number}")
                    self.tests_run += 1

    def test_enhanced_wave_validation_system(self):
        """Test the enhanced Wave validation system - now available across ALL West Africa"""
        print("\n" + "="*50)
        print("TESTING ENHANCED WAVE VALIDATION SYSTEM - ALL WEST AFRICA")
        print("="*50)
        
        # Test Wave validation for ALL West African countries
        west_african_countries = [
            {"prefix": "+221", "country": "senegal", "name": "Senegal"},
            {"prefix": "+223", "country": "mali", "name": "Mali"},
            {"prefix": "+224", "country": "guinea", "name": "Guinea"},
            {"prefix": "+225", "country": "ivory_coast", "name": "Ivory Coast"},
            {"prefix": "+226", "country": "burkina_faso", "name": "Burkina Faso"},
            {"prefix": "+227", "country": "niger", "name": "Niger"},
            {"prefix": "+228", "country": "togo", "name": "Togo"},
            {"prefix": "+229", "country": "benin", "name": "Benin"}
        ]
        
        print(f"\n🔍 Testing Wave Validation for All {len(west_african_countries)} West African Countries...")
        
        for i, country_data in enumerate(west_african_countries):
            wave_number = f"{country_data['prefix']}701234567"
            
            test_user_data = {
                "email": f"wave_{country_data['country']}_{datetime.now().strftime('%H%M%S')}_{i}@test.com",
                "password": "TestPass123!",
                "first_name": "Test",
                "last_name": f"Wave{country_data['name']}",
                "phone": wave_number,
                "user_type": "client",
                "country": country_data['country'],
                "preferred_language": "fr",
                "payment_accounts": {
                    "wave": wave_number
                }
            }
            
            success, response = self.run_test(
                f"Wave Validation - {country_data['name']} ({wave_number})",
                "POST",
                "auth/register-verified",
                200,
                data=test_user_data
            )
            
            if success:
                print(f"   ✅ Wave now supported in {country_data['name']} ({country_data['prefix']})")
            else:
                print(f"   ❌ Wave validation failed for {country_data['name']} ({country_data['prefix']})")
        
        # Test invalid Wave numbers (non-West African prefixes)
        invalid_prefixes = ["+1", "+33", "+44", "+91", "+86", "+234"]  # US, France, UK, India, China, Nigeria
        
        print(f"\n🔍 Testing Invalid Wave Numbers (Non-West African Prefixes)...")
        
        for i, invalid_prefix in enumerate(invalid_prefixes):
            invalid_wave_number = f"{invalid_prefix}701234567"
            
            invalid_test_data = {
                "email": f"wave_invalid_{i}_{datetime.now().strftime('%H%M%S')}@test.com",
                "password": "TestPass123!",
                "first_name": "Test",
                "last_name": "InvalidWave",
                "phone": invalid_wave_number,
                "user_type": "client",
                "country": "senegal",
                "preferred_language": "fr",
                "payment_accounts": {
                    "wave": invalid_wave_number
                }
            }
            
            self.run_test(
                f"Invalid Wave Number ({invalid_prefix})",
                "POST",
                "auth/register-verified",
                400,
                data=invalid_test_data
            )

    def test_enhanced_bank_account_validation_system(self):
        """Test the enhanced bank account validation system (replacing bank cards)"""
        print("\n" + "="*50)
        print("TESTING ENHANCED BANK ACCOUNT VALIDATION SYSTEM")
        print("="*50)
        
        # Test various bank account scenarios
        bank_account_tests = [
            {
                "name": "Complete Bank Account Information",
                "account": {
                    "account_number": "12345678901234567890",
                    "bank_name": "Banque Atlantique Mali",
                    "account_holder": "Amadou Traore",
                    "bank_code": "BA001",
                    "branch": "Bamako Plateau"
                },
                "expected": 200
            },
            {
                "name": "Minimum Required Fields Only",
                "account": {
                    "account_number": "87654321",
                    "bank_name": "Ecobank",
                    "account_holder": "Fatou Diallo"
                },
                "expected": 200
            },
            {
                "name": "Account Number with Spaces and Dashes",
                "account": {
                    "account_number": "1234-5678-9012-3456",
                    "bank_name": "UBA Senegal",
                    "account_holder": "Moussa Sow"
                },
                "expected": 200
            },
            {
                "name": "Very Long Account Number",
                "account": {
                    "account_number": "123456789012345678901234567890",
                    "bank_name": "BCEAO",
                    "account_holder": "Mariama Kone"
                },
                "expected": 200
            },
            {
                "name": "Account Number Too Short (7 digits)",
                "account": {
                    "account_number": "1234567",
                    "bank_name": "Test Bank",
                    "account_holder": "Test User"
                },
                "expected": 400
            },
            {
                "name": "Missing Account Number",
                "account": {
                    "bank_name": "Test Bank",
                    "account_holder": "Test User"
                },
                "expected": 400
            },
            {
                "name": "Missing Bank Name",
                "account": {
                    "account_number": "12345678",
                    "account_holder": "Test User"
                },
                "expected": 400
            },
            {
                "name": "Missing Account Holder",
                "account": {
                    "account_number": "12345678",
                    "bank_name": "Test Bank"
                },
                "expected": 400
            },
            {
                "name": "Empty Bank Name",
                "account": {
                    "account_number": "12345678",
                    "bank_name": "",
                    "account_holder": "Test User"
                },
                "expected": 400
            },
            {
                "name": "Bank Name Too Short (2 chars)",
                "account": {
                    "account_number": "12345678",
                    "bank_name": "AB",
                    "account_holder": "Test User"
                },
                "expected": 400
            }
        ]
        
        print(f"\n🔍 Testing {len(bank_account_tests)} Bank Account Validation Scenarios...")
        
        for i, test_case in enumerate(bank_account_tests):
            test_user_data = {
                "email": f"bank_test_{i}_{datetime.now().strftime('%H%M%S')}@test.com",
                "password": "TestPass123!",
                "first_name": "Test",
                "last_name": f"BankUser{i}",
                "phone": "+221701234567",
                "user_type": "client",
                "country": "senegal",
                "preferred_language": "fr",
                "payment_accounts": {
                    "bank_account": test_case["account"]
                }
            }
            
            self.run_test(
                f"Bank Account: {test_case['name']}",
                "POST",
                "auth/register-verified",
                test_case["expected"],
                data=test_user_data
            )
    def run_all_tests(self):
        """Run all tests in sequence"""
        print("🚀 Starting Kojo API Tests")
        print(f"Base URL: {self.base_url}")
        
        try:
            self.test_health_check()
            self.test_owner_account_creation_verification()  # Test Famakan account creation first
            self.test_user_registration()
            self.test_user_login()
            self.test_payment_account_verification_system()  # Test payment verification system
            self.test_enhanced_wave_validation_system()  # NEW: Test enhanced Wave validation
            self.test_enhanced_bank_account_validation_system()  # NEW: Test enhanced bank account validation
            self.test_owner_authorization_system()  # Test Famakan authorization system
            self.test_user_profile()
            self.test_profile_photo_management()  # Added profile photo tests
            self.test_worker_profile()
            self.test_job_management()
            self.test_mechanic_requirements_system()  # NEW: Test mechanic requirements
            self.test_job_proposals()
            self.test_messaging()
            self.test_unauthorized_access()
            
        except Exception as e:
            print(f"\n❌ Test suite failed with error: {str(e)}")
            
        # Print final results
        print("\n" + "="*60)
        print("FINAL TEST RESULTS")
        print("="*60)
        print(f"📊 Tests passed: {self.tests_passed}/{self.tests_run}")
        
        if self.tests_passed == self.tests_run:
            print("🎉 All tests passed!")
            return 0
        else:
            print(f"⚠️  {self.tests_run - self.tests_passed} tests failed")
            return 1

def main():
    tester = KojoAPITester()
    return tester.run_all_tests()

if __name__ == "__main__":
    sys.exit(main())