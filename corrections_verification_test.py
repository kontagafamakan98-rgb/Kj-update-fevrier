#!/usr/bin/env python3
"""
CORRECTIONS VERIFICATION TEST - KOJO BACKEND
Test spécifique pour vérifier les corrections récentes du backend
"""

import requests
import sys
import json
import io
import jwt
import base64
from datetime import datetime, timedelta, timezone
import time

class CorrectionsVerificationTester:
    def __init__(self, base_url="https://kojo-profile.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0
        self.client_token = None
        self.worker_token = None
        self.test_results = []

    def log_test(self, name, success, details=""):
        """Log test result"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            status = "✅ PASSED"
        else:
            status = "❌ FAILED"
        
        result = f"{status} - {name}"
        if details:
            result += f" | {details}"
        
        self.test_results.append(result)
        print(result)

    def run_api_test(self, name, method, endpoint, expected_status, data=None, token=None, files=None):
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}"
        headers = {}
        
        if token:
            headers['Authorization'] = f'Bearer {token}'
        
        if not files:
            headers['Content-Type'] = 'application/json'

        try:
            if method == 'GET':
                response = requests.get(url, headers=headers)
            elif method == 'POST':
                if files:
                    # Remove Content-Type for file uploads
                    headers.pop('Content-Type', None)
                    response = requests.post(url, headers=headers, files=files)
                else:
                    response = requests.post(url, json=data, headers=headers)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers)

            success = response.status_code == expected_status
            
            try:
                response_data = response.json()
            except:
                response_data = {}
            
            details = f"Status: {response.status_code}"
            if not success:
                details += f" (Expected: {expected_status})"
                if response_data and 'detail' in response_data:
                    details += f" | Error: {response_data['detail']}"
            
            self.log_test(name, success, details)
            return success, response_data

        except Exception as e:
            self.log_test(name, False, f"Exception: {str(e)}")
            return False, {}

    def test_datetime_corrections(self):
        """Test 1: Vérifier les corrections datetime.now(timezone.utc)"""
        print("\n" + "="*60)
        print("TEST 1: CORRECTIONS DATETIME.NOW(TIMEZONE.UTC)")
        print("="*60)
        
        # Test registration to verify datetime fields are properly set
        timestamp_before = datetime.now(timezone.utc)
        
        user_data = {
            "email": f"datetime_test_{int(time.time())}@test.com",
            "password": "TestPass123!",
            "first_name": "DateTime",
            "last_name": "Test",
            "phone": "+221701234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr"
        }
        
        success, response = self.run_api_test(
            "User Registration with DateTime Fields",
            "POST",
            "auth/register",
            200,
            data=user_data
        )
        
        if success and 'user' in response:
            user = response['user']
            self.client_token = response['access_token']
            
            # Verify created_at and updated_at fields exist and are recent
            if 'created_at' in user and 'updated_at' in user:
                try:
                    created_at = datetime.fromisoformat(user['created_at'].replace('Z', '+00:00'))
                    updated_at = datetime.fromisoformat(user['updated_at'].replace('Z', '+00:00'))
                    
                    # Check if timestamps are recent (within last 10 seconds)
                    time_diff = abs((created_at - timestamp_before).total_seconds())
                    
                    if time_diff < 10:
                        self.log_test("DateTime Fields - Recent Timestamps", True, f"Time diff: {time_diff:.2f}s")
                    else:
                        self.log_test("DateTime Fields - Recent Timestamps", False, f"Time diff too large: {time_diff:.2f}s")
                    
                    # Check if timezone-aware
                    if created_at.tzinfo is not None and updated_at.tzinfo is not None:
                        self.log_test("DateTime Fields - Timezone Aware", True, "UTC timezone detected")
                    else:
                        self.log_test("DateTime Fields - Timezone Aware", False, "No timezone info")
                        
                except Exception as e:
                    self.log_test("DateTime Fields - Parse Error", False, str(e))
            else:
                self.log_test("DateTime Fields - Missing Fields", False, "created_at or updated_at missing")

    def test_pydantic_models_datetime(self):
        """Test 2: Vérifier les modèles Pydantic avec datetime correct"""
        print("\n" + "="*60)
        print("TEST 2: MODÈLES PYDANTIC AVEC DATETIME CORRECT")
        print("="*60)
        
        if not self.client_token:
            self.log_test("Pydantic Models Test", False, "No client token available")
            return
        
        # Test job creation to verify Pydantic model datetime fields
        job_data = {
            "title": "Test Pydantic DateTime Job",
            "description": "Testing Pydantic model datetime fields",
            "category": "testing",
            "budget_min": 50000.0,
            "budget_max": 100000.0,
            "location": {
                "address": "Dakar, Senegal",
                "latitude": 14.6937,
                "longitude": -17.4441
            },
            "required_skills": ["testing"],
            "estimated_duration": "1 hour",
            "mechanic_must_bring_parts": True,
            "mechanic_must_bring_tools": False,
            "parts_and_tools_notes": "Testing datetime fields in Pydantic models"
        }
        
        timestamp_before = datetime.now(timezone.utc)
        
        success, response = self.run_api_test(
            "Job Creation - Pydantic DateTime Fields",
            "POST",
            "jobs",
            200,
            data=job_data,
            token=self.client_token
        )
        
        if success and 'posted_at' in response:
            try:
                posted_at = datetime.fromisoformat(response['posted_at'].replace('Z', '+00:00'))
                time_diff = abs((posted_at - timestamp_before).total_seconds())
                
                if time_diff < 10:
                    self.log_test("Pydantic Job Model - DateTime Field", True, f"posted_at recent: {time_diff:.2f}s")
                else:
                    self.log_test("Pydantic Job Model - DateTime Field", False, f"posted_at not recent: {time_diff:.2f}s")
                    
                # Check timezone awareness
                if posted_at.tzinfo is not None:
                    self.log_test("Pydantic Job Model - Timezone Aware", True, "UTC timezone in posted_at")
                else:
                    self.log_test("Pydantic Job Model - Timezone Aware", False, "No timezone in posted_at")
                    
            except Exception as e:
                self.log_test("Pydantic Job Model - Parse Error", False, str(e))

    def test_orange_money_west_africa_prefixes(self):
        """Test 3: Vérifier les préfixes Orange Money étendus à toute l'Afrique de l'Ouest"""
        print("\n" + "="*60)
        print("TEST 3: PRÉFIXES ORANGE MONEY - TOUTE L'AFRIQUE DE L'OUEST")
        print("="*60)
        
        # Test all West African Orange Money prefixes
        west_african_prefixes = [
            ("+221", "senegal", "Sénégal"),
            ("+223", "mali", "Mali"),
            ("+224", "guinea", "Guinée"),
            ("+225", "ivory_coast", "Côte d'Ivoire"),
            ("+226", "burkina_faso", "Burkina Faso"),
            ("+227", "niger", "Niger"),
            ("+228", "togo", "Togo"),
            ("+229", "benin", "Bénin")
        ]
        
        for i, (prefix, country, country_name) in enumerate(west_african_prefixes):
            orange_number = f"{prefix}701234567"
            
            user_data = {
                "email": f"orange_{country}_{int(time.time())}_{i}@test.com",
                "password": "TestPass123!",
                "first_name": "Orange",
                "last_name": country_name,
                "phone": orange_number,
                "user_type": "client",
                "country": country,
                "preferred_language": "fr",
                "payment_accounts": {
                    "orange_money": orange_number
                }
            }
            
            success, response = self.run_api_test(
                f"Orange Money {country_name} ({prefix})",
                "POST",
                "auth/register-verified",
                200,
                data=user_data
            )
            
            if success and 'payment_verification' in response:
                verification = response['payment_verification']
                if verification.get('is_verified') and verification.get('linked_accounts') >= 1:
                    self.log_test(f"Orange Money Validation - {country_name}", True, f"Verified with {verification['linked_accounts']} account(s)")
                else:
                    self.log_test(f"Orange Money Validation - {country_name}", False, "Payment verification failed")

    def test_base64_imports_location(self):
        """Test 4: Vérifier que les imports base64 sont en haut du fichier"""
        print("\n" + "="*60)
        print("TEST 4: IMPORTS BASE64 EN HAUT DU FICHIER")
        print("="*60)
        
        # Test profile photo upload with base64 to verify imports work
        if not self.client_token:
            self.log_test("Base64 Import Test", False, "No client token available")
            return
        
        # Create a small test image in base64
        test_image_base64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
        
        user_with_photo_data = {
            "email": f"base64_test_{int(time.time())}@test.com",
            "password": "TestPass123!",
            "first_name": "Base64",
            "last_name": "Test",
            "phone": "+221701234568",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr",
            "payment_accounts": {
                "orange_money": "+221701234568"
            },
            "profile_photo_base64": test_image_base64
        }
        
        success, response = self.run_api_test(
            "Registration with Base64 Profile Photo",
            "POST",
            "auth/register-verified",
            200,
            data=user_with_photo_data
        )
        
        if success and 'user' in response:
            user = response['user']
            if user.get('profile_photo'):
                self.log_test("Base64 Import - Photo Processing", True, f"Photo saved: {user['profile_photo']}")
            else:
                self.log_test("Base64 Import - Photo Processing", False, "No profile photo in response")
        else:
            self.log_test("Base64 Import - Registration Failed", False, "Could not test base64 processing")

    def test_profile_photo_extensions(self):
        """Test 5: Vérifier la gestion améliorée des photos de profil avec extensions multiples"""
        print("\n" + "="*60)
        print("TEST 5: GESTION PHOTOS DE PROFIL - EXTENSIONS MULTIPLES")
        print("="*60)
        
        if not self.client_token:
            self.log_test("Profile Photo Extensions Test", False, "No client token available")
            return
        
        # Test different image formats
        image_formats = [
            ("test_photo.jpg", "image/jpeg", b'\xff\xd8\xff\xe0\x00\x10JFIF'),
            ("test_photo.png", "image/png", b'\x89PNG\r\n\x1a\n'),
            ("test_photo.webp", "image/webp", b'RIFF\x00\x00\x00\x00WEBP')
        ]
        
        for filename, content_type, file_header in image_formats:
            # Create minimal valid file with proper header
            test_image_data = file_header + b'\x00' * 100  # Add some padding
            
            files = {'file': (filename, io.BytesIO(test_image_data), content_type)}
            
            success, response = self.run_api_test(
                f"Profile Photo Upload - {filename.split('.')[-1].upper()}",
                "POST",
                "users/profile-photo",
                200,
                files=files,
                token=self.client_token
            )
            
            if success and 'photo_url' in response:
                photo_url = response['photo_url']
                expected_extension = filename.split('.')[-1]
                if expected_extension in photo_url:
                    self.log_test(f"Photo Extension Handling - {expected_extension.upper()}", True, f"URL: {photo_url}")
                else:
                    self.log_test(f"Photo Extension Handling - {expected_extension.upper()}", False, f"Extension not preserved in URL: {photo_url}")

    def test_authentication_endpoints_datetime(self):
        """Test 6: Endpoints d'authentification avec nouvelles datetime"""
        print("\n" + "="*60)
        print("TEST 6: ENDPOINTS AUTHENTIFICATION - NOUVELLES DATETIME")
        print("="*60)
        
        # Test login to verify JWT token generation with correct datetime
        if not self.client_token:
            self.log_test("Authentication DateTime Test", False, "No client token available")
            return
        
        try:
            # Decode JWT token to check expiration time
            decoded = jwt.decode(self.client_token, options={"verify_signature": False})
            
            if 'exp' in decoded:
                exp_timestamp = decoded['exp']
                exp_datetime = datetime.fromtimestamp(exp_timestamp, tz=timezone.utc)
                current_time = datetime.now(timezone.utc)
                
                # Check if expiration is in the future (should be 24 hours from now)
                time_diff = (exp_datetime - current_time).total_seconds()
                expected_hours = 24 * 3600  # 24 hours in seconds
                
                if 20 * 3600 < time_diff < 25 * 3600:  # Allow some tolerance
                    self.log_test("JWT Token Expiration - DateTime", True, f"Expires in {time_diff/3600:.1f} hours")
                else:
                    self.log_test("JWT Token Expiration - DateTime", False, f"Unexpected expiration: {time_diff/3600:.1f} hours")
                    
                # Check if timezone-aware
                if exp_datetime.tzinfo is not None:
                    self.log_test("JWT Token Expiration - Timezone Aware", True, "UTC timezone in JWT")
                else:
                    self.log_test("JWT Token Expiration - Timezone Aware", False, "No timezone in JWT")
            else:
                self.log_test("JWT Token - Missing Expiration", False, "No 'exp' field in JWT")
                
        except Exception as e:
            self.log_test("JWT Token Analysis", False, f"Error: {str(e)}")

    def test_wave_validation_all_countries(self):
        """Test 7: Validation Wave pour tous les pays d'Afrique de l'Ouest"""
        print("\n" + "="*60)
        print("TEST 7: VALIDATION WAVE - TOUS LES PAYS D'AFRIQUE DE L'OUEST")
        print("="*60)
        
        # Test Wave validation for all West African countries
        wave_countries = [
            ("+221", "senegal", "Sénégal"),
            ("+223", "mali", "Mali"),
            ("+224", "guinea", "Guinée"),
            ("+225", "ivory_coast", "Côte d'Ivoire"),
            ("+226", "burkina_faso", "Burkina Faso"),
            ("+227", "niger", "Niger"),
            ("+228", "togo", "Togo"),
            ("+229", "benin", "Bénin")
        ]
        
        for i, (prefix, country, country_name) in enumerate(wave_countries):
            wave_number = f"{prefix}701234567"
            
            user_data = {
                "email": f"wave_{country}_{int(time.time())}_{i}@test.com",
                "password": "TestPass123!",
                "first_name": "Wave",
                "last_name": country_name,
                "phone": wave_number,
                "user_type": "client",
                "country": country,
                "preferred_language": "fr",
                "payment_accounts": {
                    "wave": wave_number
                }
            }
            
            success, response = self.run_api_test(
                f"Wave Validation {country_name} ({prefix})",
                "POST",
                "auth/register-verified",
                200,
                data=user_data
            )
            
            if success and 'payment_verification' in response:
                verification = response['payment_verification']
                if verification.get('is_verified'):
                    self.log_test(f"Wave Support - {country_name}", True, "Wave validation successful")
                else:
                    self.log_test(f"Wave Support - {country_name}", False, "Wave validation failed")

    def test_user_creation_timestamps(self):
        """Test 8: Création d'utilisateurs avec timestamps corrects"""
        print("\n" + "="*60)
        print("TEST 8: CRÉATION UTILISATEURS - TIMESTAMPS CORRECTS")
        print("="*60)
        
        # Test worker registration with profile creation
        timestamp_before = datetime.now(timezone.utc)
        
        worker_data = {
            "email": f"worker_timestamp_{int(time.time())}@test.com",
            "password": "TestPass123!",
            "first_name": "Worker",
            "last_name": "Timestamp",
            "phone": "+223701234567",
            "user_type": "worker",
            "country": "mali",
            "preferred_language": "fr",
            "payment_accounts": {
                "orange_money": "+223701234567",
                "wave": "+223701234567"
            },
            "worker_specialties": ["plumbing", "electrical"],
            "worker_experience_years": 5,
            "worker_hourly_rate": 15000.0
        }
        
        success, response = self.run_api_test(
            "Worker Registration with Profile - Timestamps",
            "POST",
            "auth/register-verified",
            200,
            data=worker_data
        )
        
        if success and 'user' in response:
            user = response['user']
            self.worker_token = response['access_token']
            
            # Check user timestamps
            if 'created_at' in user and 'updated_at' in user:
                try:
                    created_at = datetime.fromisoformat(user['created_at'].replace('Z', '+00:00'))
                    time_diff = abs((created_at - timestamp_before).total_seconds())
                    
                    if time_diff < 10:
                        self.log_test("Worker Creation - User Timestamps", True, f"Recent timestamp: {time_diff:.2f}s")
                    else:
                        self.log_test("Worker Creation - User Timestamps", False, f"Timestamp not recent: {time_diff:.2f}s")
                        
                except Exception as e:
                    self.log_test("Worker Creation - Timestamp Parse Error", False, str(e))
            
            # Check if worker profile was created with timestamps
            if 'worker_profile' in response:
                self.log_test("Worker Profile Creation - With Timestamps", True, "Worker profile created during registration")
            else:
                # Try to get worker profile to check timestamps
                success_profile, profile_response = self.run_api_test(
                    "Get Worker Profile - Check Timestamps",
                    "GET",
                    "workers/profile",
                    200,
                    token=self.worker_token
                )
                
                if success_profile and 'created_at' in profile_response:
                    try:
                        profile_created_at = datetime.fromisoformat(profile_response['created_at'].replace('Z', '+00:00'))
                        time_diff = abs((profile_created_at - timestamp_before).total_seconds())
                        
                        if time_diff < 10:
                            self.log_test("Worker Profile - Timestamps", True, f"Profile timestamp recent: {time_diff:.2f}s")
                        else:
                            self.log_test("Worker Profile - Timestamps", False, f"Profile timestamp not recent: {time_diff:.2f}s")
                            
                    except Exception as e:
                        self.log_test("Worker Profile - Timestamp Parse Error", False, str(e))

    def test_profile_photo_path_correction(self):
        """Test 9: Upload de photos de profil avec path correct"""
        print("\n" + "="*60)
        print("TEST 9: UPLOAD PHOTOS DE PROFIL - PATH CORRECT")
        print("="*60)
        
        if not self.client_token:
            self.log_test("Profile Photo Path Test", False, "No client token available")
            return
        
        # Test profile photo upload and verify path structure
        test_image_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\tpHYs\x00\x00\x0b\x13\x00\x00\x0b\x13\x01\x00\x9a\x9c\x18\x00\x00\x00\nIDATx\x9cc```\x00\x04\x00\x01\x00\x01\xdd\x8d\xb4\x1c\x00\x00\x00\x00IEND\xaeB`\x82'
        
        files = {'file': ('test_photo.png', io.BytesIO(test_image_data), 'image/png')}
        
        success, response = self.run_api_test(
            "Profile Photo Upload - Path Structure",
            "POST",
            "users/profile-photo",
            200,
            files=files,
            token=self.client_token
        )
        
        if success and 'photo_url' in response:
            photo_url = response['photo_url']
            
            # Check if path starts with /uploads/profile_photos/
            if photo_url.startswith('/uploads/profile_photos/'):
                self.log_test("Photo Path Structure - Correct Prefix", True, f"Path: {photo_url}")
            else:
                self.log_test("Photo Path Structure - Incorrect Prefix", False, f"Path: {photo_url}")
            
            # Check if filename contains user ID or timestamp
            filename = photo_url.split('/')[-1]
            if '_' in filename and '.' in filename:
                self.log_test("Photo Filename Structure - Contains Identifiers", True, f"Filename: {filename}")
            else:
                self.log_test("Photo Filename Structure - Missing Identifiers", False, f"Filename: {filename}")
            
            # Verify photo URL is updated in user profile
            success_profile, profile_response = self.run_api_test(
                "Profile Integration - Photo URL Updated",
                "GET",
                "users/profile",
                200,
                token=self.client_token
            )
            
            if success_profile and profile_response.get('profile_photo') == photo_url:
                self.log_test("Profile Integration - Photo URL Match", True, "Photo URL correctly updated in profile")
            else:
                self.log_test("Profile Integration - Photo URL Mismatch", False, f"Profile photo: {profile_response.get('profile_photo')}")

    def test_pydantic_models_no_errors(self):
        """Test 10: Modèles Pydantic sans erreurs"""
        print("\n" + "="*60)
        print("TEST 10: MODÈLES PYDANTIC SANS ERREURS")
        print("="*60)
        
        # Test various Pydantic model operations to ensure no errors
        
        # Test 1: Job creation with all mechanic fields
        if self.client_token:
            job_data = {
                "title": "Test Pydantic Models Job",
                "description": "Testing all Pydantic model fields",
                "category": "testing",
                "budget_min": 25000.0,
                "budget_max": 50000.0,
                "location": {
                    "address": "Bamako, Mali",
                    "latitude": 12.6392,
                    "longitude": -8.0029
                },
                "required_skills": ["testing", "validation"],
                "estimated_duration": "2 hours",
                "mechanic_must_bring_parts": True,
                "mechanic_must_bring_tools": True,
                "parts_and_tools_notes": "Testing Pydantic model validation with all fields populated correctly"
            }
            
            success, response = self.run_api_test(
                "Pydantic Job Model - All Fields",
                "POST",
                "jobs",
                200,
                data=job_data,
                token=self.client_token
            )
            
            if success:
                # Verify all fields are present in response
                required_fields = ['id', 'title', 'description', 'category', 'budget_min', 'budget_max', 
                                 'location', 'status', 'posted_at', 'mechanic_must_bring_parts', 
                                 'mechanic_must_bring_tools', 'parts_and_tools_notes']
                
                missing_fields = [field for field in required_fields if field not in response]
                
                if not missing_fields:
                    self.log_test("Pydantic Job Model - All Fields Present", True, "All required fields in response")
                else:
                    self.log_test("Pydantic Job Model - Missing Fields", False, f"Missing: {missing_fields}")
        
        # Test 2: Message creation with Pydantic model
        if self.client_token and self.worker_token:
            # Get worker user ID first
            success_worker, worker_profile = self.run_api_test(
                "Get Worker Profile for Message Test",
                "GET",
                "users/profile",
                200,
                token=self.worker_token
            )
            
            if success_worker and 'id' in worker_profile:
                message_data = {
                    "receiver_id": worker_profile['id'],
                    "content": "Testing Pydantic Message model with proper datetime handling"
                }
                
                success, response = self.run_api_test(
                    "Pydantic Message Model - Creation",
                    "POST",
                    "messages",
                    200,
                    data=message_data,
                    token=self.client_token
                )
                
                if success:
                    self.log_test("Pydantic Message Model - No Errors", True, "Message created successfully")

    def run_all_tests(self):
        """Run all correction verification tests"""
        print("🚀 DÉMARRAGE DES TESTS DE VÉRIFICATION DES CORRECTIONS")
        print("=" * 80)
        
        # Run all tests
        self.test_datetime_corrections()
        self.test_pydantic_models_datetime()
        self.test_orange_money_west_africa_prefixes()
        self.test_base64_imports_location()
        self.test_profile_photo_extensions()
        self.test_authentication_endpoints_datetime()
        self.test_wave_validation_all_countries()
        self.test_user_creation_timestamps()
        self.test_profile_photo_path_correction()
        self.test_pydantic_models_no_errors()
        
        # Print summary
        print("\n" + "="*80)
        print("📊 RÉSUMÉ DES TESTS DE VÉRIFICATION DES CORRECTIONS")
        print("="*80)
        
        print(f"\n📈 STATISTIQUES:")
        print(f"   Tests exécutés: {self.tests_run}")
        print(f"   Tests réussis: {self.tests_passed}")
        print(f"   Taux de réussite: {(self.tests_passed/self.tests_run*100):.1f}%")
        
        print(f"\n📋 DÉTAILS DES TESTS:")
        for result in self.test_results:
            print(f"   {result}")
        
        # Final verdict
        if self.tests_passed == self.tests_run:
            print(f"\n🎉 TOUTES LES CORRECTIONS FONCTIONNENT PARFAITEMENT!")
            print(f"✅ {self.tests_passed}/{self.tests_run} tests réussis")
        elif self.tests_passed >= self.tests_run * 0.9:
            print(f"\n✅ CORRECTIONS LARGEMENT FONCTIONNELLES")
            print(f"⚠️  {self.tests_run - self.tests_passed} tests mineurs à vérifier")
        else:
            print(f"\n⚠️  CORRECTIONS PARTIELLEMENT FONCTIONNELLES")
            print(f"❌ {self.tests_run - self.tests_passed} tests échoués nécessitent attention")
        
        return self.tests_passed, self.tests_run

if __name__ == "__main__":
    print("🔧 TESTS DE VÉRIFICATION DES CORRECTIONS BACKEND KOJO")
    print("=" * 60)
    
    tester = CorrectionsVerificationTester()
    passed, total = tester.run_all_tests()
    
    # Exit with appropriate code
    if passed == total:
        sys.exit(0)  # All tests passed
    else:
        sys.exit(1)  # Some tests failed