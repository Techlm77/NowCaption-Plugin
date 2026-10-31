#!/bin/bash
# Started by "Install on Mac.command" and "Install on Linux.sh". Gets NowCaption's own copy of Node.js (no admin
# rights, nothing changed system-wide), then runs scripts/setup.mjs, which does the rest.
# Bash 3.2 compatible (macOS's /bin/bash).
set -u
NODE_VERSION=v26.13.0
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

finish() {
    if [ -t 0 ] && [ -z "${NOWCAPTION_NO_PAUSE:-}" ] && [ -z "${CI:-}" ]; then
        echo
        read -r -p "Press Enter to close this window. " _ || true
    fi
    exit "$1"
}
fail() { echo; echo "The installation didn't finish: $*"; finish 1; }

case "$(uname -s)" in
    Darwin)
        os=darwin
        base="$HOME/Library/Application Support/NowCaption-Vesktop"
        # Node.js 26 (used to build Vencord) needs macOS 13.5 Ventura or newer.
        IFS=. read -r major minor _ <<EOF_VERSION
$(sw_vers -productVersion)
EOF_VERSION
        if [ "${major:-0}" -lt 13 ] || { [ "$major" -eq 13 ] && [ "${minor:-0}" -lt 5 ]; }; then
            fail "NowCaption's installer needs macOS 13.5 (Ventura) or newer; this Mac has $(sw_vers -productVersion)."
        fi
        # Apple Silicon reports x86_64 when this runs under Rosetta: use the native build anyway.
        if [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = "1" ]; then arch=arm64; else arch=x64; fi
        ;;
    Linux)
        os=linux
        base="${XDG_DATA_HOME:-$HOME/.local/share}/nowcaption-vesktop"
        case "$(uname -m)" in
            x86_64|amd64) arch=x64 ;;
            aarch64|arm64) arch=arm64 ;;
            *) fail "NowCaption's speech engine has no build for this processor ($(uname -m))." ;;
        esac
        ;;
    *) fail "this installer is for macOS and Linux; on Windows, use \"Install on Windows.cmd\"." ;;
esac
[ -n "${NOWCAPTION_VESKTOP_HOME:-}" ] && base="$NOWCAPTION_VESKTOP_HOME"

case "$os-$arch" in
    darwin-arm64) sha=d38bd5e5a2ddce6bbb5ce45e46e208337da4d51fffe611e567fd32073d6439f6 ;;
    darwin-x64)   sha=525c9b29bb0263d687de60a4cec0e2a6db876a8eb032369e5795eca71e7c358e ;;
    linux-x64)    sha=5848553868b402d3fabb5b09270649977780a390f832155721025a08b5104455 ;;
    linux-arm64)  sha=439e9c438acdf6a6ffe47418da709153d66c4bed812e30a473faacb107dd2791 ;;
esac
name="node-$NODE_VERSION-$os-$arch"
tools="$base/tools"
node="$tools/$name/bin/node"

if [ ! -x "$node" ]; then
    echo "Getting Node.js $NODE_VERSION for the installer (about 50 MB, kept in NowCaption's own folder)..."
    mkdir -p "$tools" || fail "can't create $tools"
    part="$tools/$name.tar.gz.part"
    url="https://nodejs.org/dist/$NODE_VERSION/$name.tar.gz"
    if command -v curl >/dev/null 2>&1; then curl -fL --retry 3 -o "$part" "$url" || fail "the Node.js download failed (check your internet connection)"
    elif command -v wget >/dev/null 2>&1; then wget -O "$part" "$url" || fail "the Node.js download failed (check your internet connection)"
    else fail "neither curl nor wget is installed, so Node.js can't be downloaded."
    fi
    if command -v sha256sum >/dev/null 2>&1; then got=$(sha256sum "$part" | cut -d' ' -f1); else got=$(shasum -a 256 "$part" | cut -d' ' -f1); fi
    if [ "$got" != "$sha" ]; then rm -f "$part"; fail "the Node.js download didn't match its SHA-256, so it wasn't used. Try again later."; fi
    stage="$tools/.unpack-$$"
    rm -rf "$stage" "$tools/$name" && mkdir -p "$stage" && tar -xzf "$part" -C "$stage" && mv "$stage/$name" "$tools/$name" || fail "couldn't unpack Node.js"
    rm -rf "$stage" "$part"
fi
# setup.mjs keeps the window open itself when there's something to read.
exec "$node" "$HERE/scripts/setup.mjs" "$@"
