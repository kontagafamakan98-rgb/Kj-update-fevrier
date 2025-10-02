#!/usr/bin/env python3
"""
Profile Photo Display Issue Debug Test
=====================================

This test specifically investigates the profile photo display issue where:
- Photos are uploaded successfully but not showing in UI
- User sees default avatar "et" instead of their uploaded photo
- Focus on erta@gmail.com user issue

Test Areas:
1. Database Photo URL Check - Query MongoDB users collection
2. Static File Serving Test - Test /api/uploads/profile_photos/ URLs
3. Profile Photo Retrieval API - Test GET endpoints
4. User Authentication & Photo Association
"""

import requests
import sys
import json
import io
import pymongo
from datetime import datetime
import os
from pathlib import Path

class ProfilePhotoDebugTester:
    def __init__(self, base_url="https://kojo-service-hub.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0
        self.issues_found = []
        
        # MongoDB connection for database inspection
        self.mongo_client = None
        self.db = None
        self.setup_database_connection()
        
    def setup_database_connection(self):
        """Setup MongoDB connection for database inspection"""
        try:
            # Try to connect to MongoDB using the same connection as backend
            mongo_url = "mongodb://localhost:27017"
            db_name = "kojo_database"
            
            self.mongo_client = pymongo.MongoClient(mongo_url)
            self.db = self.mongo_client[db_name]
            
            # Test connection
            self.db.users.count_documents({})
            print("✅ MongoDB connection established for database inspection")
            
        except Exception as e:
            print(f"⚠️ Could not connect to MongoDB for database inspection: {e}")
            print("   Database inspection tests will be skipped")
            self.mongo_client = None
            self.db = None

    def log_issue(self, severity, issue, details=""):
        """Log an issue found during testing"""
        self.issues_found.append({
            "severity": severity,
            "issue": issue,
            "details": details,
            "timestamp": datetime.now().isoformat()
        })
        
        severity_emoji = {"CRITICAL": "🚨", "HIGH": "⚠️", "MEDIUM": "📝", "LOW": "ℹ️"}
        print(f"{severity_emoji.get(severity, '📝')} {severity}: {issue}")
        if details:
            print(f"   Details: {details}")

    def run_test(self, name, method, endpoint, expected_status, data=None, token=None, files=None):
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}" if endpoint else self.base_url
        headers = {}
        
        if token:
            headers['Authorization'] = f'Bearer {token}'
        
        if data and not files:
            headers['Content-Type'] = 'application/json'

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        print(f"   URL: {url}")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers)
            elif method == 'POST':
                if files:
                    response = requests.post(url, headers={k: v for k, v in headers.items() if k != 'Content-Type'}, files=files, data=data)
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
                    if response.headers.get('content-type', '').startswith('application/json'):
                        response_data = response.json()
                        if isinstance(response_data, dict) and len(str(response_data)) < 1000:
                            print(f"   Response: {response_data}")
                        return True, response_data
                    else:
                        print(f"   Content-Type: {response.headers.get('content-type', 'unknown')}")
                        print(f"   Content-Length: {len(response.content)} bytes")
                        return True, {"content_type": response.headers.get('content-type'), "content_length": len(response.content)}
                except:
                    return True, {}
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                try:
                    if response.headers.get('content-type', '').startswith('application/json'):
                        error_data = response.json()
                        print(f"   Error: {error_data}")
                        return False, error_data
                    else:
                        print(f"   Error (non-JSON): {response.text[:500]}")
                        return False, {"error": response.text[:500]}
                except:
                    print(f"   Error: {response.text[:500]}")
                    return False, {"error": response.text[:500]}

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            self.log_issue("HIGH", f"Network/Connection error in {name}", str(e))
            return False, {}

    def test_database_photo_urls(self):
        """Test 1: Database Photo URL Check - Query MongoDB users collection"""
        print("\n" + "="*70)
        print("TEST 1: DATABASE PHOTO URL CHECK")
        print("="*70)
        
        if self.db is None:
            print("❌ Skipping database tests - no MongoDB connection")
            self.log_issue("HIGH", "Cannot inspect database", "MongoDB connection not available")
            return
        
        try:
            # Check total users with profile photos
            users_with_photos = list(self.db.users.find(
                {"profile_photo": {"$ne": None, "$exists": True}},
                {"id": 1, "email": 1, "first_name": 1, "last_name": 1, "profile_photo": 1}
            ))
            
            print(f"📊 Found {len(users_with_photos)} users with profile photos in database")
            
            if len(users_with_photos) == 0:
                self.log_issue("CRITICAL", "No users with profile photos found in database", 
                             "This could indicate photos are not being saved to database properly")
                return
            
            # Check for specific user mentioned in issue (erta@gmail.com)
            erta_user = self.db.users.find_one({"email": "erta@gmail.com"})
            if erta_user:
                print(f"\n🔍 Found user erta@gmail.com:")
                print(f"   User ID: {erta_user.get('id', 'N/A')}")
                print(f"   Name: {erta_user.get('first_name', '')} {erta_user.get('last_name', '')}")
                print(f"   Profile Photo: {erta_user.get('profile_photo', 'None')}")
                
                if not erta_user.get('profile_photo'):
                    self.log_issue("CRITICAL", "User erta@gmail.com has no profile_photo in database", 
                                 "User reports uploaded photo but database shows no photo URL")
                else:
                    print(f"✅ User erta@gmail.com has profile photo URL in database")
                    # Test if the photo URL follows expected pattern
                    photo_url = erta_user.get('profile_photo')
                    if photo_url.startswith('/api/uploads/profile_photos/'):
                        print(f"✅ Photo URL follows correct pattern: {photo_url}")
                    else:
                        self.log_issue("HIGH", "Photo URL doesn't follow expected pattern", 
                                     f"Expected /api/uploads/profile_photos/*, got: {photo_url}")
            else:
                print(f"⚠️ User erta@gmail.com not found in database")
                self.log_issue("MEDIUM", "Specific user erta@gmail.com not found in database", 
                             "User mentioned in issue report not found")
            
            # Display all users with photos for debugging
            print(f"\n📋 All users with profile photos:")
            for i, user in enumerate(users_with_photos[:10]):  # Limit to first 10
                print(f"   {i+1}. {user.get('email', 'N/A')} -> {user.get('profile_photo', 'N/A')}")
                
                # Check URL pattern
                photo_url = user.get('profile_photo', '')
                if photo_url and not photo_url.startswith('/api/uploads/profile_photos/'):
                    self.log_issue("MEDIUM", f"User {user.get('email')} has incorrect photo URL pattern", 
                                 f"URL: {photo_url}")
            
            if len(users_with_photos) > 10:
                print(f"   ... and {len(users_with_photos) - 10} more users")
                
            self.tests_passed += 1
            self.tests_run += 1
            
        except Exception as e:
            print(f"❌ Database inspection failed: {e}")
            self.log_issue("HIGH", "Database inspection failed", str(e))
            self.tests_run += 1

    def test_static_file_serving(self):
        """Test 2: Static File Serving Test - Test /api/uploads/profile_photos/ URLs"""
        print("\n" + "="*70)
        print("TEST 2: STATIC FILE SERVING TEST")
        print("="*70)
        
        # Check if uploads directory exists and has files
        uploads_dir = Path("uploads/profile_photos")
        if uploads_dir.exists():
            photo_files = list(uploads_dir.glob("*"))
            print(f"📁 Found {len(photo_files)} files in uploads/profile_photos/")
            
            if len(photo_files) == 0:
                self.log_issue("HIGH", "No photo files found in uploads directory", 
                             "Photos may not be saving to filesystem")
                return
            
            # Test serving of existing files
            for i, photo_file in enumerate(photo_files[:5]):  # Test first 5 files
                filename = photo_file.name
                photo_url = f"/api/uploads/profile_photos/{filename}"
                
                print(f"\n🔍 Testing static file serving for: {filename}")
                print(f"   File size: {photo_file.stat().st_size} bytes")
                print(f"   URL: {self.base_url.replace('/api', '')}{photo_url}")
                
                # Test the static file URL
                success, response = self.run_test(
                    f"Static File Serving - {filename}",
                    "GET",
                    f"../uploads/profile_photos/{filename}",  # Remove /api prefix for static files
                    200
                )
                
                if success and response:
                    content_type = response.get('content_type', '')
                    content_length = response.get('content_length', 0)
                    
                    # Check if we're getting actual image content
                    if content_type.startswith('image/'):
                        print(f"✅ Serving actual image content: {content_type}")
                    elif content_type.startswith('text/html'):
                        self.log_issue("CRITICAL", f"Static file {filename} returns HTML instead of image", 
                                     "This indicates Kubernetes routing issue - photos route to frontend instead of backend")
                    else:
                        self.log_issue("HIGH", f"Static file {filename} returns unexpected content type", 
                                     f"Content-Type: {content_type}")
                    
                    if content_length > 1000:  # Reasonable image size
                        print(f"✅ File has reasonable size: {content_length} bytes")
                    else:
                        self.log_issue("MEDIUM", f"Static file {filename} seems too small", 
                                     f"Size: {content_length} bytes - may not be actual image")
                else:
                    self.log_issue("CRITICAL", f"Cannot access static file {filename}", 
                                 "Static file serving is not working")
        else:
            print(f"❌ Uploads directory not found: {uploads_dir}")
            self.log_issue("CRITICAL", "Uploads directory does not exist", 
                         "Profile photos cannot be served if directory doesn't exist")

    def test_profile_photo_retrieval_api(self):
        """Test 3: Profile Photo Retrieval API - Test GET endpoints"""
        print("\n" + "="*70)
        print("TEST 3: PROFILE PHOTO RETRIEVAL API TEST")
        print("="*70)
        
        # First, we need to create a test user and upload a photo
        print("🔍 Creating test user for photo retrieval testing...")
        
        # Register test user
        test_user_data = {
            "email": f"photo_test_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "TestPass123!",
            "first_name": "Photo",
            "last_name": "Test",
            "phone": "+221701234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr"
        }
        
        success, response = self.run_test(
            "Register Test User",
            "POST",
            "auth/register",
            200,
            data=test_user_data
        )
        
        if not success or 'access_token' not in response:
            print("❌ Cannot create test user - skipping API tests")
            self.log_issue("HIGH", "Cannot create test user for API testing", "Registration failed")
            return
        
        test_token = response['access_token']
        test_user = response['user']
        print(f"✅ Test user created: {test_user['id']}")
        
        # Test GET profile photo when none exists
        success, response = self.run_test(
            "Get Profile Photo (None Exists)",
            "GET",
            "users/profile-photo",
            404,
            token=test_token
        )
        
        if success:
            print("✅ Correctly returns 404 when no photo exists")
        else:
            self.log_issue("MEDIUM", "GET profile photo doesn't return 404 when no photo exists", 
                         "API behavior inconsistent")
        
        # Upload a test photo
        print("\n🔍 Uploading test photo...")
        
        # Create a small test image (1x1 pixel PNG)
        test_image_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\tpHYs\x00\x00\x0b\x13\x00\x00\x0b\x13\x01\x00\x9a\x9c\x18\x00\x00\x00\nIDATx\x9cc```\x00\x04\x00\x01\x00\x01\xdd\x8d\xb4\x1c\x00\x00\x00\x00IEND\xaeB`\x82'
        
        files = {'file': ('test_photo.png', io.BytesIO(test_image_data), 'image/png')}
        
        success, response = self.run_test(
            "Upload Test Photo",
            "POST",
            "users/profile-photo",
            200,
            token=test_token,
            files=files
        )
        
        uploaded_photo_url = None
        if success and response and 'photo_url' in response:
            uploaded_photo_url = response['photo_url']
            print(f"✅ Photo uploaded successfully: {uploaded_photo_url}")
            
            # Check URL pattern
            if uploaded_photo_url.startswith('/api/uploads/profile_photos/'):
                print("✅ Photo URL follows correct pattern")
            else:
                self.log_issue("HIGH", "Uploaded photo URL doesn't follow expected pattern", 
                             f"URL: {uploaded_photo_url}")
        else:
            print("❌ Photo upload failed")
            self.log_issue("CRITICAL", "Photo upload failed", "Cannot test retrieval without upload")
            return
        
        # Test GET profile photo after upload
        success, response = self.run_test(
            "Get Profile Photo (After Upload)",
            "GET",
            "users/profile-photo",
            200,
            token=test_token
        )
        
        if success and response:
            if 'photo_url' in response and response['photo_url'] == uploaded_photo_url:
                print("✅ GET profile photo returns correct URL after upload")
            else:
                self.log_issue("HIGH", "GET profile photo returns incorrect URL", 
                             f"Expected: {uploaded_photo_url}, Got: {response.get('photo_url')}")
        else:
            self.log_issue("CRITICAL", "Cannot retrieve profile photo after upload", 
                         "Photo retrieval API not working")
        
        # Test GET user profile to check photo integration
        success, response = self.run_test(
            "Get User Profile (Check Photo Integration)",
            "GET",
            "users/profile",
            200,
            token=test_token
        )
        
        if success and response:
            if 'profile_photo' in response and response['profile_photo'] == uploaded_photo_url:
                print("✅ Profile photo correctly integrated in user profile")
            else:
                self.log_issue("HIGH", "Profile photo not integrated in user profile", 
                             f"Expected: {uploaded_photo_url}, Got: {response.get('profile_photo')}")
        
        # Test public photo access (GET /users/{userId}/profile-photo)
        success, response = self.run_test(
            "Get User Photo (Public Access)",
            "GET",
            f"users/{test_user['id']}/profile-photo",
            200
        )
        
        if success and response:
            if 'photo_url' in response and response['photo_url'] == uploaded_photo_url:
                print("✅ Public photo access works correctly")
            else:
                self.log_issue("MEDIUM", "Public photo access returns incorrect URL", 
                             f"Expected: {uploaded_photo_url}, Got: {response.get('photo_url')}")
        else:
            self.log_issue("HIGH", "Public photo access not working", 
                         "Users cannot view each other's photos")

    def test_user_authentication_and_photo_association(self):
        """Test 4: User Authentication & Photo Association"""
        print("\n" + "="*70)
        print("TEST 4: USER AUTHENTICATION & PHOTO ASSOCIATION")
        print("="*70)
        
        # Test authentication requirements
        print("🔍 Testing authentication requirements...")
        
        # Test accessing profile photo without authentication
        success, response = self.run_test(
            "Get Profile Photo (No Auth)",
            "GET",
            "users/profile-photo",
            403  # Should require authentication
        )
        
        if success:
            print("✅ Profile photo endpoint correctly requires authentication")
        else:
            self.log_issue("HIGH", "Profile photo endpoint doesn't require authentication", 
                         "Security issue - unauthenticated access allowed")
        
        # Test uploading photo without authentication
        test_image_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\tpHYs\x00\x00\x0b\x13\x00\x00\x0b\x13\x01\x00\x9a\x9c\x18\x00\x00\x00\nIDATx\x9cc```\x00\x04\x00\x01\x00\x01\xdd\x8d\xb4\x1c\x00\x00\x00\x00IEND\xaeB`\x82'
        files = {'file': ('test_photo.png', io.BytesIO(test_image_data), 'image/png')}
        
        success, response = self.run_test(
            "Upload Photo (No Auth)",
            "POST",
            "users/profile-photo",
            403,
            files=files
        )
        
        if success:
            print("✅ Photo upload correctly requires authentication")
        else:
            self.log_issue("HIGH", "Photo upload doesn't require authentication", 
                         "Security issue - unauthenticated upload allowed")
        
        # Test with specific user if available in database
        if self.db:
            try:
                # Look for users with photos to test association
                users_with_photos = list(self.db.users.find(
                    {"profile_photo": {"$ne": None, "$exists": True}},
                    {"id": 1, "email": 1, "profile_photo": 1}
                ).limit(3))
                
                print(f"\n🔍 Testing photo association for {len(users_with_photos)} users...")
                
                for user in users_with_photos:
                    user_id = user.get('id')
                    photo_url = user.get('profile_photo')
                    
                    if user_id and photo_url:
                        # Test public access to this user's photo
                        success, response = self.run_test(
                            f"Public Photo Access - {user.get('email', 'Unknown')}",
                            "GET",
                            f"users/{user_id}/profile-photo",
                            200
                        )
                        
                        if success and response:
                            if response.get('photo_url') == photo_url:
                                print(f"✅ Photo correctly associated with user {user_id}")
                            else:
                                self.log_issue("HIGH", f"Photo association incorrect for user {user_id}", 
                                             f"DB: {photo_url}, API: {response.get('photo_url')}")
                        else:
                            self.log_issue("HIGH", f"Cannot access photo for user {user_id}", 
                                         "Photo association or API issue")
                            
            except Exception as e:
                print(f"❌ Error testing photo association: {e}")
                self.log_issue("MEDIUM", "Error testing photo association", str(e))

    def test_specific_files_mentioned_in_issue(self):
        """Test 5: Test specific files mentioned in the issue"""
        print("\n" + "="*70)
        print("TEST 5: SPECIFIC FILES FROM ISSUE REPORT")
        print("="*70)
        
        # Files mentioned in the issue
        specific_files = [
            "3048b294-9a70-47b3-a84d-884aecff3d77_1759216000.png",
            "3048b294-9a70-47b3-a84d-884aecff3d77_1759216011.png"
        ]
        
        print("🔍 Testing specific files mentioned in issue report...")
        
        for filename in specific_files:
            # Check if file exists on filesystem
            file_path = Path(f"uploads/profile_photos/{filename}")
            if file_path.exists():
                file_size = file_path.stat().st_size
                print(f"✅ File exists on filesystem: {filename} ({file_size} bytes)")
                
                # Test static file serving
                photo_url = f"/api/uploads/profile_photos/{filename}"
                print(f"   Testing URL: {self.base_url.replace('/api', '')}{photo_url}")
                
                success, response = self.run_test(
                    f"Static File Access - {filename}",
                    "GET",
                    f"../uploads/profile_photos/{filename}",
                    200
                )
                
                if success and response:
                    content_type = response.get('content_type', '')
                    content_length = response.get('content_length', 0)
                    
                    if content_type.startswith('image/'):
                        print(f"✅ File serves as image: {content_type}")
                    elif content_type.startswith('text/html'):
                        self.log_issue("CRITICAL", f"File {filename} returns HTML instead of image", 
                                     "Kubernetes routing issue confirmed")
                    else:
                        self.log_issue("HIGH", f"File {filename} returns unexpected content", 
                                     f"Content-Type: {content_type}")
                else:
                    self.log_issue("CRITICAL", f"Cannot access file {filename}", 
                                 "Static file serving broken for specific files")
            else:
                print(f"❌ File not found on filesystem: {filename}")
                self.log_issue("HIGH", f"File {filename} mentioned in issue not found", 
                             "Files may have been deleted or moved")
        
        # Check if these files are associated with any user in database
        if self.db:
            try:
                for filename in specific_files:
                    photo_url = f"/api/uploads/profile_photos/{filename}"
                    user = self.db.users.find_one({"profile_photo": photo_url})
                    
                    if user:
                        print(f"✅ File {filename} is associated with user: {user.get('email', 'Unknown')}")
                        
                        # Check if this is the erta@gmail.com user
                        if user.get('email') == 'erta@gmail.com':
                            print(f"🎯 FOUND: File {filename} belongs to erta@gmail.com user!")
                            print(f"   User ID: {user.get('id')}")
                            print(f"   Name: {user.get('first_name')} {user.get('last_name')}")
                    else:
                        print(f"⚠️ File {filename} not associated with any user in database")
                        self.log_issue("MEDIUM", f"File {filename} exists but not linked to user", 
                                     "Orphaned file or database inconsistency")
                        
            except Exception as e:
                print(f"❌ Error checking file associations: {e}")
                self.log_issue("MEDIUM", "Error checking file associations in database", str(e))

    def generate_summary_report(self):
        """Generate a comprehensive summary report"""
        print("\n" + "="*70)
        print("PROFILE PHOTO DEBUG TEST SUMMARY REPORT")
        print("="*70)
        
        print(f"\n📊 TEST STATISTICS:")
        print(f"   Tests Run: {self.tests_run}")
        print(f"   Tests Passed: {self.tests_passed}")
        print(f"   Success Rate: {(self.tests_passed/self.tests_run*100):.1f}%" if self.tests_run > 0 else "N/A")
        
        print(f"\n🚨 ISSUES FOUND: {len(self.issues_found)}")
        
        if self.issues_found:
            # Group issues by severity
            critical_issues = [i for i in self.issues_found if i['severity'] == 'CRITICAL']
            high_issues = [i for i in self.issues_found if i['severity'] == 'HIGH']
            medium_issues = [i for i in self.issues_found if i['severity'] == 'MEDIUM']
            low_issues = [i for i in self.issues_found if i['severity'] == 'LOW']
            
            if critical_issues:
                print(f"\n🚨 CRITICAL ISSUES ({len(critical_issues)}):")
                for i, issue in enumerate(critical_issues, 1):
                    print(f"   {i}. {issue['issue']}")
                    if issue['details']:
                        print(f"      → {issue['details']}")
            
            if high_issues:
                print(f"\n⚠️ HIGH PRIORITY ISSUES ({len(high_issues)}):")
                for i, issue in enumerate(high_issues, 1):
                    print(f"   {i}. {issue['issue']}")
                    if issue['details']:
                        print(f"      → {issue['details']}")
            
            if medium_issues:
                print(f"\n📝 MEDIUM PRIORITY ISSUES ({len(medium_issues)}):")
                for i, issue in enumerate(medium_issues, 1):
                    print(f"   {i}. {issue['issue']}")
            
            if low_issues:
                print(f"\n ℹ️ LOW PRIORITY ISSUES ({len(low_issues)}):")
                for i, issue in enumerate(low_issues, 1):
                    print(f"   {i}. {issue['issue']}")
        else:
            print("✅ No issues found!")
        
        print(f"\n🔍 ROOT CAUSE ANALYSIS:")
        
        # Analyze the issues to determine root cause
        has_routing_issue = any("HTML instead of image" in issue['issue'] or "routing" in issue['details'].lower() 
                               for issue in self.issues_found)
        has_database_issue = any("database" in issue['issue'].lower() or "MongoDB" in issue['details'] 
                                for issue in self.issues_found)
        has_api_issue = any("API" in issue['issue'] or "endpoint" in issue['issue'].lower() 
                           for issue in self.issues_found)
        
        if has_routing_issue:
            print("   🎯 KUBERNETES ROUTING ISSUE DETECTED:")
            print("      Static photo URLs are being routed to React frontend instead of backend")
            print("      This causes photos to return HTML instead of image content")
            print("      SOLUTION: Fix Kubernetes ingress routing for /api/uploads/* paths")
        
        if has_database_issue:
            print("   🎯 DATABASE INTEGRATION ISSUE DETECTED:")
            print("      Photos may not be properly saved to or retrieved from database")
            print("      SOLUTION: Check database connection and photo URL storage logic")
        
        if has_api_issue:
            print("   🎯 API ENDPOINT ISSUE DETECTED:")
            print("      Profile photo API endpoints may not be working correctly")
            print("      SOLUTION: Check backend API implementation and authentication")
        
        if not (has_routing_issue or has_database_issue or has_api_issue):
            if len(self.issues_found) == 0:
                print("   ✅ No major issues detected - profile photo system appears functional")
            else:
                print("   🤔 Issues found but root cause unclear - manual investigation needed")
        
        print(f"\n📋 RECOMMENDATIONS:")
        if has_routing_issue:
            print("   1. URGENT: Fix Kubernetes ingress routing for static files")
            print("   2. Ensure /api/uploads/* routes to backend, not frontend")
        if has_database_issue:
            print("   3. Verify database connection and photo URL storage")
        if has_api_issue:
            print("   4. Test API endpoints manually and check authentication")
        
        print("   5. Test with real user account (erta@gmail.com) to reproduce issue")
        print("   6. Check browser developer tools for JavaScript errors")
        print("   7. Verify frontend photo display logic")

    def run_all_tests(self):
        """Run all profile photo debug tests"""
        print("🚀 Starting Profile Photo Display Issue Debug Tests")
        print("=" * 70)
        
        try:
            self.test_database_photo_urls()
            self.test_static_file_serving()
            self.test_profile_photo_retrieval_api()
            self.test_user_authentication_and_photo_association()
            self.test_specific_files_mentioned_in_issue()
            
        except KeyboardInterrupt:
            print("\n⚠️ Tests interrupted by user")
        except Exception as e:
            print(f"\n❌ Unexpected error during testing: {e}")
            self.log_issue("CRITICAL", "Unexpected error during testing", str(e))
        finally:
            if self.mongo_client:
                self.mongo_client.close()
            
            self.generate_summary_report()

if __name__ == "__main__":
    tester = ProfilePhotoDebugTester()
    tester.run_all_tests()