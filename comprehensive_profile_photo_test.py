#!/usr/bin/env python3
"""
Comprehensive Profile Photo System Test
======================================

This test validates the complete profile photo system including:
- API endpoints functionality
- File storage and retrieval
- Database integration
- URL accessibility issues
"""

import requests
import sys
import json
import io
from datetime import datetime

class ProfilePhotoSystemTest:
    def __init__(self, base_url="https://westafricaboost.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.test_token = None
        self.test_user = None
        self.tests_run = 0
        self.tests_passed = 0
        self.critical_issues = []
        self.warnings = []

    def log_result(self, test_name, success, details=""):
        """Log test result"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {test_name}")
        else:
            print(f"❌ {test_name}")
            self.critical_issues.append(f"{test_name}: {details}")
        
        if details:
            print(f"   {details}")

    def log_warning(self, test_name, details):
        """Log warning"""
        print(f"⚠️ {test_name}")
        print(f"   {details}")
        self.warnings.append(f"{test_name}: {details}")

    def setup_test_user(self):
        """Create test user for profile photo testing"""
        print("🔧 Setting up test user...")
        
        user_data = {
            "email": f"profile_photo_test_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "ProfileTest123!",
            "first_name": "Profile",
            "last_name": "PhotoTest",
            "phone": "+221701234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr"
        }
        
        try:
            response = requests.post(f"{self.base_url}/auth/register", json=user_data)
            if response.status_code == 200:
                data = response.json()
                self.test_token = data['access_token']
                self.test_user = data['user']
                self.log_result("Test user registration", True, f"User ID: {self.test_user['id']}")
                return True
            else:
                self.log_result("Test user registration", False, f"Status: {response.status_code}")
                return False
        except Exception as e:
            self.log_result("Test user registration", False, f"Error: {str(e)}")
            return False

    def test_profile_photo_endpoints(self):
        """Test all profile photo API endpoints"""
        print("\n📸 Testing Profile Photo API Endpoints")
        print("=" * 50)
        
        if not self.test_token:
            self.log_result("Profile photo endpoints", False, "No test token available")
            return
            
        headers = {'Authorization': f'Bearer {self.test_token}'}
        
        # Test 1: GET profile photo when none exists
        try:
            response = requests.get(f"{self.base_url}/users/profile-photo", headers=headers)
            success = response.status_code == 404
            self.log_result("GET profile photo (no photo)", success, 
                          f"Expected 404, got {response.status_code}")
        except Exception as e:
            self.log_result("GET profile photo (no photo)", False, f"Error: {str(e)}")

        # Test 2: Upload profile photo
        try:
            # Create test image data (small PNG)
            test_image_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\tpHYs\x00\x00\x0b\x13\x00\x00\x0b\x13\x01\x00\x9a\x9c\x18\x00\x00\x00\x12IDATx\x9cc```bPPP\x00\x02\xac\x01\x00\x00\x05\x00\x01\r\n-\xdb\x00\x00\x00\x00IEND\xaeB`\x82'
            
            files = {'file': ('test_photo.png', io.BytesIO(test_image_data), 'image/png')}
            response = requests.post(f"{self.base_url}/users/profile-photo", 
                                   files=files, 
                                   headers={'Authorization': f'Bearer {self.test_token}'})
            
            if response.status_code == 200:
                data = response.json()
                photo_url = data.get('photo_url')
                self.log_result("Upload profile photo", True, 
                              f"Photo URL: {photo_url}")
                
                # Test 3: GET profile photo after upload
                try:
                    response = requests.get(f"{self.base_url}/users/profile-photo", headers=headers)
                    success = response.status_code == 200
                    self.log_result("GET profile photo (after upload)", success,
                                  f"Status: {response.status_code}")
                    
                    if success:
                        data = response.json()
                        returned_url = data.get('photo_url')
                        if returned_url == photo_url:
                            self.log_result("Photo URL consistency", True, "URLs match")
                        else:
                            self.log_result("Photo URL consistency", False, 
                                          f"Upload: {photo_url}, Get: {returned_url}")
                            
                except Exception as e:
                    self.log_result("GET profile photo (after upload)", False, f"Error: {str(e)}")
                    
            else:
                self.log_result("Upload profile photo", False, 
                              f"Status: {response.status_code}, Response: {response.text}")
                
        except Exception as e:
            self.log_result("Upload profile photo", False, f"Error: {str(e)}")

        # Test 4: Profile integration (check if photo appears in user profile)
        try:
            response = requests.get(f"{self.base_url}/users/profile", headers=headers)
            if response.status_code == 200:
                user_data = response.json()
                profile_photo = user_data.get('profile_photo')
                if profile_photo:
                    self.log_result("Profile integration", True, 
                                  f"Photo in profile: {profile_photo}")
                else:
                    self.log_result("Profile integration", False, "No photo in user profile")
            else:
                self.log_result("Profile integration", False, f"Status: {response.status_code}")
        except Exception as e:
            self.log_result("Profile integration", False, f"Error: {str(e)}")

        # Test 5: Delete profile photo
        try:
            response = requests.delete(f"{self.base_url}/users/profile-photo", headers=headers)
            success = response.status_code == 200
            self.log_result("Delete profile photo", success, f"Status: {response.status_code}")
            
            if success:
                # Verify deletion
                response = requests.get(f"{self.base_url}/users/profile-photo", headers=headers)
                success = response.status_code == 404
                self.log_result("Verify photo deletion", success, 
                              f"Expected 404, got {response.status_code}")
        except Exception as e:
            self.log_result("Delete profile photo", False, f"Error: {str(e)}")

    def test_url_accessibility(self):
        """Test photo URL accessibility"""
        print("\n🌐 Testing Photo URL Accessibility")
        print("=" * 50)
        
        if not self.test_token:
            self.log_result("URL accessibility test", False, "No test token available")
            return
            
        # First upload a photo to test
        headers = {'Authorization': f'Bearer {self.test_token}'}
        test_image_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\tpHYs\x00\x00\x0b\x13\x00\x00\x0b\x13\x01\x00\x9a\x9c\x18\x00\x00\x00\x12IDATx\x9cc```bPPP\x00\x02\xac\x01\x00\x00\x05\x00\x01\r\n-\xdb\x00\x00\x00\x00IEND\xaeB`\x82'
        
        try:
            files = {'file': ('url_test.png', io.BytesIO(test_image_data), 'image/png')}
            response = requests.post(f"{self.base_url}/users/profile-photo", 
                                   files=files, 
                                   headers={'Authorization': f'Bearer {self.test_token}'})
            
            if response.status_code == 200:
                data = response.json()
                photo_url = data.get('photo_url')
                
                if photo_url:
                    # Test direct URL access
                    full_url = f"https://westafricaboost.preview.emergentagent.com{photo_url}"
                    
                    try:
                        url_response = requests.get(full_url)
                        content_type = url_response.headers.get('content-type', '')
                        
                        if url_response.status_code == 200:
                            if content_type.startswith('image/'):
                                self.log_result("Direct URL access", True, 
                                              f"Content-Type: {content_type}")
                            else:
                                self.log_warning("Direct URL access", 
                                               f"Returns HTML instead of image (Content-Type: {content_type})")
                                self.log_result("Direct URL access", False, 
                                              "Static file serving issue - returns HTML instead of image")
                        else:
                            self.log_result("Direct URL access", False, 
                                          f"Status: {url_response.status_code}")
                            
                    except Exception as e:
                        self.log_result("Direct URL access", False, f"Error: {str(e)}")
                        
                else:
                    self.log_result("URL accessibility test", False, "No photo URL returned")
                    
        except Exception as e:
            self.log_result("URL accessibility test", False, f"Error: {str(e)}")

    def test_login_photo_context(self):
        """Test if profile photo is included in login response"""
        print("\n🔐 Testing Login Photo Context")
        print("=" * 50)
        
        if not self.test_user:
            self.log_result("Login photo context", False, "No test user available")
            return
            
        # First ensure user has a photo
        headers = {'Authorization': f'Bearer {self.test_token}'}
        test_image_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\tpHYs\x00\x00\x0b\x13\x00\x00\x0b\x13\x01\x00\x9a\x9c\x18\x00\x00\x00\x12IDATx\x9cc```bPPP\x00\x02\xac\x01\x00\x00\x05\x00\x01\r\n-\xdb\x00\x00\x00\x00IEND\xaeB`\x82'
        
        try:
            files = {'file': ('login_test.png', io.BytesIO(test_image_data), 'image/png')}
            upload_response = requests.post(f"{self.base_url}/users/profile-photo", 
                                          files=files, 
                                          headers={'Authorization': f'Bearer {self.test_token}'})
            
            if upload_response.status_code == 200:
                # Now test login
                login_data = {
                    "email": self.test_user['email'],
                    "password": "ProfileTest123!"
                }
                
                login_response = requests.post(f"{self.base_url}/auth/login", json=login_data)
                
                if login_response.status_code == 200:
                    login_data = login_response.json()
                    user_in_login = login_data.get('user', {})
                    profile_photo = user_in_login.get('profile_photo')
                    
                    if profile_photo:
                        self.log_result("Login includes profile photo", True, 
                                      f"Photo URL: {profile_photo}")
                    else:
                        self.log_result("Login includes profile photo", False, 
                                      "Profile photo not included in login response")
                else:
                    self.log_result("Login photo context", False, 
                                  f"Login failed: {login_response.status_code}")
            else:
                self.log_result("Login photo context", False, 
                              f"Photo upload failed: {upload_response.status_code}")
                
        except Exception as e:
            self.log_result("Login photo context", False, f"Error: {str(e)}")

    def run_comprehensive_test(self):
        """Run all profile photo tests"""
        print("🔍 COMPREHENSIVE PROFILE PHOTO SYSTEM TEST")
        print("=" * 80)
        print("Testing complete profile photo functionality...")
        print("=" * 80)
        
        # Setup
        if not self.setup_test_user():
            print("❌ Test aborted - could not setup test user")
            return
            
        # Run all tests
        self.test_profile_photo_endpoints()
        self.test_url_accessibility()
        self.test_login_photo_context()
        
        # Print summary
        self.print_test_summary()

    def print_test_summary(self):
        """Print comprehensive test summary"""
        print("\n" + "=" * 80)
        print("📊 COMPREHENSIVE TEST SUMMARY")
        print("=" * 80)
        
        success_rate = (self.tests_passed / self.tests_run * 100) if self.tests_run > 0 else 0
        
        print(f"\n📈 OVERALL RESULTS:")
        print(f"   Tests Run: {self.tests_run}")
        print(f"   Tests Passed: {self.tests_passed}")
        print(f"   Success Rate: {success_rate:.1f}%")
        
        if self.critical_issues:
            print(f"\n🚨 CRITICAL ISSUES ({len(self.critical_issues)}):")
            for issue in self.critical_issues:
                print(f"   • {issue}")
        
        if self.warnings:
            print(f"\n⚠️ WARNINGS ({len(self.warnings)}):")
            for warning in self.warnings:
                print(f"   • {warning}")
        
        # Diagnosis
        print(f"\n🔍 DIAGNOSIS:")
        if success_rate >= 80:
            if self.warnings:
                print("   ✅ Profile photo system is WORKING with minor issues")
                print("   📝 The API endpoints are functional but static file serving has routing issues")
            else:
                print("   ✅ Profile photo system is FULLY FUNCTIONAL")
        elif success_rate >= 60:
            print("   ⚠️ Profile photo system has SIGNIFICANT ISSUES")
            print("   🔧 Requires attention to resolve critical problems")
        else:
            print("   ❌ Profile photo system is NOT WORKING")
            print("   🚨 Major functionality is broken")
        
        print("=" * 80)

if __name__ == "__main__":
    tester = ProfilePhotoSystemTest()
    tester.run_comprehensive_test()