# Privacy and security design notes

- Audio is captured from incoming Discord voice tracks **only after the user enables the plugin/caption capture** and adds the track. Audio stays in memory for local recognition; no network transcription service is used.
- The model installer downloads from a pinned release URL and checks SHA-256; the runtime package is pinned. No model download is required at every launch.
- Diagnostic exports contain performance metadata, not transcripts, raw audio, Discord user IDs, SSRCs, or names; metadata still reveals timing and usage patterns, so exports should be opt-in.
- The plugin stores your appearance settings and card layout in Vesktop's local storage. For a speaker Discord has
  verified, the colour and card position you chose are stored under their Discord user ID (no names or captions).
  Exported diagnostics omit them. There's no button to clear them yet: clearing Vesktop's local storage does.
- Messages shown in Vesktop (for example "Speech model v4 isn't installed in …") show the home folder as `~`, so a
  screenshot doesn't reveal the computer's user name.
- Any future transcript-export feature must be explicit and opt-in; it is not part of this version.
- Captions are kept in memory only while a card is open, and each card keeps at most its last 3,000 characters.
- `update-plugin` changes one setting in Vesktop's `state.json` (`vencordDir`) after saving a backup next to it, and
  for Flathub's Vesktop copies the Vencord build into that app's own folder. No sandbox permissions are added.
- Native addon and Electron privilege boundaries require additional audit. Current global WebRTC interception is fragile and must be replaced or approved before official distribution.
- Do not claim compliance with Discord ToS merely because captions run locally or Vencord accepts a plugin.
