#!/usr/bin/env bash
# Generates the test clips with macOS's built-in voices (free — no provider credits).
# Output: 16 kHz mono 16-bit WAV in fixtures/audio/, plus the source text as ground truth.
set -euo pipefail
cd "$(dirname "$0")/../fixtures/audio"

make_clip() {
  local name="$1" voice="$2" text="$3"
  say -v "$voice" -o "/tmp/$name.aiff" "$text"
  afconvert -f WAVE -d LEI16@16000 -c 1 "/tmp/$name.aiff" "$name.wav"
  printf '%s\n' "$text" > "$name.txt"
  rm "/tmp/$name.aiff"
  echo "$name.wav: $(afinfo "$name.wav" | awk '/estimated duration/ {print $3 "s"}')"
}

make_clip hi-4s Lekha "नमस्ते, आज मौसम बहुत अच्छा है और मैं बाज़ार जा रहा हूँ।"
make_clip en-4s Rishi "Hello, this is a quick test of the speech to text playground."
