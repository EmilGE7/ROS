#!/usr/bin/env bash
# ==============================================================================
# RescueOS ISO Builder
# Builds a bootable Debian 13 (Trixie) Live ISO running the RescueOS application
# full-screen in Chromium kiosk mode, completely offline after boot.
#
# Requirements (run on Debian/Ubuntu amd64 host or Debian under WSL2):
#   sudo apt install -y live-build debootstrap squashfs-tools xorriso curl git
#
# Usage:
#   cd deployment/debian-live
#   ./build-rescueos-iso.sh
#
# Output: rescueos-amd64.iso in the current directory
# ==============================================================================
set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${HERE}/../.." && pwd)"

NODE_VERSION="22.14.0"
NODE_ARCHIVE="node-v${NODE_VERSION}-linux-x64.tar.xz"
NODE_BASE="https://nodejs.org/dist/v${NODE_VERSION}"
NODE_DEST="${HERE}/config/includes.chroot/usr/local/lib/nodejs"
NODE_DIR="${NODE_DEST}/node-v${NODE_VERSION}-linux-x64"

CHROOT_APP="${HERE}/config/includes.chroot/opt/rescueos"

# -----------------------------------------------------------------------------
# Sanity checks
# -----------------------------------------------------------------------------
if [[ "$(uname -m)" != "x86_64" ]]; then
  echo "ERROR: This build targets amd64/x86_64 only. Run on an x86_64 machine." >&2
  exit 1
fi

if ! command -v lb >/dev/null 2>&1; then
  echo "ERROR: live-build not found." >&2
  echo "Install: sudo apt install -y live-build debootstrap squashfs-tools xorriso" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "ERROR: curl not found. Install: sudo apt install -y curl" >&2
  exit 1
fi

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "ERROR: This script must run as root (sudo) because live-build requires root." >&2
  echo "Run:  sudo ${BASH_SOURCE[0]}" >&2
  exit 1
fi

# -----------------------------------------------------------------------------
# Step 1: Sync the latest application source into the chroot overlay
# -----------------------------------------------------------------------------
echo ""
echo "=== Step 1: Syncing RescueOS application source into chroot overlay ==="
mkdir -p "${CHROOT_APP}/backend" "${CHROOT_APP}/frontend"

# Sync backend (exclude runtime artifacts)
rsync -a --delete \
  --exclude='rescueos.sqlite' \
  --exclude='rescueos-data.json' \
  --exclude='rescueos.pid' \
  --exclude='rescueos.log' \
  --exclude='node_modules/' \
  "${PROJECT_ROOT}/backend/" "${CHROOT_APP}/backend/"

# Sync frontend (all static files including bundled vendor libs)
rsync -a --delete \
  "${PROJECT_ROOT}/frontend/" "${CHROOT_APP}/frontend/"

# Copy documentation
for doc in README.md ARCHITECTURE.md SECURITY.md; do
  if [ -f "${PROJECT_ROOT}/${doc}" ]; then
    cp "${PROJECT_ROOT}/${doc}" "${CHROOT_APP}/"
  fi
done

echo "  Backend files synced to:  ${CHROOT_APP}/backend"
echo "  Frontend files synced to: ${CHROOT_APP}/frontend"

# -----------------------------------------------------------------------------
# Step 2: Download and verify the pinned Node.js runtime
# -----------------------------------------------------------------------------
echo ""
echo "=== Step 2: Preparing Node.js ${NODE_VERSION} runtime ==="
mkdir -p "${NODE_DEST}"

if [[ ! -x "${NODE_DIR}/bin/node" ]]; then
  echo "  Downloading Node.js ${NODE_VERSION} ..."
  TMPDIR_NODE="$(mktemp -d)"
  cleanup_tmp() { rm -rf "${TMPDIR_NODE}"; }
  trap cleanup_tmp EXIT

  curl -fL --retry 3 --progress-bar \
    "${NODE_BASE}/${NODE_ARCHIVE}" -o "${TMPDIR_NODE}/${NODE_ARCHIVE}"

  echo "  Verifying SHA-256 checksum ..."
  curl -fL --retry 3 --silent \
    "${NODE_BASE}/SHASUMS256.txt" -o "${TMPDIR_NODE}/SHASUMS256.txt"

  EXPECTED="$(awk -v f="${NODE_ARCHIVE}" '$2 == f {print $1}' "${TMPDIR_NODE}/SHASUMS256.txt")"
  ACTUAL="$(sha256sum "${TMPDIR_NODE}/${NODE_ARCHIVE}" | awk '{print $1}')"

  if [[ -z "${EXPECTED}" || "${EXPECTED}" != "${ACTUAL}" ]]; then
    echo "ERROR: Node.js archive checksum verification FAILED." >&2
    echo "  Expected: ${EXPECTED}" >&2
    echo "  Actual:   ${ACTUAL}" >&2
    exit 1
  fi
  echo "  Checksum verified OK."

  tar -xJf "${TMPDIR_NODE}/${NODE_ARCHIVE}" -C "${TMPDIR_NODE}"
  rm -rf "${NODE_DIR}"
  cp -a "${TMPDIR_NODE}/node-v${NODE_VERSION}-linux-x64" "${NODE_DIR}"
  echo "  Node.js extracted to: ${NODE_DIR}"
else
  echo "  Node.js ${NODE_VERSION} already present, skipping download."
fi

# Quick sanity check: verify the bundled server.js is syntactically valid
echo "  Checking server.js syntax ..."
"${NODE_DIR}/bin/node" --version
"${NODE_DIR}/bin/node" --check "${CHROOT_APP}/backend/server.js"
echo "  server.js syntax OK."

# -----------------------------------------------------------------------------
# Step 3: Mark all shell scripts in the chroot overlay as executable
# These permissions survive the copy into the live filesystem.
# -----------------------------------------------------------------------------
echo ""
echo "=== Step 3: Setting executable permissions on scripts ==="
for f in \
  "${HERE}/config/includes.chroot/usr/local/bin/rescueos-kiosk" \
  "${HERE}/config/includes.chroot/usr/local/bin/rescueos-session" \
  "${HERE}/config/includes.chroot/usr/local/bin/rescueos-hotspot" \
  "${HERE}/config/includes.chroot/usr/local/bin/rescueos-network" \
  "${HERE}/config/hooks/live/0100-rescueos-config.hook.chroot" \
  "${HERE}/auto/config" \
  "${HERE}/auto/clean" \
  "${HERE}/auto/build"
do
  if [ -f "$f" ]; then
    chmod +x "$f"
    echo "  chmod +x $f"
  else
    echo "  WARNING: expected file not found: $f" >&2
  fi
done

# -----------------------------------------------------------------------------
# Step 4: Build the ISO
# -----------------------------------------------------------------------------
echo ""
echo "=== Step 4: Running live-build ==="
cd "${HERE}"

# Clean previous build (preserves cached packages for speed)
lb clean --purge 2>/dev/null || true

lb config
lb build 2>&1 | tee build.log

# -----------------------------------------------------------------------------
# Step 5: Locate and report the ISO
# -----------------------------------------------------------------------------
echo ""
echo "=== Step 5: Build complete ==="

ISO_FILE="$(find "${HERE}" -maxdepth 1 -name "*.iso" | head -1)"
if [[ -z "${ISO_FILE}" ]]; then
  echo "ERROR: No ISO file found after build. Check build.log for errors." >&2
  exit 1
fi

ISO_SIZE="$(du -sh "${ISO_FILE}" | cut -f1)"
echo "  ISO file:   ${ISO_FILE}"
echo "  ISO size:   ${ISO_SIZE}"
echo ""
echo "============================================================"
echo "  RescueOS ISO build complete!"
echo "============================================================"
echo ""
echo "Test in QEMU/KVM (no USB flashing needed):"
echo ""
echo "  # BIOS boot test:"
echo "  qemu-system-x86_64 -m 2048 -cdrom '${ISO_FILE}' -boot d"
echo ""
echo "  # UEFI boot test (requires ovmf):"
echo "  sudo apt install -y ovmf"
echo "  qemu-system-x86_64 -m 2048 -bios /usr/share/ovmf/OVMF.fd \\"
echo "    -cdrom '${ISO_FILE}' -boot d"
echo ""
echo "Offline connectivity test:"
echo "  Start the VM, disconnect host internet, verify app loads at http://127.0.0.1:8080"
echo ""
echo "IMPORTANT: Boot-test in a VM before any field deployment."
