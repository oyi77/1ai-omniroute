#!/bin/bash
# CLIProxyAPI Version Manager
# Manage CLIProxyAPI versions and updates

set -e

CLI_PROXY_DIR="/home/openclaw/CLIProxyAPI"
CLI_PROXY_BIN="$CLI_PROXY_DIR/cli-proxy-api"
BACKUP_DIR="/home/openclaw/.cliproxyapi-backups"
LOG_FILE="/home/openclaw/.omniroute/cliproxyapi-manager.log"

current_version() {
  if [ -f "$CLI_PROXY_BIN" ]; then
    local ver
    ver=$("$CLI_PROXY_BIN" 2>&1 | grep -o "Version: [^,]*" | cut -d' ' -f2 || echo "unknown")
    echo "$ver"
  else
    echo "not_installed"
  fi
}

list_versions() {
  cd "$CLI_PROXY_DIR"
  echo "=== Available Versions ==="
  git fetch --tags 2>/dev/null || true
  git tag -l | sort -V | tail -20
  echo ""
  echo "=== Current ==="
  echo "$(current_version) (current)"
}

switch_version() {
  local version="$1"
  
  if [ -z "$version" ]; then
    echo "Usage: cliproxyapi-manager switch <version>"
    exit 1
  fi
  
  cd "$CLI_PROXY_DIR"
  
  # Check if tag exists
  if ! git tag -l | grep -q "^${version}$"; then
    echo "Version $version not found. Fetching tags..."
    git fetch --tags
    if ! git tag -l | grep -q "^${version}$"; then
      echo "Error: Version $version does not exist"
      exit 1
    fi
  fi
  
  # Backup current binary
  mkdir -p "$BACKUP_DIR"
  local current
  current=$(current_version)
  if [ -f "$CLI_PROXY_BIN" ] && [ "$current" != "not_installed" ]; then
    cp "$CLI_PROXY_BIN" "$BACKUP_DIR/cli-proxy-api-${current}-$(date +%Y%m%d-%H%M%S)"
    echo "Backed up current version: $current"
  fi
  
  # Stop service
  echo "Stopping CLIProxyAPI service..."
  sudo systemctl stop cliproxyapi || true
  
  # Checkout version
  echo "Switching to $version..."
  git checkout "tags/$version" -B "version-$version" 2>/dev/null || git checkout "$version"
  
  # Build if needed (Go binary)
  if [ -f "go.mod" ] && [ ! -f "$CLI_PROXY_BIN" ]; then
    echo "Building CLIProxyAPI..."
    if command -v go >/dev/null 2>&1; then
      go build -o cli-proxy-api .
    else
      echo "Error: Go not installed, cannot build"
      exit 1
    fi
  fi
  
  # Start service
  echo "Starting CLIProxyAPI service..."
  sudo systemctl start cliproxyapi
  
  # Verify
  sleep 2
  if pgrep -f cli-proxy-api > /dev/null; then
    echo "✓ Successfully switched to $version"
    echo "$(date): Switched to $version" | tee -a "$LOG_FILE"
  else
    echo "✗ Failed to start CLIProxyAPI"
    exit 1
  fi
}

update_latest() {
  local force_yes="${1:-}"
  
  cd "$CLI_PROXY_DIR"
  
  echo "Fetching latest changes..."
  git fetch origin
  
  local latest
  latest=$(git describe --tags --abbrev=0 2>/dev/null || echo "main")
  
  local current
  current=$(current_version)
  
  if [ "$latest" = "$current" ]; then
    echo "Already at latest version: $latest"
    return 0
  fi
  
  echo "Update available: $current -> $latest"
  
  if [[ "$force_yes" =~ ^(-y|--yes)$ ]]; then
    echo "Auto-confirming update (-y flag)"
    switch_version "$latest"
  else
    read -p "Proceed with update? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      switch_version "$latest"
    else
      echo "Update cancelled"
    fi
  fi
}

status() {
  echo "=== CLIProxyAPI Status ==="
  echo "Current Version: $(current_version)"
  echo "Binary Location: $CLI_PROXY_BIN"
  echo "Service Status:"
  sudo systemctl status cliproxyapi --no-pager 2>&1 | grep -E "Active:|Loaded:" | head -2
  echo ""
  echo "Recent Logs:"
  sudo journalctl -u cliproxyapi --since "5 minutes ago" --no-pager 2>&1 | tail -3
}

show_help() {
  echo "CLIProxyAPI Version Manager"
  echo ""
  echo "Usage:"
  echo "  $0 current          - Show current version"
  echo "  $0 list             - List available versions"
  echo "  $0 switch <version> - Switch to specific version"
  echo "  $0 update           - Update to latest version"
  echo "  $0 status           - Show service status"
  echo ""
  echo "Examples:"
  echo "  $0 list"
  echo "  $0 switch v6.9.1"
  echo "  $0 update"
}

case "${1:-help}" in
  current)
    current_version
    ;;
  list|ls)
    list_versions
    ;;
  switch|use)
    switch_version "$2"
    ;;
  update|upgrade)
    update_latest "$2"
    ;;
  status|st)
    status
    ;;
  help|--help|-h)
    show_help
    ;;
  *)
    echo "Unknown command: $1"
    show_help
    exit 1
    ;;
esac
