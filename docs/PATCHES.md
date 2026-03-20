# 1ai-omniroute Patches Documentation

This document details all patches included in the 1ai-omniroute repository and how they work.

## Table of Contents

1. [Antigravity No-ProjectId Patch](#antigravity-no-projectid-patch)
2. [Enhanced Endpoint Router Patch](#enhanced-endpoint-router-patch)
3. [Provider Catalog Patcher](#provider-catalog-patcher)
4. [Update Manager Script](#update-manager-script)
5. [Systemd Service Configuration](#systemd-service-configuration)

---

## Antigravity No-ProjectId Patch

**File**: `patches/antigravity-no-projectid.cjs`  
**Type**: Modular Runtime Patch  
**Loaded**: On OmniRoute startup via `node --require`

### Problem

When using Antigravity OAuth accounts in OmniRoute, you encounter this error:

```
Missing Google projectId for Antigravity account. Please reconnect OAuth so OmniRoute can fetch your real Cloud Code project (loadCodeAssist).
```

This happens because OmniRoute requires a projectId to be stored in the database, but Antigravity OAuth accounts don't provide one automatically.

### Solution

This patch intercepts the bundled AntigravityExecutor code and removes the throw error. Instead, it:

1. **Detects missing projectId** — checks if the account has a stored projectId
2. **Auto-fetches projectId** — calls Google's loadCodeAssist API to get the projectId
3. **Continues normally** — proceeds with the request using the fetched projectId

### Technical Details

**What's Patched**:

The patch finds and replaces this minified JavaScript in the bundled chunk:

```javascript
// ORIGINAL (unpatched)
if(!a)throw Error("Missing Google projectId...")
```

```javascript
// REPLACEMENT (patched)
if(!a){let c;try{c=await(await fetch("https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",{method:"POST",headers:{...},body:JSON.stringify(...)})).json()}catch(e){}let p=c?.cloudaicompanionProject;a="object"==typeof p&&null!==p&&p.id?p.id:...}
```

**File Target**:

```
~/.npm-global/lib/node_modules/omniroute/app/.next/server/chunks/[root-of-the-server]__f0f9eb3f._.js
```

**Why It Works**:

1. **No database changes** — doesn't modify the SQLite database
2. **Survives updates** — re-patched on each startup
3. **No side effects** — only affects the projectId check, doesn't change other behavior

### Verification

After applying the patch, check if antigravity requests work:

```bash
# Check patch is loaded
omniroute --help
# Should show: "🩹 Loaded X openclaw patch(es)"

# Make a test request
curl -X POST http://localhost:20128/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "antigravity/gemini-2.5-flash", "messages": [{"role": "user", "content": "Hello"}]}'
```

---

## Enhanced Endpoint Router Patch

**File**: `patches/endpoint-router.cjs`  
**Type**: Modular Runtime Patch  
**Loaded**: On OmniRoute startup via `node --require`

### Problem

OmniRoute provides standard OpenAI-compatible endpoints, but users expect common aliases to work. For example:
- `/v1/dalle` should map to `/v1/images/generations`
- `/v1/sora` should map to `/v1/videos/generations`
- `/v1/vision` should map to `/v1/chat/completions`

### Solution

This patch intercepts HTTP requests and redirects endpoint aliases to their canonical destinations. It also enhances content-type detection for media endpoints.

### Endpoint Aliases

#### Image Generation

| Alias | Target | Description |
|-------|--------|-------------|
| `/v1/generate` | `/v1/images/generations` | Generic generation |
| `/v1/image` | `/v1/images/generations` | Short form |
| `/v1/images` | `/v1/images/generations` | Plural form |
| `/v1/dalle` | `/v1/images/generations` | DALL-E style |
| `/v1/stable-diffusion` | `/v1/images/generations` | SD style |
| `/v1/midjourney` | `/v1/images/generations` | MJ style |

#### Video Generation

| Alias | Target | Description |
|-------|--------|-------------|
| `/v1/video` | `/v1/videos/generations` | Generic video |
| `/v1/sora` | `/v1/videos/generations` | Sora style |
| `/v1/seedance` | `/v1/videos/generations` | Seedance style |
| `/v1/kling` | `/v1/videos/generations` | Kling style |
| `/v1/runway` | `/v1/videos/generations` | Runway style |
| `/v1/pika` | `/v1/videos/generations` | Pika style |
| `/v1/animatediff` | `/v1/videos/generations` | AnimateDiff style |

#### Vision/Understanding

| Alias | Target | Description |
|-------|--------|-------------|
| `/v1/vision` | `/v1/chat/completions` | Vision analysis |
| `/v1/analyze` | `/v1/chat/completions` | Image analysis |
| `/v1/understand` | `/v1/chat/completions` | Content understanding |
| `/v1/describe` | `/v1/chat/completions` | Image description |
| `/v1/ocr` | `/v1/chat/completions` | Text extraction |

#### Audio

| Alias | Target | Description |
|-------|--------|-------------|
| `/v1/transcribe` | `/v1/audio/transcriptions` | Speech-to-text |
| `/v1/speech` | `/v1/audio/speech` | Text-to-speech |
| `/v1/tts` | `/v1/audio/speech` | TTS abbreviation |
| `/v1/stt` | `/v1/audio/transcriptions` | STT abbreviation |
| `/v1/whisper` | `/v1/audio/transcriptions` | Whisper style |

#### Other Modalities

| Alias | Target | Description |
|-------|--------|-------------|
| `/v1/embed` | `/v1/embeddings` | Embedding generation |
| `/v1/vectorize` | `/v1/embeddings` | Vectorization |
| `/v1/rank` | `/v1/rerank` | Reranking |
| `/v1/reranker` | `/v1/rerank` | Reranker model |
| `/v1/moderate` | `/v1/moderations` | Content moderation |
| `/v1/content-filter` | `/v1/moderations` | Content filtering |
| `/v1/music` | `/v1/music/generations` | Music generation |
| `/v1/audiogen` | `/v1/music/generations` | Audio generation |

### Content-Type Detection

The patch enhances content-type detection for media endpoints:

- **Image endpoints**: Automatically sets `Content-Type: application/json` when curl/wget is detected
- **Video endpoints**: Handles binary uploads with proper headers
- **Audio endpoints**: Detects common audio formats

### Technical Details

**How It Works**:

1. **HTTP Server Interception** — patches `http.createServer`
2. **Request Interception** — intercepts incoming requests before routing
3. **URL Rewriting** — redirects aliased URLs to canonical endpoints
4. **Header Enhancement** — sets appropriate content-type headers

**Why This Approach**:

1. **No route changes** — doesn't modify the underlying route handlers
2. **Backwards compatible** — original endpoints still work
3. **User friendly** — common aliases work as expected

---

## Provider Catalog Patcher

**File**: `scripts/patch-providers.sh`  
**Type**: Python Script  
**Usage**: Manual or via update script

### Problem

OmniRoute's compiled JavaScript bundles contain a hardcoded provider catalog. When you add custom providers to the database, they don't appear in the UI "Add Provider" dropdown.

### Solution

This script injects custom provider entries into the compiled `.next/*.js` files, making them appear in the UI.

### Custom Providers Included

| Provider | Description | Models |
|----------|-------------|--------|
| **BytePlus (Seedance)** | BytePlus Ark platform | Seedance video generation + LLMs |
| **LaoZhang AI** | OpenAI-compatible video proxy | Sora and other video models |
| **EvoLink** | Async webhook-based video | Various video generation models |
| **Hypereal AI** | Kling-3.0-based video | Kling-3.0 text/image-to-video |
| **Kie.ai** | Video generation platform | Various video models |

### Usage

```bash
# Check if patch is needed
./patch-providers.sh --status

# Dry run (show what would be patched)
./patch-providers.sh --check

# Apply patches
./patch-providers.sh
```

### Technical Details

**What's Patched**:

The script finds this string in the compiled JavaScript:

```javascript
"tavily-search":{id:"tavily-search",alias:"tavily-search",name:"Tavily Search",...}
```

And injects custom providers immediately after it.

**Why This Exists**:

1. **UI Only** — provider connections (routing) are stored in SQLite
2. **Catalog = UI dropdown** — the compiled bundle contains the UI catalog
3. **Updates break** — npm reinstalls overwrite the compiled bundle

---

## Update Manager Script

**File**: `scripts/omniroute-update.sh`  
**Type**: Bash Script  
**Usage**: Manual or via cron

### Problem

When you update OmniRoute via `npm install -g omniroute`, all patches are lost.

### Solution

This script automates the update workflow:

1. **Update OmniRoute** — pulls latest version from npm
2. **Re-apply patches** — runs the provider catalog patcher
3. **Verify patches** — checks if patches are loaded
4. **Restart service** — restarts the systemd service

### Usage

```bash
# Full update
./omniroute-update.sh

# Dry run
./omniroute-update.sh --dry-run

# Only patch (skip update)
./omniroute-update.sh --patch-only
```

### Cron Integration

Add to crontab for automatic weekly updates:

```bash
# Weekly, Sunday 00:00
0 0 * * 0 /home/openclaw/.omniroute/omniroute-update.sh >> /home/openclaw/.omniroute/update.log 2>&1
```

### Technical Details

**Steps Executed**:

1. **Sanity checks** — verifies required tools (npm, python3)
2. **Version comparison** — checks current vs latest version
3. **npm install** — updates to latest version
4. **Patch application** — runs `patch-providers.sh`
5. **Service restart** — restarts systemd service
6. **Verification** — tests if provider catalog works

---

## Systemd Service Configuration

**File**: `scripts/omniroute.service`  
**Type**: Systemd Unit File  
**Usage**: Install to `/etc/systemd/system/`

### Problem

OmniRoute needs to run as a service with proper environment variables, including the `ANTIGRAVITY_OAUTH_CLIENT_SECRET`.

### Solution

This service file configures OmniRoute as a systemd service with all required environment variables.

### Configuration

```ini
[Unit]
Description=OmniRoute AI Router
After=network.target

[Service]
Type=simple
User=openclaw
WorkingDirectory=/home/openclaw/.openclaw/workspace
ExecStart=/home/openclaw/.npm-global/bin/omniroute --no-open --port 20128
Restart=always
RestartSec=5
Environment=HOME=/home/openclaw
Environment=PATH=/home/openclaw/.npm-global/bin:/usr/local/bin:/usr/bin:/bin
Environment=ANTIGRAVITY_OAUTH_CLIENT_SECRET=YOUR_ANTIGRAVITY_OAUTH_CLIENT_SECRET_HERE
```

### Installation

```bash
# Copy service file
sudo cp scripts/omniroute.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable and start
sudo systemctl enable omniroute
sudo systemctl start omniroute

# Check status
sudo systemctl status omniroute
```

---

## Patch Loading Order

When OmniRoute starts, patches are loaded in this order:

1. **Modular patches** (`~/.omniroute/patches/*.cjs`)
   - antigravity-no-projectid.cjs
   - endpoint-router.cjs
   - Any other .cjs files in the patches directory

2. **Provider catalog** (already patched in compiled bundle)
   - Custom providers injected by `patch-providers.sh`

3. **Database providers** (loaded from SQLite)
   - User-added provider connections

---

## Troubleshooting

### Patches Not Loading

```bash
# Check if patches directory exists
ls -la ~/.omniroute/patches/

# Verify patch files are valid JavaScript
node -c ~/.omniroute/patches/*.cjs

# Check OmniRoute output for patch messages
omniroute --help
# Should show: "🩹 Loaded X openclaw patch(es)"
```

### Provider Catalog Missing

```bash
# Check patch status
./patch-providers.sh --status

# Re-apply patches
./patch-providers.sh

# Check OmniRoute logs
sudo journalctl -u omniroute -f
```

### Service Won't Start

```bash
# Check service logs
sudo journalctl -u omniroute -f

# Check service file
sudo systemctl cat omniroute

# Test manually
/home/openclaw/.npm-global/bin/omniroute --help
```

---

## Adding New Patches

To add a new modular patch:

1. **Create the patch file** in `patches/` directory with `.cjs` extension
2. **Use the `require` pattern** to intercept modules
3. **Follow naming convention**: `feature-name.cjs`
4. **Document in this file** with problem/solution/technical details
5. **Update README.md** with patch description

Example patch structure:

```javascript
/**
 * OpenClaw OmniRoute Modular Patch: [Feature Name]
 * =================================================
 * [Brief description of what this patch does]
 */

'use strict';

// ─── Configuration ───────────────────────────────────────────────────────────
const CONFIG = {
  // Patch configuration here
};

// ─── Patch Logic ─────────────────────────────────────────────────────────────
function applyPatch() {
  // Intercept modules and apply changes
  console.log('[patch-name] ✅ Patch applied');
}

// ─── Execution ───────────────────────────────────────────────────────────────
applyPatch();
```

