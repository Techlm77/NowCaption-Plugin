# Draft discussion outline — human review required before posting

Accessibility feature: local live captions for Discord voice channels in Vesktop/Vencord. English-only NowCaption model; no cloud transcription; optional speaker-specific floating captions and accessible fonts. Audio remains in memory, is not uploaded, and captions are not automatically saved.

**Architectural questions:**

1. Would Vencord accept a plugin with a native ONNX model dependency, installed separately with pinned checksums? If not, is an opt-in standalone companion plus lightweight integration acceptable?
2. Which stable, officially preferred hook provides incoming audio tracks and mapping to Discord member IDs, without changing global browser WebRTC constructors?
3. What render patch/API should host React-based overlay captions without a manual DOM container?
4. What privacy/consent guidance would you require for participant speech recognition?

Development status: v19; installers and the engine tested on Linux (native and Flatpak), Windows and macOS only through CI; the scoped WebRTC hook still needs live testing on current Discord. Code and documentation have had AI assistance; human review and cleanup are required under Vencord's CONTRIBUTING.md rules. This is a **draft for personal review**, not text to paste into an upstream issue verbatim.
