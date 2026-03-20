# Changelog

All notable changes to the 1ai-omniroute project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-03-21

### Added
- Initial release of 1ai-omniroute patch system
- **Antigravity No-ProjectId Patch** (`patches/antigravity-no-projectid.cjs`)
  - Removes "Missing Google projectId" error for Antigravity OAuth accounts
  - Auto-fetches projectId via loadCodeAssist API
  - Modular design that survives OmniRoute updates
- **Enhanced Endpoint Router Patch** (`patches/endpoint-router.cjs`)
  - Adds common aliases for AI aggregator endpoints
  - Image generation: `/v1/dalle`, `/v1/stable-diffusion`, `/v1/midjourney`
  - Video generation: `/v1/sora`, `/v1/seedance`, `/v1/kling`, `/v1/runway`, `/v1/pika`
  - Vision: `/v1/vision`, `/v1/analyze`, `/v1/describe`, `/v1/ocr`
  - Audio: `/v1/transcribe`, `/v1/speech`, `/v1/tts`, `/v1/stt`, `/v1/whisper`
  - Enhances content-type detection for media endpoints
- **Provider Catalog Patcher** (`scripts/patch-providers.sh`)
  - Python script to inject custom providers into compiled OmniRoute bundles
  - Adds 5 custom video generation providers:
    - BytePlus (Seedance)
    - LaoZhang AI
    - EvoLink
    - Hypereal AI
    - Kie.ai
  - Idempotent operation (safe to run multiple times)
- **Update Manager Script** (`scripts/omniroute-update.sh`)
  - Automated update workflow for OmniRoute
  - Re-applies patches after npm updates
  - Restarts systemd service
  - Supports dry-run and patch-only modes
- **Systemd Service Configuration** (`scripts/omniroute.service`)
  - Service file with ANTIGRAVITY_OAUTH_CLIENT_SECRET environment variable
  - Configured for production deployment
  - Auto-restart on failure
- **Documentation**
  - Comprehensive README with installation and usage instructions
  - Detailed patch documentation (docs/PATCHES.md)
  - Issue template for bug reports and feature requests
  - Changelog for tracking project history

### Technical Details
- **Patch System**: Uses Node.js `--require` for modular runtime patching
- **Survivability**: Patches are reapplied on each OmniRoute startup
- **Idempotency**: All patches check before modifying to avoid double-patching
- **Backwards Compatible**: Original endpoints continue to work

### Dependencies
- OmniRoute 2.7.8+
- Node.js 22.x
- Python 3.8+ (for provider catalog patcher)
- Bash 4.x (for update scripts)

### Installation
```bash
git clone https://github.com/1ai-omniroute/1ai-omniroute.git
cd 1ai-omniroute
./install.sh  # Not yet implemented — see README for manual installation
```

### Known Issues
- Endpoint router patch may conflict with custom middleware
- Provider catalog patch requires OmniRoute to be installed globally
- Systemd service file assumes specific paths and user

### Contributors
- openclaw (initial development)

---

## [Unreleased]

### Planned Features
- Installation script for automated setup
- GitHub Actions for CI/CD
- More custom providers from berkahkarya-saas-bot
- Support for additional AI modalities
- Configuration wizard for easier setup

---

*This changelog is maintained manually. Please update it with each significant change.*

## [1.1.0] - 2026-03-21

### Added
- **OpenCode Zen Provider**
  - Added to custom provider catalog patch
  - Provider ID: `opencode-zen`
  - Alias: `oczen`
  - API key format: `oczen_...`
  - Description: OpenCode AI provider for advanced code generation

### Updated
- Provider catalog now includes 10 custom providers (was 9)
