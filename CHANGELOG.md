# Changelog

## 0.4.0-dodo.2
- League of Legends: auto-accept the queue (optional).
- Images through your Gemini web account (Zen or Chrome) instead of the API key, with API fallback; the result stays open on screen.
- Zen: Capri adds `--remote-debugging-port 9223` to your Zen shortcuts so it (and the Zen MCP) can drive it. Off with `zenDebugPort: false`.
- Pick the Claude version and effort per family (Sonnet / Opus / Haiku).
- Compact voice-call card in the big chat window; Ctrl+Alt+V opens her card.
- WhatsApp sending: select the contact with Down+Enter.

## 0.4.0-dodo.1 (on top of capri-desktop 0.4.0, MIT)
- Dictation anywhere, Downloads scan (Defender / VirusTotal hash), picture tools, PC alerts, incremental backup, performance mode, League of Legends mode, quieter message cards, a model-install command, one-model-at-a-time memory handling, resting on the taskbar left or right.
- The packaged app now includes `tools/` (local Whisper installer) and unpacks `dictate.ps1`, so dictation and "instala whisper" work from the installer too.
- No personal name is built in: she uses the name you set in her settings (`userName`).
