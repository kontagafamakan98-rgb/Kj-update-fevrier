#!/usr/bin/env python3
"""
Frontend-Backend Integration Test for Profile Photo Upload
Simulates the exact frontend workflow to identify "Erreur lors de la mise à jour"
"""

import requests
import sys
import json
import io
import base64
from datetime import datetime
from PIL import Image

class FrontendBackendIntegrationTester:
    def __init__(self, base_url="https://geoloc-boost.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.test_user_token = None
        self.test_user_id = None
        self.test_user_data = None
        
    def log(self, message, level="INFO"):
        """Enhanced logging with timestamp"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        print(f"[{timestamp}] {level}: {message}")
        
    def create_test_image(self, format="JPEG", size=(300, 300)):
        """Create a test image in memory"""
        img = Image.new('RGB', size, color='green')
        img_buffer = io.BytesIO()
        img.save(img_buffer, format=format)
        img_buffer.seek(0)
        return img_buffer.getvalue()
    
    def setup_test_user(self):
        """Create a test user exactly like frontend would"""
        timestamp = datetime.now().strftime('%H%M%S')
        user_data = {
            "email": f"integration_test_{timestamp}@gmail.com",
            "password": "IntegrationTest123!",
            "first_name": "Integration",
            "last_name": "Tester",
            "phone": "+221701234570",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr",
            "payment_accounts": {
                "orange_money": "+221701234570"
            }
        }
        
        try:
            response = requests.post(
                f"{self.base_url}/auth/register-verified",
                json=user_data,
                headers={'Content-Type': 'application/json'}
            )
            
            if response.status_code == 200:
                data = response.json()
                self.test_user_token = data['access_token']
                self.test_user_id = data['user']['id']
                self.test_user_data = data['user']
                self.log(f"✅ Test user created - ID: {self.test_user_id}")
                return True
            else:
                self.log(f"❌ Failed to create test user: {response.status_code} - {response.text}", "ERROR")
                return False
        except Exception as e:
            self.log(f"❌ Exception creating test user: {e}", "ERROR")
            return False

    def simulate_frontend_photo_upload_workflow(self):
        """Simulate the exact frontend ProfilePhotoUploader workflow"""
        self.log("\n🔍 SIMULATING FRONTEND PHOTO UPLOAD WORKFLOW")
        self.log("="*60)
        
        if not self.test_user_token:
            self.log("❌ No test user token", "ERROR")
            return False
        
        try:
            # Step 1: Load current photo (like useEffect in ProfilePhotoUploader)
            self.log("Step 1: Loading current photo...")
            current_photo_response = requests.get(
                f"{self.base_url}/users/profile-photo",
                headers={'Authorization': f'Bearer {self.test_user_token}'}
            )
            
            if current_photo_response.status_code == 404:
                self.log("✅ No current photo (expected for new user)")
            elif current_photo_response.status_code == 200:
                current_data = current_photo_response.json()
                self.log(f"✅ Current photo found: {current_data.get('photo_url')}")
            else:
                self.log(f"⚠️ Unexpected status for current photo: {current_photo_response.status_code}", "WARNING")
            
            # Step 2: Simulate file selection and validation (like handleFiles)
            self.log("Step 2: Simulating file selection and validation...")
            test_file_data = self.create_test_image("JPEG", (400, 400))
            file_size = len(test_file_data)
            self.log(f"Test file size: {file_size} bytes ({file_size/1024:.1f} KB)")
            
            # Frontend validation checks
            if file_size > 5 * 1024 * 1024:
                self.log("❌ File too large (frontend validation)", "ERROR")
                return False
            
            self.log("✅ File passes frontend validation")
            
            # Step 3: Create FormData exactly like frontend
            self.log("Step 3: Creating FormData for upload...")
            files = {'file': ('integration_test.jpg', test_file_data, 'image/jpeg')}
            
            # Step 4: Upload to backend (like usersAPI.uploadProfilePhoto)
            self.log("Step 4: Uploading to backend...")
            upload_response = requests.post(
                f"{self.base_url}/users/profile-photo",
                files=files,
                headers={'Authorization': f'Bearer {self.test_user_token}'}
            )
            
            self.log(f"Upload response status: {upload_response.status_code}")
            
            if upload_response.status_code == 200:
                upload_data = upload_response.json()
                photo_url = upload_data.get('photo_url')
                message = upload_data.get('message')
                filename = upload_data.get('filename')
                
                self.log(f"✅ Upload successful!")
                self.log(f"   Photo URL: {photo_url}")
                self.log(f"   Message: {message}")
                self.log(f"   Filename: {filename}")
                
                # Step 5: Verify photo URL format (like frontend validation)
                self.log("Step 5: Verifying photo URL format...")
                if photo_url and photo_url.startswith('/api/uploads/profile_photos/'):
                    self.log("✅ Photo URL has correct format")
                else:
                    self.log(f"❌ Photo URL has incorrect format: {photo_url}", "ERROR")
                    return False
                
                # Step 6: Create full URL (like frontend does)
                self.log("Step 6: Creating full URL...")
                backend_url = "https://geoloc-boost.preview.emergentagent.com"
                full_url = f"{backend_url}{photo_url}?t={int(datetime.now().timestamp())}"
                self.log(f"Full URL: {full_url}")
                
                # Step 7: Test photo accessibility
                self.log("Step 7: Testing photo accessibility...")
                photo_response = requests.get(full_url)
                
                if photo_response.status_code == 200:
                    content_type = photo_response.headers.get('content-type', '')
                    if content_type.startswith('image/'):
                        self.log("✅ Photo accessible and returns image content")
                    else:
                        self.log(f"❌ Photo returns wrong content-type: {content_type}", "ERROR")
                        return False
                else:
                    self.log(f"❌ Photo not accessible: {photo_response.status_code}", "ERROR")
                    return False
                
                # Step 8: Verify profile update (like updateUser in AuthContext)
                self.log("Step 8: Verifying profile update...")
                profile_response = requests.get(
                    f"{self.base_url}/users/profile",
                    headers={'Authorization': f'Bearer {self.test_user_token}'}
                )
                
                if profile_response.status_code == 200:
                    profile_data = profile_response.json()
                    profile_photo = profile_data.get('profile_photo')
                    
                    if profile_photo == photo_url:
                        self.log("✅ Profile updated with correct photo URL")
                    else:
                        self.log(f"❌ Profile photo URL mismatch - Expected: {photo_url}, Got: {profile_photo}", "ERROR")
                        return False
                else:
                    self.log(f"❌ Failed to get updated profile: {profile_response.status_code}", "ERROR")
                    return False
                
                self.log("🎉 COMPLETE WORKFLOW SUCCESSFUL!")
                return True
                
            else:
                self.log(f"❌ Upload failed with status: {upload_response.status_code}", "ERROR")
                try:
                    error_data = upload_response.json()
                    self.log(f"Error details: {error_data}")
                    
                    # Check for specific error messages that might cause "Erreur lors de la mise à jour"
                    if 'detail' in error_data:
                        detail = error_data['detail']
                        if isinstance(detail, str):
                            self.log(f"🔍 POTENTIAL CAUSE: {detail}")
                        elif isinstance(detail, list):
                            for error in detail:
                                if isinstance(error, dict) and 'msg' in error:
                                    self.log(f"🔍 POTENTIAL CAUSE: {error['msg']}")
                except:
                    self.log(f"Raw error response: {upload_response.text}")
                
                return False
                
        except Exception as e:
            self.log(f"❌ Exception in workflow: {e}", "ERROR")
            return False

    def test_error_scenarios_that_cause_update_error(self):
        """Test specific scenarios that might cause 'Erreur lors de la mise à jour'"""
        self.log("\n🔍 TESTING ERROR SCENARIOS THAT CAUSE 'ERREUR LORS DE LA MISE À JOUR'")
        self.log("="*70)
        
        if not self.test_user_token:
            self.log("❌ No test user token", "ERROR")
            return
        
        # Scenario 1: Token expiry during upload
        self.log("\n--- Scenario 1: Invalid/Expired Token ---")
        test_file_data = self.create_test_image("JPEG", (200, 200))
        files = {'file': ('expired_token_test.jpg', test_file_data, 'image/jpeg')}
        
        expired_response = requests.post(
            f"{self.base_url}/users/profile-photo",
            files=files,
            headers={'Authorization': 'Bearer expired_or_invalid_token'}
        )
        
        self.log(f"Expired token response: {expired_response.status_code}")
        if expired_response.status_code == 401:
            try:
                error_data = expired_response.json()
                self.log(f"Error message: {error_data}")
                if 'detail' in error_data:
                    self.log(f"🔍 This could cause 'Erreur lors de la mise à jour': {error_data['detail']}")
            except:
                self.log(f"Raw error: {expired_response.text}")
        
        # Scenario 2: Network timeout simulation (large file)
        self.log("\n--- Scenario 2: Large File Upload (Potential Timeout) ---")
        large_file_data = self.create_test_image("JPEG", (1500, 1500))  # Larger file
        files = {'file': ('large_file_test.jpg', large_file_data, 'image/jpeg')}
        
        try:
            large_response = requests.post(
                f"{self.base_url}/users/profile-photo",
                files=files,
                headers={'Authorization': f'Bearer {self.test_user_token}'},
                timeout=10  # 10 second timeout
            )
            
            self.log(f"Large file response: {large_response.status_code}")
            if large_response.status_code != 200:
                try:
                    error_data = large_response.json()
                    self.log(f"Large file error: {error_data}")
                except:
                    self.log(f"Large file raw error: {large_response.text}")
                    
        except requests.exceptions.Timeout:
            self.log("🔍 TIMEOUT DETECTED - This could cause 'Erreur lors de la mise à jour'", "ERROR")
        except Exception as e:
            self.log(f"Large file upload error: {e}")
        
        # Scenario 3: Malformed file data
        self.log("\n--- Scenario 3: Malformed File Data ---")
        malformed_files = {'file': ('malformed.jpg', b'not_an_image', 'image/jpeg')}
        
        malformed_response = requests.post(
            f"{self.base_url}/users/profile-photo",
            files=malformed_files,
            headers={'Authorization': f'Bearer {self.test_user_token}'}
        )
        
        self.log(f"Malformed file response: {malformed_response.status_code}")
        if malformed_response.status_code != 200:
            try:
                error_data = malformed_response.json()
                self.log(f"Malformed file error: {error_data}")
                if 'detail' in error_data:
                    self.log(f"🔍 This could cause 'Erreur lors de la mise à jour': {error_data['detail']}")
            except:
                self.log(f"Malformed file raw error: {malformed_response.text}")

    def test_concurrent_upload_scenario(self):
        """Test concurrent upload scenario that might cause race conditions"""
        self.log("\n🔍 TESTING CONCURRENT UPLOAD SCENARIO")
        self.log("="*50)
        
        if not self.test_user_token:
            self.log("❌ No test user token", "ERROR")
            return
        
        # Simulate rapid successive uploads (like user clicking multiple times)
        self.log("Simulating rapid successive uploads...")
        
        for i in range(3):
            test_file_data = self.create_test_image("JPEG", (200 + i*50, 200 + i*50))
            files = {'file': (f'concurrent_test_{i}.jpg', test_file_data, 'image/jpeg')}
            
            try:
                response = requests.post(
                    f"{self.base_url}/users/profile-photo",
                    files=files,
                    headers={'Authorization': f'Bearer {self.test_user_token}'},
                    timeout=5
                )
                
                self.log(f"Concurrent upload {i+1}: {response.status_code}")
                if response.status_code == 200:
                    data = response.json()
                    self.log(f"   Photo URL: {data.get('photo_url')}")
                else:
                    try:
                        error_data = response.json()
                        self.log(f"   Error: {error_data}")
                    except:
                        self.log(f"   Raw error: {response.text}")
                        
            except Exception as e:
                self.log(f"Concurrent upload {i+1} error: {e}")

    def run_integration_tests(self):
        """Run all integration tests"""
        self.log("🚀 STARTING FRONTEND-BACKEND INTEGRATION TESTS")
        self.log("="*80)
        
        # Setup
        if not self.setup_test_user():
            self.log("❌ Failed to setup test user. Aborting tests.", "ERROR")
            return
        
        # Run tests
        workflow_success = self.simulate_frontend_photo_upload_workflow()
        self.test_error_scenarios_that_cause_update_error()
        self.test_concurrent_upload_scenario()
        
        # Final analysis
        self.log("\n" + "="*80)
        self.log("INTEGRATION TEST ANALYSIS")
        self.log("="*80)
        
        if workflow_success:
            self.log("✅ MAIN WORKFLOW SUCCESSFUL - Backend profile photo system is working correctly")
            self.log("\n🔍 CONCLUSION FOR 'Erreur lors de la mise à jour':")
            self.log("Since the backend workflow is successful, the issue is likely in the FRONTEND:")
            
            self.log("\n💡 MOST LIKELY CAUSES:")
            self.log("1. 🔴 FRONTEND ERROR HANDLING: Frontend not properly catching/displaying backend errors")
            self.log("2. 🔴 JAVASCRIPT EXCEPTION: Unhandled exception in ProfilePhotoUploader component")
            self.log("3. 🔴 AUTHENTICATION ISSUE: Token expiry during upload not handled properly")
            self.log("4. 🔴 NETWORK TIMEOUT: Frontend timeout shorter than backend processing time")
            self.log("5. 🔴 BROWSER COMPATIBILITY: File API issues in specific browsers")
            
            self.log("\n🛠️ DEBUGGING STEPS FOR MAIN AGENT:")
            self.log("1. Check browser console for JavaScript errors during photo upload")
            self.log("2. Add more detailed error logging in ProfilePhotoUploader.js")
            self.log("3. Test with different browsers (Chrome, Firefox, Safari)")
            self.log("4. Verify authentication token is valid during upload")
            self.log("5. Add timeout handling in frontend API calls")
            self.log("6. Test with different image sizes and formats")
            
        else:
            self.log("❌ WORKFLOW FAILED - Backend issues detected")
            self.log("The 'Erreur lors de la mise à jour' is likely caused by backend problems")

if __name__ == "__main__":
    tester = FrontendBackendIntegrationTester()
    tester.run_integration_tests()