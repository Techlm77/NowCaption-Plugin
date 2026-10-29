#!/usr/bin/env node
/** Installs or updates the NowCaption userplugin in a Vencord source folder, builds Vencord, and points
 * Vesktop at that build. Backs up and rolls back on failure. Run with Vesktop closed.
 *
 *   node scripts/update-plugin.mjs [--vencord DIR] [--setup-vencord] [--vesktop-data DIR] [--no-configure] [--preflight]
 *
 * --vencord        Vencord source folder (default: VENCORD_DIR or ~/Documents/Vencord-source)
 * --setup-vencord  clone Vencord into that folder first if it isn't there
 * --vesktop-data   Vesktop's data folder, for portable or unusual installs (default: found automatically,
 *                  including Flathub's dev.vencord.Vesktop)
 * --no-configure   build only; leave Vesktop's "Vencord location" setting alone
 * --keep-old-models keep earlier speech models (by default they're removed once this update has succeeded)
 * --preflight      check everything and change nothing
 */
import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { argValue, findVesktopInstalls, hasCompiledPlugin, LEGACY_PLUGIN_FOLDERS, PLUGIN_FOLDER, readVesktopState, removeOldModels, run, samePath, setVencordDir, versionOf, VESKTOP_REQUIRED_FILES, vesktopRunning } from "./common.mjs";
import { MODEL_DIRECTORY } from "./runtime-paths.mjs";

const VERSION = "v19";
const VENCORD_REPO = "https://github.com/Vendicated/Vencord.git";
const here = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const root = resolve(argValue(args, "--vencord") ?? process.env.VENCORD_DIR ?? join(homedir(), "Documents", "Vencord-source"));
const source = join(here, "src", "userplugins", PLUGIN_FOLDER);
const destParent = join(root, "src", "userplugins");
const dest = join(destParent, PLUGIN_FOLDER);
const dist = join(root, "dist");
const backups = join(homedir(), "Documents", "NowCaption-Vesktop-Backups");
const backupName = `nowCaption-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const preflight = args.includes("--preflight");
const configure = !args.includes("--no-configure");

async function exists(path) { try { await stat(path); return true; } catch { return false; } }

/** First install: a Vencord source folder with its dependencies. */
async function ensureVencord() {
    if (!await exists(join(root, "scripts", "build", "build.mjs"))) {
        if (!args.includes("--setup-vencord")) {
            throw new Error(`No Vencord source folder at ${root}.\n` +
                `  Run this again with --setup-vencord to download it there (needs git), or use --vencord DIR for another folder.`);
        }
        if (!versionOf("git")) throw new Error("git is needed to download Vencord: install it from https://git-scm.com and run this again.");
        if (preflight) { console.log(`Would download Vencord into ${root}.`); return false; }
        if (await exists(root) && (await readdir(root)).length) throw new Error(`${root} exists but isn't a Vencord source folder; choose another with --vencord DIR.`);
        console.log(`Downloading Vencord into ${root}…`);
        await mkdir(dirname(root), { recursive: true });
        run("git", ["clone", "--depth", "1", VENCORD_REPO, root]);
    }
    if (!versionOf("pnpm")) {
        throw new Error("pnpm is needed to build Vencord. Run `corepack enable` (included with Node.js), or `npm install -g pnpm`, then run this again.");
    }
    if (!await exists(join(root, "node_modules"))) {
        if (preflight) { console.log("Would install Vencord's dependencies (pnpm install)."); return true; }
        console.log("Installing Vencord's dependencies (first time only)…");
        run("pnpm", ["install", "--frozen-lockfile"], { cwd: root });
    }
    return true;
}

/** The sandbox can't read the Vencord folder: copy the files Vesktop loads into Flatpak Vesktop's own folder. */
async function copyForFlatpak(target) {
    const stage = `${target}.new-${process.pid}`;
    await rm(stage, { recursive: true, force: true });
    await mkdir(stage, { recursive: true });
    for (const name of await readdir(dist)) {
        if (name.startsWith("vencordDesktop") || name === "package.json" || name === "font-licenses") {
            await cp(join(dist, name), join(stage, name), { recursive: true });
        }
    }
    for (const name of VESKTOP_REQUIRED_FILES) if (!await exists(join(stage, name))) throw new Error(`Build is missing ${name}`);
    const old = `${target}.old-${process.pid}`;
    if (await exists(target)) await rename(target, old);
    await rename(stage, target);
    await rm(old, { recursive: true, force: true });
}

async function engineReady(runtimeRoot) {
    return await exists(join(runtimeRoot, "models", MODEL_DIRECTORY, "encoder.int8.onnx")) &&
        await exists(join(runtimeRoot, "node_modules", "sherpa-onnx-node", "package.json"));
}

async function main() {
    if (Number(process.versions.node.split(".")[0]) < 20) throw new Error("Node.js 20 or newer is required.");
    console.log(`Vencord source: ${root}`);
    for (const f of [join(source, "index.ts"), join(source, "native.ts")]) if (!await exists(f)) throw new Error(`Plugin file not found: ${f}`);
    const installs = configure ? findVesktopInstalls({ customDataDir: argValue(args, "--vesktop-data") }) : [];
    for (const install of installs) console.log(`Vesktop (${install.kind}): ${install.dataDir}`);
    const running = installs.filter(install => vesktopRunning(install));
    if (running.length) {
        throw new Error(`Vesktop is running (${running.map(i => i.kind).join(", ")}). Quit it completely (also from the tray icon), then run this again.\n` +
            "  Or use --no-configure to only build, and restart Vesktop afterwards.");
    }
    const haveVencord = await ensureVencord();
    if (preflight) {
        console.log(haveVencord ? "Preflight OK: nothing was changed." : "Preflight OK after Vencord is downloaded: nothing was changed.");
        return;
    }

    const stage = await mkdtemp(join(destParent, ".nowcaption-stage-")).catch(async () => {
        await mkdir(destParent, { recursive: true });
        return mkdtemp(join(destParent, ".nowcaption-stage-"));
    });
    let sourceBackup, distBackup, replaced = false;
    const legacy = []; // the plugin under an earlier folder name: moved out, or Vencord would build it twice
    try {
        await cp(source, stage, { recursive: true });
        console.log("Preparing licensed fonts (verified upstream; cached if already available)…");
        run(process.execPath, [join(here, "scripts", "prepare-fonts.mjs"), stage]);
        await mkdir(backups, { recursive: true });
        if (await exists(dest)) {
            sourceBackup = join(backups, backupName + "-plugin");
            await cp(dest, sourceBackup, { recursive: true });
            console.log(`Backup: ${sourceBackup}`);
        }
        for (const name of LEGACY_PLUGIN_FOLDERS) {
            if (!await exists(join(destParent, name))) continue;
            const backup = join(backups, `${backupName}-plugin-${name}`);
            await cp(join(destParent, name), backup, { recursive: true });
            legacy.push({ name, backup });
            console.log(`Backup of the earlier plugin folder ${name}: ${backup}`);
        }
        if (await exists(dist)) {
            distBackup = join(backups, backupName + "-dist");
            await cp(dist, distBackup, { recursive: true });
        }
        replaced = true;
        for (const { name } of legacy) await rm(join(destParent, name), { recursive: true, force: true });
        await rm(dest, { recursive: true, force: true });
        await rename(stage, dest);
        console.log("Building Vencord with the NowCaption plugin…");
        run("pnpm", ["build", "--dev"], { cwd: root });
        await writeFile(join(dist, "package.json"), "{}\n");
        const licenseDir = join(dist, "font-licenses");
        await mkdir(licenseDir, { recursive: true });
        for (const name of await readdir(join(dest, "font-licenses"))) if (name.endsWith("-OFL.txt")) {
            await cp(join(dest, "font-licenses", name), join(licenseDir, name));
        }
        for (const file of VESKTOP_REQUIRED_FILES) {
            const data = await readFile(join(dist, file));
            if (!data.length) throw new Error(`Empty compiled artifact: ${file}`);
            if (!hasCompiledPlugin(file, data)) throw new Error(`The NowCaption plugin is missing from the compiled ${file}`);
        }
    } catch (error) {
        if (replaced) {
            console.error(`Update failed: ${error.message}. Restoring the previous plugin and build…`);
            await rm(dest, { recursive: true, force: true });
            if (sourceBackup) await cp(sourceBackup, dest, { recursive: true });
            for (const { name, backup } of legacy) {
                await rm(join(destParent, name), { recursive: true, force: true });
                await cp(backup, join(destParent, name), { recursive: true });
            }
            if (distBackup) {
                await rm(dist, { recursive: true, force: true });
                await cp(distBackup, dist, { recursive: true });
            }
        }
        throw error;
    } finally { await rm(stage, { recursive: true, force: true }); }

    const nextSteps = [];
    for (const install of installs) {
        const label = install.kind === "flatpak" ? "Flatpak Vesktop" : "Vesktop";
        const location = install.kind === "flatpak" ? install.vencordCopy : dist;
        if (install.kind === "flatpak") await copyForFlatpak(location);
        const state = await readVesktopState(install.dataDir);
        if (!state) {
            nextSteps.push(`${label} hasn't been started yet: start it once, quit it, and run this again (or set Settings → Vesktop → Vencord Location to ${location}).`);
        } else if (samePath(state.vencordDir, location)) {
            console.log(`${label} already uses this build.`);
        } else {
            const backup = await setVencordDir(install.dataDir, location);
            console.log(`${label} now loads Vencord from ${location} (previous settings saved to ${backup}).`);
        }
        if (!await engineReady(install.runtimeRoot)) {
            nextSteps.push(`Install the speech engine for ${label}: node scripts/install-engine.mjs${install.kind === "flatpak" ? " --target flatpak" : ""}`);
        } else if (!args.includes("--keep-old-models")) {
            // The new plugin is in place and its model is installed: earlier models are no longer needed.
            for (const name of await removeOldModels(install.runtimeRoot)) console.log(`Removed the old ${name} for ${label}.`);
        }
    }
    console.log(`\nSUCCESS: NowCaption for Vesktop ${VERSION} is built${installs.length ? " and set up" : ""}.`);
    for (const step of nextSteps) console.log(`Next: ${step}`);
    console.log("Then start Vesktop and open the CC · Captions button. In DevTools, window.__nowCaption?.profile()?.nowCaptionPlugin shows the version.");
}
main().catch(e => { console.error(`ERROR: ${e.message}`); process.exitCode = 1; });
