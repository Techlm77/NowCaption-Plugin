#!/usr/bin/env node
/* Read-only installation report. Doesn't print user names, Discord data, transcripts or credentials.
 *   node scripts/doctor.mjs [--vencord DIR] [--vesktop-data DIR]
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { argValue, defaultVencordDir, findVesktopInstalls, gitAvailable, hasCompiledPlugin, installLabel, portableHint, runningVesktopExecutables, LEGACY_PLUGIN_FOLDERS, PLUGIN_FOLDER, readVesktopState, run, samePath, versionOf, VESKTOP_REQUIRED_FILES, vesktopRunning } from "./common.mjs";
import { MODEL_DIRECTORY } from "./runtime-paths.mjs";

const args = process.argv.slice(2);
const vencord = resolve(argValue(args, "--vencord") ?? defaultVencordDir());
const dist = join(vencord, "dist");
async function exists(path) { try { await stat(path); return true; } catch { return false; } }
const mark = ok => ok ? "OK     " : "MISSING";
// People paste this report into issues: show the home folder (and so the computer's user name) as ~.
// Case-insensitive, because Windows paths (such as %LOCALAPPDATA%) can differ in case from the home folder.
const home = homedir();
const homePattern = home.length > 1 ? new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi") : undefined;
const hideHome = text => homePattern ? String(text).replace(homePattern, "~") : String(text);
const print = text => console.log(hideHome(text));

function engineLoads(root) {
    try {
        run(process.execPath, ["-e", "require(require('module').createRequire(process.argv[1]).resolve('sherpa-onnx-node'))", join(root, "package.json")], { capture: true });
        return "loads";
    } catch { return "does NOT load with this Node (see docs/PLATFORM_SUPPORT.md)"; }
}
async function builtWithPlugin(folder) {
    try { return hasCompiledPlugin("vencordDesktopRenderer.js", await readFile(join(folder, "vencordDesktopRenderer.js"))); }
    catch { return false; }
}

async function main() {
    print("NowCaption for Vesktop: installation report (nothing is changed)\n");
    print(`Host: ${process.platform}/${process.arch} · Node ${process.version} · npm ${versionOf("npm") ?? "not found"} · pnpm ${versionOf("pnpm") ?? "not found"} · git ${gitAvailable() ? "found" : "not found (not needed)"}`);
    if (process.platform === "linux") print(`bzip2 (to unpack the model): ${versionOf("bzip2") || (await exists("/usr/bin/bzip2")) ? "found" : "NOT found: install your distribution's bzip2 package"}`);
    if (Number(process.versions.node.split(".")[0]) < 20) print("Node.js 20 or newer is required.");

    print(`\nVencord source: ${vencord}`);
    print(`  ${mark(await exists(join(vencord, "scripts", "build", "build.mjs")))} Vencord source folder`);
    print(`  ${mark(await exists(join(vencord, "node_modules")))} its dependencies (pnpm install)`);
    print(`  ${mark(await exists(join(vencord, "src", "userplugins", PLUGIN_FOLDER, "index.ts")))} NowCaption userplugin`);
    for (const name of LEGACY_PLUGIN_FOLDERS) if (await exists(join(vencord, "src", "userplugins", name))) {
        print(`  The plugin's earlier folder src/userplugins/${name} is still there: update-plugin moves it out.`);
    }
    print(`  ${mark(await builtWithPlugin(dist))} built with NowCaption (dist)`);

    for (const install of findVesktopInstalls({ customDataDir: argValue(args, "--vesktop-data") })) {
        const label = installLabel(install);
        print(`\n${label}: ${install.dataDir}${vesktopRunning(install) ? " (running)" : ""}`);
        const state = await readVesktopState(install.dataDir).catch(e => { print(`  ${e.message}`); return undefined; });
        const expected = install.kind === "flatpak" ? install.vencordCopy : dist;
        if (!state) print(`  Not started from this folder yet (no state.json). ${portableHint()}`);
        else if (!state.vencordDir) print("  Uses Vesktop's own Vencord, not the NowCaption build: run update-plugin.");
        else {
            const files = (await Promise.all(VESKTOP_REQUIRED_FILES.map(f => exists(join(state.vencordDir, f))))).every(Boolean);
            print(`  Vencord location: ${state.vencordDir}${samePath(state.vencordDir, expected) ? "" : `\n  (update-plugin would set ${expected})`}`);
            print(`  ${mark(files)} Vencord files there · ${await builtWithPlugin(state.vencordDir) ? "includes NowCaption" : "WITHOUT NowCaption"}`);
        }
        const root = install.runtimeRoot;
        const model = join(root, "models", MODEL_DIRECTORY);
        const modelOk = (await Promise.all(["tokens.txt", "encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx"].map(f => exists(join(model, f))))).every(Boolean);
        const engineOk = await exists(join(root, "node_modules", "sherpa-onnx-node", "package.json"));
        print(`  Speech runtime: ${root}`);
        print(`  ${mark(modelOk)} speech model v4`);
        print(`  ${mark(engineOk)} speech engine (sherpa-onnx-node)${engineOk ? ` · ${engineLoads(root)}` : ""}`);
        const old = (await readdir(join(root, "models")).catch(() => [])).filter(n => n !== MODEL_DIRECTORY && n.startsWith("nowcaption-fastconformer"));
        if (old.length) print(`  Old models still installed: ${old.join(", ")} (update-plugin removes them after a successful update)`);
        if (!modelOk || !engineOk) print(`  Fix: node scripts/install-engine.mjs${install.kind === "flatpak" ? " --target flatpak" : ""}`);
    }
    for (const { exe, portable } of runningVesktopExecutables()) {
        print(`\nRunning now: ${exe}`);
        if (portable) print(`  This is a portable Vesktop: its settings are in ${join(dirname(exe), "Data")}.\n` +
            `  Set it up: start "Install on Windows.cmd" while this Vesktop is open, or run command-line\\update-plugin.cmd --vesktop-data "${dirname(exe)}" (quit Vesktop first)`);
    }
    print("\nNot checked here: live Discord audio, speaker identification and font rendering (see the diagnostics tab in Vesktop).");
}
main().catch(e => { console.error(hideHome(`Doctor failed: ${e.message}`)); process.exitCode = 1; });
