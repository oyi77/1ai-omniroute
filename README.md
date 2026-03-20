# 1ai-omniroute

An advanced patch for omniroute to make it spectacular — a collection of modular patches and scripts that enhance OmniRoute with additional providers, model support, and seamless AI aggregation capabilities.

## Overview

OmniRoute is a powerful AI router, but it needs some patches to work with certain providers and handle all AI modalities properly. This repository contains:

1. **Antigravity No-ProjectId Patch** — Fixes the "Missing Google projectId" error for Antigravity OAuth accounts
2. **Custom Provider Catalog Injection** — Adds additional providers to the compiled OmniRoute UI
3. **Update Automation** — Scripts to keep OmniRoute patched after updates
4. **Systemd Configuration** — Service file with proper environment variables

## What's Included

### Modular Patches (loaded on startup)

| Patch | File | Description |
|-------|------|-------------|
| **Antigravity No-ProjectId** | `patches/antigravity-no-projectid.cjs` | Removes the need for stored projectId in Antigravity OAuth accounts, auto-fetches via loadCodeAssist |

### Scripts

| Script | File | Description |
|--------|------|-------------|
| **Provider Catalog Patcher** | `scripts/patch-providers.sh` | Injects custom providers into compiled .next/*.js files |
| **Update Manager** | `scripts/omniroute-update.sh` | Automated update + patch + restart workflow |
| **Systemd Service** | `scripts/omniroute.service` | Service file with ANTIGRAVITY_OAUTH_CLIENT_SECRET configured |

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/1ai-omniroute.git
cd 1ai-omniroute
```

### 2. Install Patches

```bash
# Copy patches to OmniRoute patches directory
mkdir -p ~/.omniroute/patches
cp patches/*.cjs ~/.omniroute/patches/

# Copy scripts
cp scripts/*.sh ~/.omniroute/
chmod +x ~/.omniroute/*.sh

# Install systemd service
sudo cp scripts/omniroute.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart omniroute
```

### 3. Verify Installation

```bash
# Check patches are loaded
omniroute --help
# Should show: "🩹 Loaded X openclaw patch(es)"

# Check service status
sudo systemctl status omniroute
```

## Patches Explained

### 1. Antigravity No-ProjectId (`patches/antigravity-no-projectid.cjs`)

**Problem**: When using Antigravity OAuth accounts, OmniRoute throws "Missing Google projectId" error.

**Solution**: This patch intercepts the bundled AntigravityExecutor code and removes the throw error. Instead, it auto-fetches the projectId via Google's loadCodeAssist API when missing.

**How it works**:
- Loaded via `node --require` on every OmniRoute startup
- Finds the bundled chunk file in `.next/`
- Applies string replacement on the minified code
- Survives OmniRoute updates (re-patched on each startup)

### 2. Provider Catalog Patcher (`scripts/patch-providers.sh`)

**Problem**: OmniRoute's compiled JavaScript bundles contain a hardcoded provider catalog. Custom providers don't appear in the UI dropdown.

**Solution**: Python script that injects custom provider entries into the compiled `.next/*.js` files.

**Usage**:
```bash
./patch-providers.sh          # Apply patches
./patch-providers.sh --check  # Dry run
./patch-providers.sh --status # Check status
```

**Custom Providers Included**:
- BytePlus (Seedance video generation)
- LaoZhang AI (OpenAI-compatible Sora proxy)
- EvoLink (async webhook video generation)
- Hypereal AI (Kling-3.0-based video)
- Kie.ai (video generation)

### 3. Update Manager (`scripts/omniroute-update.sh`)

**Problem**: After `npm install -g omniroute`, patches are lost.

**Solution**: Automated script that:
1. Updates OmniRoute to latest version
2. Re-applies provider catalog patch
3. Verifies patches are loaded
4. Restarts systemd service

**Usage**:
```bash
./omniroute-update.sh           # Full update
./omniroute-update.sh --dry-run # Show what would happen
./omniroute-update.sh --patch-only # Skip update, only patch
```

### 4. Systemd Service (`scripts/omniroute.service`)

Includes the `ANTIGRAVITY_OAUTH_CLIENT_SECRET` environment variable required for Antigravity OAuth flow.

## Supported AI Modalities

With these patches, OmniRoute can handle all standard AI aggregator scenarios:

| Modality | Endpoint | Status |
|----------|----------|--------|
| **Chat/Completions** | `/v1/chat/completions` | ✅ Native |
| **Image Generation** | `/v1/images/generations` | ✅ Native |
| **Video Generation** | `/v1/videos/generations` | ✅ Native + Custom Providers |
| **Audio Transcription** | `/v1/audio/transcriptions` | ✅ Native |
| **Text-to-Speech** | `/v1/audio/speech` | ✅ Native |
| **Embeddings** | `/v1/embeddings` | ✅ Native |
| **Reranking** | `/v1/rerank` | ✅ Native |
| **Moderations** | `/v1/moderations` | ✅ Native |
| **Music Generation** | `/v1/music/generations` | ✅ Native |

## Architecture

```
~/.omniroute/
├── patches/                    # Modular patches (loaded on startup)
│   └── antigravity-no-projectid.cjs
├── patch-providers.sh          # Provider catalog injector
├── omniroute-update.sh         # Update automation
└── storage.sqlite              # Routing database (survives updates)

/etc/systemd/system/
└── omniroute.service           # Systemd service with env vars
```

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

# Cron (weekly, Sunday 00:00)
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

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/new-patch`
3. Add your patch to `patches/` directory
4. Update this README with documentation
5. Submit a pull request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- OmniRoute team for the amazing AI router
- OpenClaw community for patch development and testing

---

**Status**: Actively maintained. All patches tested with OmniRoute v2.7.8+.

