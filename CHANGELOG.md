## Unreleased — Windows and macOS checked on real systems

**Windows** (Windows 11 26H2, fresh install, normal user without admin rights, Vesktop 1.6.8 from its installer)
- The README steps work as written: `install-engine.cmd`, `update-plugin.cmd --setup-vencord`, NowCaption in the
  plugin list, and live captions in a real Discord call with the speaker verified by Discord.
- pnpm: the README now says `npm install -g pnpm`. Node.js 25 and newer (26 is the current LTS) no longer include
  `corepack`, so `corepack enable` failed with "not recognized".

## v19 — Speech model v4, four speakers, long calls, Windows/macOS/Flatpak installers

**Name**
- The plugin is now called **NowCaption** (folder `src/userplugins/nowCaption`) instead of NowCaptionDiscord.
  Vencord's settings migration keeps whether it's turned on; captions' appearance and speaker colours are kept too.
  `update-plugin` moves the old `nowCaptionDiscord` folder to the backups (and back if the build fails), so the
  plugin isn't built twice. The developer API is now `window.__nowCaption`.

**Privacy**
- Engine error messages show your home folder as `~`, so screenshots of them don't show your user name.
- Test data uses made-up names and IDs only.

**Windows**
- The portable Vesktop (.zip) and Scoop's Vesktop are supported: Scoop's is found automatically, and
  `--vesktop-data` takes the folder that has `Vesktop.exe`. When no Vesktop could be set up, `update-plugin` says
  NOT FINISHED instead of SUCCESS, and `doctor` shows which `Vesktop.exe` is running.
- npm and pnpm are started correctly through cmd.exe (the engine install failed on Windows before).
- A Windows end-to-end workflow installs Vesktop (installer and portable), follows the README and checks the plugin
  list and real speech over DevTools.

**Recognition**
- Speech model v4 (models-v4 release, SHA-256 pinned): fewer word errors than v3 and less than half its CPU time.
- Up to four speakers are captioned at once, enforced in the Speakers panel (with a message and an "x of 4"
  count), the developer API, the main-process bridge and the worker. Up to 25 incoming tracks are listed, and new
  floating cards take a free spot instead of opening on top of each other.
- Long calls stay bounded: in a real pause (silent audio and no new words for 1.2 s) after about 600 characters,
  the worker starts a fresh recognizer segment; the card keeps the earlier text (last 3,000 characters). Talk
  that never pauses is split at 4,000 characters on a 0.4 s pause, and at 8,000 characters regardless. Memory
  stays flat (measured over 40 minutes of speech), and caption updates are combined per segment so a slow render
  doesn't lose a segment's last words.
- Stereo audio (such as Go Live) is downmixed instead of using only the left channel.

**Speaker identification**
- A voice-activity guess is no longer shown as the speaker's name; it appears as "User 2 (likely Alex)".
- SSRC lookups use the track's own Discord connection when it can be found, and an SSRC number that a Go Live
  connection gives to someone else is treated as ambiguous. Audio that only a Go Live connection knows is marked as
  that person's stream (Chromium gives it no label), so their microphone can still be verified as their voice.
- When the person behind a track changes, its captions and any manual tile placement start again, so earlier words
  never appear under the new name. A verified name stays through pauses even when Discord's stats still list an
  old SSRC.
- Re-checks fail closed when a verified receiver shows more than one audio SSRC, and a per-tick check catches
  Discord reusing a receiver for someone else without waiting for the next probe.
- The previous person's colour no longer carries over to a new speaker on the same track.
- Manual tile placement is checked against what the tile shows (Discord's focus view can swap people), a verified
  identity replaces a manual pick, and the picker no longer lets its click through to Discord.
- When someone's voice and Go Live audio are both captioned, the stream captions use the stream preview (or float)
  instead of covering the voice captions.

**Reliability and performance**
- AudioWorklet processors end when captions are hidden (they used to keep running), and a second start no longer
  falls back to the older capture path.
- Discord modules that aren't present are looked up once, not several times a second (each miss scanned every
  module and logged an error).
- Stats for a released track are no longer recreated by late callbacks; font families install all-or-nothing.

**Installers**
- `install-engine`: model v4, installs for the normal Vesktop, Flathub's Vesktop or both (`--target`), checks the
  engine loads, installs both macOS builds of the engine, uses Windows' own tar, and only gives up on a download
  after a minute without data.
- `update-plugin`: works for a first install (`--setup-vencord` downloads Vencord, dependencies are installed),
  refuses to run while Vesktop is open, sets Vesktop's Vencord location (backing up `state.json`), and copies the
  build into Flathub's Vesktop's folder. It removes older speech models only after the update has succeeded, so a
  rolled-back update still has the model it needs. npm and pnpm are started safely on Windows, including folders
  with spaces.
- `doctor` reports every Vesktop found, where it loads Vencord from, and whether the engine loads for it.
- Font downloads are pinned to upstream commits; download errors give the real cause.

**Tests**
- New tests for the four-speaker limit, segments, identity re-checks, tile placement, the worklet and the
  installer helpers; `tsc` passes again. `npm run test:engine` and CI transcribe real speech with the installed
  engine on Windows, macOS and Linux.

## v18 — Stream-aware participant captions and compact controls

- Fix verified Go Live/stream tracks falling back to floating captions because of an unconditional stream exclusion in `tileOwner`.
- Prefer a person's normal voice tile over an explicitly recognized stream-preview tile when both tiles advertise the same verified Discord ID. Don't guess on ambiguous tiles.
- Place captions along the *top* of the voice tile with geometry and CSS sharing three full text rows; keep the bottom native name unobstructed.
- Remove the optional speaker-name field and floating edit icon. Prefer live Discord usernames over stale manually entered aliases.
- Replace the ambiguous Save / Show speaker action with functional Show captions / Hide captions toggle.
- Show the manual tile-placement fallback only when a source remains unverified.
- Update diagnostic version marker and required caption geometry. Add stream-specific regressions for attachment, join/leave reflow, duplicate tile selection, font sizes and cleaned-up controls.
- Existing audio capture, recognition model, performance diagnostics, bundled font preparation and private test tools remain intact.

> Source-level tests do not prove compatibility with a live Discord update. Test in Vesktop with a voice participant who starts and stops screen sharing.
