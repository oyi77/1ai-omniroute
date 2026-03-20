# 1ai-omniroute

An advanced patch for omniroute to make it spectacular — a collection of modular patches and scripts that enhance OmniRoute with additional providers, model support, and seamless AI aggregation capabilities.

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

### Scripts & Configuration

| Script | Description |
|--------|-------------|
| **patch-providers.sh** | Injects custom providers into compiled OmniRoute bundles |
| **omniroute-update.sh** | Automated update workflow with patch reapplication |
| **omniroute.service** | Systemd service with Antigravity OAuth secret |

## How to use this?

### Installation

```bash
# Clone the repository
git clone https://github.com/oyi77/1ai-omniroute.git
cd 1ai-omniroute

# Copy patches to OmniRoute patches directory
mkdir -p ~/.omniroute/patches
cp patches/*.cjs ~/.omniroute/patches/

# Copy scripts
cp scripts/*.sh ~/.omniroute/
chmod +x ~/.omniroute/*.sh

# Install systemd service (optional)
sudo cp scripts/omniroute.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart omniroute
```

### Verification

```bash
# Check patches are loaded
omniroute --help
# Should show: "🩹 Loaded X openclaw patch(es)"

# Check service status (if using systemd)
sudo systemctl status omniroute
```

## Supported AI Modalities

| Modality | Endpoint | Aliases |
|----------|----------|---------|
| **Chat/Completions** | `/v1/chat/completions` | - |
| **Image Generation** | `/v1/images/generations` | `/v1/dalle`, `/v1/stable-diffusion`, `/v1/midjourney` |
| **Video Generation** | `/v1/videos/generations` | `/v1/sora`, `/v1/seedance`, `/v1/kling`, `/v1/runway`, `/v1/pika` |
| **Vision** | `/v1/chat/completions` (with images) | `/v1/vision`, `/v1/analyze`, `/v1/describe`, `/v1/ocr` |
| **Audio Transcription** | `/v1/audio/transcriptions` | `/v1/transcribe`, `/v1/stt`, `/v1/whisper` |
| **Text-to-Speech** | `/v1/audio/speech` | `/v1/speech`, `/v1/tts` |
| **Embeddings** | `/v1/embeddings` | `/v1/embed`, `/v1/vectorize` |
| **Reranking** | `/v1/rerank` | `/v1/rank`, `/v1/reranker` |
| **Moderations** | `/v1/moderations` | `/v1/moderate`, `/v1/content-filter` |
| **Music Generation** | `/v1/music/generations` | `/v1/music`, `/v1/audiogen` |

## Patches Explained

### 1. Antigravity No-ProjectId Patch

**Problem**: Antigravity OAuth accounts require a stored projectId, which OmniRoute doesn't have.

**Solution**: Intercepts the bundled code and auto-fetches projectId via Google's loadCodeAssist API.

### 2. Endpoint Router Patch

**Problem**: Users expect common AI aggregator aliases to work (e.g., `/v1/dalle`).

**Solution**: Intercepts HTTP requests and redirects aliases to canonical endpoints.

## How It Works

### Startup Sequence

1. User runs `omniroute` (or systemd starts it)
2. `bin/omniroute.mjs` scans `~/.omniroute/patches/` for `.cjs` files
3. Each patch is loaded via `node --require=<patch>`
4. Patches apply modifications (string replacement, module interception)
5. OmniRoute starts with patches active

### Update Workflow

```bash
# Manual update
~/.omniroute/omniroute-update.sh

# Or with cron (weekly, Sunday 00:00)
0 0 * * 0 /home/openclaw/.omniroute/omniroute-update.sh >> /home/openclaw/.omniroute/update.log 2>&1
```

## Troubleshooting

### Patches not loading

```bash
# Check if patches are loaded
omniroute --help
# Should show: "🩹 Loaded X openclaw patch(es)"

# Check patch files exist
ls -la ~/.omniroute/patches/

# Check syntax errors
node -c ~/.omniroute/patches/*.cjs
```

### Provider catalog missing

```bash
# Re-apply provider patch
~/.omniroute/patch-providers.sh --status

# If needed, force re-patch
~/.omniroute/patch-providers.sh
```

### Service won't start

```bash
# Check logs
sudo journalctl -u omniroute -f

# Check service file
sudo systemctl cat omniroute

# Restart manually
sudo systemctl restart omniroute
```

## Documentation

- **[PATCHES.md](docs/PATCHES.md)**: Detailed documentation for each patch
- **[CHANGELOG.md](docs/CHANGELOG.md)**: Project history and changes
- **[CONTRIBUTING.md](docs/CONTRIBUTING.md)**: How to contribute

## How to contribute?

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/new-patch`
3. Add your patch to `patches/` directory
4. Update documentation:
   - Update this README
   - Update [PATCHES.md](docs/PATCHES.md)
   - Update [CHANGELOG.md](docs/CHANGELOG.md)
5. Submit a pull request

See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for detailed guidelines.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

**Status**: Actively maintained. All patches tested with OmniRoute v2.7.8+.

## Security

### Important: Never Commit Secrets

This repository is public. **NEVER** commit real secrets, API keys, or OAuth credentials to the repository.

### Setting Up Secrets

1. **Copy the example file**:
   ```bash
   cp .env.example .env
   ```

2. **Edit the .env file** with your actual secrets:
   ```bash
   # Get Antigravity OAuth secret from Google Cloud Console
   # APIs & Services → Credentials → OAuth 2.0 Client IDs
   ANTIGRAVITY_OAUTH_CLIENT_SECRET=your-actual-secret-here
   ```

3. **For systemd service**, edit the service file:
   ```bash
   sudo nano /etc/systemd/system/omniroute.service
   # Replace YOUR_ANTIGRAVITY_OAUTH_CLIENT_SECRET_HERE with your actual secret
   sudo systemctl daemon-reload
   sudo systemctl restart omniroute
   ```

### Security Best Practices

- Store secrets in `.env` files (gitignored)
- Use environment variables for production secrets
- Rotate API keys regularly
- Use least-privilege access for service accounts
- Monitor API usage for anomalies

### Reporting Security Issues

If you discover a security vulnerability, please report it responsibly to the maintainers.

---

**Status**: Actively maintained. All patches tested with OmniRoute v2.7.8+.
