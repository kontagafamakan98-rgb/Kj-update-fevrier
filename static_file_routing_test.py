#!/usr/bin/env python3
"""
Static File Routing Fix Test for Profile Photos
==============================================
Focus: Testing the fix that moved static file serving from /uploads to /api/uploads
to match Kubernetes ingress routing that routes /api/* requests to backend port 8001.

Key Test Areas:
1. Profile photo upload with /api/uploads prefix in URLs
2. Static file serving returns actual image content (not HTML)
3. Complete upload-to-display workflow
4. Various image formats (JPG, PNG, WEBP)
5. Authentication and validation
"""

import requests
import sys
import json
import io
import os
from datetime import datetime
from pathlib import Path

class StaticFileRoutingTester:
    def __init__(self, base_url="https://kojo-service-hub.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.token = None
        self.user_id = None
        self.tests_run = 0
        self.tests_passed = 0
        self.uploaded_photos = []

    def log_test(self, name, success, details=""):
        """Log test results with clear formatting"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name}")
            if details:
                print(f"   📋 {details}")
        else:
            print(f"❌ {name}")
            if details:
                print(f"   ⚠️  {details}")

    def create_test_image(self, format="jpg", size_kb=500):
        """Create a realistic test image file"""
        if format == "jpg":
            # Minimal valid JPEG
            jpeg_data = (
                b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00H\x00H\x00\x00'
                b'\xff\xc0\x00\x11\x08\x00\x01\x00\x01\x01\x01\x11\x00\x02\x11\x01\x03\x11\x01'
                b'\xff\xc4\x00\x14\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x08'
                b'\xff\xc4\x00\x14\x10\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00'
                b'\xff\xda\x00\x0c\x03\x01\x00\x02\x11\x03\x11\x00\x3f\x00'
            )
            # Pad to desired size
            padding = b'\x00' * (size_kb * 1024 - len(jpeg_data) - 2)
            return jpeg_data + padding + b'\xff\xd9', "image/jpeg", "test_photo.jpg"
        
        elif format == "png":
            # Minimal valid PNG (1x1 pixel)
            png_data = (
                b'\x89PNG\r\n\x1a\n'
                b'\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde'
                b'\x00\x00\x00\x0cIDATx\x9cc\xf8\x00\x00\x00\x01\x00\x01\x00\x00\x00\x00'
                b'\x00\x00\x00\x00IEND\xaeB`\x82'
            )
            # Pad to desired size
            padding = b'\x00' * (size_kb * 1024 - len(png_data))
            return png_data + padding, "image/png", "test_photo.png"
        
        elif format == "webp":
            # Minimal valid WebP
            webp_data = b'RIFF\x1a\x00\x00\x00WEBPVP8 \x0e\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00'
            # Pad to desired size
            padding = b'\x00' * (size_kb * 1024 - len(webp_data))
            return webp_data + padding, "image/webp", "test_photo.webp"

    def authenticate_user(self):
        """Create and authenticate a test user for photo testing"""
        print("\n🔐 Setting up test user authentication...")
        
        timestamp = int(datetime.now().timestamp())
        user_data = {
            "email": f"statictest_{timestamp}@kojo.test",
            "password": "StaticTest2024!",
            "first_name": "Static",
            "last_name": "Tester",
            "phone": f"+221{70 + (timestamp % 30)}{str(timestamp)[-6:]}",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr",
            "payment_accounts": {
                "orange_money": f"+221{70 + (timestamp % 30)}{str(timestamp)[-6:]}"
            }
        }
        
        try:
            response = requests.post(f"{self.base_url}/auth/register-verified", json=user_data)
            if response.status_code == 200:
                data = response.json()
                self.token = data["access_token"]
                self.user_id = data["user"]["id"]
                self.log_test("User authentication", True, f"User ID: {self.user_id}")
                return True
            else:
                self.log_test("User authentication", False, f"Status: {response.status_code}")
                return False
        except Exception as e:
            self.log_test("User authentication", False, f"Error: {str(e)}")
            return False

    def test_photo_upload_with_api_prefix(self):
        """Test that photo upload returns URLs with /api/uploads prefix"""
        print("\n📸 Testing Photo Upload with /api/uploads Prefix...")
        
        if not self.token:
            return None

        try:
            # Create test image
            image_data, content_type, filename = self.create_test_image("jpg", 800)  # 800KB
            files = {'file': (filename, io.BytesIO(image_data), content_type)}
            headers = {'Authorization': f'Bearer {self.token}'}
            
            response = requests.post(f"{self.base_url}/users/profile-photo", files=files, headers=headers)
            
            if response.status_code == 200:
                data = response.json()
                photo_url = data.get("photo_url")
                filename_returned = data.get("filename")
                
                # Check if URL has correct /api/uploads prefix
                if photo_url and photo_url.startswith("/api/uploads/profile_photos/"):
                    self.uploaded_photos.append(photo_url)
                    self.log_test("Photo upload with /api/uploads prefix", True, 
                                f"URL: {photo_url}, Filename: {filename_returned}")
                    return photo_url
                else:
                    self.log_test("Photo upload with /api/uploads prefix", False, 
                                f"Wrong URL prefix: {photo_url}")
                    return None
            else:
                self.log_test("Photo upload with /api/uploads prefix", False, 
                            f"Status: {response.status_code}, Response: {response.text}")
                return None
        except Exception as e:
            self.log_test("Photo upload with /api/uploads prefix", False, f"Error: {str(e)}")
            return None

    def test_static_file_serving_returns_image(self, photo_url):
        """Test that static file URLs return actual image content, not HTML"""
        print("\n🌐 Testing Static File Serving Returns Image Content...")
        
        if not photo_url:
            self.log_test("Static file serving setup", False, "No photo URL provided")
            return False

        # Construct full URL
        full_url = f"https://kojo-service-hub.preview.emergentagent.com{photo_url}"
        
        try:
            response = requests.get(full_url, timeout=10)
            content_type = response.headers.get('content-type', '').lower()
            content_length = len(response.content)
            
            if response.status_code == 200:
                if 'image/' in content_type:
                    self.log_test("Static file serving returns image", True, 
                                f"Content-Type: {content_type}, Size: {content_length} bytes")
                    return True
                elif 'text/html' in content_type:
                    self.log_test("Static file serving returns image", False, 
                                "❌ CRITICAL: Got HTML instead of image - Kubernetes routing issue not fixed!")
                    return False
                else:
                    self.log_test("Static file serving returns image", False, 
                                f"Unexpected content type: {content_type}")
                    return False
            else:
                self.log_test("Static file serving returns image", False, 
                            f"HTTP {response.status_code}: {response.text[:200]}")
                return False
        except Exception as e:
            self.log_test("Static file serving returns image", False, f"Error: {str(e)}")
            return False

    def test_multiple_image_formats(self):
        """Test uploading and serving different image formats"""
        print("\n🎨 Testing Multiple Image Formats...")
        
        if not self.token:
            return False

        formats = [("jpg", "JPEG"), ("png", "PNG"), ("webp", "WebP")]
        headers = {'Authorization': f'Bearer {self.token}'}
        
        for format_ext, format_name in formats:
            try:
                image_data, content_type, filename = self.create_test_image(format_ext, 600)
                files = {'file': (filename, io.BytesIO(image_data), content_type)}
                
                response = requests.post(f"{self.base_url}/users/profile-photo", files=files, headers=headers)
                
                if response.status_code == 200:
                    data = response.json()
                    photo_url = data.get("photo_url")
                    
                    if photo_url and photo_url.startswith("/api/uploads/profile_photos/"):
                        # Test static file serving for this format
                        full_url = f"https://kojo-service-hub.preview.emergentagent.com{photo_url}"
                        static_response = requests.get(full_url, timeout=5)
                        
                        if static_response.status_code == 200 and 'image/' in static_response.headers.get('content-type', ''):
                            self.log_test(f"{format_name} upload and serving", True, 
                                        f"URL: {photo_url}")
                        else:
                            self.log_test(f"{format_name} upload and serving", False, 
                                        f"Static serving failed for {format_name}")
                    else:
                        self.log_test(f"{format_name} upload and serving", False, 
                                    f"Invalid URL: {photo_url}")
                else:
                    self.log_test(f"{format_name} upload and serving", False, 
                                f"Upload failed: {response.status_code}")
            except Exception as e:
                self.log_test(f"{format_name} upload and serving", False, f"Error: {str(e)}")

    def test_file_storage_location(self):
        """Test that files are stored in correct backend location"""
        print("\n📁 Testing File Storage Location...")
        
        # This test checks if files are being stored in the backend uploads directory
        # We can't directly access the filesystem, but we can infer from successful uploads
        
        if not self.token:
            return False

        try:
            image_data, content_type, filename = self.create_test_image("jpg", 400)
            files = {'file': (filename, io.BytesIO(image_data), content_type)}
            headers = {'Authorization': f'Bearer {self.token}'}
            
            response = requests.post(f"{self.base_url}/users/profile-photo", files=files, headers=headers)
            
            if response.status_code == 200:
                data = response.json()
                photo_url = data.get("photo_url")
                filename_returned = data.get("filename")
                
                # Check filename format includes user_id and timestamp
                if filename_returned and self.user_id in filename_returned:
                    self.log_test("File storage location", True, 
                                f"File stored with correct naming: {filename_returned}")
                    return True
                else:
                    self.log_test("File storage location", False, 
                                f"Unexpected filename format: {filename_returned}")
                    return False
            else:
                self.log_test("File storage location", False, f"Upload failed: {response.status_code}")
                return False
        except Exception as e:
            self.log_test("File storage location", False, f"Error: {str(e)}")
            return False

    def test_user_profile_photo_url_update(self):
        """Test that user profile is updated with new photo URL"""
        print("\n👤 Testing User Profile Photo URL Update...")
        
        if not self.token:
            return False

        try:
            headers = {'Authorization': f'Bearer {self.token}'}
            response = requests.get(f"{self.base_url}/users/profile", headers=headers)
            
            if response.status_code == 200:
                data = response.json()
                profile_photo = data.get("profile_photo")
                
                if profile_photo and profile_photo.startswith("/api/uploads/profile_photos/"):
                    self.log_test("User profile photo URL update", True, 
                                f"Profile photo URL: {profile_photo}")
                    return True
                elif profile_photo is None:
                    self.log_test("User profile photo URL update", True, 
                                "No profile photo (expected if none uploaded)")
                    return True
                else:
                    self.log_test("User profile photo URL update", False, 
                                f"Invalid profile photo URL: {profile_photo}")
                    return False
            else:
                self.log_test("User profile photo URL update", False, 
                            f"Profile fetch failed: {response.status_code}")
                return False
        except Exception as e:
            self.log_test("User profile photo URL update", False, f"Error: {str(e)}")
            return False

    def test_authentication_and_validation(self):
        """Test authentication requirements and file validation"""
        print("\n🔒 Testing Authentication and Validation...")
        
        # Test 1: Upload without authentication
        try:
            image_data, content_type, filename = self.create_test_image("jpg", 400)
            files = {'file': (filename, io.BytesIO(image_data), content_type)}
            
            response = requests.post(f"{self.base_url}/users/profile-photo", files=files)
            
            if response.status_code == 403:
                self.log_test("Authentication requirement", True, "Unauthenticated upload rejected")
            else:
                self.log_test("Authentication requirement", False, f"Status: {response.status_code}")
        except Exception as e:
            self.log_test("Authentication requirement", False, f"Error: {str(e)}")

        # Test 2: File size limit (5MB+)
        if self.token:
            try:
                large_image_data, content_type, filename = self.create_test_image("jpg", 6000)  # 6MB
                files = {'file': (filename, io.BytesIO(large_image_data), content_type)}
                headers = {'Authorization': f'Bearer {self.token}'}
                
                response = requests.post(f"{self.base_url}/users/profile-photo", files=files, headers=headers)
                
                if response.status_code == 400:
                    self.log_test("File size validation (6MB)", True, "Large file rejected")
                else:
                    self.log_test("File size validation (6MB)", False, f"Status: {response.status_code}")
            except Exception as e:
                self.log_test("File size validation (6MB)", False, f"Error: {str(e)}")

        # Test 3: Non-image file
        if self.token:
            try:
                text_data = b"This is not an image file, it's just text content"
                files = {'file': ("document.txt", io.BytesIO(text_data), "text/plain")}
                headers = {'Authorization': f'Bearer {self.token}'}
                
                response = requests.post(f"{self.base_url}/users/profile-photo", files=files, headers=headers)
                
                if response.status_code == 400:
                    self.log_test("File type validation", True, "Non-image file rejected")
                else:
                    self.log_test("File type validation", False, f"Status: {response.status_code}")
            except Exception as e:
                self.log_test("File type validation", False, f"Error: {str(e)}")

    def test_complete_upload_to_display_workflow(self):
        """Test the complete workflow from upload to display"""
        print("\n🔄 Testing Complete Upload-to-Display Workflow...")
        
        workflow_success = True
        
        # Step 1: Upload photo
        photo_url = self.test_photo_upload_with_api_prefix()
        if not photo_url:
            workflow_success = False
        
        # Step 2: Verify photo URL in user profile
        if not self.test_user_profile_photo_url_update():
            workflow_success = False
        
        # Step 3: Test static file serving
        if photo_url and not self.test_static_file_serving_returns_image(photo_url):
            workflow_success = False
        
        # Step 4: Test file storage
        if not self.test_file_storage_location():
            workflow_success = False
        
        if workflow_success:
            self.log_test("Complete upload-to-display workflow", True, 
                        "All workflow steps completed successfully")
        else:
            self.log_test("Complete upload-to-display workflow", False, 
                        "One or more workflow steps failed")
        
        return workflow_success

    def run_all_tests(self):
        """Run comprehensive static file routing tests"""
        print("🚀 Starting Static File Routing Fix Tests")
        print("=" * 70)
        print("🎯 Focus: Testing /uploads → /api/uploads routing fix")
        print("🔍 Verifying Kubernetes ingress routes /api/* to backend correctly")
        print("=" * 70)
        
        # Setup
        if not self.authenticate_user():
            print("\n❌ Authentication failed - cannot continue")
            return False

        # Core routing tests
        photo_url = self.test_photo_upload_with_api_prefix()
        if photo_url:
            self.test_static_file_serving_returns_image(photo_url)
        
        # Additional tests
        self.test_user_profile_photo_url_update()
        self.test_file_storage_location()
        self.test_multiple_image_formats()
        self.test_authentication_and_validation()
        
        # Complete workflow test
        self.test_complete_upload_to_display_workflow()

        # Results summary
        print("\n" + "=" * 70)
        print(f"📊 Test Results: {self.tests_passed}/{self.tests_run} tests passed")
        success_rate = (self.tests_passed / self.tests_run * 100) if self.tests_run > 0 else 0
        print(f"📈 Success Rate: {success_rate:.1f}%")
        
        # Critical assessment
        if success_rate >= 90:
            print("✅ Static file routing fix is working correctly!")
            print("🎉 Photos should now display properly in frontend")
        elif success_rate >= 70:
            print("⚠️  Static file routing has some issues but core functionality works")
        else:
            print("❌ Static file routing fix has significant problems")
            print("🔧 Kubernetes ingress routing may still need adjustment")
        
        return success_rate >= 70

if __name__ == "__main__":
    tester = StaticFileRoutingTester()
    success = tester.run_all_tests()
    sys.exit(0 if success else 1)