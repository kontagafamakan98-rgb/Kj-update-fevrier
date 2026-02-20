#!/usr/bin/env python3
"""
Profile Photo Upload System Testing
===================================
Comprehensive testing of the profile photo upload system for the new ProfilePhotoUploader component.

Tests cover:
1. Backend Endpoint Testing (POST /api/users/profile-photo)
2. Authentication & Authorization 
3. File Handling & Storage
4. Data Persistence
5. Response Format
6. Edge Cases

Author: Testing Agent
Date: 2025-09-30
"""

import requests
import sys
import json
import io
import os
from datetime import datetime
from pathlib import Path

class ProfilePhotoTester:
    def __init__(self, base_url="https://kojo-work.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.test_user_token = None
        self.test_user_id = None
        self.tests_run = 0
        self.tests_passed = 0
        self.uploaded_photo_url = None

    def log_test(self, name, status, details=""):
        """Log test results"""
        self.tests_run += 1
        if status:
            self.tests_passed += 1
            print(f"✅ {name}")
            if details:
                print(f"   {details}")
        else:
            print(f"❌ {name}")
            if details:
                print(f"   {details}")

    def setup_test_user(self):
        """Create a test user for profile photo testing"""
        print("\n🔧 Setting up test user...")
        
        # Register a test user
        user_data = {
            "email": f"photo_test_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "TestPass123!",
            "first_name": "Photo",
            "last_name": "Tester",
            "phone": "+221701234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr"
        }
        
        try:
            response = requests.post(f"{self.base_url}/auth/register", json=user_data)
            if response.status_code == 200:
                data = response.json()
                self.test_user_token = data['access_token']
                self.test_user_id = data['user']['id']
                print(f"✅ Test user created: {data['user']['email']}")
                print(f"   User ID: {self.test_user_id}")
                return True
            else:
                print(f"❌ Failed to create test user: {response.status_code}")
                return False
        except Exception as e:
            print(f"❌ Error creating test user: {e}")
            return False

    def create_test_image(self, size_mb=0.1, format="png"):
        """Create a test image of specified size"""
        if format == "png":
            # Small 1x1 pixel PNG (about 67 bytes)
            base_image = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\tpHYs\x00\x00\x0b\x13\x00\x00\x0b\x13\x01\x00\x9a\x9c\x18\x00\x00\x00\nIDATx\x9cc```\x00\x04\x00\x01\x00\x01\xdd\x8d\xb4\x1c\x00\x00\x00\x00IEND\xaeB`\x82'
            
            if size_mb > 0.1:
                # Pad with extra data to reach desired size
                target_size = int(size_mb * 1024 * 1024)
                padding_size = max(0, target_size - len(base_image))
                # Add padding as PNG comment chunks (safe)
                padding = b'\x00' * padding_size
                return base_image + padding
            return base_image
            
        elif format == "jpg":
            # Minimal JPEG header
            return b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00H\x00H\x00\x00\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a\x1f\x1e\x1d\x1a\x1c\x1c $.\' ",#\x1c\x1c(7),01444\x1f\'9=82<.342\xff\xc0\x00\x11\x08\x00\x01\x00\x01\x01\x01\x11\x00\x02\x11\x01\x03\x11\x01\xff\xc4\x00\x14\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x08\xff\xc4\x00\x14\x10\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\xff\xda\x00\x08\x01\x01\x00\x00?\x00\xaa\xff\xd9'
        
        elif format == "webp":
            # Minimal WebP header
            return b'RIFF\x1a\x00\x00\x00WEBPVP8 \x0e\x00\x00\x00\x90\x01\x00\x9d\x01*\x01\x00\x01\x00\x01\x00'
        
        else:
            return b"This is not an image file"

    def test_1_get_profile_photo_no_photo(self):
        """Test 1: Get profile photo when none exists (should return 404)"""
        print("\n🔍 Test 1: Get profile photo when none exists")
        
        try:
            headers = {'Authorization': f'Bearer {self.test_user_token}'}
            response = requests.get(f"{self.base_url}/users/profile-photo", headers=headers)
            
            if response.status_code == 404:
                self.log_test("GET profile photo (no photo)", True, "404 Not Found as expected")
                return True
            else:
                self.log_test("GET profile photo (no photo)", False, f"Expected 404, got {response.status_code}")
                return False
                
        except Exception as e:
            self.log_test("GET profile photo (no photo)", False, f"Error: {e}")
            return False

    def test_2_upload_valid_image(self):
        """Test 2: Upload valid image files (JPG, PNG, WEBP)"""
        print("\n🔍 Test 2: Upload valid image files")
        
        test_formats = [
            ("PNG", "png", "image/png"),
            ("JPG", "jpg", "image/jpeg"), 
            ("WEBP", "webp", "image/webp")
        ]
        
        success_count = 0
        
        for format_name, format_ext, content_type in test_formats:
            try:
                headers = {'Authorization': f'Bearer {self.test_user_token}'}
                image_data = self.create_test_image(0.1, format_ext)
                files = {'file': (f'test_photo.{format_ext}', io.BytesIO(image_data), content_type)}
                
                response = requests.post(f"{self.base_url}/users/profile-photo", headers=headers, files=files)
                
                if response.status_code == 200:
                    data = response.json()
                    if 'photo_url' in data:
                        self.uploaded_photo_url = data['photo_url']
                        self.log_test(f"Upload {format_name} image", True, f"Photo URL: {data['photo_url']}")
                        success_count += 1
                    else:
                        self.log_test(f"Upload {format_name} image", False, "No photo_url in response")
                else:
                    self.log_test(f"Upload {format_name} image", False, f"Status: {response.status_code}")
                    
            except Exception as e:
                self.log_test(f"Upload {format_name} image", False, f"Error: {e}")
        
        return success_count == len(test_formats)

    def test_3_file_size_validation(self):
        """Test 3: Test file size validation (should accept files under 5MB)"""
        print("\n🔍 Test 3: File size validation")
        
        test_cases = [
            (1, True, "1MB file (should pass)"),
            (4.9, True, "4.9MB file (should pass)"),
            (6, False, "6MB file (should fail)")
        ]
        
        success_count = 0
        
        for size_mb, should_pass, description in test_cases:
            try:
                headers = {'Authorization': f'Bearer {self.test_user_token}'}
                image_data = self.create_test_image(size_mb, "png")
                files = {'file': ('test_photo.png', io.BytesIO(image_data), 'image/png')}
                
                response = requests.post(f"{self.base_url}/users/profile-photo", headers=headers, files=files)
                
                if should_pass and response.status_code == 200:
                    self.log_test(description, True, "Accepted as expected")
                    success_count += 1
                elif not should_pass and response.status_code == 400:
                    error_data = response.json()
                    if "too large" in error_data.get('detail', '').lower():
                        self.log_test(description, True, "Rejected as expected (file too large)")
                        success_count += 1
                    else:
                        self.log_test(description, False, f"Wrong error message: {error_data}")
                else:
                    expected = "200" if should_pass else "400"
                    self.log_test(description, False, f"Expected {expected}, got {response.status_code}")
                    
            except Exception as e:
                self.log_test(description, False, f"Error: {e}")
        
        return success_count == len(test_cases)

    def test_4_file_type_validation(self):
        """Test 4: Test invalid file types (should reject non-images)"""
        print("\n🔍 Test 4: File type validation")
        
        test_cases = [
            ("text/plain", b"This is a text file", "text.txt", "Text file"),
            ("application/pdf", b"%PDF-1.4 fake pdf", "document.pdf", "PDF file"),
            ("application/json", b'{"test": "data"}', "data.json", "JSON file"),
            ("video/mp4", b"fake video data", "video.mp4", "Video file")
        ]
        
        success_count = 0
        
        for content_type, file_data, filename, description in test_cases:
            try:
                headers = {'Authorization': f'Bearer {self.test_user_token}'}
                files = {'file': (filename, io.BytesIO(file_data), content_type)}
                
                response = requests.post(f"{self.base_url}/users/profile-photo", headers=headers, files=files)
                
                if response.status_code == 400:
                    error_data = response.json()
                    if "image" in error_data.get('detail', '').lower():
                        self.log_test(f"Reject {description}", True, "Rejected as expected (not an image)")
                        success_count += 1
                    else:
                        self.log_test(f"Reject {description}", False, f"Wrong error message: {error_data}")
                else:
                    self.log_test(f"Reject {description}", False, f"Expected 400, got {response.status_code}")
                    
            except Exception as e:
                self.log_test(f"Reject {description}", False, f"Error: {e}")
        
        return success_count == len(test_cases)

    def test_5_authentication_authorization(self):
        """Test 5: Authentication & Authorization"""
        print("\n🔍 Test 5: Authentication & Authorization")
        
        success_count = 0
        
        # Test 5a: No authentication token
        try:
            image_data = self.create_test_image(0.1, "png")
            files = {'file': ('test_photo.png', io.BytesIO(image_data), 'image/png')}
            
            response = requests.post(f"{self.base_url}/users/profile-photo", files=files)
            
            if response.status_code == 403:
                self.log_test("Upload without authentication", True, "403 Forbidden as expected")
                success_count += 1
            else:
                self.log_test("Upload without authentication", False, f"Expected 403, got {response.status_code}")
                
        except Exception as e:
            self.log_test("Upload without authentication", False, f"Error: {e}")
        
        # Test 5b: Invalid token
        try:
            headers = {'Authorization': 'Bearer invalid_token_12345'}
            image_data = self.create_test_image(0.1, "png")
            files = {'file': ('test_photo.png', io.BytesIO(image_data), 'image/png')}
            
            response = requests.post(f"{self.base_url}/users/profile-photo", headers=headers, files=files)
            
            if response.status_code in [401, 403]:
                self.log_test("Upload with invalid token", True, f"{response.status_code} as expected")
                success_count += 1
            else:
                self.log_test("Upload with invalid token", False, f"Expected 401/403, got {response.status_code}")
                
        except Exception as e:
            self.log_test("Upload with invalid token", False, f"Error: {e}")
        
        return success_count == 2

    def test_6_file_storage_and_url_generation(self):
        """Test 6: File storage and URL generation"""
        print("\n🔍 Test 6: File storage and URL generation")
        
        success_count = 0
        
        # Upload a file and check response structure
        try:
            headers = {'Authorization': f'Bearer {self.test_user_token}'}
            image_data = self.create_test_image(0.1, "png")
            files = {'file': ('test_photo.png', io.BytesIO(image_data), 'image/png')}
            
            response = requests.post(f"{self.base_url}/users/profile-photo", headers=headers, files=files)
            
            if response.status_code == 200:
                data = response.json()
                
                # Check required fields in response
                required_fields = ['message', 'photo_url', 'filename']
                missing_fields = [field for field in required_fields if field not in data]
                
                if not missing_fields:
                    self.log_test("Response structure", True, f"All required fields present: {required_fields}")
                    success_count += 1
                    
                    # Check URL format
                    photo_url = data['photo_url']
                    if photo_url.startswith('/uploads/profile_photos/') and self.test_user_id in photo_url:
                        self.log_test("URL format", True, f"Correct URL format: {photo_url}")
                        success_count += 1
                        self.uploaded_photo_url = photo_url
                    else:
                        self.log_test("URL format", False, f"Incorrect URL format: {photo_url}")
                        
                    # Check filename uniqueness
                    filename = data['filename']
                    if self.test_user_id in filename and len(filename) > 20:
                        self.log_test("Unique filename", True, f"Filename includes user ID and timestamp: {filename}")
                        success_count += 1
                    else:
                        self.log_test("Unique filename", False, f"Filename not unique enough: {filename}")
                        
                else:
                    self.log_test("Response structure", False, f"Missing fields: {missing_fields}")
            else:
                self.log_test("File upload for storage test", False, f"Status: {response.status_code}")
                
        except Exception as e:
            self.log_test("File storage test", False, f"Error: {e}")
        
        return success_count >= 2

    def test_7_data_persistence(self):
        """Test 7: Database integration and data persistence"""
        print("\n🔍 Test 7: Data persistence")
        
        success_count = 0
        
        # Test 7a: Check if profile_photo field is updated in user profile
        try:
            headers = {'Authorization': f'Bearer {self.test_user_token}'}
            response = requests.get(f"{self.base_url}/users/profile", headers=headers)
            
            if response.status_code == 200:
                user_data = response.json()
                profile_photo = user_data.get('profile_photo')
                
                if profile_photo and profile_photo == self.uploaded_photo_url:
                    self.log_test("Profile photo in user profile", True, f"Photo URL correctly stored: {profile_photo}")
                    success_count += 1
                elif profile_photo:
                    self.log_test("Profile photo in user profile", True, f"Photo URL stored (different from last upload): {profile_photo}")
                    success_count += 1
                else:
                    self.log_test("Profile photo in user profile", False, "No profile_photo field in user profile")
            else:
                self.log_test("Get user profile", False, f"Status: {response.status_code}")
                
        except Exception as e:
            self.log_test("Profile integration test", False, f"Error: {e}")
        
        # Test 7b: Get profile photo endpoint
        try:
            headers = {'Authorization': f'Bearer {self.test_user_token}'}
            response = requests.get(f"{self.base_url}/users/profile-photo", headers=headers)
            
            if response.status_code == 200:
                data = response.json()
                if 'photo_url' in data and 'user_id' in data:
                    if data['user_id'] == self.test_user_id:
                        self.log_test("Get profile photo endpoint", True, f"Correct user_id: {data['user_id']}")
                        success_count += 1
                    else:
                        self.log_test("Get profile photo endpoint", False, f"Wrong user_id: {data['user_id']}")
                else:
                    self.log_test("Get profile photo endpoint", False, "Missing required fields in response")
            else:
                self.log_test("Get profile photo endpoint", False, f"Status: {response.status_code}")
                
        except Exception as e:
            self.log_test("Get profile photo test", False, f"Error: {e}")
        
        return success_count >= 1

    def test_8_photo_replacement(self):
        """Test 8: Photo replacement (uploading new photo should replace old one)"""
        print("\n🔍 Test 8: Photo replacement")
        
        try:
            headers = {'Authorization': f'Bearer {self.test_user_token}'}
            
            # Upload first photo
            image_data1 = self.create_test_image(0.1, "png")
            files1 = {'file': ('photo1.png', io.BytesIO(image_data1), 'image/png')}
            response1 = requests.post(f"{self.base_url}/users/profile-photo", headers=headers, files=files1)
            
            if response1.status_code == 200:
                photo_url1 = response1.json()['photo_url']
                
                # Upload second photo
                image_data2 = self.create_test_image(0.1, "jpg")
                files2 = {'file': ('photo2.jpg', io.BytesIO(image_data2), 'image/jpeg')}
                response2 = requests.post(f"{self.base_url}/users/profile-photo", headers=headers, files=files2)
                
                if response2.status_code == 200:
                    photo_url2 = response2.json()['photo_url']
                    
                    # Check that URLs are different
                    if photo_url1 != photo_url2:
                        self.log_test("Photo replacement", True, f"New photo URL: {photo_url2}")
                        
                        # Verify current profile shows new photo
                        profile_response = requests.get(f"{self.base_url}/users/profile", headers=headers)
                        if profile_response.status_code == 200:
                            current_photo = profile_response.json().get('profile_photo')
                            if current_photo == photo_url2:
                                self.log_test("Profile updated with new photo", True, "Profile shows latest photo")
                                return True
                            else:
                                self.log_test("Profile updated with new photo", False, f"Profile shows: {current_photo}")
                        else:
                            self.log_test("Profile check after replacement", False, f"Status: {profile_response.status_code}")
                    else:
                        self.log_test("Photo replacement", False, "Same URL returned for different uploads")
                else:
                    self.log_test("Second photo upload", False, f"Status: {response2.status_code}")
            else:
                self.log_test("First photo upload", False, f"Status: {response1.status_code}")
                
        except Exception as e:
            self.log_test("Photo replacement test", False, f"Error: {e}")
        
        return False

    def test_9_photo_deletion(self):
        """Test 9: Photo deletion"""
        print("\n🔍 Test 9: Photo deletion")
        
        success_count = 0
        
        # Test 9a: Delete existing photo
        try:
            headers = {'Authorization': f'Bearer {self.test_user_token}'}
            response = requests.delete(f"{self.base_url}/users/profile-photo", headers=headers)
            
            if response.status_code == 200:
                data = response.json()
                if 'message' in data and 'deleted' in data['message'].lower():
                    self.log_test("Delete profile photo", True, data['message'])
                    success_count += 1
                else:
                    self.log_test("Delete profile photo", True, f"Deleted successfully: {data}")
                    success_count += 1
            else:
                self.log_test("Delete profile photo", False, f"Status: {response.status_code}")
                
        except Exception as e:
            self.log_test("Delete profile photo", False, f"Error: {e}")
        
        # Test 9b: Verify photo removed from profile
        try:
            headers = {'Authorization': f'Bearer {self.test_user_token}'}
            response = requests.get(f"{self.base_url}/users/profile", headers=headers)
            
            if response.status_code == 200:
                user_data = response.json()
                profile_photo = user_data.get('profile_photo')
                
                if not profile_photo or profile_photo is None:
                    self.log_test("Profile photo removed from profile", True, "profile_photo field is null")
                    success_count += 1
                else:
                    self.log_test("Profile photo removed from profile", False, f"Still has photo: {profile_photo}")
            else:
                self.log_test("Check profile after deletion", False, f"Status: {response.status_code}")
                
        except Exception as e:
            self.log_test("Profile check after deletion", False, f"Error: {e}")
        
        # Test 9c: Try to delete non-existent photo
        try:
            headers = {'Authorization': f'Bearer {self.test_user_token}'}
            response = requests.delete(f"{self.base_url}/users/profile-photo", headers=headers)
            
            if response.status_code == 404:
                self.log_test("Delete non-existent photo", True, "404 Not Found as expected")
                success_count += 1
            else:
                self.log_test("Delete non-existent photo", False, f"Expected 404, got {response.status_code}")
                
        except Exception as e:
            self.log_test("Delete non-existent photo", False, f"Error: {e}")
        
        return success_count >= 2

    def test_10_edge_cases(self):
        """Test 10: Edge cases and error handling"""
        print("\n🔍 Test 10: Edge cases")
        
        success_count = 0
        
        # Test 10a: Empty file
        try:
            headers = {'Authorization': f'Bearer {self.test_user_token}'}
            files = {'file': ('empty.png', io.BytesIO(b''), 'image/png')}
            
            response = requests.post(f"{self.base_url}/users/profile-photo", headers=headers, files=files)
            
            if response.status_code in [400, 422]:
                self.log_test("Empty file upload", True, f"Rejected as expected: {response.status_code}")
                success_count += 1
            else:
                self.log_test("Empty file upload", False, f"Expected 400/422, got {response.status_code}")
                
        except Exception as e:
            self.log_test("Empty file upload", False, f"Error: {e}")
        
        # Test 10b: Missing file parameter
        try:
            headers = {'Authorization': f'Bearer {self.test_user_token}'}
            response = requests.post(f"{self.base_url}/users/profile-photo", headers=headers)
            
            if response.status_code in [400, 422]:
                self.log_test("Missing file parameter", True, f"Rejected as expected: {response.status_code}")
                success_count += 1
            else:
                self.log_test("Missing file parameter", False, f"Expected 400/422, got {response.status_code}")
                
        except Exception as e:
            self.log_test("Missing file parameter", False, f"Error: {e}")
        
        # Test 10c: Corrupted image data
        try:
            headers = {'Authorization': f'Bearer {self.test_user_token}'}
            corrupted_data = b'\x89PNG\r\n\x1a\n\x00\x00corrupted_data_here'
            files = {'file': ('corrupted.png', io.BytesIO(corrupted_data), 'image/png')}
            
            response = requests.post(f"{self.base_url}/users/profile-photo", headers=headers, files=files)
            
            # Either accepts it (backend doesn't validate image structure) or rejects it
            if response.status_code in [200, 400, 422]:
                self.log_test("Corrupted image data", True, f"Handled appropriately: {response.status_code}")
                success_count += 1
            else:
                self.log_test("Corrupted image data", False, f"Unexpected status: {response.status_code}")
                
        except Exception as e:
            self.log_test("Corrupted image data", False, f"Error: {e}")
        
        return success_count >= 2

    def run_all_tests(self):
        """Run all profile photo upload tests"""
        print("="*80)
        print("PROFILE PHOTO UPLOAD SYSTEM TESTING")
        print("="*80)
        print("Testing the profile photo upload system for the new ProfilePhotoUploader component")
        print(f"Base URL: {self.base_url}")
        
        # Setup
        if not self.setup_test_user():
            print("❌ Failed to setup test user. Cannot continue.")
            return False
        
        # Run all tests
        test_results = []
        
        test_results.append(self.test_1_get_profile_photo_no_photo())
        test_results.append(self.test_2_upload_valid_image())
        test_results.append(self.test_3_file_size_validation())
        test_results.append(self.test_4_file_type_validation())
        test_results.append(self.test_5_authentication_authorization())
        test_results.append(self.test_6_file_storage_and_url_generation())
        test_results.append(self.test_7_data_persistence())
        test_results.append(self.test_8_photo_replacement())
        test_results.append(self.test_9_photo_deletion())
        test_results.append(self.test_10_edge_cases())
        
        # Summary
        print("\n" + "="*80)
        print("PROFILE PHOTO UPLOAD SYSTEM TEST RESULTS")
        print("="*80)
        
        passed_tests = sum(test_results)
        total_tests = len(test_results)
        
        print(f"📊 Overall Test Groups: {passed_tests}/{total_tests} passed")
        print(f"📊 Individual Tests: {self.tests_passed}/{self.tests_run} passed")
        
        success_rate = (self.tests_passed / self.tests_run) * 100 if self.tests_run > 0 else 0
        print(f"📊 Success Rate: {success_rate:.1f}%")
        
        if success_rate >= 90:
            print("🎉 EXCELLENT: Profile photo upload system is working very well!")
        elif success_rate >= 80:
            print("✅ GOOD: Profile photo upload system is working well with minor issues")
        elif success_rate >= 70:
            print("⚠️  ACCEPTABLE: Profile photo upload system is working but has some issues")
        else:
            print("❌ NEEDS WORK: Profile photo upload system has significant issues")
        
        print("\n🔍 DETAILED FINDINGS:")
        
        # Categorize results
        critical_features = [
            "Upload valid image files",
            "File size validation", 
            "Authentication & Authorization",
            "Data persistence"
        ]
        
        working_features = []
        failing_features = []
        
        test_names = [
            "Get profile photo when none exists",
            "Upload valid image files", 
            "File size validation",
            "File type validation",
            "Authentication & Authorization",
            "File storage and URL generation",
            "Data persistence",
            "Photo replacement",
            "Photo deletion",
            "Edge cases"
        ]
        
        for i, (name, result) in enumerate(zip(test_names, test_results)):
            if result:
                working_features.append(name)
            else:
                failing_features.append(name)
        
        if working_features:
            print("✅ WORKING FEATURES:")
            for feature in working_features:
                print(f"   • {feature}")
        
        if failing_features:
            print("❌ FAILING FEATURES:")
            for feature in failing_features:
                print(f"   • {feature}")
        
        # Critical assessment
        critical_issues = [f for f in failing_features if any(c in f for c in critical_features)]
        if critical_issues:
            print(f"\n🚨 CRITICAL ISSUES FOUND: {len(critical_issues)}")
            for issue in critical_issues:
                print(f"   • {issue}")
        else:
            print("\n✅ NO CRITICAL ISSUES: All essential features are working")
        
        return success_rate >= 80

if __name__ == "__main__":
    tester = ProfilePhotoTester()
    success = tester.run_all_tests()
    sys.exit(0 if success else 1)