#!/usr/bin/env python3
"""
Add Free AI Providers to OmniRoute
====================================
Based on research of free AI API providers (2026)

Free Providers to Add:
1. Google AI Studio (Gemini) - Free tier
2. Groq - Free tier with Llama models
3. OpenRouter - Free tier with some models
4. HuggingFace - Free inference
5. GitHub Models - Free tier
6. NVIDIA NIM - Free tier
"""

import sqlite3
import uuid
import json
from datetime import datetime
from pathlib import Path

# Configuration
DB_PATH = Path.home() / ".omniroute" / "storage.sqlite"

def get_db_connection():
    """Connect to OmniRoute SQLite database."""
    if not DB_PATH.exists():
        print(f"ERROR: Database not found at {DB_PATH}")
        return None
    return sqlite3.connect(str(DB_PATH))

def add_provider(provider_id, name, base_url, api_key="free-tier", models=None, description=""):
    """Add a free provider to OmniRoute."""
    conn = get_db_connection()
    if not conn:
        return False
    
    cursor = conn.cursor()
    
    # Check if provider already exists
    cursor.execute("""
        SELECT COUNT(*) FROM provider_connections 
        WHERE provider = ? AND name = ?
    """, (provider_id, name))
    
    if cursor.fetchone()[0] > 0:
        print(f"  ⚠️  {name} already exists, skipping")
        conn.close()
        return True
    
    # Generate unique ID
    connection_id = str(uuid.uuid4())
    
    # Provider-specific data
    provider_data = {
        "base_url": base_url,
        "models": models or [],
        "description": description,
        "free_tier": True,
        "rate_limit": "Free tier",
        "added_at": datetime.now().isoformat()
    }
    
    # Insert provider
    cursor.execute("""
        INSERT INTO provider_connections 
        (id, provider, name, api_key, is_active, created_at, updated_at, 
         auth_type, priority, default_model, provider_specific_data)
        VALUES (?, ?, ?, ?, 1, ?, ?, 'api_key', ?, ?, ?)
    """, (
        connection_id,
        provider_id,
        name,
        api_key,
        datetime.now().isoformat(),
        datetime.now().isoformat(),
        100,  # Low priority (free tier)
        models[0] if models else "default",
        json.dumps(provider_data)
    ))
    
    conn.commit()
    conn.close()
    
    print(f"  ✅ {name} added successfully")
    return True

def main():
    print("Adding Free AI Providers to OmniRoute...")
    print("=" * 50)
    
    # Define free providers based on research
    free_providers = [
        {
            "provider_id": "openai-compatible-chat",
            "name": "Google AI Studio (Gemini Free)",
            "base_url": "https://generativelanguage.googleapis.com/v1beta",
            "api_key": "free-tier",
            "models": ["gemini-2.5-flash", "gemini-2.5-pro"],
            "description": "Google AI Studio free tier - Gemini models"
        },
        {
            "provider_id": "openai-compatible-chat",
            "name": "Groq (Llama Free)",
            "base_url": "https://api.groq.com/openai/v1",
            "api_key": "free-tier",
            "models": ["llama-3.3-70b", "llama-4-scout", "qwen3"],
            "description": "Groq free tier - Fast inference with Llama models"
        },
        {
            "provider_id": "openai-compatible-chat",
            "name": "OpenRouter (Free Tier)",
            "base_url": "https://openrouter.ai/api/v1",
            "api_key": "free-tier",
            "models": ["deepseek-r1", "llama-4", "qwen3"],
            "description": "OpenRouter free tier - 50 requests/day"
        },
        {
            "provider_id": "openai-compatible-chat",
            "name": "HuggingFace (Free Inference)",
            "base_url": "https://api-inference.huggingface.co/models",
            "api_key": "free-tier",
            "models": ["distilbert", "gpt-3", "llama-3.3-70b"],
            "description": "HuggingFace free inference - Thousands of models"
        },
        {
            "provider_id": "openai-compatible-chat",
            "name": "GitHub Models (Free Tier)",
            "base_url": "https://models.inference.ai.azure.com",
            "api_key": "free-tier",
            "models": ["gpt-4o", "gpt-4.1", "o3", "grok-3"],
            "description": "GitHub Models free tier - 50-150 requests/day"
        },
        {
            "provider_id": "openai-compatible-chat",
            "name": "NVIDIA NIM (Free Tier)",
            "base_url": "https://integrate.api.nvidia.com/v1",
            "api_key": "free-tier",
            "models": ["deepseek-r1", "llama", "kimi-k2.5"],
            "description": "NVIDIA NIM free tier - 1K credits"
        }
    ]
    
    # Add each provider
    for provider in free_providers:
        add_provider(**provider)
    
    print("=" * 50)
    print("✅ Free providers added successfully!")
    print("\nNote: These providers need API keys to work.")
    print("Get free API keys from:")
    print("  - Google AI Studio: https://aistudio.google.com/")
    print("  - Groq: https://console.groq.com/")
    print("  - OpenRouter: https://openrouter.ai/")
    print("  - HuggingFace: https://huggingface.co/")
    print("  - GitHub Models: https://github.com/marketplace/models")
    print("  - NVIDIA NIM: https://build.nvidia.com/")
    print("\nThen update the api_key field in the database.")

if __name__ == "__main__":
    main()
