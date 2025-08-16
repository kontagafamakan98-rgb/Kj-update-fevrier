#!/usr/bin/env python3
"""
Profile Photo Static File Serving Test
Tests the static file serving functionality for uploaded profile photos
"""

import requests
import io
import sys
from datetime import datetime

def test_static_file_serving():
    """Test static file serving for profile photos"""
    base_url = "https://profile-photo-fix-1.preview.emergentagent.com/api"
    
    print("🚀 Testing Profile Photo Static File Serving")
    print(f"Base URL: {base_url}")
    
    # Step 1: Register a test user
    print("\n📝 Step 1: Registering test user...")
    user_data = {
        "email": f"static_test_{datetime.now().strftime('%H%M%S')}@test.com",
        "password": "TestPass123!",
        "first_name": "Static",
        "last_name": "Test",
        "phone": "+221701234567",
        "user_type": "client",
        "country": "senegal",
        "preferred_language": "fr"
    }
    
    try:
        response = requests.post(f"{base_url}/auth/register", json=user_data)
        if response.status_code == 200:
            token = response.json()['access_token']
            print("✅ User registered successfully")
        else:
            print(f"❌ Registration failed: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Registration error: {e}")
        return False
    
    # Step 2: Upload a profile photo
    print("\n📤 Step 2: Uploading profile photo...")
    
    # Create a small test image (1x1 pixel PNG)
    test_image_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\tpHYs\x00\x00\x0b\x13\x00\x00\x0b\x13\x01\x00\x9a\x9c\x18\x00\x00\x00\nIDATx\x9cc```\x00\x00\x00\x04\x00\x01\xdd\x8d\xb4\x1c\x00\x00\x00\x00IEND\xaeB`\x82'
    
    files = {'file': ('test_photo.png', io.BytesIO(test_image_data), 'image/png')}
    headers = {'Authorization': f'Bearer {token}'}
    
    try:
        response = requests.post(f"{base_url}/users/profile-photo", headers=headers, files=files)
        if response.status_code == 200:
            photo_data = response.json()
            photo_url = photo_data['photo_url']
            print(f"✅ Photo uploaded successfully")
            print(f"   Photo URL: {photo_url}")
        else:
            print(f"❌ Upload failed: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Upload error: {e}")
        return False
    
    # Step 3: Test static file serving
    print("\n🌐 Step 3: Testing static file serving...")
    
    # Construct the full URL for the static file
    static_url = f"https://profile-photo-fix-1.preview.emergentagent.com{photo_url}"
    print(f"   Static URL: {static_url}")
    
    try:
        response = requests.get(static_url)
        if response.status_code == 200:
            print("✅ Static file served successfully")
            print(f"   Content-Type: {response.headers.get('content-type', 'Not specified')}")
            print(f"   Content-Length: {len(response.content)} bytes")
            
            # Verify it's actually an image
            if response.content.startswith(b'\x89PNG'):
                print("✅ File is a valid PNG image")
            else:
                print("⚠️  File content doesn't appear to be PNG")
                
        else:
            print(f"❌ Static file serving failed: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Static file serving error: {e}")
        return False
    
    # Step 4: Test non-existent file (should return 404)
    print("\n🔍 Step 4: Testing non-existent file...")
    
    fake_url = "https://profile-photo-fix-1.preview.emergentagent.com/uploads/profile_photos/nonexistent.jpg"
    
    try:
        response = requests.get(fake_url)
        if response.status_code == 404:
            print("✅ Non-existent file returns 404 as expected")
        else:
            print(f"⚠️  Non-existent file returned: {response.status_code}")
    except Exception as e:
        print(f"❌ Non-existent file test error: {e}")
    
    # Step 5: Clean up - delete the photo
    print("\n🗑️  Step 5: Cleaning up...")
    
    try:
        response = requests.delete(f"{base_url}/users/profile-photo", headers=headers)
        if response.status_code == 200:
            print("✅ Photo deleted successfully")
        else:
            print(f"⚠️  Delete failed: {response.status_code}")
    except Exception as e:
        print(f"❌ Delete error: {e}")
    
    print("\n🎉 Static file serving test completed successfully!")
    return True

if __name__ == "__main__":
    success = test_static_file_serving()
    sys.exit(0 if success else 1)