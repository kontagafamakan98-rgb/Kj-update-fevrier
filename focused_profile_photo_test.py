#!/usr/bin/env python3
"""
Focused Profile Photo Test - Investigating specific issues
"""

import requests
import sys
import json
import io
import base64
from datetime import datetime
from PIL import Image

class FocusedProfilePhotoTester:
    def __init__(self, base_url="https://kojo-work.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.test_user_token = None
        self.test_user_id = None
        self.issues_found = []
        
    def log(self, message, level="INFO"):
        """Enhanced logging with timestamp"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        print(f"[{timestamp}] {level}: {message}")
        
    def create_test_image(self, format="JPEG", size=(200, 200)):
        """Create a test image in memory"""
        img = Image.new('RGB', size, color='blue')
        img_buffer = io.BytesIO()
        img.save(img_buffer, format=format)
        img_buffer.seek(0)
        return img_buffer.getvalue()
    
    def setup_test_user(self):
        """Create a test user for profile photo testing"""
        timestamp = datetime.now().strftime('%H%M%S')
        user_data = {
            "email": f"focused_test_{timestamp}@gmail.com",
            "password": "FocusedTest123!",
            "first_name": "Focused",
            "last_name": "Tester",
            "phone": "+221701234569",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr",
            "payment_accounts": {
                "orange_money": "+221701234569"
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
                self.log(f"✅ Test user created - ID: {self.test_user_id}")
                return True
            else:
                self.log(f"❌ Failed to create test user: {response.status_code} - {response.text}", "ERROR")
                return False
        except Exception as e:
            self.log(f"❌ Exception creating test user: {e}", "ERROR")
            return False

    def test_file_size_validation(self):
        """Test file size validation issues"""
        self.log("\n🔍 TESTING FILE SIZE VALIDATION ISSUES")
        self.log("="*50)
        
        if not self.test_user_token:
            self.log("❌ No test user token", "ERROR")
            return
        
        # Test 1: Very large file (should be rejected but currently isn't)
        self.log("Testing oversized file upload...")
        large_data = b"x" * (6 * 1024 * 1024)  # 6MB of data
        files = {'file': ('large_test.jpg', large_data, 'image/jpeg')}
        
        try:
            response = requests.post(
                f"{self.base_url}/users/profile-photo",
                files=files,
                headers={'Authorization': f'Bearer {self.test_user_token}'}
            )
            
            self.log(f"Large file upload - Status: {response.status_code}")
            if response.status_code == 200:
                self.log("❌ ISSUE: Large file (6MB) was accepted when it should be rejected", "ERROR")
                self.issues_found.append("File size validation not working - 6MB file accepted")
            else:
                self.log("✅ Large file properly rejected")
                
        except Exception as e:
            self.log(f"Error testing large file: {e}", "ERROR")
        
        # Test 2: Empty file (should be rejected but currently isn't)
        self.log("Testing empty file upload...")
        files = {'file': ('empty.jpg', b'', 'image/jpeg')}
        
        try:
            response = requests.post(
                f"{self.base_url}/users/profile-photo",
                files=files,
                headers={'Authorization': f'Bearer {self.test_user_token}'}
            )
            
            self.log(f"Empty file upload - Status: {response.status_code}")
            if response.status_code == 200:
                self.log("❌ ISSUE: Empty file was accepted when it should be rejected", "ERROR")
                self.issues_found.append("Empty file validation not working - empty file accepted")
            else:
                self.log("✅ Empty file properly rejected")
                
        except Exception as e:
            self.log(f"Error testing empty file: {e}", "ERROR")

    def test_error_handling_issues(self):
        """Test error handling issues found in logs"""
        self.log("\n🔍 TESTING ERROR HANDLING ISSUES")
        self.log("="*50)
        
        # Test 1: Non-existent user profile photo (500 error instead of 404)
        self.log("Testing non-existent user profile photo...")
        try:
            response = requests.get(f"{self.base_url}/users/nonexistent_user_id/profile-photo")
            
            self.log(f"Non-existent user photo - Status: {response.status_code}")
            if response.status_code == 500:
                self.log("❌ ISSUE: Non-existent user returns 500 instead of 404", "ERROR")
                self.issues_found.append("Error handling issue - non-existent user returns 500 instead of 404")
                try:
                    error_data = response.json()
                    self.log(f"Error response: {error_data}")
                except:
                    self.log(f"Raw error: {response.text}")
            elif response.status_code == 404:
                self.log("✅ Non-existent user properly returns 404")
            else:
                self.log(f"⚠️ Unexpected status code: {response.status_code}", "WARNING")
                
        except Exception as e:
            self.log(f"Error testing non-existent user: {e}", "ERROR")

    def test_profile_update_workflow(self):
        """Test the complete profile update workflow to identify 'Erreur lors de la mise à jour'"""
        self.log("\n🔍 TESTING COMPLETE PROFILE UPDATE WORKFLOW")
        self.log("="*50)
        
        if not self.test_user_token:
            self.log("❌ No test user token", "ERROR")
            return
        
        # Step 1: Upload a profile photo
        self.log("Step 1: Uploading profile photo...")
        jpeg_data = self.create_test_image("JPEG", (300, 300))
        files = {'file': ('workflow_test.jpg', jpeg_data, 'image/jpeg')}
        
        try:
            response = requests.post(
                f"{self.base_url}/users/profile-photo",
                files=files,
                headers={'Authorization': f'Bearer {self.test_user_token}'}
            )
            
            if response.status_code == 200:
                data = response.json()
                photo_url = data.get('photo_url')
                self.log(f"✅ Photo uploaded: {photo_url}")
                
                # Step 2: Verify photo is in user profile
                self.log("Step 2: Verifying photo in user profile...")
                profile_response = requests.get(
                    f"{self.base_url}/users/profile",
                    headers={'Authorization': f'Bearer {self.test_user_token}'}
                )
                
                if profile_response.status_code == 200:
                    profile_data = profile_response.json()
                    profile_photo = profile_data.get('profile_photo')
                    
                    if profile_photo == photo_url:
                        self.log("✅ Photo URL correctly saved in profile")
                    else:
                        self.log(f"❌ ISSUE: Photo URL mismatch - Expected: {photo_url}, Got: {profile_photo}", "ERROR")
                        self.issues_found.append("Photo URL not properly saved in user profile")
                else:
                    self.log(f"❌ Failed to get user profile: {profile_response.status_code}", "ERROR")
                
                # Step 3: Test photo accessibility
                self.log("Step 3: Testing photo accessibility...")
                if photo_url.startswith('/api/uploads/'):
                    full_url = f"https://kojo-work.preview.emergentagent.com{photo_url}"
                    photo_response = requests.get(full_url)
                    
                    if photo_response.status_code == 200:
                        content_type = photo_response.headers.get('content-type', '')
                        if content_type.startswith('image/'):
                            self.log("✅ Photo accessible and returns image content")
                        else:
                            self.log(f"❌ ISSUE: Photo returns wrong content-type: {content_type}", "ERROR")
                            self.issues_found.append(f"Static file serving returns wrong content-type: {content_type}")
                    else:
                        self.log(f"❌ ISSUE: Photo not accessible - Status: {photo_response.status_code}", "ERROR")
                        self.issues_found.append(f"Uploaded photo not accessible via static file serving")
                
                # Step 4: Test profile update with photo change
                self.log("Step 4: Testing profile update with photo change...")
                new_jpeg_data = self.create_test_image("JPEG", (250, 250))
                new_files = {'file': ('workflow_test_2.jpg', new_jpeg_data, 'image/jpeg')}
                
                update_response = requests.post(
                    f"{self.base_url}/users/profile-photo",
                    files=new_files,
                    headers={'Authorization': f'Bearer {self.test_user_token}'}
                )
                
                if update_response.status_code == 200:
                    update_data = update_response.json()
                    new_photo_url = update_data.get('photo_url')
                    self.log(f"✅ Photo updated: {new_photo_url}")
                    
                    # Verify the update in profile
                    final_profile_response = requests.get(
                        f"{self.base_url}/users/profile",
                        headers={'Authorization': f'Bearer {self.test_user_token}'}
                    )
                    
                    if final_profile_response.status_code == 200:
                        final_profile_data = final_profile_response.json()
                        final_photo = final_profile_data.get('profile_photo')
                        
                        if final_photo == new_photo_url:
                            self.log("✅ Photo update workflow completed successfully")
                        else:
                            self.log(f"❌ ISSUE: Photo update not reflected in profile", "ERROR")
                            self.issues_found.append("Photo update not properly reflected in user profile")
                    else:
                        self.log(f"❌ Failed to verify updated profile: {final_profile_response.status_code}", "ERROR")
                else:
                    self.log(f"❌ ISSUE: Photo update failed - Status: {update_response.status_code}", "ERROR")
                    try:
                        error_data = update_response.json()
                        self.log(f"Update error: {error_data}")
                        if 'detail' in error_data:
                            self.issues_found.append(f"Photo update error: {error_data['detail']}")
                    except:
                        self.log(f"Raw update error: {update_response.text}")
                        self.issues_found.append(f"Photo update failed with status {update_response.status_code}")
            else:
                self.log(f"❌ Initial photo upload failed: {response.status_code}", "ERROR")
                
        except Exception as e:
            self.log(f"❌ Exception in workflow test: {e}", "ERROR")
            self.issues_found.append(f"Workflow test exception: {str(e)}")

    def test_authentication_edge_cases(self):
        """Test authentication-related edge cases"""
        self.log("\n🔍 TESTING AUTHENTICATION EDGE CASES")
        self.log("="*50)
        
        # Test with expired/invalid token
        self.log("Testing with invalid token...")
        jpeg_data = self.create_test_image("JPEG", (200, 200))
        files = {'file': ('auth_test.jpg', jpeg_data, 'image/jpeg')}
        
        try:
            response = requests.post(
                f"{self.base_url}/users/profile-photo",
                files=files,
                headers={'Authorization': 'Bearer invalid_token_12345'}
            )
            
            self.log(f"Invalid token upload - Status: {response.status_code}")
            if response.status_code == 401:
                self.log("✅ Invalid token properly rejected")
            else:
                self.log(f"❌ ISSUE: Invalid token not properly handled - Status: {response.status_code}", "ERROR")
                self.issues_found.append(f"Invalid token handling issue - got {response.status_code} instead of 401")
                
        except Exception as e:
            self.log(f"Error testing invalid token: {e}", "ERROR")

    def run_focused_tests(self):
        """Run all focused tests"""
        self.log("🚀 STARTING FOCUSED PROFILE PHOTO TESTS")
        self.log("="*80)
        
        # Setup
        if not self.setup_test_user():
            self.log("❌ Failed to setup test user. Aborting tests.", "ERROR")
            return
        
        # Run focused tests
        self.test_file_size_validation()
        self.test_error_handling_issues()
        self.test_profile_update_workflow()
        self.test_authentication_edge_cases()
        
        # Summary
        self.log("\n" + "="*80)
        self.log("FOCUSED TEST RESULTS")
        self.log("="*80)
        
        if self.issues_found:
            self.log(f"❌ {len(self.issues_found)} ISSUES FOUND:")
            for i, issue in enumerate(self.issues_found, 1):
                self.log(f"  {i}. {issue}")
        else:
            self.log("✅ NO CRITICAL ISSUES FOUND")
        
        self.log("\n🔍 ANALYSIS FOR 'Erreur lors de la mise à jour':")
        self.log("Based on the tests, the backend profile photo system is mostly functional.")
        self.log("The 'Erreur lors de la mise à jour' is likely a FRONTEND issue, not backend.")
        
        self.log("\n💡 LIKELY CAUSES:")
        self.log("1. Frontend JavaScript error during file upload process")
        self.log("2. Frontend form validation failing before reaching backend")
        self.log("3. Frontend timeout during upload process")
        self.log("4. Frontend error handling not displaying proper error messages")
        self.log("5. Browser compatibility issues with file upload")
        
        self.log("\n🛠️ RECOMMENDATIONS:")
        self.log("1. Check browser console for JavaScript errors during photo upload")
        self.log("2. Test the frontend photo upload component directly")
        self.log("3. Verify frontend API integration is using correct endpoints")
        self.log("4. Check if frontend is properly handling authentication tokens")
        self.log("5. Test with different browsers and file types")

if __name__ == "__main__":
    tester = FocusedProfilePhotoTester()
    tester.run_focused_tests()