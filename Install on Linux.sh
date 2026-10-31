#!/bin/bash
# Install or update NowCaption for Vesktop: double-click (choose "Run" or "Run in Terminal") or run it in a terminal.
# Nothing else needs to be installed first.
HERE="$(cd "$(dirname "$0")" && pwd)"
# Started from a file manager without a terminal: open one, so the progress and any questions can be seen.
if [ ! -t 0 ] && [ -z "${NOWCAPTION_IN_TERMINAL:-}" ] && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
    export NOWCAPTION_IN_TERMINAL=1
    script="$HERE/Install on Linux.sh"
    for t in x-terminal-emulator gnome-terminal konsole xfce4-terminal mate-terminal tilix kitty alacritty foot wezterm xterm; do
        command -v "$t" >/dev/null 2>&1 || continue
        case "$t" in
            gnome-terminal|mate-terminal|tilix) exec "$t" -- /bin/bash "$script" "$@" ;;
            xfce4-terminal) exec "$t" -x /bin/bash "$script" "$@" ;;
            wezterm) exec "$t" start -- /bin/bash "$script" "$@" ;;
            foot|kitty) exec "$t" /bin/bash "$script" "$@" ;;
            *) exec "$t" -e /bin/bash "$script" "$@" ;;
        esac
    done
fi
exec /bin/bash "$HERE/scripts/bootstrap/install-unix.sh" "$@"
