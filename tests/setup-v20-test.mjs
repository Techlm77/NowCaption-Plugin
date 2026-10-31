// The double-click installer's helpers: finding Vesktop (and telling the Discord app apart), turning NowCaption on in
// Vencord's settings, setting up a Vesktop that was never opened, PATH for the installer's own tools, and building
// a Vencord source folder downloaded without git.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { detectVesktop, enableNowCaption, prependPath, readVesktopState, setVencordDir, vencordBuildEnv, VENCORD_ORIGIN_FILE } from "../scripts/common.mjs";

const fresh = () => mkdtempSync(join(tmpdir(), "nowcaption-setup-"));
const touch = (path, text = "") => { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, text); };

// Linux: nothing installed → nothing found; a used data folder (an AppImage anywhere) or an app on PATH counts.
{
    const home = fresh();
    let found = detectVesktop({ platform: "linux", environment: { PATH: "" }, home, flatpak: false, running: [], systemWide: false });
    assert.deepEqual(found.installs, [], "no Vesktop: nothing to set up");
    assert.equal(found.discord, false);
    touch(join(home, ".config", "vesktop", "state.json"), "{}");
    found = detectVesktop({ platform: "linux", environment: { PATH: "" }, home, flatpak: false, running: [], systemWide: false });
    assert.deepEqual(found.installs.map(i => i.kind), ["native"], "a Vesktop data folder that has been used counts on Linux");
    const bin = join(home, "bin-on-path");
    touch(join(bin, "vesktop"));
    found = detectVesktop({ platform: "linux", environment: { PATH: bin }, home, flatpak: false, running: [], systemWide: false });
    assert.equal(found.installs[0].app, join(bin, "vesktop"));
    touch(join(home, "Applications", "Vesktop-1.6.8.AppImage"));
    found = detectVesktop({ platform: "linux", environment: { PATH: "" }, home, flatpak: false, running: [], systemWide: false });
    assert.equal(found.installs[0].app, join(home, "Applications", "Vesktop-1.6.8.AppImage"), "an AppImage in ~/Applications");
    found = detectVesktop({ platform: "linux", environment: { PATH: "" }, home: fresh(), flatpak: true, running: [], systemWide: false });
    assert.deepEqual(found.installs.map(i => i.kind), ["flatpak"], "only Flathub's Vesktop");
    const discordHome = fresh();
    touch(join(discordHome, ".config", "Vencord", "settings", "settings.json"), "{}");
    touch(join(discordHome, ".config", "discord", "settings.json"), "{}");
    found = detectVesktop({ platform: "linux", environment: { PATH: "" }, home: discordHome, flatpak: false, running: [], systemWide: false });
    assert.deepEqual([found.installs.length, found.discord, found.vencordOnDiscord], [0, true, true], "Discord with Vencord isn't Vesktop");
}

// Windows: the app has to be there (the data folder outlives an uninstall); a running portable Vesktop is found.
{
    const home = fresh();
    const environment = { LOCALAPPDATA: join(home, "AppData", "Local"), APPDATA: join(home, "AppData", "Roaming"), ProgramFiles: join(home, "PF") };
    touch(join(environment.APPDATA, "vesktop", "state.json"), "{}");
    let found = detectVesktop({ platform: "win32", environment, home, running: [], systemWide: false });
    assert.deepEqual(found.installs, [], "Windows: a leftover data folder alone isn't an installed Vesktop");
    touch(join(environment.LOCALAPPDATA, "vesktop", "vesktop.exe"));
    found = detectVesktop({ platform: "win32", environment, home, running: [], systemWide: false });
    assert.deepEqual(found.installs.map(i => [i.kind, i.app]), [["native", join(environment.LOCALAPPDATA, "vesktop", "vesktop.exe")]]);
    const portable = join(home, "Downloads", "Vesktop portable");
    found = detectVesktop({ platform: "win32", environment, home, running: [{ exe: join(portable, "Vesktop.exe"), portable: true }], systemWide: false });
    assert.deepEqual(found.installs.map(i => i.kind), ["native", "custom"], "a running portable Vesktop is set up too");
    assert.equal(found.installs[1].dataDir, join(portable, "Data"));
    assert.equal(found.installs[1].portableFolder, portable);
    const discordHome = fresh();
    touch(join(discordHome, "AppData", "Local", "Discord", "Update.exe"));
    found = detectVesktop({ platform: "win32", environment: { LOCALAPPDATA: join(discordHome, "AppData", "Local"), APPDATA: join(discordHome, "AppData", "Roaming") }, home: discordHome, running: [], systemWide: false });
    assert.deepEqual([found.installs.length, found.discord, found.vencordOnDiscord], [0, true, false]);
}

// macOS: Vesktop.app in ~/Applications (or /Applications).
{
    const home = fresh();
    mkdirSync(join(home, "Applications", "Vesktop.app"), { recursive: true });
    const found = detectVesktop({ platform: "darwin", environment: {}, home, running: [], systemWide: false });
    assert.ok(found.installs.some(i => i.kind === "native" && i.app), "Vesktop.app found");
}

// Turning NowCaption on keeps every other setting, backs the file up, and moves v18 settings like Vencord would.
{
    const data = fresh();
    assert.equal(await enableNowCaption(data), "enabled", "no settings yet: created");
    assert.deepEqual(JSON.parse(readFileSync(join(data, "settings", "settings.json"), "utf8")), { plugins: { NowCaption: { enabled: true } } });
    assert.equal(await enableNowCaption(data), "already");

    const used = fresh();
    const original = { autoUpdate: false, plugins: { NoTrack: { enabled: true }, NowCaption: { enabled: false, textSize: 22 } } };
    touch(join(used, "settings", "settings.json"), JSON.stringify(original));
    assert.equal(await enableNowCaption(used), "enabled");
    const after = JSON.parse(readFileSync(join(used, "settings", "settings.json"), "utf8"));
    assert.deepEqual(after, { autoUpdate: false, plugins: { NoTrack: { enabled: true }, NowCaption: { enabled: true, textSize: 22 } } });

    const v18 = fresh();
    touch(join(v18, "settings", "settings.json"), JSON.stringify({ plugins: { NowCaptionDiscord: { enabled: true, font: "lexend" } } }));
    await enableNowCaption(v18);
    assert.deepEqual(JSON.parse(readFileSync(join(v18, "settings", "settings.json"), "utf8")).plugins, { NowCaption: { enabled: true, font: "lexend" } });

    const bom = fresh();
    touch(join(bom, "settings", "settings.json"), "\uFEFF" + JSON.stringify({ plugins: { NoTrack: { enabled: true } } }));
    assert.equal(await enableNowCaption(bom), "enabled", "a byte-order mark (PowerShell, some editors) is fine");
    assert.ok(!readFileSync(join(bom, "settings", "settings.json"), "utf8").startsWith("\uFEFF"), "written back without one");

    const broken = fresh();
    touch(join(broken, "settings", "settings.json"), "{ not json");
    assert.match(await enableNowCaption(broken), /couldn't be read/);
    assert.equal(readFileSync(join(broken, "settings", "settings.json"), "utf8"), "{ not json", "an unreadable file is left alone");
}

// A Vesktop that was installed but never opened: state.json is created with only the Vencord location, so
// Vesktop's first-launch window still runs (it checks for "firstLaunch").
{
    const data = join(fresh(), "vesktop");
    assert.equal(await setVencordDir(data, "/somewhere/dist", { create: true }), "created");
    assert.deepEqual(await readVesktopState(data), { vencordDir: "/somewhere/dist" });
    await assert.rejects(setVencordDir(join(fresh(), "other"), "/x"), /start Vesktop once/, "without create it still asks");
}

// PATH: the installer's tools go first once, whatever the variable's case is (Windows calls it "Path").
{
    const tools = join(tmpdir(), "NowCaption", "node");
    const env = { Path: [join(tmpdir(), "Windows"), join(tmpdir(), "Tools")].join(delimiter) };
    prependPath(tools, env);
    prependPath(tools, env);
    assert.deepEqual(Object.keys(env), ["Path"]);
    assert.equal(env.Path.split(delimiter)[0], tools);
    assert.equal(env.Path.split(delimiter).length, 3);
    const empty = {};
    prependPath(tools, empty);
    assert.equal(empty.PATH, tools);
}

// Building a Vencord folder without git history: its version comes from the download record.
{
    const git = fresh();
    mkdirSync(join(git, ".git"));
    assert.deepEqual(vencordBuildEnv(git), {}, "a git checkout builds as before");
    const archive = fresh();
    writeFileSync(join(archive, VENCORD_ORIGIN_FILE), JSON.stringify({ repo: "Vendicated/Vencord", commit: "8d64c8be7e68616f8f116a6fff9480051aa2a0c5" }));
    assert.deepEqual(vencordBuildEnv(archive), { VENCORD_HASH: "8d64c8b", VENCORD_REMOTE: "Vendicated/Vencord" });
    assert.deepEqual(vencordBuildEnv(fresh()), { VENCORD_HASH: "unknown", VENCORD_REMOTE: "Vendicated/Vencord" });
}

// The double-click files are where the README says, and the Mac/Linux ones are executable.
{
    const root = join(import.meta.dirname, "..");
    for (const name of ["Install on Windows.cmd", "Install on Mac.command", "Install on Linux.sh", "scripts/bootstrap/install-windows.ps1", "scripts/bootstrap/install-unix.sh", "scripts/setup.mjs"]) {
        assert.ok(existsSync(join(root, name)), name);
    }
    if (process.platform !== "win32") {
        for (const name of ["Install on Mac.command", "Install on Linux.sh", "scripts/bootstrap/install-unix.sh"]) {
            assert.ok(statSync(join(root, name)).mode & 0o111, `${name} is executable`);
        }
    }
    const ps1 = readFileSync(join(root, "scripts/bootstrap/install-windows.ps1"));
    assert.ok(ps1.every(byte => byte < 0x80), "install-windows.ps1 is ASCII (Windows PowerShell 5.1 reads it in the local code page)");
}

console.log("PASS v20 installer: Vesktop/Discord detection, NowCaption turned on (v18 settings kept), first-start setup, tools on PATH, Vencord without git, launch files");
