# Platform support

The double-click installers need only Vesktop and an internet connection: they bring their own Node.js 26.13.0
(SHA-256 pinned per system), download Vencord's source as a GitHub archive and install the pnpm version Vencord asks
for, all into NowCaption's folder. Linux also needs `tar` with `bzip2` and the `libatomic` library (desktop systems
have both; the installer says how to add them). The command-line scripts need Node.js 22+ (Vencord's minimum); git
and pnpm are used when installed. The engine is `sherpa-onnx-node@1.13.8`; the model is checked against its SHA-256.

| System | Speech runtime folder | Vesktop's settings (`state.json`) | Status |
|---|---|---|---|
| Linux x64 / arm64 | `$XDG_DATA_HOME/nowcaption-vesktop` or `~/.local/share/nowcaption-vesktop` | `~/.config/vesktop` | Tested: live calls; double-click installer in Ubuntu 24.04 with a never-opened Vesktop 1.6.5 (headless), real engine |
| Flathub's Vesktop (`dev.vencord.Vesktop`) | `~/.var/app/dev.vencord.Vesktop/data/nowcaption-vesktop` | `~/.var/app/dev.vencord.Vesktop/config/vesktop` | Tested: engine inside the Freedesktop 25.08 and 26.08 runtimes; Vesktop 1.6.5 in the same environment (headless) |
| macOS 13.5+ (Apple Silicon and Intel) | `~/Library/Application Support/NowCaption-Vesktop` (also Vencord's source and the backups) | `~/Library/Application Support/vesktop` | Tested on Intel macOS 15.8 (VM): double-click installer, live call with two speakers. Apple Silicon not run (same universal Vesktop, arm64 engine build installed too) |
| Windows 10/11 x64 | `%LOCALAPPDATA%\NowCaption-Vesktop` | `%APPDATA%\vesktop` | Tested on Windows 11 26H2: double-click installer (first install and update, no admin rights), live call |
| Windows on Arm | — | — | Not supported (no engine build) |

`NOWCAPTION_VESKTOP_HOME` overrides the runtime folder for a normal (non-Flatpak) Vesktop; `VENCORD_USER_DATA_DIR`
or `--vesktop-data` point the scripts at a portable Vesktop's data folder. Inside Flatpak the plugin always uses the
app's own data folder (it can't read others).

## Flathub's Vesktop

The sandbox can read only `~/.var/app/dev.vencord.Vesktop` (plus a few media folders), so:

- `install-engine` installs the model and engine into the app's data folder (`--target flatpak`, or automatically);
- `update-plugin` copies the Vencord build (the `vencordDesktop*` files, `package.json` and font licences) into
  `…/nowcaption-vesktop/vencord-dist` and sets Vesktop's Vencord location there.

No `flatpak override` is needed. The engine's libraries need glibc 2.32 and GLIBCXX 3.4.29, which Freedesktop
runtimes 22.08 and later provide (Flathub's Vesktop 1.6.8 uses 26.08).

## macOS

The engine loads the build matching the process that runs it, so `install-engine` installs both the Apple Silicon
and the Intel build: Node and Vesktop can run as different architectures (Rosetta).

## Windows

npm and pnpm are `.cmd` scripts, so the scripts start them through `cmd.exe` with every argument quoted; folder
names with spaces work, but names containing `%` or `"` are refused. Windows' own `tar.exe` unpacks the model (a Git
for Windows `tar` on the PATH would misread `C:\` paths).

## Commands

| | Windows | macOS and Linux |
|---|---|---|
| Install everything (double-click) | `Install on Windows.cmd` | `Install on Mac.command`, `Install on Linux.sh` |
| Install the model and engine | `command-line\install-engine.cmd` | `command-line/install-engine.sh` |
| Install or update the plugin | `command-line\update-plugin.cmd` | `command-line/update-plugin.sh` |
| Check the installation (read-only) | `node scripts\doctor.mjs` | `node scripts/doctor.mjs` |
| Show what would happen | `command-line\install-engine.cmd --dry-run`, `command-line\update-plugin.cmd --preflight` | same with `command-line/…sh` |
