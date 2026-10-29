// v19 installer helpers: Windows-safe command lines, Vesktop detection (native, Flatpak, custom),
// the Vencord-location update in state.json, stale locks, and the scripts' argument handling.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cmdCommandLine, customVesktopDataDir, findVesktopInstalls, hasCompiledPlugin, installLabel, nativeVesktopDataDir, removeOldModels, setVencordDir, vesktopRunning } from "../scripts/common.mjs";

// npm and pnpm are .cmd scripts on Windows: every argument quoted, nothing cmd.exe would expand. The program name
// stays unquoted, or npm.cmd looks for its own files in the current folder (it failed this way on Windows CI).
assert.equal(cmdCommandLine("npm", ["install", "--prefix", "C:\\Users\\Jo Smith\\AppData\\Local\\NowCaption-Vesktop", "x@1"]),
    '"npm "install" "--prefix" "C:\\Users\\Jo Smith\\AppData\\Local\\NowCaption-Vesktop" "x@1""');
assert.equal(cmdCommandLine("pnpm", ["build", "--dev"]), '"pnpm "build" "--dev""');
assert.throws(() => cmdCommandLine("C:\\Program Files\\nodejs\\npm.cmd", []), /start this/);
assert.throws(() => cmdCommandLine("npm", ["C:\\100%\\x"]), /safely/);
assert.throws(() => cmdCommandLine("npm", ['a"b']), /safely/);

// A build counts only if it has the plugin under its current name (minified or not); font names don't count.
assert.ok(hasCompiledPlugin("vencordDesktopRenderer.js", 'pC=h({name:"NowCaption",description:'));
assert.ok(hasCompiledPlugin("vencordDesktopRenderer.js", 'definePlugin({\n  name: "NowCaption",'));
assert.ok(!hasCompiledPlugin("vencordDesktopRenderer.js", 'h({name:"NowCaptionDiscord",d'), "the v18 name");
assert.ok(!hasCompiledPlugin("vencordDesktopRenderer.js", "font-family:'NowCaption Atkinson'"));
assert.ok(hasCompiledPlugin("vencordDesktopMain.js", "XSOverlay:ct,NowCaption:mt};"));
assert.ok(!hasCompiledPlugin("vencordDesktopMain.js", "XSOverlay:ct,NowCaptionDiscord:mt};"));

// Vesktop's data folder (where state.json lives), as Vesktop itself computes it.
const home = "/home/tester";
assert.equal(nativeVesktopDataDir({ platform: "linux", environment: {}, home }), join(home, ".config", "vesktop"));
assert.equal(nativeVesktopDataDir({ platform: "linux", environment: { XDG_CONFIG_HOME: "/cfg" }, home }), join("/cfg", "vesktop"));
assert.equal(nativeVesktopDataDir({ platform: "darwin", environment: {}, home }), join(home, "Library", "Application Support", "vesktop"));
assert.equal(nativeVesktopDataDir({ platform: "win32", environment: { APPDATA: "C:\\Roaming" }, home }), join("C:\\Roaming", "vesktop"));
// A folder given in the environment is made absolute for this computer (on Windows /portable/data is on the current drive).
assert.equal(nativeVesktopDataDir({ platform: "linux", environment: { VENCORD_USER_DATA_DIR: "/portable/data" }, home }), resolve("/portable/data"));

// Detection: native by default, Flatpak when installed, both when both exist, a custom folder on request.
let found = findVesktopInstalls({ platform: "darwin", environment: {}, home, flatpak: false });
assert.deepEqual(found.map(i => i.kind), ["native"]);
found = findVesktopInstalls({ platform: "linux", environment: {}, home, flatpak: true });
assert.deepEqual(found.map(i => i.kind), ["flatpak"], "only Flatpak Vesktop: no native target is invented");
assert.equal(found[0].dataDir, join(home, ".var", "app", "dev.vencord.Vesktop", "config", "vesktop"));
assert.equal(found[0].runtimeRoot, join(home, ".var", "app", "dev.vencord.Vesktop", "data", "nowcaption-vesktop"));
assert.equal(found[0].vencordCopy, join(home, ".var", "app", "dev.vencord.Vesktop", "data", "nowcaption-vesktop", "vencord-dist"));
const temp = await mkdtemp(join(tmpdir(), "nowcaption-scripts-"));
try {
    const linuxHome = join(temp, "home");
    await mkdir(join(linuxHome, ".config", "vesktop"), { recursive: true });
    found = findVesktopInstalls({ platform: "linux", environment: {}, home: linuxHome, flatpak: true });
    assert.deepEqual(found.map(i => i.kind), ["native", "flatpak"], "both installed: set up both");
    found = findVesktopInstalls({ platform: "linux", environment: {}, home: linuxHome, customDataDir: join(temp, "portable") });
    assert.deepEqual(found.map(i => i.kind), ["custom"]);

    // Windows: Scoop's Vesktop (the portable .zip) is found by itself; the native one only when it has been used.
    const scoopRoot = join(temp, "scoop");
    await mkdir(join(scoopRoot, "apps", "vesktop", "current"), { recursive: true });
    found = findVesktopInstalls({ platform: "win32", environment: { SCOOP: scoopRoot, APPDATA: join(temp, "Roaming") }, home: linuxHome, flatpak: false });
    assert.deepEqual(found.map(i => i.kind), ["scoop"], "only Scoop's Vesktop: no unused native target");
    assert.equal(found[0].dataDir, join(scoopRoot, "apps", "vesktop", "current", "Data"));
    assert.equal(installLabel(found[0]), "Scoop's Vesktop");
    await mkdir(join(temp, "Roaming", "vesktop"), { recursive: true });
    found = findVesktopInstalls({ platform: "win32", environment: { SCOOP: scoopRoot, APPDATA: join(temp, "Roaming") }, home: linuxHome, flatpak: false });
    assert.deepEqual(found.map(i => i.kind), ["native", "scoop"]);
    // --vesktop-data takes the portable Vesktop's folder, its Vesktop.exe, or the Data folder itself.
    const portable = join(temp, "Vesktop-1.6.8-win");
    await mkdir(portable);
    await writeFile(join(portable, "Vesktop.exe"), "");
    assert.equal(customVesktopDataDir(portable), join(portable, "Data"));
    assert.equal(customVesktopDataDir(join(portable, "Vesktop.exe")), join(portable, "Data"));
    assert.equal(customVesktopDataDir(join(portable, "Data")), join(portable, "Data"));
    assert.deepEqual(findVesktopInstalls({ customDataDir: portable }).map(i => [i.kind, i.dataDir]), [["custom", join(portable, "Data")]]);

    // state.json: only vencordDir changes, a backup is kept, and a second run changes nothing.
    const data = join(temp, "vesktop");
    await mkdir(data);
    const original = { firstLaunch: false, windowBounds: { x: 1, y: 2, width: 3, height: 4 }, maximized: true, vencordDir: "/old/dist/" };
    await writeFile(join(data, "state.json"), JSON.stringify(original));
    const backup = await setVencordDir(data, "/new/dist");
    assert.ok(backup, "a backup is made");
    assert.deepEqual(JSON.parse(await readFile(backup, "utf8")), original);
    assert.deepEqual(JSON.parse(await readFile(join(data, "state.json"), "utf8")), { ...original, vencordDir: "/new/dist" });
    assert.equal(await setVencordDir(data, "/new/dist/"), undefined, "same folder: nothing to do");
    assert.equal((await readdir(data)).filter(n => n.includes(".nowcaption-")).length, 1, "no temporary files left");
    await assert.rejects(setVencordDir(join(temp, "never-started"), "/x"), /start Vesktop once/);

    // A stale Chromium lock from another machine or container is not a running Vesktop.
    if (process.platform !== "win32") {
        await symlink("some-container-1", join(data, "SingletonLock"));
        assert.equal(vesktopRunning({ kind: "native", dataDir: data }), false);
    }

    // Earlier models go (after a successful update-plugin); the current one and other files stay.
    const rt = join(temp, "runtime");
    for (const dir of ["models/nowcaption-fastconformer-en-80ms-cc-by-v3", "models/nowcaption-fastconformer-en-80ms-cc-by-v4", "models/something-else"]) await mkdir(join(rt, dir), { recursive: true });
    await mkdir(join(rt, "downloads"), { recursive: true });
    await writeFile(join(rt, "downloads", "nowcaption-fastconformer-en-80ms-cc-by-v3.tar.bz2"), "x");
    assert.deepEqual((await removeOldModels(rt)).sort(), [join("downloads", "nowcaption-fastconformer-en-80ms-cc-by-v3.tar.bz2"), join("models", "nowcaption-fastconformer-en-80ms-cc-by-v3")].sort());
    assert.deepEqual((await readdir(join(rt, "models"))).sort(), ["nowcaption-fastconformer-en-80ms-cc-by-v4", "something-else"]);

    // Script arguments.
    const here = fileURLToPath(new URL("..", import.meta.url));
    // The README runs ./install-engine.sh and ./update-plugin.sh: both must be executable.
    if (process.platform !== "win32") for (const f of ["install-engine.sh", "update-plugin.sh"]) {
        assert.ok((await stat(join(here, f))).mode & 0o100, `${f} is executable`);
    }
    const node = (script, args, env = {}) => spawnSync(process.execPath, [join(here, "scripts", script), ...args],
        { encoding: "utf8", env: { ...process.env, HOME: linuxHome, USERPROFILE: linuxHome, ...env } });
    let r = node("install-engine.mjs", ["--dry-run", "--target", "native"], { NOWCAPTION_VESKTOP_HOME: join(temp, "rt") });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Target: native/);
    r = node("install-engine.mjs", ["--dry-run", "--target", "sideways"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Unknown --target/);
    if (process.platform === "linux") {
        r = node("install-engine.mjs", ["--dry-run", "--target", "flatpak"]);
        assert.match(r.stdout, /dev\.vencord\.Vesktop[\\/]data[\\/]nowcaption-vesktop/);
    }
    r = node("update-plugin.mjs", ["--preflight", "--no-configure", "--vencord", join(temp, "no-vencord-here")]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /--setup-vencord/, "a first-time user is told how to get Vencord");
} finally { await rm(temp, { recursive: true, force: true }); }
console.log("PASS v19 scripts: compiled-plugin check, Scoop/portable Windows Vesktop, cmd.exe quoting, Vesktop/Flatpak detection, state.json update with backup, stale locks, script arguments");
