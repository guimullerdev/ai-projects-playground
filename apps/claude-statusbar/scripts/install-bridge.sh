#!/bin/sh
# Installs (idempotently) the claude-statusbar bridge into the user's
# ~/.claude/statusline-command.sh — the snippet that dumps every statusline
# payload the Claude Code app sends into ~/.claude/statusbar/, so the
# claude-statusbar menu-bar app has something to read.
#
# Safe to re-run: if the bridge markers are already present, this is a no-op.
# Safe if no statusline is configured yet: a minimal one is created.

set -eu

TARGET="${1:-$HOME/.claude/statusline-command.sh}"
MARK_START="# >>> claude-statusbar bridge >>>"
MARK_END="# <<< claude-statusbar bridge <<<"
ANCHOR='input=$(cat)'

mkdir -p "$HOME/.claude/statusbar"

if [ -f "$TARGET" ] && grep -qF "$MARK_START" "$TARGET" 2>/dev/null; then
  echo "claude-statusbar bridge already installed in $TARGET — nothing to do."
  exit 0
fi

if [ ! -f "$TARGET" ]; then
  echo "No statusline script found at $TARGET — creating a minimal one."
  printf '#!/bin/sh\ninput=$(cat)\n' > "$TARGET"
  chmod +x "$TARGET"
fi

SNIPPET=$(mktemp)
trap 'rm -f "$SNIPPET"' EXIT

cat > "$SNIPPET" <<SNIPPET_EOF
$MARK_START
mkdir -p "\$HOME/.claude/statusbar"
_csb_tmp="\$HOME/.claude/statusbar/latest.json.tmp.\$\$"
printf '%s' "\$input" | jq --arg at "\$(date -u +%FT%TZ)" '. + {captured_at:\$at}' > "\$_csb_tmp" 2>/dev/null \\
  && mv "\$_csb_tmp" "\$HOME/.claude/statusbar/latest.json"
_csb_5h=\$(printf '%s' "\$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
_csb_7d=\$(printf '%s' "\$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
_csb_last="\$HOME/.claude/statusbar/.last_pct"
_csb_cur="\${_csb_5h}|\${_csb_7d}"
if [ "\$(cat "\$_csb_last" 2>/dev/null || true)" != "\$_csb_cur" ]; then
  printf '%s\n' "\$_csb_cur" > "\$_csb_last"
  printf '%s' "\$input" | jq -c --arg at "\$(date -u +%FT%TZ)" '{at:\$at, five_hour: .rate_limits.five_hour, seven_day: .rate_limits.seven_day}' >> "\$HOME/.claude/statusbar/rate-limits.jsonl" 2>/dev/null || true
fi
$MARK_END
SNIPPET_EOF

if ! grep -qF "$ANCHOR" "$TARGET"; then
  echo "Warning: $TARGET doesn't read stdin as \$input the way this bridge" >&2
  echo "expects (looked for a line like 'input=\$(cat)'). Appending the" >&2
  echo "bridge at the end of the file instead — check it reads \$input" >&2
  echo "correctly before it, or it will capture nothing." >&2
  { echo ""; cat "$SNIPPET"; } >> "$TARGET"
  exit 0
fi

LINE_NO=$(grep -nF "$ANCHOR" "$TARGET" | head -1 | cut -d: -f1)
TMP=$(mktemp)
{
  head -n "$LINE_NO" "$TARGET"
  cat "$SNIPPET"
  tail -n "+$((LINE_NO + 1))" "$TARGET"
} > "$TMP"
mv "$TMP" "$TARGET"
chmod +x "$TARGET"

echo "claude-statusbar bridge installed in $TARGET."
echo "It writes ~/.claude/statusbar/latest.json on every statusline update"
echo "and appends to ~/.claude/statusbar/rate-limits.jsonl when the rate"
echo "limit percentage changes."
