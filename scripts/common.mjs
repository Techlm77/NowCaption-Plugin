/* Shared helpers for the installer scripts: running commands safely on every platform, and finding
 * Vesktop installations (native, Flathub's dev.vencord.Vesktop, or a custom data folder).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readlinkSync } from "node:fs";
import { copyFile, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { join, resolve } from "node:path";

import { getRuntimeRoot, MODEL_DIRECTORY, VESKTOP_FLATPAK_ID } from "./runtime-paths.mjs";

/** Files Vesktop requires in a custom Vencord location (from Vesktop's own check). */
export const VESKTOP_REQUIRED_FILES = ["vencordDesktopMain.js", "vencordDesktopPreload.js", "vencordDesktopRenderer.js", "vencordDesktopRenderer.css"];
/** The plugin's folder in Vencord's src/userplugins, and the names it had before (removed when updating). */
export const PLUGIN_FOLDER = "nowCaption";
export const LEGACY_PLUGIN_FOLDERS = ["nowCaptionDiscord"];

/** Whether a compiled Vencord file contains the NowCaption plugin (the renderer defines it, main registers its helpers). */
export function hasCompiledPlugin(file, data) {
    const text = String(data);
    if (file.endsWith("Renderer.js")) return /name:\s*"NowCaption"/.test(text);
    if (file.endsWith("Main.js")) return /[{,\s]"?NowCaption"?\s*:/.test(text);
    return true;
}

export function argValue(args, name) {
    const i = args.indexOf(name);
    if (i === -1) return undefined;
    if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`${name} needs a value`);
    return args[i + 1];
}

/**
 * cmd.exe command line for npm/pnpm, which are .cmd scripts on Windows (Node won't start those without a shell).
 * Every argument is quoted, so folders with spaces work; characters cmd.exe expands even inside quotes are refused.
 */
export function cmdCommandLine(program, args) {
    const parts = [program, ...args].map(String);
    const bad = parts.find(part => /["%\r\n]/.test(part));
    if (bad !== undefined) throw new Error(`Can't pass this safely to cmd.exe: ${bad}`);
    return `"${parts.map(part => `"${part}"`).join(" ")}"`;
}

/** Runs a program with inherited output. `program` is a bare name (npm, pnpm, git, tar) or a full path. */
export function run(program, args, { cwd, capture = false, platform = process.platform } = {}) {
    const stdio = capture ? ["ignore", "pipe", "pipe"] : "inherit";
    const viaCmd = platform === "win32" && !/\.exe$/i.test(program);
    const result = viaCmd
        ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", cmdCommandLine(program, args)],
            { stdio, cwd, encoding: "utf8", windowsVerbatimArguments: true })
        : spawnSync(program, args, { stdio, cwd, encoding: "utf8" });
    if (result.error) throw new Error(`${program} could not be started: ${result.error.message}`);
    if (result.status !== 0) {
        const detail = capture ? `\n${(result.stderr || result.stdout || "").trim()}` : "";
        throw new Error(`${program} ${args[0] ?? ""} failed with exit code ${result.status}${detail}`);
    }
    return capture ? result.stdout : "";
}

/** First line of `program --version`, or undefined when it isn't installed. */
export function versionOf(program) {
    try { return run(program, ["--version"], { capture: true }).trim().split(/\r?\n/)[0] || undefined; }
    catch { return undefined; }
}

/** Windows' own tar (bsdtar) understands C:\ paths and bzip2; a Git for Windows tar on PATH doesn't. */
export function tarProgram() {
    if (process.platform !== "win32") return "tar";
    const system = join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
    return existsSync(system) ? system : "tar.exe";
}

/** Where a native (non-Flatpak) Vesktop keeps settings.json and state.json. */
export function nativeVesktopDataDir({ platform = process.platform, environment = process.env, home = homedir() } = {}) {
    if (environment.VENCORD_USER_DATA_DIR) return resolve(environment.VENCORD_USER_DATA_DIR);
    if (platform === "win32") return join(environment.APPDATA || join(home, "AppData", "Roaming"), "vesktop");
    if (platform === "darwin") return join(home, "Library", "Application Support", "vesktop");
    return join(environment.XDG_CONFIG_HOME || join(home, ".config"), "vesktop");
}
export function flatpakVesktopDataDir(home = homedir()) {
    return join(home, ".var", "app", VESKTOP_FLATPAK_ID, "config", "vesktop");
}

/** True when Flathub's Vesktop is installed (user or system) or has run before. */
export function flatpakVesktopInstalled({ platform = process.platform, home = homedir() } = {}) {
    if (platform !== "linux") return false;
    try { run("flatpak", ["info", VESKTOP_FLATPAK_ID], { capture: true }); return true; }
    catch (e) {
        // Without the flatpak command (e.g. inside a container), its data folder is the only clue.
        return /could not be started/.test(e.message) && existsSync(join(home, ".var", "app", VESKTOP_FLATPAK_ID));
    }
}

/**
 * Vesktop installations to set up. `kind` is "native", "flatpak" or "custom" (--vesktop-data).
 * A native one counts when its data folder exists or no Flatpak one does (a fresh install is native by default).
 */
export function findVesktopInstalls({ platform = process.platform, environment = process.env, home = homedir(), customDataDir, flatpak } = {}) {
    if (customDataDir) return [{ kind: "custom", dataDir: resolve(customDataDir), runtimeRoot: getRuntimeRoot({ platform, environment, home, target: "native" }) }];
    const installs = [];
    flatpak ??= flatpakVesktopInstalled({ platform, home });
    const nativeDir = nativeVesktopDataDir({ platform, environment, home });
    if (existsSync(nativeDir) || !flatpak) {
        installs.push({ kind: "native", dataDir: nativeDir, runtimeRoot: getRuntimeRoot({ platform, environment, home, target: "native" }) });
    }
    if (flatpak) {
        installs.push({
            kind: "flatpak", dataDir: flatpakVesktopDataDir(home), runtimeRoot: getRuntimeRoot({ platform, environment, home, target: "flatpak" }),
            // The sandbox can't read ~/Documents, so the built Vencord files are copied here (inside its own folder).
            vencordCopy: join(getRuntimeRoot({ platform, environment, home, target: "flatpak" }), "vencord-dist")
        });
    }
    return installs;
}

/** Whether this Vesktop is running now. Changing its state.json while it runs would be undone on exit. */
export function vesktopRunning(install, { platform = process.platform } = {}) {
    if (install.kind === "flatpak") {
        try { return run("flatpak", ["ps", "--columns=application"], { capture: true }).split(/\s+/).includes(VESKTOP_FLATPAK_ID); }
        catch { return false; }
    }
    if (platform === "win32") {
        try { return /vesktop\.exe/i.test(run(join(process.env.SystemRoot || "C:\\Windows", "System32", "tasklist.exe"), ["/FO", "CSV", "/NH", "/FI", "IMAGENAME eq Vesktop.exe"], { capture: true })); }
        catch { return false; }
    }
    // Linux and macOS: Chromium keeps a SingletonLock symlink ("<host>-<pid>") in the data folder while it runs.
    // A crash or a container can leave a stale one, so the host and the process must match too.
    let host, pid;
    try {
        const link = readlinkSync(join(install.dataDir, "SingletonLock"));
        host = link.slice(0, link.lastIndexOf("-"));
        pid = Number(link.slice(link.lastIndexOf("-") + 1));
    } catch { return false; }
    if (host !== hostname() || !(pid > 0)) return false;
    try { process.kill(pid, 0); } catch (e) { if (e.code !== "EPERM") return false; }
    return /vesktop|electron/i.test(processName(pid, platform) ?? "vesktop");
}
function processName(pid, platform) {
    try {
        if (platform === "linux") return readFileSync(`/proc/${pid}/comm`, "utf8");
        return run("ps", ["-p", String(pid), "-o", "comm="], { capture: true });
    } catch { return undefined; }
}

/** Removes earlier speech models (and their downloads) from a runtime folder; returns what was removed. */
export async function removeOldModels(root) {
    const old = /^nowcaption-fastconformer-en-80ms-cc-by-v\d+(\.tar\.bz2)?$/;
    const removed = [];
    for (const folder of ["models", "downloads"]) {
        let names = [];
        try { names = await readdir(join(root, folder)); } catch { continue; }
        for (const name of names) {
            if (!old.test(name) || name.startsWith(MODEL_DIRECTORY)) continue;
            await rm(join(root, folder, name), { recursive: true, force: true });
            removed.push(join(folder, name));
        }
    }
    return removed;
}

export async function readVesktopState(dataDir) {
    try { return JSON.parse(await readFile(join(dataDir, "state.json"), "utf8")); }
    catch (e) { if (e.code === "ENOENT") return undefined; throw new Error(`Can't read ${join(dataDir, "state.json")}: ${e.message}`); }
}
export const samePath = (a, b) => !!a && !!b && resolve(a) === resolve(b);

/**
 * Points Vesktop at a Vencord build (the "Vencord location" setting), keeping every other state key.
 * Returns the backup's path, or undefined when nothing had to change.
 */
export async function setVencordDir(dataDir, vencordDir) {
    const file = join(dataDir, "state.json");
    const state = await readVesktopState(dataDir);
    if (!state) throw new Error(`${file} doesn't exist yet: start Vesktop once, close it, then run this again.`);
    if (samePath(state.vencordDir, vencordDir)) return undefined;
    const backup = `${file}.nowcaption-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    await copyFile(file, backup);
    const temp = `${file}.nowcaption-${process.pid}`;
    await writeFile(temp, JSON.stringify({ ...state, vencordDir }, null, 4));
    await rename(temp, file);
    return backup;
}
