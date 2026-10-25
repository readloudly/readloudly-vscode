#!/bin/sh
# Launches a throwaway VS Code profile with the spike; pass AUTOQUIT_MS to quit after the probes.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
case "$(uname)" in
  Darwin) app="/Applications/Visual Studio Code.app/Contents/MacOS/Code" ;;
  *) app=$(command -v code) ;;
esac
# A fixed short profile path: reused so a relaunch shows whether window bounds were restored; macOS IPC sockets need <104 chars.
profile="${RL_SPIKE_PROFILE:-/tmp/rl-spike-profile}"
mkdir -p "$profile"
# env -i drops ELECTRON_RUN_AS_NODE and VSCODE_* inherited from a VS Code terminal.
exec env -i HOME="$HOME" USER="${USER:-}" PATH="/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin" DISPLAY="${DISPLAY:-}" WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-}" XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-}" RL_SPIKE_AUTOQUIT="${AUTOQUIT_MS:-}" \
  "$app" --user-data-dir "$profile/ud" --extensions-dir "$profile/ext" --extensionDevelopmentPath="$here" \
  --disable-extensions --disable-workspace-trust --skip-welcome --skip-release-notes --new-window
