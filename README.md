# 1ai-omniroute

An advanced patch for omniroute to make it spectacular — a collection of modular patches and scripts that enhance OmniRoute with additional providers, model support, and seamless AI aggregation capabilities.

## 🚀 One-Line Installation

```bash
curl -fsSL https://raw.githubusercontent.com/oyi77/1ai-omniroute/main/install.sh | bash
```

Or clone and install manually:

```bash
git clone https://github.com/oyi77/1ai-omniroute.git
cd 1ai-omniroute
./install.sh
```

## What is this?

1ai-omniroute is a collection of patches and scripts that enhance OmniRoute to work with all AI modalities (video, image, vision, audio, etc.) and support additional providers. These patches are designed to be:

- **Modular**: Each patch is a self-contained `.cjs` file
- **Survivable**: Patches are reapplied on every OmniRoute startup
- **Idempotent**: Safe to run multiple times without side effects
- **Production-ready**: Includes systemd service configuration

## What's being added?

### Modular Patches

| Patch | Description |
|-------|-------------|
| **antigravity-no-projectid.cjs** | Fixes "Missing Google projectId" error for Antigravity OAuth accounts |
| **endpoint-router.cjs** | Adds common AI aggregator endpoint aliases (e.g., `/v1/dalle`, `/v1/sora`, `/v1/vision`) |

### Custom Providers

| Provider | Description |
|----------|-------------|
| **BytePlus (Seedance)** | BytePlus Ark platform for video generation |
| **LaoZhang AI** | OpenAI-compatible Sora proxy |
| **EvoLink** | Async webhook-based video generation |
| **Hypereal AI** | Kling-3.0-based video generation |
| **Kie.ai** | Video generation platform |
| **Fal.ai** | Queue-based image + video generation |
| **Replicate** | Image (FLUX) and video (CogVideoX) generation |
| **Vast.ai GPU** | On-demand GPU for video models |
| **Tinker** | Philippine AI provider |
| **OpenCode Zen** | OpenCode AI provider |

### Scripts & Configuration

| Script | Description |
|--------|-------------|
| **install.sh** | One-line installer |
| **patch-providers.sh** | Injects custom providers into compiled OmniRoute bundles |
| **omniroute-update.sh** | Automated update workflow with patch reapplication |
| **omniroute.service** | Systemd service with Antigravity OAuth secret |

## Endpoint Aliases

After installation, these endpoint aliases work automatically:

| Alias | Redirects To |
|-------|--------------|
| `/v1/dalle`, `/v1/stable-diffusion`, `/v1/midjourney` | `/v1/images/generations` |
| `/v1/sora`, `/v1/seedance`, `/v1/kling`, `/v1/runway`, `/v1/pika` | `/v1/videos/generations` |
| `/v1/vision`, `/v1/analyze`, `/v1/describe`, `/v1/ocr` | `/v1/chat/completions` |
| `/v1/transcribe`, `/v1/stt`, `/v1/whisper` | `/v1/audio/transcriptions` |
| `/v1/speech`, `/v1/tts` | `/v1/audio/speech` |
| `/v1/embed`, `/v1/vectorize` | `/v1/embeddings` |
| `/v1/rank`, `/v1/reranker` | `/v1/rerank` |
| `/v1/moderate`, `/v1/content-filter` | `/v1/moderations` |
| `/v1/music`, `/v1/audiogen` | `/v1/music/generations` |

## Supported AI Modalities

| Modality | Endpoint | Status |
|----------|----------|--------|
| **Chat/Completions** | `/v1/chat/completions` | ✅ Native |
| **Image Generation** | `/v1/images/generations` | ✅ Native + Aliases |
| **Video Generation** | `/v1/videos/generations` | ✅ Native + Aliases + Custom Providers |
| **Vision** | `/v1/chat/completions` (with images) | ✅ Native + Aliases |
| **Audio Transcription** | `/v1/audio/transcriptions` | ✅ Native + Aliases |
| **Text-to-Speech** | `/v1/audio/speech` | ✅ Native + Aliases |
| **Embeddings** | `/v1/embeddings` | ✅ Native + Aliases |
| **Reranking** | `/v1/rerank` | ✅ Native + Aliases |
| **Moderations** | `/v1/moderations` | ✅ Native + Aliases |
| **Music Generation** | `/v1/music/generations` | ✅ Native + Aliases |

## How to use this?

### Installation

```bash
# One-liner
curl -fsSL https://raw.githubusercontent.com/oyi77/1ai-omniroute/main/install.sh | bash

# Or clone and install
git clone https://github.com/oyi77/1ai-omniroute.git
cd 1ai-omniroute
./install.sh
```

### Configuration

1. Copy the example environment file:
   ```bash
   cp ~/.omniroute/.env.example ~/.omniroute/.env
   ```

2. Edit with your secrets:
   ```bash
   nano ~/.omniroute/.env
   ```

3. Required secrets:
   - `ANTIGRAVITY_OAUTH_CLIENT_SECRET` - Get from Google Cloud Console
   - `OMNIROUTE_API_KEY` - Your OmniRoute API key

### Verification

```bash
# Check patches are loaded
omniroute --help
# Should show: "🩹 Loaded X openclaw patch(es)"

# Test endpoint aliases
curl -X POST http://localhost:20128/v1/dalle \
  -H "Content-Type: application/json" \
  -d '{"model":"test","prompt":"hello"}'
```

## Documentation

- **[PATCHES.md](docs/PATCHES.md)**: Detailed documentation for each patch
- **[CHANGELOG.md](docs/CHANGELOG.md)**: Project history and changes
- **[CONTRIBUTING.md](docs/CONTRIBUTING.md)**: How to contribute

## How to contribute?

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/new-patch`
3. Add your patch to `patches/` directory
4. Update documentation
5. Submit a pull request

See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for detailed guidelines.

## Security

### Important: Never Commit Secrets

This repository is public. **NEVER** commit real secrets, API keys, or OAuth credentials to the repository.

### Setting Up Secrets

1. **Copy the example file**:
   ```bash
   cp ~/.omniroute/.env.example ~/.omniroute/.env
   ```

2. **Edit the .env file** with your actual secrets:
   ```bash
   # Get Antigravity OAuth secret from Google Cloud Console
   # APIs & Services → Credentials → OAuth 2.0 Client IDs
   ANTIGRAVITY_OAUTH_CLIENT_SECRET=your-actual-secret-here
   ```

## Uninstallation

```bash
cd 1ai-omniroute
./uninstall.sh
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

**Status**: Actively maintained. All patches tested with OmniRoute v2.7.8+.

## Batch Add API Keys

Instead of adding API keys one by one through the UI, you can batch add them from a JSON file:

### 1. Create your API keys config

```bash
cp api-keys.json.example api-keys.json
```

### 2. Edit with your API keys

```bash
nano api-keys.json
```

Example:
```json
{
  "providers": {
    "opencode-zen": {
      "api_key": "oczen_abc123...",
      "name": "OpenCode Zen",
      "priority": 1,
      "default_model": "opencode-zen/default"
    },
    "openai": {
      "api_key": "sk-abc123...",
      "name": "OpenAI",
      "priority": 10,
      "default_model": "openai/gpt-4o"
    }
  }
}
```

### 3. Run the batch adder

```bash
# Add all providers from api-keys.json
./scripts/batch-add-providers.sh

# Or dry run to see what would be added
./scripts/batch-add-providers.sh --dry-run

# Or add a single provider
./scripts/batch-add-providers.sh opencode-zen

# List current providers
./scripts/batch-add-providers.sh --list
```

### 4. Restart OmniRoute

```bash
sudo systemctl restart omniroute
```

The providers will now appear in the OmniRoute UI!


## Available Patches

| Patch | Description | Status |
|-------|-------------|--------|
| **antigravity-no-projectid.cjs** | Fixes "Missing Google projectId" error | ✅ Working |
| **endpoint-router.cjs** | Adds endpoint aliases (/v1/dalle, /v1/sora, etc.) | ✅ Working |
| **response-cache.cjs** | Cache responses to reduce API calls | ✅ Working |
| **enhanced-logging.cjs** | Detailed logging for debugging | ✅ Working |
| **semantic-cache.cjs** | Cache based on query similarity | ✅ Working |

## New Patches Details

### Response Cache
- **Purpose**: Reduce API calls by caching responses
- **Features**: TTL-based expiration, configurable size, auto-cleanup
- **Config**: 5 min TTL, 1000 max entries

### Enhanced Logging
- **Purpose**: Better debugging and monitoring
- **Features**: Request/response logging, timing, token tracking
- **Log File**: `~/.omniroute/omniroute.log`

### Semantic Cache
- **Purpose**: Cache responses based on query similarity
- **Features**: Embedding-based comparison, configurable threshold
- **Similarity**: 85% threshold
- **Providers**: Local, OpenAI, Ollama

## Patch Configuration

All patches can be configured by editing the .cjs files in `~/.omniroute/patches/`.

### Example: Adjust similarity threshold
Edit `semantic-cache.cjs`:
```javascript
const SEMANTIC_CACHE_CONFIG = {
  similarityThreshold: 0.90, // Change from 0.85 to 0.90
  // ...
};
```

### Example: Change cache TTL
Edit `response-cache.cjs`:
```javascript
const CACHE_CONFIG = {
  ttl: 10 * 60 * 1000, // Change from 5 to 10 minutes
  // ...
};
```


## Provider Monitor & Optimizer

Monitor and optimize free provider usage with automatic health tracking.

### Features
- ✅ Track success/failure rates
- ✅ Monitor response times
- ✅ Auto-disable problematic providers
- ✅ Health scoring (0-100)
- ✅ Usage statistics
- ✅ Recommendations

### API Endpoints

#### Get Provider Statistics
```bash
curl http://localhost:20128/api/provider-monitor/stats
```

#### Get Health Status
```bash
curl http://localhost:20128/api/provider-monitor/health
```

### Example Response
```json
{
  "antigravity": {
    "totalRequests": 150,
    "successfulRequests": 142,
    "failedRequests": 8,
    "successRate": 0.947,
    "successRatePercent": "94.67%",
    "avgDuration": 2345,
    "avgDurationMs": "2345ms",
    "healthScore": 85,
    "healthStatus": "healthy"
  }
}
```

### Auto-Disable
Providers with success rate < 30% are automatically disabled after 10 requests.

### Recommendations
The system provides recommendations:
- ⚠️ Warning: Low success rate
- 🐌 Performance: Slow response time
- 💡 Recommendation: Best provider to use


## Provider Circuit Breaker (NEW!)

Implements circuit breaker pattern for AI providers to prevent cascading failures.

### Features
- ✅ **Three states**: CLOSED (normal), OPEN (failing), HALF-OPEN (testing)
- ✅ **Exponential backoff**: Smart retry with jitter
- ✅ **Auto-recovery**: Periodic health checks
- ✅ **Monitoring**: Real-time status and statistics
- ✅ **Reset API**: Manual circuit breaker reset

### API Endpoints

#### Get Circuit Breaker Status
```bash
curl http://localhost:20128/api/circuit-breaker/status
```

#### Reset Circuit Breaker
```bash
# Reset all providers
curl -X POST http://localhost:20128/api/circuit-breaker/reset \
  -H "Content-Type: application/json" \
  -d '{}'

# Reset specific provider
curl -X POST http://localhost:20128/api/circuit-breaker/reset \
  -H "Content-Type: application/json" \
  -d '{"provider":"antigravity"}'
```

### Circuit States

| State | Description | Behavior |
|-------|-------------|----------|
| **CLOSED** | Normal operation | Requests flow through, failures tracked |
| **OPEN** | Failing | Requests fail fast, no calls made |
| **HALF-OPEN** | Testing recovery | Limited requests to test if service recovered |

### Configuration

Edit `provider-circuit-breaker.cjs` to adjust:

```javascript
const CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: 5,        // Failures before opening circuit
  successThreshold: 2,        // Successes to close circuit from half-open
  resetTimeout: 30000,        // 30 seconds before testing recovery
  maxRetries: 3,              // Max retries with exponential backoff
  baseDelay: 1000,            // 1 second base delay
  maxDelay: 10000,            // 10 seconds max delay
};
```

### Example Status Response

```json
{
  "enabled": true,
  "totalBreakers": 4,
  "breakers": {
    "antigravity": {
      "state": "CLOSED",
      "failures": 0,
      "stats": {
        "totalRequests": 150,
        "successfulRequests": 142,
        "successRate": "94.67%",
        "avgResponseTimeMs": "2345ms"
      }
    }
  },
  "summary": {
    "totalRequests": 450,
    "successRate": "92.44%",
    "openCircuits": 0,
    "halfOpenCircuits": 1,
    "healthyCircuits": 3
  }
}
```

### Free Providers Monitored

1. **antigravity** - 70+ OAuth accounts
2. **G4F.dev** - Keyless aggregator
3. **Pollinations** - Keyless image/text
4. **uncloseai** - Keyless models (Hermes-3, Qwen)

### How It Works

1. **Request fails** → Increment failure counter
2. **Failures exceed threshold** → Circuit OPENS
3. **After reset timeout** → Circuit moves to HALF-OPEN
4. **Test requests succeed** → Circuit CLOSES (recovered)
5. **Test requests fail** → Circuit stays OPEN


## Free AI Providers (Based on Research)

Based on 2026 research, these free AI API providers have been added to OmniRoute:

### ✅ Already Configured (No API Key Needed)
1. **antigravity** - 70+ OAuth accounts (Claude, GPT, Gemini)
2. **G4F.dev** - Keyless aggregator (multiple models)
3. **Pollinations** - Keyless image/text generation
4. **uncloseai** - Keyless models (Hermes-3, Qwen)

### 🔑 Free Tier Providers (API Key Required)
5. **Google AI Studio** - Gemini 2.5 Pro, Flash (250K TPM free)
6. **Groq** - Llama 3.3 70B, Qwen3 (1K req/day free)
7. **OpenRouter** - DeepSeek R1, Llama 4 (50 req/day free)
8. **HuggingFace** - Thousands of models (free inference)
9. **GitHub Models** - GPT-4o, GPT-4.1, o3 (50-150 req/day free)
10. **NVIDIA NIM** - DeepSeek R1, Llama (1K credits free)

### How to Get Free API Keys

#### Google AI Studio
1. Go to https://aistudio.google.com/
2. Sign in with Google account
3. Click "Get API Key"
4. Copy the key

#### Groq
1. Go to https://console.groq.com/
2. Sign up for free account
3. Go to API Keys section
4. Create new API key

#### OpenRouter
1. Go to https://openrouter.ai/
2. Sign up for free account
3. Go to Keys section
4. Create new API key

#### HuggingFace
1. Go to https://huggingface.co/
2. Sign up for free account
3. Go to Settings → Access Tokens
4. Create new token

#### GitHub Models
1. Go to https://github.com/marketplace/models
2. Sign in with GitHub account
3. Get API key from dashboard

#### NVIDIA NIM
1. Go to https://build.nvidia.com/
2. Sign up for free account
3. Go to API section
4. Get API key

### Update API Keys in Database

After getting API keys, update them in the database:

```bash
# Update Google AI Studio key
sqlite3 ~/.omniroute/storage.sqlite << 'SQL'
UPDATE provider_connections 
SET api_key = 'YOUR_GOOGLE_AI_STUDIO_KEY'
WHERE name = 'Google AI Studio (Gemini Free)';
SQL

# Update Groq key
sqlite3 ~/.omniroute/storage.sqlite << 'SQL'
UPDATE provider_connections 
SET api_key = 'YOUR_GROQ_KEY'
WHERE name = 'Groq (Llama Free)';
SQL

# Update OpenRouter key
sqlite3 ~/.omniroute/storage.sqlite << 'SQL'
UPDATE provider_connections 
SET api_key = 'YOUR_OPENROUTER_KEY'
WHERE name = 'OpenRouter (Free Tier)';
SQL

# Update HuggingFace key
sqlite3 ~/.omniroute/storage.sqlite << 'SQL'
UPDATE provider_connections 
SET api_key = 'YOUR_HUGGINGFACE_KEY'
WHERE name = 'HuggingFace (Free Inference)';
SQL

# Update GitHub Models key
sqlite3 ~/.omniroute/storage.sqlite << 'SQL'
UPDATE provider_connections 
SET api_key = 'YOUR_GITHUB_MODELS_KEY'
WHERE name = 'GitHub Models (Free Tier)';
SQL

# Update NVIDIA NIM key
sqlite3 ~/.omniroute/storage.sqlite << 'SQL'
UPDATE provider_connections 
SET api_key = 'YOUR_NVIDIA_NIM_KEY'
WHERE name = 'NVIDIA NIM (Free Tier)';
SQL
```

### Restart OmniRoute

After updating API keys:

```bash
sudo systemctl restart omniroute
```

### Test Providers

```bash
# Test Google AI Studio
curl -X POST http://localhost:20128/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"openai-compatible-chat/gemini-2.5-flash","messages":[{"role":"user","content":"Hello"}],"max_tokens":10}'

# Test Groq
curl -X POST http://localhost:20128/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"openai-compatible-chat/llama-3.3-70b","messages":[{"role":"user","content":"Hello"}],"max_tokens":10}'
```

### Rate Limits (Free Tier)

| Provider | Rate Limit | Daily Limit | Monthly Limit |
|----------|------------|-------------|---------------|
| **Google AI Studio** | 5-15 RPM | 250K TPM | Unlimited |
| **Groq** | 30-60 RPM | 1K req/day | - |
| **OpenRouter** | 20 RPM | 50 req/day | - |
| **HuggingFace** | Variable | Variable | Variable |
| **GitHub Models** | 10-15 RPM | 50-150 req/day | - |
| **NVIDIA NIM** | 40 RPM | 1K credits | - |

### Benefits of Using Free Providers

1. **Cost Savings** - No API costs for testing and development
2. **Model Variety** - Access to different AI models
3. **Redundancy** - Multiple providers for reliability
4. **Learning** - Experiment with different models
5. **Prototyping** - Build and test without costs

### Limitations

1. **Rate Limits** - Limited requests per minute/day
2. **Model Availability** - Not all models available free
3. **Quality** - Free models may be less capable
4. **Support** - Limited support for free tier

### Best Practices

1. **Use Circuit Breaker** - Already configured to handle failures
2. **Rotate Providers** - Use multiple providers to avoid rate limits
3. **Monitor Usage** - Track which providers work best
4. **Cache Responses** - Use response cache to reduce API calls
5. **Fallback Strategy** - Have backup providers ready

