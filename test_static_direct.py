#!/usr/bin/env python3
"""
Direct test of static file serving after upload
"""

import requests
import io
from datetime import datetime

def test_direct_static():
    base_url = "https://profile-photo-fix-1.preview.emergentagent.com/api"
    
    # Register user
    user_data = {
        "email": f"direct_test_{datetime.now().strftime('%H%M%S')}@test.com",
        "password": "TestPass123!",
        "first_name": "Direct",
        "last_name": "Test",
        "phone": "+221701234567",
        "user_type": "client",
        "country": "senegal",
        "preferred_language": "fr"
    }
    
    response = requests.post(f"{base_url}/auth/register", json=user_data)
    token = response.json()['access_token']
    
    # Upload photo
    test_image_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\tpHYs\x00\x00\x0b\x13\x00\x00\x0b\x13\x01\x00\x9a\x9c\x18\x00\x00\x00\nIDATx\x9cc```\x00\x00\x00\x04\x00\x01\xdd\x8d\xb4\x1c\x00\x00\x00\x00IEND\xaeB`\x82'
    files = {'file': ('test.png', io.BytesIO(test_image_data), 'image/png')}
    headers = {'Authorization': f'Bearer {token}'}
    
    response = requests.post(f"{base_url}/users/profile-photo", headers=headers, files=files)
    photo_data = response.json()
    photo_url = photo_data['photo_url']
    
    print(f"Photo uploaded: {photo_url}")
    
    # Test static serving
    static_url = f"https://profile-photo-fix-1.preview.emergentagent.com{photo_url}"
    print(f"Testing: {static_url}")
    
    response = requests.get(static_url)
    print(f"Status: {response.status_code}")
    print(f"Content-Type: {response.headers.get('content-type')}")
    print(f"Content-Length: {len(response.content)}")
    
    # Check first few bytes
    if len(response.content) > 10:
        print(f"First 10 bytes: {response.content[:10]}")
        
    # Check if it's PNG
    if response.content.startswith(b'\x89PNG'):
        print("✅ Valid PNG file served")
    else:
        print("❌ Not a PNG file")
        print(f"Content preview: {response.text[:200] if response.text else 'No text content'}")

if __name__ == "__main__":
    test_direct_static()