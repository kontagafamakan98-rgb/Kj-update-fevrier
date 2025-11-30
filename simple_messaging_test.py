#!/usr/bin/env python3
"""
Simple Messaging Test to verify core functionality
"""

import requests
import json
import time

def test_messaging_core():
    base_url = "https://local-connect-43.preview.emergentagent.com/api"
    
    print("🔍 Testing Messaging System Core Functionality")
    print("="*60)
    
    # Step 1: Create test users
    print("\n1. Creating test users...")
    
    client_data = {
        "email": f"msg_client_{int(time.time())}@test.com",
        "password": "TestPass123!",
        "first_name": "Test",
        "last_name": "Client",
        "phone": "+221701234567",
        "user_type": "client",
        "country": "senegal",
        "preferred_language": "fr"
    }
    
    try:
        response = requests.post(f"{base_url}/auth/register", json=client_data, timeout=10)
        print(f"   Client registration: {response.status_code}")
        if response.status_code == 200:
            client_token = response.json()['access_token']
            client_user = response.json()['user']
            print(f"   Client ID: {client_user['id']}")
        else:
            print(f"   Error: {response.text}")
            return
    except Exception as e:
        print(f"   Client registration failed: {e}")
        return
    
    worker_data = {
        "email": f"msg_worker_{int(time.time())}@test.com",
        "password": "TestPass123!",
        "first_name": "Test",
        "last_name": "Worker",
        "phone": "+223701234567",
        "user_type": "worker",
        "country": "mali",
        "preferred_language": "fr"
    }
    
    try:
        response = requests.post(f"{base_url}/auth/register", json=worker_data, timeout=10)
        print(f"   Worker registration: {response.status_code}")
        if response.status_code == 200:
            worker_token = response.json()['access_token']
            worker_user = response.json()['user']
            print(f"   Worker ID: {worker_user['id']}")
        else:
            print(f"   Error: {response.text}")
            return
    except Exception as e:
        print(f"   Worker registration failed: {e}")
        return
    
    # Step 2: Test sending messages
    print("\n2. Testing message sending...")
    
    message_data = {
        "receiver_id": worker_user['id'],
        "content": "Bonjour, j'ai besoin d'aide pour un travail de plomberie."
    }
    
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {client_token}'
    }
    
    try:
        response = requests.post(f"{base_url}/messages", json=message_data, headers=headers, timeout=10)
        print(f"   Send message (client to worker): {response.status_code}")
        if response.status_code != 200:
            print(f"   Error: {response.text}")
    except Exception as e:
        print(f"   Send message failed: {e}")
    
    # Reply from worker
    reply_data = {
        "receiver_id": client_user['id'],
        "content": "Bonjour! Je peux vous aider. Quel est le problème exactement?"
    }
    
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {worker_token}'
    }
    
    try:
        response = requests.post(f"{base_url}/messages", json=reply_data, headers=headers, timeout=10)
        print(f"   Send reply (worker to client): {response.status_code}")
        if response.status_code != 200:
            print(f"   Error: {response.text}")
    except Exception as e:
        print(f"   Send reply failed: {e}")
    
    # Step 3: Test getting conversations
    print("\n3. Testing conversation retrieval...")
    
    headers = {
        'Authorization': f'Bearer {client_token}'
    }
    
    try:
        response = requests.get(f"{base_url}/messages/conversations", headers=headers, timeout=10)
        print(f"   Get conversations (client): {response.status_code}")
        if response.status_code == 200:
            conversations = response.json()
            print(f"   Found {len(conversations)} conversation(s)")
        else:
            print(f"   Error: {response.text}")
    except Exception as e:
        print(f"   Get conversations failed: {e}")
    
    # Step 4: Test getting specific conversation
    print("\n4. Testing specific conversation retrieval...")
    
    conversation_id = f"{min(client_user['id'], worker_user['id'])}_{max(client_user['id'], worker_user['id'])}"
    print(f"   Conversation ID: {conversation_id}")
    
    try:
        response = requests.get(f"{base_url}/messages/{conversation_id}", headers=headers, timeout=10)
        print(f"   Get conversation messages: {response.status_code}")
        if response.status_code == 200:
            messages = response.json()
            print(f"   Found {len(messages)} message(s)")
            for i, msg in enumerate(messages):
                print(f"     Message {i+1}: {msg.get('content', 'No content')[:50]}...")
        else:
            print(f"   Error: {response.text}")
    except Exception as e:
        print(f"   Get conversation messages failed: {e}")
    
    # Step 5: Test authentication requirements
    print("\n5. Testing authentication requirements...")
    
    try:
        response = requests.post(f"{base_url}/messages", json=message_data, timeout=10)
        print(f"   Send message without auth: {response.status_code}")
        if response.status_code in [401, 403]:
            print("   ✅ Authentication properly required")
        else:
            print("   ❌ Authentication not properly enforced")
    except Exception as e:
        print(f"   Auth test failed: {e}")
    
    try:
        response = requests.get(f"{base_url}/messages/conversations", timeout=10)
        print(f"   Get conversations without auth: {response.status_code}")
        if response.status_code in [401, 403]:
            print("   ✅ Authentication properly required")
        else:
            print("   ❌ Authentication not properly enforced")
    except Exception as e:
        print(f"   Auth test failed: {e}")
    
    print("\n✅ Messaging system core functionality test completed!")

if __name__ == "__main__":
    test_messaging_core()