#!/bin/sh
# Read-only Mac checks. The only write is a new report beside this script.
set -eu
if [ "$(uname -s)" != Darwin ]; then
  printf '%s\n' 'This diagnostic must run on the Mac itself.' >&2
  exit 2
fi
for innovox_bin in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin"; do
  if [ -d "$innovox_bin" ]; then PATH="$innovox_bin:$PATH"; fi
done
export PATH
innovox_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
innovox_report="$innovox_directory/InnoVox-Mac-check-$(date +%Y%m%d-%H%M%S).txt"
umask 077
set -C
{
  printf 'InnoVox Mac diagnostic v1\n'
  printf 'CheckedAtUTC: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'MacName: %s\n' "$(/usr/sbin/scutil --get ComputerName 2>/dev/null || printf unknown)"
  printf 'LoginUser: %s\n' "$(id -un)"
  printf 'MacOS: %s\n' "$(/usr/bin/sw_vers -productVersion)"
  printf 'Architecture: %s\n' "$(uname -m)"
  printf 'HardwareModel: %s\n' "$(/usr/sbin/sysctl -n hw.model)"
  printf 'MemoryBytes: %s\n' "$(/usr/sbin/sysctl -n hw.memsize)"
  for innovox_tool in node pnpm git codex claude tailscale; do
    if command -v "$innovox_tool" >/dev/null 2>&1; then
      printf 'Command_%s: present\n' "$innovox_tool"
    else
      printf 'Command_%s: not_found_on_checked_path\n' "$innovox_tool"
    fi
  done
  if command -v node >/dev/null 2>&1; then printf 'NodeVersion: %s\n' "$(node --version 2>/dev/null || printf unavailable)"; fi
  if [ -d "$HOME/.codex/sessions" ]; then printf 'CodexSessionDirectory: present\n'; else printf 'CodexSessionDirectory: not_found\n'; fi
  if [ -d "$HOME/.claude/projects" ]; then printf 'ClaudeProjectDirectory: present\n'; else printf 'ClaudeProjectDirectory: not_found\n'; fi
  printf 'ConversationContentsRead: false\n'
  printf 'CredentialsRead: false\n'
  printf 'MicrophoneTested: false\n'
  printf 'ScreenCaptureTested: false\n'
  printf 'SettingsChanged: false\n'
} > "$innovox_report"
printf '\n診断結果を保存しました:\n%s\nこのテキストファイルを元のCodexの会話へ添付してください。\n' "$innovox_report"
/usr/bin/open -R "$innovox_report" >/dev/null 2>&1 || true
