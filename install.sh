#!/usr/bin/env bash
set -euo pipefail

REPO="fyiel/Union.Manifold"
BASE="https://github.com/$REPO/releases/latest/download"
SUDO="${SUDO:-sudo}"
[ "$(id -u)" = "0" ] && SUDO=""

say() { printf '\033[1m%s\033[0m\n' "$*"; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Verify a downloaded artifact against the sha256 checksum the release
# publishes next to it (<artifact>.sha256). If no checksum file exists for
# that asset, say so and skip verification rather than fail.
verify_sha256() {
  local file="$1" url="$2" expected actual
  if curl -fsSL -o "$tmp/checksum" "$url.sha256" 2>/dev/null; then
    # checksum files are "<hex>  <filename>" (or just "<hex>")
    expected=$(awk '{print $1}' "$tmp/checksum")
    actual=$(sha256sum "$file" | awk '{print $1}')
    if [ "$expected" != "$actual" ]; then
      say "checksum mismatch for $(basename "$file") — aborting"
      exit 1
    fi
    say "sha256 checksum verified"
  else
    say "note: release does not publish a sha256 checksum for $(basename "$file"), skipping verification"
  fi
}

case "$(uname -m)" in
  x86_64) arch=x86_64 ;;
  aarch64 | arm64) arch=aarch64 ;;
  *)
    arch=""
    say "unsupported architecture $(uname -m): releases only publish x86_64 and aarch64 packages"
    exit 1
    ;;
esac

if command -v pacman >/dev/null 2>&1; then
  say "arch detected — installing pacman package"
  if [ "$arch" != "x86_64" ]; then
    say "no aarch64 pacman package is published yet — see https://github.com/$REPO/releases"
    exit 1
  fi
  curl -fL --progress-bar -o "$tmp/union-manifold.pkg.tar.zst" "$BASE/union-manifold-x86_64.pkg.tar.zst"
  verify_sha256 "$tmp/union-manifold.pkg.tar.zst" "$BASE/union-manifold-x86_64.pkg.tar.zst"
  $SUDO pacman -U --noconfirm "$tmp/union-manifold.pkg.tar.zst"
elif command -v dnf >/dev/null 2>&1; then
  say "fedora detected — installing rpm"
  if [ "$arch" != "x86_64" ]; then
    say "no aarch64 rpm is published yet — see https://github.com/$REPO/releases"
    exit 1
  fi
  curl -fL --progress-bar -o "$tmp/union-manifold.rpm" "$BASE/union-manifold-x86_64.rpm"
  verify_sha256 "$tmp/union-manifold.rpm" "$BASE/union-manifold-x86_64.rpm"
  $SUDO dnf install -y "$tmp/union-manifold.rpm"
elif command -v dpkg >/dev/null 2>&1; then
  say "debian/ubuntu detected — installing deb"
  ver=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep -om1 '"tag_name": *"[^"]*"' | grep -o '[0-9][0-9.]*')
  deb_arch=$(dpkg --print-architecture)
  if [ "$deb_arch" != "amd64" ]; then
    say "no ${deb_arch} deb is published yet (only amd64) — see https://github.com/$REPO/releases"
    exit 1
  fi
  curl -fL --progress-bar -o "$tmp/union-manifold.deb" "$BASE/Union.Manifold_${ver}_amd64.deb"
  verify_sha256 "$tmp/union-manifold.deb" "$BASE/Union.Manifold_${ver}_amd64.deb"
  $SUDO dpkg -i "$tmp/union-manifold.deb" || $SUDO apt-get -f install -y
else
  if [ "$arch" = "aarch64" ]; then
    say "no aarch64 AppImage is published yet (only amd64) — see https://github.com/$REPO/releases"
    exit 1
  fi
  say "no pacman/dpkg — installing AppImage to ~/.local/bin"
  mkdir -p "$HOME/.local/bin" "$HOME/.local/share/applications" "$HOME/.local/share/icons/hicolor/512x512/apps"
  ver=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep -om1 '"tag_name": *"[^"]*"' | grep -o '[0-9][0-9.]*')
  appimage="$HOME/.local/bin/union-manifold"
  curl -fL --progress-bar -o "$appimage" "$BASE/Union.Manifold_${ver}_amd64.AppImage"
  chmod +x "$appimage"
  verify_sha256 "$appimage" "$BASE/Union.Manifold_${ver}_amd64.AppImage"
  # Ship the icon so the desktop entry has something spec-compliant to point at.
  icon="$HOME/.local/share/icons/hicolor/512x512/apps/union-manifold.png"
  if ! curl -fsSL --progress-bar -o "$icon" "$BASE/icon.png"; then
    rm -f "$icon"; icon=""
  fi
  # Exec must be a single expanded path ($HOME already holds an absolute path,
  # but expand it here explicitly so the entry stays valid even if the heredoc
  # quoting changes later).
  cat > "$HOME/.local/share/applications/union-manifold.desktop" <<EOF
[Desktop Entry]
Name=Union.Manifold
Exec=${appimage}
Type=Application
Categories=Game;
StartupWMClass=Union.Manifold
${icon:+Icon=${icon}}
EOF
  say "installed to ~/.local/bin/union-manifold"
fi

say "done"
