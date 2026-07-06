#!/usr/bin/env bash
# Union.Manifold installer/updater for Linux.
#   curl -fsSL https://raw.githubusercontent.com/fyiel/Union.Manifold/main/install.sh | bash
# Detects the package manager and installs the matching artifact from the
# latest release. Running it again updates an existing install.
set -euo pipefail

REPO="fyiel/Union.Manifold"
BASE="https://github.com/$REPO/releases/latest/download"
SUDO="${SUDO:-sudo}"
[ "$(id -u)" = "0" ] && SUDO=""

say() { printf '\033[1m%s\033[0m\n' "$*"; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

if command -v pacman >/dev/null 2>&1; then
  say "arch detected — installing pacman package"
  curl -fL --progress-bar -o "$tmp/union-manifold.pkg.tar.zst" "$BASE/union-manifold-x86_64.pkg.tar.zst"
  $SUDO pacman -U --noconfirm "$tmp/union-manifold.pkg.tar.zst"
elif command -v dpkg >/dev/null 2>&1; then
  say "debian/ubuntu detected — installing deb"
  ver=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep -om1 '"tag_name": *"v[^"]*"' | grep -o '[0-9][0-9.]*')
  curl -fL --progress-bar -o "$tmp/union-manifold.deb" "$BASE/Union.Manifold_${ver}_amd64.deb"
  $SUDO dpkg -i "$tmp/union-manifold.deb" || $SUDO apt-get -f install -y
else
  say "no pacman/dpkg — installing AppImage to ~/.local/bin"
  mkdir -p "$HOME/.local/bin" "$HOME/.local/share/applications"
  ver=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep -om1 '"tag_name": *"v[^"]*"' | grep -o '[0-9][0-9.]*')
  curl -fL --progress-bar -o "$HOME/.local/bin/union-manifold" "$BASE/Union.Manifold_${ver}_amd64.AppImage"
  chmod +x "$HOME/.local/bin/union-manifold"
  cat > "$HOME/.local/share/applications/union-manifold.desktop" <<EOF
[Desktop Entry]
Name=Union.Manifold
Exec=$HOME/.local/bin/union-manifold
Type=Application
Categories=Game;
EOF
  say "installed to ~/.local/bin/union-manifold"
fi

say "done"
