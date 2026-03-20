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
