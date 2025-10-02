#!/usr/bin/env python3
"""
Profile Photo Display Issue Investigation
=========================================

This script investigates the specific issue where a user uploaded a photo 
but it's not showing after login. We'll check:

1. Database Check: Verify if profile photos are stored in the database
2. File Storage Verification: Check if uploaded files exist on the server  
3. API Response Testing: Test the profile photo endpoints
4. URL Construction: Test photo URL accessibility
5. User Context: Check how profile photos are loaded in the frontend

"""

import requests
import sys
import json
import io
import os
import pymongo
from datetime import datetime
from pathlib import Path

class ProfilePhotoInvestigator:
    def __init__(self, base_url="https://kojo-profile.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.test_token = None
        self.test_user = None
        self.findings = []
        
    def log_finding(self, category, status, message, details=None):
        """Log investigation findings"""
        finding = {
            "category": category,
            "status": status,  # "✅ PASS", "❌ FAIL", "⚠️ WARNING", "ℹ️ INFO"
            "message": message,
            "details": details or {},
            "timestamp": datetime.now().isoformat()
        }
        self.findings.append(finding)
        print(f"{status} {category}: {message}")
        if details:
            for key, value in details.items():
                print(f"   {key}: {value}")
        print()

    def setup_test_user(self):
        """Create a test user for investigation"""
        print("🔧 Setting up test user for investigation...")
        
        # Register a test user
        user_data = {
            "email": f"photo_test_{datetime.now().strftime('%H%M%S')}@investigation.com",
            "password": "PhotoTest123!",
            "first_name": "Photo",
            "last_name": "TestUser",
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
                self.log_finding("SETUP", "✅ PASS", "Test user created successfully", {
                    "user_id": self.test_user['id'],
                    "email": self.test_user['email']
                })
                return True
            else:
                self.log_finding("SETUP", "❌ FAIL", f"Failed to create test user: {response.status_code}", {
                    "response": response.text
                })
                return False
        except Exception as e:
            self.log_finding("SETUP", "❌ FAIL", f"Error creating test user: {str(e)}")
            return False

    def investigate_database_storage(self):
        """1. Database Check: Verify if profile photos are stored in the database"""
        print("🔍 INVESTIGATION 1: Database Storage Check")
        print("=" * 60)
        
        try:
            # Try to connect to MongoDB to check database directly
            mongo_url = "mongodb://localhost:27017"
            client = pymongo.MongoClient(mongo_url)
            db = client['kojo_database']
            
            # Check if any users have profile photos
            users_with_photos = list(db.users.find(
                {"profile_photo": {"$ne": None}}, 
                {"id": 1, "email": 1, "profile_photo": 1, "first_name": 1, "last_name": 1}
            ).limit(10))
            
            if users_with_photos:
                self.log_finding("DATABASE", "✅ PASS", f"Found {len(users_with_photos)} users with profile photos", {
                    "sample_users": [
                        {
                            "user_id": user.get('id', 'N/A'),
                            "email": user.get('email', 'N/A'),
                            "photo_url": user.get('profile_photo', 'N/A')
                        } for user in users_with_photos[:3]
                    ]
                })
            else:
                self.log_finding("DATABASE", "⚠️ WARNING", "No users found with profile photos in database")
            
            # Check recent uploads (last 24 hours)
            from datetime import datetime, timedelta
            yesterday = datetime.now() - timedelta(days=1)
            recent_uploads = list(db.users.find(
                {
                    "profile_photo": {"$ne": None},
                    "updated_at": {"$gte": yesterday.isoformat()}
                },
                {"id": 1, "email": 1, "profile_photo": 1, "updated_at": 1}
            ).limit(5))
            
            if recent_uploads:
                self.log_finding("DATABASE", "ℹ️ INFO", f"Found {len(recent_uploads)} recent photo uploads", {
                    "recent_uploads": [
                        {
                            "user_id": user.get('id', 'N/A'),
                            "photo_url": user.get('profile_photo', 'N/A'),
                            "updated_at": user.get('updated_at', 'N/A')
                        } for user in recent_uploads
                    ]
                })
            else:
                self.log_finding("DATABASE", "ℹ️ INFO", "No recent photo uploads found in last 24 hours")
                
        except Exception as e:
            self.log_finding("DATABASE", "❌ FAIL", f"Could not connect to database: {str(e)}")

    def investigate_file_storage(self):
        """2. File Storage Verification: Check if uploaded files exist on the server"""
        print("🔍 INVESTIGATION 2: File Storage Verification")
        print("=" * 60)
        
        # Check if uploads directory exists
        uploads_dir = Path("/app/uploads/profile_photos")
        
        if uploads_dir.exists():
            self.log_finding("FILE_STORAGE", "✅ PASS", "Profile photos directory exists", {
                "directory_path": str(uploads_dir)
            })
            
            # List files in directory
            try:
                photo_files = list(uploads_dir.glob("*"))
                if photo_files:
                    self.log_finding("FILE_STORAGE", "✅ PASS", f"Found {len(photo_files)} files in uploads directory", {
                        "file_count": len(photo_files),
                        "sample_files": [f.name for f in photo_files[:5]],
                        "total_size_mb": sum(f.stat().st_size for f in photo_files) / (1024*1024)
                    })
                    
                    # Check file permissions
                    for photo_file in photo_files[:3]:
                        stat = photo_file.stat()
                        self.log_finding("FILE_STORAGE", "ℹ️ INFO", f"File permissions check", {
                            "file": photo_file.name,
                            "size_bytes": stat.st_size,
                            "readable": os.access(photo_file, os.R_OK),
                            "writable": os.access(photo_file, os.W_OK)
                        })
                else:
                    self.log_finding("FILE_STORAGE", "⚠️ WARNING", "No files found in profile photos directory")
                    
            except Exception as e:
                self.log_finding("FILE_STORAGE", "❌ FAIL", f"Error accessing files: {str(e)}")
        else:
            self.log_finding("FILE_STORAGE", "❌ FAIL", "Profile photos directory does not exist", {
                "expected_path": str(uploads_dir)
            })

    def investigate_api_endpoints(self):
        """3. API Response Testing: Test the profile photo endpoints"""
        print("🔍 INVESTIGATION 3: API Endpoints Testing")
        print("=" * 60)
        
        if not self.test_token:
            self.log_finding("API_ENDPOINTS", "❌ FAIL", "No test token available for API testing")
            return
            
        headers = {'Authorization': f'Bearer {self.test_token}'}
        
        # Test 1: GET profile photo (should return 404 initially)
        try:
            response = requests.get(f"{self.base_url}/users/profile-photo", headers=headers)
            if response.status_code == 404:
                self.log_finding("API_ENDPOINTS", "✅ PASS", "GET profile photo returns 404 when no photo exists")
            else:
                self.log_finding("API_ENDPOINTS", "⚠️ WARNING", f"Unexpected response for GET profile photo: {response.status_code}")
        except Exception as e:
            self.log_finding("API_ENDPOINTS", "❌ FAIL", f"Error testing GET profile photo: {str(e)}")
        
        # Test 2: POST profile photo upload
        try:
            # Create a small test image (1x1 PNG)
            test_image_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\tpHYs\x00\x00\x0b\x13\x00\x00\x0b\x13\x01\x00\x9a\x9c\x18\x00\x00\x00\x12IDATx\x9cc```bPPP\x00\x02\xac\x01\x00\x00\x05\x00\x01\r\n-\xdb\x00\x00\x00\x00IEND\xaeB`\x82'
            
            files = {'file': ('test_photo.png', io.BytesIO(test_image_data), 'image/png')}
            response = requests.post(f"{self.base_url}/users/profile-photo", files=files, headers={'Authorization': f'Bearer {self.test_token}'})
            
            if response.status_code == 200:
                data = response.json()
                photo_url = data.get('photo_url')
                self.log_finding("API_ENDPOINTS", "✅ PASS", "Profile photo upload successful", {
                    "photo_url": photo_url,
                    "filename": data.get('filename'),
                    "response": data
                })
                
                # Test 3: GET profile photo after upload (should return 200)
                try:
                    response = requests.get(f"{self.base_url}/users/profile-photo", headers=headers)
                    if response.status_code == 200:
                        data = response.json()
                        self.log_finding("API_ENDPOINTS", "✅ PASS", "GET profile photo after upload successful", {
                            "photo_url": data.get('photo_url'),
                            "user_id": data.get('user_id')
                        })
                    else:
                        self.log_finding("API_ENDPOINTS", "❌ FAIL", f"GET profile photo after upload failed: {response.status_code}")
                except Exception as e:
                    self.log_finding("API_ENDPOINTS", "❌ FAIL", f"Error testing GET profile photo after upload: {str(e)}")
                    
            else:
                self.log_finding("API_ENDPOINTS", "❌ FAIL", f"Profile photo upload failed: {response.status_code}", {
                    "response": response.text
                })
        except Exception as e:
            self.log_finding("API_ENDPOINTS", "❌ FAIL", f"Error testing profile photo upload: {str(e)}")

    def investigate_url_accessibility(self):
        """4. URL Construction: Test photo URL accessibility"""
        print("🔍 INVESTIGATION 4: URL Accessibility Testing")
        print("=" * 60)
        
        if not self.test_token:
            self.log_finding("URL_ACCESS", "❌ FAIL", "No test token available for URL testing")
            return
            
        # First get the user's profile to see if they have a photo URL
        try:
            headers = {'Authorization': f'Bearer {self.test_token}'}
            response = requests.get(f"{self.base_url}/users/profile", headers=headers)
            
            if response.status_code == 200:
                user_data = response.json()
                photo_url = user_data.get('profile_photo')
                
                if photo_url:
                    self.log_finding("URL_ACCESS", "✅ PASS", "User profile contains photo URL", {
                        "photo_url": photo_url
                    })
                    
                    # Test direct access to photo URL
                    if photo_url.startswith('/uploads/'):
                        # Construct full URL
                        full_photo_url = f"https://kojo-profile.preview.emergentagent.com{photo_url}"
                        
                        try:
                            photo_response = requests.get(full_photo_url)
                            if photo_response.status_code == 200:
                                content_type = photo_response.headers.get('content-type', '')
                                self.log_finding("URL_ACCESS", "✅ PASS", "Photo URL is directly accessible", {
                                    "url": full_photo_url,
                                    "content_type": content_type,
                                    "content_length": len(photo_response.content)
                                })
                            else:
                                self.log_finding("URL_ACCESS", "❌ FAIL", f"Photo URL not accessible: {photo_response.status_code}", {
                                    "url": full_photo_url,
                                    "response": photo_response.text[:200]
                                })
                        except Exception as e:
                            self.log_finding("URL_ACCESS", "❌ FAIL", f"Error accessing photo URL: {str(e)}")
                    else:
                        self.log_finding("URL_ACCESS", "⚠️ WARNING", "Photo URL format unexpected", {
                            "photo_url": photo_url
                        })
                else:
                    self.log_finding("URL_ACCESS", "ℹ️ INFO", "User profile does not contain photo URL")
            else:
                self.log_finding("URL_ACCESS", "❌ FAIL", f"Could not get user profile: {response.status_code}")
                
        except Exception as e:
            self.log_finding("URL_ACCESS", "❌ FAIL", f"Error testing URL accessibility: {str(e)}")

    def investigate_user_context(self):
        """5. User Context: Check how profile photos are loaded in the frontend"""
        print("🔍 INVESTIGATION 5: User Context & Frontend Integration")
        print("=" * 60)
        
        if not self.test_token:
            self.log_finding("USER_CONTEXT", "❌ FAIL", "No test token available for context testing")
            return
            
        # Test the user profile endpoint that frontend would use
        try:
            headers = {'Authorization': f'Bearer {self.test_token}'}
            response = requests.get(f"{self.base_url}/users/profile", headers=headers)
            
            if response.status_code == 200:
                user_data = response.json()
                
                # Check all relevant fields for photo display
                relevant_fields = {
                    'id': user_data.get('id'),
                    'email': user_data.get('email'),
                    'first_name': user_data.get('first_name'),
                    'last_name': user_data.get('last_name'),
                    'profile_photo': user_data.get('profile_photo'),
                    'updated_at': user_data.get('updated_at')
                }
                
                self.log_finding("USER_CONTEXT", "✅ PASS", "User profile data structure", relevant_fields)
                
                # Check if AuthContext would have the photo data
                if user_data.get('profile_photo'):
                    self.log_finding("USER_CONTEXT", "✅ PASS", "Profile photo field present in user context")
                else:
                    self.log_finding("USER_CONTEXT", "⚠️ WARNING", "Profile photo field missing or null in user context")
                    
                # Test login response to see if photo is included
                login_data = {
                    "email": self.test_user['email'],
                    "password": "PhotoTest123!"
                }
                
                login_response = requests.post(f"{self.base_url}/auth/login", json=login_data)
                if login_response.status_code == 200:
                    login_data = login_response.json()
                    user_in_login = login_data.get('user', {})
                    
                    if user_in_login.get('profile_photo'):
                        self.log_finding("USER_CONTEXT", "✅ PASS", "Profile photo included in login response", {
                            "photo_url": user_in_login.get('profile_photo')
                        })
                    else:
                        self.log_finding("USER_CONTEXT", "❌ FAIL", "Profile photo NOT included in login response")
                else:
                    self.log_finding("USER_CONTEXT", "❌ FAIL", f"Login test failed: {login_response.status_code}")
                    
            else:
                self.log_finding("USER_CONTEXT", "❌ FAIL", f"Could not get user profile for context testing: {response.status_code}")
                
        except Exception as e:
            self.log_finding("USER_CONTEXT", "❌ FAIL", f"Error testing user context: {str(e)}")

    def run_investigation(self):
        """Run the complete profile photo investigation"""
        print("🔍 PROFILE PHOTO DISPLAY ISSUE INVESTIGATION")
        print("=" * 80)
        print("Investigating why uploaded photos are not showing after login...")
        print("=" * 80)
        
        # Setup
        if not self.setup_test_user():
            print("❌ Investigation aborted - could not setup test user")
            return
            
        # Run all investigations
        self.investigate_database_storage()
        self.investigate_file_storage()
        self.investigate_api_endpoints()
        self.investigate_url_accessibility()
        self.investigate_user_context()
        
        # Summary
        self.print_investigation_summary()

    def print_investigation_summary(self):
        """Print a summary of all findings"""
        print("\n" + "=" * 80)
        print("🔍 INVESTIGATION SUMMARY")
        print("=" * 80)
        
        categories = {}
        for finding in self.findings:
            category = finding['category']
            if category not in categories:
                categories[category] = {'pass': 0, 'fail': 0, 'warning': 0, 'info': 0}
                
            if '✅' in finding['status']:
                categories[category]['pass'] += 1
            elif '❌' in finding['status']:
                categories[category]['fail'] += 1
            elif '⚠️' in finding['status']:
                categories[category]['warning'] += 1
            else:
                categories[category]['info'] += 1
        
        print("\n📊 RESULTS BY CATEGORY:")
        for category, counts in categories.items():
            total = sum(counts.values())
            print(f"\n{category}:")
            print(f"  ✅ Pass: {counts['pass']}/{total}")
            print(f"  ❌ Fail: {counts['fail']}/{total}")
            print(f"  ⚠️ Warning: {counts['warning']}/{total}")
            print(f"  ℹ️ Info: {counts['info']}/{total}")
        
        # Critical issues
        critical_issues = [f for f in self.findings if '❌' in f['status']]
        if critical_issues:
            print(f"\n🚨 CRITICAL ISSUES FOUND ({len(critical_issues)}):")
            for issue in critical_issues:
                print(f"  • {issue['category']}: {issue['message']}")
        
        # Warnings
        warnings = [f for f in self.findings if '⚠️' in f['status']]
        if warnings:
            print(f"\n⚠️ WARNINGS ({len(warnings)}):")
            for warning in warnings:
                print(f"  • {warning['category']}: {warning['message']}")
        
        print(f"\n📋 TOTAL FINDINGS: {len(self.findings)}")
        print("=" * 80)

if __name__ == "__main__":
    investigator = ProfilePhotoInvestigator()
    investigator.run_investigation()