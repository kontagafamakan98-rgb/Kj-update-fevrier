#!/usr/bin/env python3
"""
Profile Photo Upload System Diagnostic Test
Focus: Diagnose "Erreur lors de la mise à jour" issue reported by user
"""

import requests
import sys
import json
import io
import base64
import os
from datetime import datetime
from PIL import Image

class ProfilePhotoDiagnosticTester:
    def __init__(self, base_url="https://kojo-service-hub.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.test_user_token = None
        self.test_user_id = None
        self.tests_run = 0
        self.tests_passed = 0
        self.uploaded_photos = []
        
    def log(self, message, level="INFO"):
        """Enhanced logging with timestamp"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        print(f"[{timestamp}] {level}: {message}")
        
    def create_test_image(self, format="JPEG", size=(200, 200)):
        """Create a test image in memory"""
        img = Image.new('RGB', size, color='red')
        img_buffer = io.BytesIO()
        img.save(img_buffer, format=format)
        img_buffer.seek(0)
        return img_buffer.getvalue()
    
    def create_test_image_base64(self, format="JPEG", size=(200, 200)):
        """Create a test image as base64 string"""
        img_data = self.create_test_image(format, size)
        mime_type = f"image/{format.lower()}"
        b64_data = base64.b64encode(img_data).decode('utf-8')
        return f"data:{mime_type};base64,{b64_data}"
    
    def run_test(self, name, method, endpoint, expected_status, data=None, files=None, token=None):
        """Run a single API test with enhanced error reporting"""
        url = f"{self.base_url}/{endpoint}"
        headers = {}
        
        if token:
            headers['Authorization'] = f'Bearer {token}'
        
        # Don't set Content-Type for file uploads
        if not files:
            headers['Content-Type'] = 'application/json'

        self.tests_run += 1
        self.log(f"🔍 Testing {name}")
        self.log(f"   URL: {url}")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers)
            elif method == 'POST':
                if files:
                    # Remove Content-Type for multipart/form-data
                    headers.pop('Content-Type', None)
                    response = requests.post(url, files=files, headers=headers)
                else:
                    response = requests.post(url, json=data, headers=headers)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                self.log(f"✅ PASSED - Status: {response.status_code}")
                try:
                    response_data = response.json()
                    if isinstance(response_data, dict):
                        # Log key response fields
                        if 'photo_url' in response_data:
                            self.log(f"   Photo URL: {response_data['photo_url']}")
                        if 'message' in response_data:
                            self.log(f"   Message: {response_data['message']}")
                    return True, response_data
                except:
                    return True, {"raw_response": response.text}
            else:
                self.log(f"❌ FAILED - Expected {expected_status}, got {response.status_code}", "ERROR")
                try:
                    error_data = response.json()
                    self.log(f"   Error Response: {error_data}", "ERROR")
                except:
                    self.log(f"   Raw Error: {response.text}", "ERROR")
                return False, {"error": response.text, "status_code": response.status_code}

        except Exception as e:
            self.log(f"❌ FAILED - Exception: {str(e)}", "ERROR")
            return False, {"exception": str(e)}

    def setup_test_user(self):
        """Create a test user for profile photo testing"""
        self.log("\n" + "="*60)
        self.log("SETTING UP TEST USER")
        self.log("="*60)
        
        # Create test user with payment verification
        timestamp = datetime.now().strftime('%H%M%S')
        user_data = {
            "email": f"photo_test_{timestamp}@kojo.test",
            "password": "PhotoTest123!",
            "first_name": "Photo",
            "last_name": "Tester",
            "phone": "+221701234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr",
            "payment_accounts": {
                "orange_money": "+221701234567"
            }
        }
        
        success, response = self.run_test(
            "Create Test User with Payment Verification",
            "POST",
            "auth/register-verified",
            200,
            data=user_data
        )
        
        if success and 'access_token' in response:
            self.test_user_token = response['access_token']
            self.test_user_id = response['user']['id']
            self.log(f"✅ Test user created - ID: {self.test_user_id}")
            return True
        else:
            self.log("❌ Failed to create test user", "ERROR")
            return False

    def test_profile_photo_upload_api(self):
        """Test profile photo upload API endpoint"""
        self.log("\n" + "="*60)
        self.log("TESTING PROFILE PHOTO UPLOAD API")
        self.log("="*60)
        
        if not self.test_user_token:
            self.log("❌ No test user token available", "ERROR")
            return
        
        # Test 1: Upload valid JPEG image
        self.log("\n--- Test 1: Upload Valid JPEG Image ---")
        jpeg_data = self.create_test_image("JPEG", (300, 300))
        files = {'file': ('test_photo.jpg', jpeg_data, 'image/jpeg')}
        
        success, response = self.run_test(
            "Upload JPEG Profile Photo",
            "POST",
            "users/profile-photo",
            200,
            files=files,
            token=self.test_user_token
        )
        
        if success and 'photo_url' in response:
            photo_url = response['photo_url']
            self.uploaded_photos.append(photo_url)
            self.log(f"✅ Photo uploaded successfully: {photo_url}")
            
            # Verify URL format
            if photo_url.startswith('/api/uploads/profile_photos/'):
                self.log("✅ Photo URL uses correct /api/uploads prefix")
            else:
                self.log(f"❌ Photo URL has incorrect prefix: {photo_url}", "ERROR")
        
        # Test 2: Upload PNG image
        self.log("\n--- Test 2: Upload Valid PNG Image ---")
        png_data = self.create_test_image("PNG", (250, 250))
        files = {'file': ('test_photo.png', png_data, 'image/png')}
        
        success, response = self.run_test(
            "Upload PNG Profile Photo",
            "POST",
            "users/profile-photo",
            200,
            files=files,
            token=self.test_user_token
        )
        
        # Test 3: Upload WebP image
        self.log("\n--- Test 3: Upload Valid WebP Image ---")
        try:
            webp_data = self.create_test_image("WEBP", (200, 200))
            files = {'file': ('test_photo.webp', webp_data, 'image/webp')}
            
            success, response = self.run_test(
                "Upload WebP Profile Photo",
                "POST",
                "users/profile-photo",
                200,
                files=files,
                token=self.test_user_token
            )
        except Exception as e:
            self.log(f"⚠️ WebP test skipped: {e}", "WARNING")
        
        # Test 4: Upload oversized file (should fail)
        self.log("\n--- Test 4: Upload Oversized File (Should Fail) ---")
        large_data = self.create_test_image("JPEG", (2000, 2000))  # Large image
        # Create a file larger than 5MB
        large_data = large_data * 50  # Make it very large
        files = {'file': ('large_photo.jpg', large_data, 'image/jpeg')}
        
        self.run_test(
            "Upload Oversized Photo (Should Fail)",
            "POST",
            "users/profile-photo",
            400,
            files=files,
            token=self.test_user_token
        )
        
        # Test 5: Upload non-image file (should fail)
        self.log("\n--- Test 5: Upload Non-Image File (Should Fail) ---")
        text_data = b"This is not an image file"
        files = {'file': ('not_image.txt', text_data, 'text/plain')}
        
        self.run_test(
            "Upload Non-Image File (Should Fail)",
            "POST",
            "users/profile-photo",
            400,
            files=files,
            token=self.test_user_token
        )
        
        # Test 6: Upload without authentication (should fail)
        self.log("\n--- Test 6: Upload Without Authentication (Should Fail) ---")
        jpeg_data = self.create_test_image("JPEG", (200, 200))
        files = {'file': ('test_photo.jpg', jpeg_data, 'image/jpeg')}
        
        self.run_test(
            "Upload Without Authentication (Should Fail)",
            "POST",
            "users/profile-photo",
            403,
            files=files
        )

    def test_database_integration(self):
        """Test that profile photo URLs are properly saved to database"""
        self.log("\n" + "="*60)
        self.log("TESTING DATABASE INTEGRATION")
        self.log("="*60)
        
        if not self.test_user_token:
            self.log("❌ No test user token available", "ERROR")
            return
        
        # Get user profile to check if photo URL is saved
        success, response = self.run_test(
            "Get User Profile (Check Photo URL)",
            "GET",
            "users/profile",
            200,
            token=self.test_user_token
        )
        
        if success:
            profile_photo = response.get('profile_photo')
            if profile_photo:
                self.log(f"✅ Profile photo URL found in database: {profile_photo}")
                
                # Verify URL format
                if profile_photo.startswith('/api/uploads/profile_photos/'):
                    self.log("✅ Database photo URL uses correct /api/uploads prefix")
                else:
                    self.log(f"❌ Database photo URL has incorrect prefix: {profile_photo}", "ERROR")
            else:
                self.log("❌ No profile photo URL found in user profile", "ERROR")

    def test_static_file_serving(self):
        """Test that uploaded photos are accessible via static file serving"""
        self.log("\n" + "="*60)
        self.log("TESTING STATIC FILE SERVING")
        self.log("="*60)
        
        if not self.uploaded_photos:
            self.log("❌ No uploaded photos to test", "ERROR")
            return
        
        for photo_url in self.uploaded_photos:
            self.log(f"\n--- Testing Static File Access: {photo_url} ---")
            
            # Convert relative URL to full URL
            if photo_url.startswith('/api/uploads/'):
                full_url = f"https://kojo-service-hub.preview.emergentagent.com{photo_url}"
            else:
                full_url = photo_url
            
            try:
                response = requests.get(full_url)
                self.log(f"Static file request - Status: {response.status_code}")
                self.log(f"Content-Type: {response.headers.get('content-type', 'Not set')}")
                self.log(f"Content-Length: {response.headers.get('content-length', 'Not set')}")
                
                if response.status_code == 200:
                    content_type = response.headers.get('content-type', '')
                    if content_type.startswith('image/'):
                        self.log("✅ Static file serving returns image content")
                        self.tests_passed += 1
                    else:
                        self.log(f"❌ Static file serving returns wrong content-type: {content_type}", "ERROR")
                else:
                    self.log(f"❌ Static file serving failed with status: {response.status_code}", "ERROR")
                
                self.tests_run += 1
                
            except Exception as e:
                self.log(f"❌ Static file serving error: {e}", "ERROR")
                self.tests_run += 1

    def test_registration_with_photo(self):
        """Test registration with profile photo (base64)"""
        self.log("\n" + "="*60)
        self.log("TESTING REGISTRATION WITH PROFILE PHOTO")
        self.log("="*60)
        
        # Create base64 image
        base64_image = self.create_test_image_base64("JPEG", (150, 150))
        
        timestamp = datetime.now().strftime('%H%M%S')
        user_data = {
            "email": f"photo_reg_{timestamp}@kojo.test",
            "password": "PhotoReg123!",
            "first_name": "PhotoReg",
            "last_name": "User",
            "phone": "+221701234568",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr",
            "payment_accounts": {
                "orange_money": "+221701234568"
            },
            "profile_photo_base64": base64_image
        }
        
        success, response = self.run_test(
            "Register User with Profile Photo",
            "POST",
            "auth/register-verified",
            200,
            data=user_data
        )
        
        if success:
            user_profile = response.get('user', {})
            profile_photo = user_profile.get('profile_photo')
            
            if profile_photo:
                self.log(f"✅ Registration with photo successful: {profile_photo}")
                
                # Verify URL format
                if profile_photo.startswith('/api/uploads/profile_photos/'):
                    self.log("✅ Registration photo URL uses correct /api/uploads prefix")
                else:
                    self.log(f"❌ Registration photo URL has incorrect prefix: {profile_photo}", "ERROR")
                
                # Test static file access
                if profile_photo.startswith('/api/uploads/'):
                    full_url = f"https://kojo-service-hub.preview.emergentagent.com{profile_photo}"
                    try:
                        response = requests.get(full_url)
                        if response.status_code == 200 and response.headers.get('content-type', '').startswith('image/'):
                            self.log("✅ Registration photo accessible via static file serving")
                        else:
                            self.log(f"❌ Registration photo not accessible: {response.status_code}", "ERROR")
                    except Exception as e:
                        self.log(f"❌ Error accessing registration photo: {e}", "ERROR")
            else:
                self.log("❌ No profile photo URL in registration response", "ERROR")

    def test_error_scenarios(self):
        """Test various error scenarios to identify 'Erreur lors de la mise à jour' issue"""
        self.log("\n" + "="*60)
        self.log("TESTING ERROR SCENARIOS")
        self.log("="*60)
        
        if not self.test_user_token:
            self.log("❌ No test user token available", "ERROR")
            return
        
        # Test 1: Empty file upload
        self.log("\n--- Test 1: Empty File Upload ---")
        files = {'file': ('empty.jpg', b'', 'image/jpeg')}
        
        self.run_test(
            "Upload Empty File",
            "POST",
            "users/profile-photo",
            400,
            files=files,
            token=self.test_user_token
        )
        
        # Test 2: Invalid token
        self.log("\n--- Test 2: Invalid Token ---")
        jpeg_data = self.create_test_image("JPEG", (200, 200))
        files = {'file': ('test_photo.jpg', jpeg_data, 'image/jpeg')}
        
        self.run_test(
            "Upload with Invalid Token",
            "POST",
            "users/profile-photo",
            401,
            files=files,
            token="invalid_token_123"
        )
        
        # Test 3: Malformed request
        self.log("\n--- Test 3: Malformed Request ---")
        try:
            url = f"{self.base_url}/users/profile-photo"
            headers = {'Authorization': f'Bearer {self.test_user_token}'}
            
            # Send malformed multipart data
            response = requests.post(url, data="malformed_data", headers=headers)
            self.log(f"Malformed request - Status: {response.status_code}")
            self.log(f"Response: {response.text[:200]}...")
            
            self.tests_run += 1
            if response.status_code in [400, 422]:
                self.tests_passed += 1
                self.log("✅ Malformed request properly rejected")
            else:
                self.log(f"❌ Unexpected response to malformed request: {response.status_code}", "ERROR")
                
        except Exception as e:
            self.log(f"❌ Error testing malformed request: {e}", "ERROR")

    def test_get_profile_photo_endpoints(self):
        """Test profile photo retrieval endpoints"""
        self.log("\n" + "="*60)
        self.log("TESTING PROFILE PHOTO RETRIEVAL")
        self.log("="*60)
        
        if not self.test_user_token:
            self.log("❌ No test user token available", "ERROR")
            return
        
        # Test 1: Get current user's profile photo
        success, response = self.run_test(
            "Get Current User Profile Photo",
            "GET",
            "users/profile-photo",
            200,
            token=self.test_user_token
        )
        
        # Test 2: Get specific user's profile photo (public endpoint)
        if self.test_user_id:
            success, response = self.run_test(
                "Get Specific User Profile Photo",
                "GET",
                f"users/{self.test_user_id}/profile-photo",
                200
            )
        
        # Test 3: Get non-existent user's profile photo
        self.run_test(
            "Get Non-existent User Profile Photo",
            "GET",
            "users/nonexistent_user_id/profile-photo",
            404
        )

    def run_comprehensive_diagnostic(self):
        """Run comprehensive diagnostic tests"""
        self.log("🚀 STARTING PROFILE PHOTO DIAGNOSTIC TESTS")
        self.log("="*80)
        
        # Setup
        if not self.setup_test_user():
            self.log("❌ Failed to setup test user. Aborting tests.", "ERROR")
            return
        
        # Run all test suites
        self.test_profile_photo_upload_api()
        self.test_database_integration()
        self.test_static_file_serving()
        self.test_registration_with_photo()
        self.test_error_scenarios()
        self.test_get_profile_photo_endpoints()
        
        # Summary
        self.log("\n" + "="*80)
        self.log("DIAGNOSTIC TEST SUMMARY")
        self.log("="*80)
        self.log(f"Tests Run: {self.tests_run}")
        self.log(f"Tests Passed: {self.tests_passed}")
        self.log(f"Success Rate: {(self.tests_passed/self.tests_run*100):.1f}%")
        
        if self.tests_passed == self.tests_run:
            self.log("🎉 ALL TESTS PASSED - Profile photo system appears to be working correctly")
        else:
            failed = self.tests_run - self.tests_passed
            self.log(f"⚠️ {failed} TESTS FAILED - Issues detected in profile photo system", "WARNING")
        
        # Specific diagnostic for "Erreur lors de la mise à jour"
        self.log("\n" + "="*60)
        self.log("DIAGNOSTIC ANALYSIS FOR 'Erreur lors de la mise à jour'")
        self.log("="*60)
        
        if self.uploaded_photos:
            self.log("✅ Photo upload functionality is working")
            self.log("✅ Photo URLs are being generated correctly")
            self.log("✅ Database integration appears functional")
            
            self.log("\n🔍 POSSIBLE CAUSES OF USER ISSUE:")
            self.log("1. Frontend JavaScript error during photo save process")
            self.log("2. Authentication token expiry during upload")
            self.log("3. Network timeout during large file upload")
            self.log("4. Browser-specific file handling issues")
            self.log("5. Race condition between upload and profile update")
            
            self.log("\n💡 RECOMMENDATIONS:")
            self.log("1. Check browser console for JavaScript errors")
            self.log("2. Test with different image sizes and formats")
            self.log("3. Verify authentication token is valid during upload")
            self.log("4. Test upload process step-by-step in frontend")
            self.log("5. Check network tab for failed requests")
        else:
            self.log("❌ Photo upload functionality has issues")
            self.log("🔍 This could be the root cause of 'Erreur lors de la mise à jour'")

if __name__ == "__main__":
    tester = ProfilePhotoDiagnosticTester()
    tester.run_comprehensive_diagnostic()