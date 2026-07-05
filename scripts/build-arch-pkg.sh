#!/usr/bin/env bash
# Repackage the tauri deb into a pacman package (.pkg.tar.zst) that installs
# with pacman -U. A pacman package is just a zstd tar with a .PKGINFO at the
# root, so no Arch tooling is needed, plain tar + zstd on any distro works.
set -euo pipefail

version="${1:?usage: build-arch-pkg.sh <version> [target-triple]}"
triple="${2:-x86_64-unknown-linux-gnu}"
root="$(cd "$(dirname "$0")/.." && pwd)"

# match the requested version exactly so a stale deb from an older build never
# gets repackaged under the new version label
deb=$(find "$root/src-tauri/target/$triple/release/bundle/deb" -maxdepth 1 -name "*_${version}_*.deb" 2>/dev/null | head -1)
[ -n "$deb" ] || { echo "no ${version} deb found for $triple, run tauri build first" >&2; exit 1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
if command -v dpkg-deb >/dev/null; then
  dpkg-deb -x "$deb" "$work/pkg"
else
  # no dpkg on the runner, unpack the ar archive by hand
  (cd "$work" && ar x "$deb" && mkdir pkg && tar -xf data.tar.* -C pkg)
fi

# the deb drops sidecars straight into /usr/bin where they'd conflict with the
# system aria2 and p7zip packages, park them in /usr/lib/Union.Manifold instead
# (resolve_sidecar in src-tauri/src/bins.rs knows to look there)
mkdir -p "$work/pkg/usr/lib/Union.Manifold"
for bin in 7z aria2c; do
  [ -f "$work/pkg/usr/bin/$bin" ] && mv "$work/pkg/usr/bin/$bin" "$work/pkg/usr/lib/Union.Manifold/$bin"
done

size=$(du -sb "$work/pkg" | cut -f1)
cat > "$work/pkg/.PKGINFO" <<EOF
pkgname = union-manifold
pkgbase = union-manifold
pkgver = ${version}-1
pkgdesc = one search across every catalog, deduped into one library
url = https://github.com/fyiel/Union.Manifold
builddate = $(date +%s)
packager = Union.Manifold CI <me@pumg.fyi>
size = ${size}
arch = x86_64
license = MIT
depend = webkit2gtk-4.1
depend = gtk3
depend = libayatana-appindicator
optdepend = gamemode: feral gamemode launch wrapper
optdepend = mangohud: fps overlay launch wrapper
EOF

out="$root/union-manifold-${version}-1-x86_64.pkg.tar.zst"
# .PKGINFO must be the first entry, ownership root, no ./ prefix noise
(cd "$work/pkg" && \
  find . -mindepth 1 -not -name '.PKGINFO' -printf '%P\n' | sort > ../files && \
  tar --zstd --owner=0 --group=0 --numeric-owner --no-recursion -cf "$out" .PKGINFO -T ../files)
echo "built $out"
