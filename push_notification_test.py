#!/usr/bin/env python3
"""
Focused Push Notification Token Endpoint Testing
Tests the newly implemented push notification endpoints for mobile app integration
"""

import requests
import json
from datetime import datetime

class PushNotificationTester:
    def __init__(self, base_url="https://westafricaboost.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.client_token = None
        self.worker_token = None
        self.client_user = None
        self.worker_user = None
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
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers)

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

    def setup_test_users(self):
        """Create test users for push notification testing"""
        print("\n" + "="*60)
        print("SETTING UP TEST USERS FOR PUSH NOTIFICATION TESTING")
        print("="*60)
        
        # Create client user
        client_data = {
            "email": f"push_client_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "TestPass123!",
            "first_name": "Push",
            "last_name": "Client",
            "phone": "+221701234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr"
        }
        
        success, response = self.run_test(
            "Create Client User",
            "POST",
            "auth/register",
            200,
            data=client_data
        )
        
        if success and 'access_token' in response:
            self.client_token = response['access_token']
            self.client_user = response['user']
            print(f"   Client ID: {self.client_user['id']}")
        
        # Create worker user
        worker_data = {
            "email": f"push_worker_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "TestPass123!",
            "first_name": "Push",
            "last_name": "Worker",
            "phone": "+223701234567",
            "user_type": "worker",
            "country": "mali",
            "preferred_language": "fr"
        }
        
        success, response = self.run_test(
            "Create Worker User",
            "POST",
            "auth/register",
            200,
            data=worker_data
        )
        
        if success and 'access_token' in response:
            self.worker_token = response['access_token']
            self.worker_user = response['user']
            print(f"   Worker ID: {self.worker_user['id']}")

    def test_push_notification_endpoints(self):
        """Test all push notification token endpoints"""
        print("\n" + "="*60)
        print("TESTING PUSH NOTIFICATION TOKEN ENDPOINTS")
        print("="*60)
        
        if not self.client_token or not self.worker_token:
            print("❌ Cannot test push notifications - missing user tokens")
            return
        
        # Test 1: Register iOS push token
        print(f"\n🔍 Testing iOS Push Token Registration...")
        ios_token_data = {
            "user_id": self.client_user['id'],
            "push_token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
            "device_type": "ios",
            "device_id": "iPhone_12_Pro_Max_001"
        }
        
        success, response = self.run_test(
            "Register iOS Push Token",
            "POST",
            "users/push-token",
            200,
            data=ios_token_data,
            token=self.client_token
        )
        
        ios_token_id = None
        if success and 'token_id' in response:
            ios_token_id = response['token_id']
            print(f"   ✅ iOS Token ID: {ios_token_id}")
            if response.get('action') == 'created':
                print(f"   ✅ New iOS token created successfully")
        
        # Test 2: Register Android push token
        print(f"\n🔍 Testing Android Push Token Registration...")
        android_token_data = {
            "user_id": self.client_user['id'],
            "push_token": "ExponentPushToken[yyyyyyyyyyyyyyyyyyyyyy]",
            "device_type": "android",
            "device_id": "Samsung_Galaxy_S21_001"
        }
        
        success, response = self.run_test(
            "Register Android Push Token",
            "POST",
            "users/push-token",
            200,
            data=android_token_data,
            token=self.client_token
        )
        
        android_token_id = None
        if success and 'token_id' in response:
            android_token_id = response['token_id']
            print(f"   ✅ Android Token ID: {android_token_id}")
        
        # Test 3: Register Web push token
        print(f"\n🔍 Testing Web Push Token Registration...")
        web_token_data = {
            "user_id": self.client_user['id'],
            "push_token": "ExponentPushToken[zzzzzzzzzzzzzzzzzzzzzz]",
            "device_type": "web",
            "device_id": "Chrome_Browser_001"
        }
        
        success, response = self.run_test(
            "Register Web Push Token",
            "POST",
            "users/push-token",
            200,
            data=web_token_data,
            token=self.client_token
        )
        
        web_token_id = None
        if success and 'token_id' in response:
            web_token_id = response['token_id']
            print(f"   ✅ Web Token ID: {web_token_id}")
        
        # Test 4: Update existing token (same device registration)
        print(f"\n🔍 Testing Token Update (Same Device Registration)...")
        updated_ios_token_data = {
            "user_id": self.client_user['id'],
            "push_token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx_updated]",
            "device_type": "ios",
            "device_id": "iPhone_12_Pro_Max_001"  # Same device ID
        }
        
        success, response = self.run_test(
            "Update Existing iOS Push Token",
            "POST",
            "users/push-token",
            200,
            data=updated_ios_token_data,
            token=self.client_token
        )
        
        if success and response.get('action') == 'updated':
            print(f"   ✅ Existing token updated successfully")
        
        # Test 5: Authentication requirement
        print(f"\n🔍 Testing Authentication Requirement...")
        self.run_test(
            "Register Push Token Without Authentication",
            "POST",
            "users/push-token",
            403,
            data=ios_token_data
        )
        
        # Test 6: Invalid device type validation
        print(f"\n🔍 Testing Invalid Device Type Validation...")
        invalid_device_data = {
            "user_id": self.client_user['id'],
            "push_token": "ExponentPushToken[invaliddevicetype]",
            "device_type": "invalid_device",  # Invalid device type
            "device_id": "Invalid_Device_001"
        }
        
        self.run_test(
            "Register Push Token with Invalid Device Type",
            "POST",
            "users/push-token",
            422,  # Validation error
            data=invalid_device_data,
            token=self.client_token
        )
        
        # Test 7: Security check - user can only register tokens for themselves
        print(f"\n🔍 Testing Security Check (User ID Mismatch)...")
        security_test_data = {
            "user_id": self.worker_user['id'],  # Different user ID
            "push_token": "ExponentPushToken[securitytest]",
            "device_type": "ios",
            "device_id": "Security_Test_Device"
        }
        
        self.run_test(
            "Register Push Token for Different User (Should Fail)",
            "POST",
            "users/push-token",
            403,
            data=security_test_data,
            token=self.client_token  # Client token but worker user_id
        )
        
        # Test 8: Invalid push token format
        print(f"\n🔍 Testing Invalid Push Token Format...")
        invalid_token_data = {
            "user_id": self.client_user['id'],
            "push_token": "short",  # Too short
            "device_type": "ios",
            "device_id": "Invalid_Token_Test"
        }
        
        self.run_test(
            "Register Push Token with Invalid Format",
            "POST",
            "users/push-token",
            422,  # Validation error
            data=invalid_token_data,
            token=self.client_token
        )
        
        # Test 9: Get all push tokens for user
        print(f"\n🔍 Testing Get All Push Tokens...")
        success, response = self.run_test(
            "Get All Push Tokens for User",
            "GET",
            "users/push-tokens",
            200,
            token=self.client_token
        )
        
        if success and response:
            token_count = response.get('count', 0)
            tokens = response.get('tokens', [])
            print(f"   ✅ Retrieved {token_count} push tokens")
            
            # Verify token structure
            if tokens and len(tokens) > 0:
                first_token = tokens[0]
                required_fields = ['id', 'device_type', 'created_at', 'updated_at']
                for field in required_fields:
                    if field in first_token:
                        print(f"   ✅ Token contains required field: {field}")
                    else:
                        print(f"   ❌ Token missing required field: {field}")
        
        # Test 10: Get push tokens without authentication
        print(f"\n🔍 Testing Get Push Tokens Without Authentication...")
        self.run_test(
            "Get Push Tokens Without Authentication",
            "GET",
            "users/push-tokens",
            403
        )
        
        # Test 11: Delete push token
        print(f"\n🔍 Testing Delete Push Token...")
        if ios_token_id:
            success, response = self.run_test(
                "Delete iOS Push Token",
                "DELETE",
                f"users/push-token/{ios_token_id}",
                200,
                token=self.client_token
            )
            
            if success:
                print(f"   ✅ Push token deleted successfully")
        
        # Test 12: Delete non-existent token
        print(f"\n🔍 Testing Delete Non-Existent Token...")
        fake_token_id = "non_existent_token_id_12345"
        self.run_test(
            "Delete Non-Existent Push Token",
            "DELETE",
            f"users/push-token/{fake_token_id}",
            404,
            token=self.client_token
        )
        
        # Test 13: Delete token without authentication
        print(f"\n🔍 Testing Delete Token Without Authentication...")
        if android_token_id:
            self.run_test(
                "Delete Push Token Without Authentication",
                "DELETE",
                f"users/push-token/{android_token_id}",
                403
            )
        
        # Test 14: Worker user push token registration
        print(f"\n🔍 Testing Worker Push Token Registration...")
        worker_token_data = {
            "user_id": self.worker_user['id'],
            "push_token": "ExponentPushToken[workerdevicetoken]",
            "device_type": "android",
            "device_id": "Worker_Android_Device_001"
        }
        
        success, response = self.run_test(
            "Register Worker Push Token",
            "POST",
            "users/push-token",
            200,
            data=worker_token_data,
            token=self.worker_token
        )
        
        worker_token_id = None
        if success and 'token_id' in response:
            worker_token_id = response['token_id']
            print(f"   ✅ Worker Token ID: {worker_token_id}")
        
        # Test 15: Verify worker can only delete their own tokens
        print(f"\n🔍 Testing Token Ownership Security...")
        if worker_token_id and web_token_id:
            # Worker tries to delete client's token (should fail)
            self.run_test(
                "Worker Delete Client Token (Should Fail)",
                "DELETE",
                f"users/push-token/{web_token_id}",
                404,  # Token not found for this user
                token=self.worker_token
            )
        
        # Test 16: Realistic Expo push token formats
        print(f"\n🔍 Testing Realistic Expo Push Token Formats...")
        realistic_tokens = [
            "ExponentPushToken[AbCdEfGhIjKlMnOpQrStUv]",
            "ExponentPushToken[1234567890abcdef123456]",
            "ExponentPushToken[ABCDEFGHIJKLMNOPQRSTUVWXYZ]"
        ]
        
        for i, token in enumerate(realistic_tokens):
            realistic_token_data = {
                "user_id": self.client_user['id'],
                "push_token": token,
                "device_type": "ios",
                "device_id": f"Realistic_Test_Device_{i}"
            }
            
            self.run_test(
                f"Realistic Expo Token Format {i+1}",
                "POST",
                "users/push-token",
                200,
                data=realistic_token_data,
                token=self.client_token
            )
        
        # Test 17: Missing optional device_id (should work)
        print(f"\n🔍 Testing Missing Optional Device ID...")
        no_device_id_data = {
            "user_id": self.client_user['id'],
            "push_token": "ExponentPushToken[nodeviceidtest]",
            "device_type": "web"
            # No device_id field
        }
        
        self.run_test(
            "Push Token Without Device ID",
            "POST",
            "users/push-token",
            200,
            data=no_device_id_data,
            token=self.client_token
        )

    def run_all_tests(self):
        """Run all push notification tests"""
        print("🚀 Starting Push Notification Token Endpoint Testing...")
        print(f"Base URL: {self.base_url}")
        
        # First check if backend is healthy
        success, _ = self.run_test("Backend Health Check", "GET", "health", 200)
        if not success:
            print("❌ Backend is not healthy - cannot proceed with tests")
            return False
        
        self.setup_test_users()
        self.test_push_notification_endpoints()
        
        print("\n" + "="*60)
        print("🎯 PUSH NOTIFICATION TEST RESULTS")
        print("="*60)
        print(f"Total Tests Run: {self.tests_run}")
        print(f"Tests Passed: {self.tests_passed}")
        print(f"Tests Failed: {self.tests_run - self.tests_passed}")
        print(f"Success Rate: {(self.tests_passed/self.tests_run)*100:.1f}%")
        
        if self.tests_passed == self.tests_run:
            print("🎉 ALL PUSH NOTIFICATION TESTS PASSED!")
            print("✅ Push notification endpoints are working correctly")
            print("✅ Mobile app integration is ready")
        else:
            print(f"⚠️  {self.tests_run - self.tests_passed} tests failed. Please review.")
        
        return self.tests_passed == self.tests_run

if __name__ == "__main__":
    tester = PushNotificationTester()
    tester.run_all_tests()