#!/usr/bin/env python3
"""
KOJO JOB MANAGEMENT SUPPLEMENT TEST
==================================
Quick test for job management with mechanic requirements
"""

import requests
import json
from datetime import datetime, timezone

def test_job_management():
    base_url = "https://local-connect-43.preview.emergentagent.com/api"
    
    print("🔧 TESTING JOB MANAGEMENT WITH MECHANIC REQUIREMENTS")
    print("="*60)
    
    # Create a client user first
    timestamp = datetime.now().strftime('%H%M%S%f')[:-3]
    client_data = {
        "email": f"job_client_{timestamp}@test.com",
        "password": "TestPass123!",
        "first_name": "Job",
        "last_name": "Creator",
        "phone": "+221701234567",
        "user_type": "client",
        "country": "senegal",
        "preferred_language": "fr"
    }
    
    print("1. Creating test client...")
    response = requests.post(f"{base_url}/auth/register", json=client_data)
    if response.status_code == 200:
        client_token = response.json()['access_token']
        print("   ✅ Client created successfully")
        
        # Test job creation with mechanic requirements
        job_data = {
            "title": "Réparation moteur avec outils spécialisés",
            "description": "Réparation complète du moteur d'une voiture. Le mécanicien doit apporter ses propres outils spécialisés et certaines pièces de rechange.",
            "category": "Mécanique Automobile",
            "budget_min": 50000.0,
            "budget_max": 75000.0,
            "location": {
                "city": "Dakar",
                "district": "Plateau",
                "address": "Avenue Léopold Sédar Senghor"
            },
            "required_skills": ["Mécanique", "Diagnostic moteur", "Réparation"],
            "estimated_duration": "2-3 jours",
            "mechanic_must_bring_parts": True,
            "mechanic_must_bring_tools": True,
            "parts_and_tools_notes": "Le mécanicien doit apporter : clés spécialisées, scanner OBD, pièces de rechange courantes (filtres, bougies, courroies). Le client fournira les pièces majeures après diagnostic."
        }
        
        print("2. Creating job with mechanic requirements...")
        headers = {'Authorization': f'Bearer {client_token}', 'Content-Type': 'application/json'}
        response = requests.post(f"{base_url}/jobs", json=job_data, headers=headers)
        
        if response.status_code == 200:
            job = response.json()
            job_id = job['id']
            print("   ✅ Job created successfully")
            print(f"   📋 Job ID: {job_id}")
            print(f"   🔧 Mechanic must bring parts: {job.get('mechanic_must_bring_parts')}")
            print(f"   🛠️  Mechanic must bring tools: {job.get('mechanic_must_bring_tools')}")
            
            # Test job retrieval
            print("3. Retrieving job details...")
            response = requests.get(f"{base_url}/jobs/{job_id}", headers=headers)
            if response.status_code == 200:
                job_details = response.json()
                print("   ✅ Job details retrieved successfully")
                
                # Verify mechanic requirements fields
                mechanic_fields = ['mechanic_must_bring_parts', 'mechanic_must_bring_tools', 'parts_and_tools_notes']
                for field in mechanic_fields:
                    if field in job_details:
                        print(f"   ✅ Field '{field}': {job_details[field]}")
                    else:
                        print(f"   ❌ Missing field: {field}")
            else:
                print(f"   ❌ Failed to retrieve job: {response.status_code}")
            
            # Test job listing with query parameters
            print("4. Testing job listing with query parameters...")
            response = requests.get(f"{base_url}/jobs?limit=10&category=Mécanique Automobile", headers=headers)
            if response.status_code == 200:
                jobs = response.json()
                print(f"   ✅ Job listing successful - Found {len(jobs)} jobs")
            else:
                print(f"   ❌ Job listing failed: {response.status_code}")
                
        else:
            print(f"   ❌ Job creation failed: {response.status_code} - {response.text}")
    else:
        print(f"   ❌ Client creation failed: {response.status_code}")

if __name__ == "__main__":
    test_job_management()