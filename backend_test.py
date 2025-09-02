import requests
import sys
import json
import io
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

    def run_all_tests(self):
        """Run all tests in sequence"""
        print("🚀 Starting Kojo API Tests")
        print(f"Base URL: {self.base_url}")
        
        try:
            self.test_health_check()
            self.test_user_registration()
            self.test_user_login()
            self.test_user_profile()
            self.test_profile_photo_management()  # Added profile photo tests
            self.test_worker_profile()
            self.test_job_management()
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