#!/bin/bash
# Double-click to install or update NowCaption for Vesktop. Nothing else needs to be installed first.
# The first time, macOS may block it: open System Settings > Privacy & Security and click "Open Anyway".
exec /bin/bash "$(dirname "$0")/scripts/bootstrap/install-unix.sh" "$@"
