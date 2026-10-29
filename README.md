# NowCaption for Vesktop (v19)

Live captions for Discord voice calls in [Vesktop](https://vesktop.dev), made on your own computer with the speech
model v4 of [NowCaption](https://github.com/Techlm77/NowCaption), the live-caption app for Linux. Nothing you or anyone
else says is sent anywhere to be transcribed. You don't need the NowCaption app itself: the installer downloads the
same model and a speech engine for Vesktop.

- Captions for **up to four speakers at once**, each in its own box, on the person's participant tile or floating
  wherever you put it. Calls can have more people: everyone is listed, and you choose whose captions to show.
- Names come from Discord itself: a speaker is named only once Discord's own audio mapping confirms who they are.
  A guess from who's talking is shown as "User 2 (likely Alex)", never as a name.
- Long calls stay light: each card keeps the latest few thousand characters to scroll back through.
- Readable fonts (Atkinson Hyperlegible Next, Lexend, OpenDyslexic), text size and a colour per speaker.
- Works with Vesktop on **Windows, macOS and Linux**, including **Flathub's Vesktop** (Flatpak).

This is a Vencord userplugin, not an official Vencord plugin. It's called **NowCaption** in Vesktop's plugin list
(up to v18 it was called NowCaptionDiscord; updating keeps whether it's turned on and your appearance settings). Status: tested on Linux, with the normal
and the Flathub Vesktop. On Windows and macOS the installers and engine are covered by the CI workflow but haven't
been tried in a real call yet; see `docs/PLATFORM_SUPPORT.md`.

## What you need

- **Vesktop**, installed any way: from vesktop.dev or GitHub, Flathub (`dev.vencord.Vesktop`) or your package manager.
- **Node.js 20 or newer** from [nodejs.org](https://nodejs.org) (it includes npm and corepack).
- **pnpm**: run `corepack enable` once (or `npm install -g pnpm`).
- **git**, the first time only, to download Vencord's source code.
- On Linux, `tar` and `bzip2` (almost every distribution has them).
- About 150 MB for the speech model and engine (per Vesktop install) and 300 MB for Vencord's source code.

Windows on Arm isn't supported: the speech engine has no build for it.

## Install

1. **Quit Vesktop completely**, including its tray icon. If you use Flathub's Vesktop and have never started it,
   start it once and quit it first.
2. Download this repository and open a terminal in its folder:

   ```sh
   git clone https://github.com/Techlm77/NowCaption-Plugin.git
   cd NowCaption-Plugin
   ```

   (Or use **Code → Download ZIP** on GitHub and unpack it.)
3. Install the speech model and engine (downloads about 106 MiB, checked against a fixed SHA-256):

   | Windows | macOS and Linux |
   |---|---|
   | `install-engine.cmd` | `./install-engine.sh` |

4. Download Vencord's source code, add NowCaption to it, build it and point Vesktop at the build:

   | Windows | macOS and Linux |
   |---|---|
   | `update-plugin.cmd --setup-vencord` | `./update-plugin.sh --setup-vencord` |

   Vencord's source goes to `Documents/Vencord-source` in your home folder. Use `--vencord <folder>` to choose
   another folder, or to use a Vencord source folder you already have.
5. Start Vesktop. In **Settings → Vencord → Plugins**, turn on **NowCaption** (restart Vesktop if it asks).

Both scripts find every Vesktop on your computer: the normal one, Flathub's, or both. For a portable Vesktop, add
`--vesktop-data <its Data folder>` to `update-plugin`.

### Flathub's Vesktop

Nothing extra is needed, and Vesktop needs no added permissions. Flathub's Vesktop can only read its own folder,
so the scripts put everything there:

- the speech model and engine go in `~/.var/app/dev.vencord.Vesktop/data/nowcaption-vesktop`;
- a copy of the Vencord build goes in `…/nowcaption-vesktop/vencord-dist`, and Vesktop's Vencord location is set to it.

Run `update-plugin` again after any change, so the copy stays current. To set up only one of the two, use
`install-engine --target native` or `--target flatpak`.

## Using captions

1. Join a voice channel and click **CC · Captions** (top right).
2. In **Speakers**, pick someone from the list and click **Show captions**. The heading shows how many of the four
   caption slots are in use; hide someone's captions to free one.
3. **Identify speakers** lights up whoever is talking, which helps when Discord hasn't confirmed a name yet.
4. **Appearance** sets the font, text size, colours, and whether captions sit on participant tiles or float.

If Discord hasn't confirmed who a track belongs to, you can click **Place on participant tile** and then click that
person's tile. Placement you set by hand is dropped again if the tile starts showing someone else or people join
or leave. That way captions never stay on the wrong person.

## Updating

Quit Vesktop and run `update-plugin` again (without `--setup-vencord`). It backs up the previous plugin and build
to `Documents/NowCaption-Vesktop-Backups` and restores them if the build fails. Run `install-engine` again only
when a new speech model is announced. Once an update has succeeded, `update-plugin` removes older speech models
(`--keep-old-models` keeps them).

## Troubleshooting

Run `node scripts/doctor.mjs`. It changes nothing and reports each Vesktop it finds, where that Vesktop loads
Vencord from, and whether the model and engine are installed for it and load.

- **"Speech model v4 isn't installed"**: run `install-engine` (for Flathub's Vesktop: `install-engine --target flatpak`).
- **"Vesktop is running"**: quit it from the tray icon too, or wait a few seconds after closing it.
- **Captions never start in a call**: a Discord update may have moved its voice code. In Vesktop's developer tools
  (Ctrl+Shift+I, or Cmd+Option+I on a Mac), run `window.__nowCaption.enableLegacyCapture()` and rejoin the call.
- **On Linux, "bzip2: Cannot exec"**: install your distribution's `bzip2` package and run `install-engine` again.
- **A folder name containing `%` or `"` on Windows**: the scripts refuse these, because the Windows command prompt
  changes them. Use `--vencord` with another folder, or set `NOWCAPTION_VESKTOP_HOME` for the engine.

The **Diagnostics** tab in Vesktop shows the engine's speed and each track's identification status. It can export
a report that contains timings and counts only: no audio, captions, names or Discord IDs.

## Known limitations

- Caption cards stay above Discord's own menus and its Settings screen while you're on the voice channel page.
  Hide the cards with the **CC · Captions** controls, or move them, if they cover something.
- Telling a Go Live preview apart from a person's own tile partly uses Discord's English "Watch Stream" label.
  With Discord in another language, a streaming person's captions may float instead of sitting on their tile.
- Discord updates can change the voice code the plugin watches; see Troubleshooting.

## Uninstalling

1. In Vesktop, **Settings → Vesktop Settings → Vencord Location**: switch back to Vesktop's own Vencord. Or
   restore the `state.json.nowcaption-backup-…` file that `update-plugin` saved next to Vesktop's `state.json`.
2. Delete the speech runtime folder:

   | | Folder |
   |---|---|
   | Windows | `%LOCALAPPDATA%\NowCaption-Vesktop` |
   | macOS | `~/Library/Application Support/NowCaption-Vesktop` |
   | Linux | `~/.local/share/nowcaption-vesktop` (or under `$XDG_DATA_HOME`) |
   | Flathub's Vesktop | `~/.var/app/dev.vencord.Vesktop/data/nowcaption-vesktop` |

3. Delete `src/userplugins/nowCaption` from your Vencord source folder (or the whole folder if you only
   made it for NowCaption).

## Privacy

Audio from the people you choose is processed in memory on your computer and isn't saved or uploaded. Captions
aren't saved either. Colours and layout you set for a verified speaker are kept in Vesktop's local storage under
their Discord ID. Let the people in your calls know you use live captions. See `docs/PRIVACY_SECURITY.md`.

## For developers

```sh
npm install
npm test                                  # mocked worker, UI, identity, installer and path tests
npx tsc -p tests/tsconfig.json --noEmit   # strict type check
npm run test:engine                       # real speech through the installed engine and model v4
```

`npm run doctor`, `npm run preflight` (`update-plugin --preflight`) and `install-engine --dry-run` change nothing.
The CI workflow (`.github/workflows/tests.yml`) runs the tests, then installs the real engine and transcribes
a clip on Windows, macOS and Linux.

## Credits and licences

- This plugin and its scripts: MIT licence, see `LICENSE`.
- Speech model v4: NowCaption's fine-tune of NVIDIA's `stt_en_fastconformer_hybrid_large_streaming_multi`,
  CC BY 4.0. Details and training data licences: `docs/MODEL_ATTRIBUTION.md`.
- Speech engine: [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (Apache 2.0).
- Fonts: Atkinson Hyperlegible Next, Lexend and OpenDyslexic, SIL Open Font License, with their licence files
  copied into the build.
- Test clip: LibriSpeech (CC BY 4.0), see `tests/fixtures/README.md`.
