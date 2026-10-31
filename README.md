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
(up to v18 it was called NowCaptionDiscord; updating keeps whether it's turned on and your appearance settings).
Status: tested in real calls on Linux (normal and Flathub Vesktop) and Windows 11; see `docs/PLATFORM_SUPPORT.md`.

## Install

You need **Vesktop** (from [vesktop.dev](https://vesktop.dev/install), Flathub or your package manager) and an
internet connection. Nothing else has to be installed first.

1. **Download** this project: **Code → Download ZIP**, and unpack it (Windows: right-click the ZIP →
   **Extract All…**; macOS: double-click the ZIP).
2. **Double-click the installer** for your computer in the unpacked folder:

   | Windows | macOS | Linux |
   |---|---|---|
   | **Install on Windows** (`Install on Windows.cmd`) | **Install on Mac** (`Install on Mac.command`) | **Install on Linux** (`Install on Linux.sh`) |

3. Wait for **"NowCaption is installed"**. Vesktop opens with NowCaption turned on: join a voice call and click
   **CC · Captions** at the top right.

The first installation downloads about 300 MB and takes a few minutes. To **update**, run the installer again.

**The first time you open the installer**, your computer may ask whether to trust it:

- **Windows**: "The publisher could not be verified": click **Run**. (If you see "Windows protected your PC",
  click **More info → Run anyway**.)
- **macOS**: "“Install on Mac.command” Not Opened": click **Done**, open **System Settings → Privacy & Security**,
  scroll down and click **Open Anyway** next to the installer's name, then **Open**.
- **Linux**: if double-clicking opens the file in an editor, right-click it and choose **Run as a Program** (or run
  `./"Install on Linux.sh"` in a terminal).

### What the installer does

1. Looks for Vesktop: the normal one, Flathub's (`dev.vencord.Vesktop`), or both, and on Windows also Scoop's and
   a portable Vesktop that is open. If there's none, it says so and offers to open Vesktop's download page. (Vencord
   in the Discord app isn't enough: NowCaption needs Vesktop, which can import your Vencord settings on its first start.)
2. Asks to close Vesktop if it's open.
3. Gets its own copy of Node.js (checked against a fixed SHA-256) and the speech model v4 and engine (also checked).
   These stay in NowCaption's folder: no admin rights are needed and nothing is installed system-wide.
4. Downloads Vencord's source code (git isn't needed), adds NowCaption to it and builds it, then sets Vesktop to load
   that build. Vesktop's previous setting is saved next to it (`state.json.nowcaption-backup-…`).
5. Turns NowCaption on in Vencord's settings, shows "NowCaption is installed" and starts Vesktop again.

Everything it prints is also saved to a log file (your home folder is shown as `~`, so it can be shared when asking
for help). Where things go:

| | Windows | macOS | Linux |
|---|---|---|---|
| Speech model, engine, tools, logs | `%LOCALAPPDATA%\NowCaption-Vesktop` | `~/Library/Application Support/NowCaption-Vesktop` | `~/.local/share/nowcaption-vesktop` |
| Vencord's source and build | `Documents\Vencord-source` | `~/Documents/Vencord-source` | `~/Documents/Vencord-source` |
| Backups of earlier versions | `Documents\NowCaption-Vesktop-Backups` | same | same |

Flathub's Vesktop can only read its own folder, so it gets its own copy of the model, engine and build in
`~/.var/app/dev.vencord.Vesktop/data/nowcaption-vesktop`. It needs no extra permissions.

Windows on Arm isn't supported (the speech engine has no build for it). macOS needs 13.5 (Ventura) or newer.

### From the command line

The same steps without the installer, for people who prefer them (needs Node.js 22 or newer; pnpm and git are used
when installed and fetched or skipped when not):

| | Windows | macOS and Linux |
|---|---|---|
| The whole installer | `node scripts\setup.mjs` | `node scripts/setup.mjs` |
| Only the speech model and engine | `command-line\install-engine.cmd` | `command-line/install-engine.sh` |
| Only build and set up the plugin | `command-line\update-plugin.cmd --setup-vencord` | `command-line/update-plugin.sh --setup-vencord` |
| Check the installation (changes nothing) | `node scripts\doctor.mjs` | `node scripts/doctor.mjs` |

`update-plugin` options: `--vencord <folder>` for another Vencord source folder, `--vesktop-data <folder>` for a
portable Vesktop (the folder that has `Vesktop.exe`), `--keep-old-models`, `--preflight` (changes nothing). It backs
up the previous plugin and build to `Documents/NowCaption-Vesktop-Backups` and restores them if the build fails. If no
Vesktop could be set up, it ends with **NOT FINISHED** and says what to do. `install-engine --target native|flatpak`
installs for one kind of Vesktop only.

## Using captions

1. Join a voice channel and click **CC · Captions** (top right).
2. In **Speakers**, pick someone from the list and click **Show captions**. The heading shows how many of the four
   caption slots are in use; hide someone's captions to free one.
3. **Identify speakers** lights up whoever is talking, which helps when Discord hasn't confirmed a name yet.
4. **Appearance** sets the font, text size, colours, and whether captions sit on participant tiles or float.

If Discord hasn't confirmed who a track belongs to, you can click **Place on participant tile** and then click that
person's tile. Placement you set by hand is dropped again if the tile starts showing someone else or people join
or leave. That way captions never stay on the wrong person.

## Troubleshooting

The installer's last lines say what went wrong and where its log is. `node scripts/doctor.mjs` changes nothing and
reports each Vesktop it finds, where that Vesktop loads Vencord from, and whether the model and engine load.

- **"Vesktop isn't installed"**: install it from [vesktop.dev](https://vesktop.dev/install) and run the installer
  again. For a portable Vesktop (the Windows .zip), start it first: the installer finds it while it's open.
- **NowCaption isn't in Vencord's plugin list**: that Vesktop loads its own Vencord, not the one built with
  NowCaption. Run the installer again (with a portable Vesktop open, so it's found).
- **NowCaption is listed but off**: turn it on in **Settings → Vencord → Plugins** (with Vencord's cloud settings
  sync, the cloud copy can replace the installer's setting).
- **"Vesktop didn't close"**: quit it from its tray icon and run the installer again.
- **Captions never start in a call**: a Discord update may have moved its voice code. In Vesktop's developer tools
  (Ctrl+Shift+I, or Cmd+Option+I on a Mac), run `window.__nowCaption.enableLegacyCapture()` and rejoin the call.
- **On Linux, "bzip2: Cannot exec"**: install your distribution's `bzip2` package and run the installer again.
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
2. Delete NowCaption's folder (speech model, engine, the installer's tools and logs):

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
