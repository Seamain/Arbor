#!/usr/bin/env bash
# =============================================================================
# Arbor — Cross-platform build script (macOS & Linux)
# =============================================================================
# Usage:
#   ./scripts/build.sh [OPTIONS]
#
# Options:
#   --platform  <macos|linux|auto>   Target platform (default: auto-detect)
#   --arch      <x86_64|aarch64|arm64|all>  Target architecture (default: all)
#   --skip-frontend                  Skip `npm run build` (use if already built)
#   -h, --help                       Show this help message
#
# Examples:
#   ./scripts/build.sh
#   ./scripts/build.sh --platform macos
#   ./scripts/build.sh --platform macos --arch aarch64
#   ./scripts/build.sh --platform linux --arch x86_64
# =============================================================================

set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

log()    { echo -e "${CYAN}[build]${NC} $*"; }
ok()     { echo -e "${GREEN}[  ok ]${NC} $*"; }
warn()   { echo -e "${YELLOW}[ warn]${NC} $*"; }
err()    { echo -e "${RED}[error]${NC} $*" >&2; }
header() { echo -e "\n${BOLD}${CYAN}══════════════════════════════════════════${NC}"; \
           echo -e "${BOLD}${CYAN}  $*${NC}"; \
           echo -e "${BOLD}${CYAN}══════════════════════════════════════════${NC}\n"; }

# ── Defaults ──────────────────────────────────────────────────────────────────
PLATFORM="auto"
ARCH="all"
SKIP_FRONTEND=false

# ── Parse arguments ───────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform)  PLATFORM="$2"; shift 2 ;;
    --arch)      ARCH="$2";     shift 2 ;;
    --skip-frontend) SKIP_FRONTEND=true; shift ;;
    -h|--help)
      sed -n '3,20p' "$0"; exit 0 ;;
    *) err "Unknown argument: $1"; exit 1 ;;
  esac
done

# ── Auto-detect platform ──────────────────────────────────────────────────────
if [[ "$PLATFORM" == "auto" ]]; then
  case "$(uname -s)" in
    Darwin) PLATFORM="macos" ;;
    Linux)  PLATFORM="linux" ;;
    *)      err "Unsupported OS: $(uname -s)"; exit 1 ;;
  esac
fi

# Normalise arm64 → aarch64 on macOS (they are synonyms)
[[ "$ARCH" == "arm64" && "$PLATFORM" == "macos" ]] && ARCH="aarch64"

# ── Validate ──────────────────────────────────────────────────────────────────
case "$PLATFORM" in
  macos|linux) ;;
  *) err "Invalid --platform: $PLATFORM (must be macos or linux)"; exit 1 ;;
esac

# ── Helpers ───────────────────────────────────────────────────────────────────
require() {
  if ! command -v "$1" &>/dev/null; then
    err "Required tool not found: $1"
    err "  Install it and re-run this script."
    exit 1
  fi
}

collect() {
  local src="$1" dest_dir="$2"
  if [[ -f "$src" ]]; then
    cp "$src" "$dest_dir/"
    ok "Collected: $(basename "$src")"
  else
    warn "Expected artifact not found: $src"
  fi
}

# ── Pre-flight checks ─────────────────────────────────────────────────────────
header "Pre-flight checks"
require cargo
require rustup
require node
require npm

TAURI_CLI_VERSION=$(npx tauri --version 2>/dev/null || echo "not found")
log "Tauri CLI: $TAURI_CLI_VERSION"
log "Rust: $(rustc --version)"
log "Node: $(node --version)"
log "npm:  $(npm --version)"

# ── Read version from tauri.conf.json ────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VERSION=$(node -p "require('$REPO_ROOT/src-tauri/tauri.conf.json').version" 2>/dev/null || \
          node -p "require('$REPO_ROOT/package.json').version")
log "App version: $VERSION"

# ── Output directory ──────────────────────────────────────────────────────────
OUT_DIR="$REPO_ROOT/dist-packages/$PLATFORM"
mkdir -p "$OUT_DIR"
log "Output dir: $OUT_DIR"

# ── Frontend build ────────────────────────────────────────────────────────────
if [[ "$SKIP_FRONTEND" == false ]]; then
  header "Building frontend"
  cd "$REPO_ROOT"
  npm run build
  ok "Frontend build complete"
fi

# =============================================================================
# macOS builds
# =============================================================================
build_macos() {
  local target="$1"    # e.g. x86_64-apple-darwin
  local arch_label="$2" # e.g. x86_64 or aarch64

  header "macOS — $arch_label ($target)"

  # Ensure target is installed
  if ! rustup target list --installed | grep -q "$target"; then
    log "Installing Rust target $target …"
    rustup target add "$target"
  fi

  cd "$REPO_ROOT"
  npx tauri build --target "$target"

  # Collect DMG
  local bundle_dir="$REPO_ROOT/src-tauri/target/$target/release/bundle/dmg"
  if [[ -d "$bundle_dir" ]]; then
    for dmg in "$bundle_dir"/*.dmg; do
      collect "$dmg" "$OUT_DIR"
    done
  else
    warn "DMG bundle dir not found: $bundle_dir"
  fi
}

# =============================================================================
# Linux builds
# =============================================================================
build_linux() {
  local target="$1"     # e.g. x86_64-unknown-linux-gnu
  local arch_label="$2" # e.g. x86_64 or arm64

  header "Linux — $arch_label ($target)"

  # For native arch, no cross-compiler needed.
  # For cross (aarch64), we need cross-compilation toolchain.
  local native_arch
  native_arch="$(uname -m)"
  local is_cross=false

  if [[ "$target" == "aarch64-unknown-linux-gnu" && "$native_arch" != "aarch64" ]]; then
    is_cross=true
  fi

  # Ensure target is installed
  if ! rustup target list --installed | grep -q "$target"; then
    log "Installing Rust target $target …"
    rustup target add "$target"
  fi

  if [[ "$is_cross" == true ]]; then
    # Check for cross-linker
    if ! command -v aarch64-linux-gnu-gcc &>/dev/null; then
      warn "Cross-linker aarch64-linux-gnu-gcc not found."
      warn "Install it with:"
      warn "  sudo apt install gcc-aarch64-linux-gnu (Debian/Ubuntu)"
      warn "  sudo dnf install gcc-aarch64-linux-gnu (Fedora)"
      warn "Skipping aarch64 Linux build."
      return
    fi
    export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc
    export CC_aarch64_unknown_linux_gnu=aarch64-linux-gnu-gcc
    export CXX_aarch64_unknown_linux_gnu=aarch64-linux-gnu-g++
    export PKG_CONFIG_SYSROOT_DIR=/usr/aarch64-linux-gnu
  fi

  cd "$REPO_ROOT"
  npx tauri build --target "$target" --bundles deb,rpm,appimage

  local bundle_base="$REPO_ROOT/src-tauri/target/$target/release/bundle"

  # .deb
  for f in "$bundle_base/deb/"*.deb; do collect "$f" "$OUT_DIR"; done
  # .rpm
  for f in "$bundle_base/rpm/"*.rpm; do collect "$f" "$OUT_DIR"; done
  # .AppImage
  for f in "$bundle_base/appimage/"*.AppImage; do collect "$f" "$OUT_DIR"; done
}

# =============================================================================
# Dispatch
# =============================================================================
if [[ "$PLATFORM" == "macos" ]]; then
  # macOS must be built ON macOS
  if [[ "$(uname -s)" != "Darwin" ]]; then
    err "macOS targets must be built on a macOS host."
    exit 1
  fi

  case "$ARCH" in
    x86_64) build_macos "x86_64-apple-darwin"  "x86_64" ;;
    aarch64|arm64) build_macos "aarch64-apple-darwin" "aarch64" ;;
    all)
      build_macos "x86_64-apple-darwin"  "x86_64"
      build_macos "aarch64-apple-darwin" "aarch64"
      ;;
    *) err "Invalid --arch for macOS: $ARCH"; exit 1 ;;
  esac

elif [[ "$PLATFORM" == "linux" ]]; then
  if [[ "$(uname -s)" != "Linux" ]]; then
    err "Linux targets must be built on a Linux host."
    exit 1
  fi

  case "$ARCH" in
    x86_64) build_linux "x86_64-unknown-linux-gnu"   "x86_64" ;;
    arm64|aarch64) build_linux "aarch64-unknown-linux-gnu" "arm64" ;;
    all)
      build_linux "x86_64-unknown-linux-gnu"   "x86_64"
      build_linux "aarch64-unknown-linux-gnu"  "arm64"
      ;;
    *) err "Invalid --arch for Linux: $ARCH"; exit 1 ;;
  esac
fi

# ── Summary ───────────────────────────────────────────────────────────────────
header "Build complete"
log "Artifacts in: $OUT_DIR"
echo ""
ls -lh "$OUT_DIR"
echo ""
ok "All done! 🎉"
