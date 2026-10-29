#!/usr/bin/env node
/** Cross-platform installer for the speech model (v4) and the sherpa-onnx engine (Node 20+, npm, tar).
 * SHA-256 verification is mandatory, both for cached and freshly downloaded archives.
 * No audio, transcripts or personal data are uploaded.
 *
 *   node scripts/install-engine.mjs [--target auto|native|flatpak|both] [--dry-run]
 *
 * "auto" installs for every Vesktop found: the normal one, Flathub's (dev.vencord.Vesktop), or both.
 * The Flatpak sandbox can only read its own folder, so it gets its own copy in ~/.var/app/dev.vencord.Vesktop/data.
 * Older models stay until update-plugin has installed a plugin that uses this one (a failed update rolls back to
 * the previous plugin, which still needs them).
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { argValue, findVesktopInstalls, run, tarProgram } from "./common.mjs";
import { getRuntimeRoot, MODEL_DIRECTORY } from "./runtime-paths.mjs";

const MODEL_ARCHIVE = `${MODEL_DIRECTORY}.tar.bz2`;
const MODEL_URL = `https://github.com/Techlm77/NowCaption/releases/download/models-v4/${MODEL_ARCHIVE}`;
const MODEL_SHA256 = "caad3a84b9547a4ec4143b668cd1d17acf769ada00fa964d80781c124d1598ef";
const SHERPA_VERSION = "1.13.8";
const RUNTIME_PACKAGE = `sherpa-onnx-node@${SHERPA_VERSION}`;
const REQUIRED = ["tokens.txt", "encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx"];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const target = argValue(args, "--target") ?? "auto";

async function exists(path) { try { await stat(path); return true; } catch { return false; } }
async function validModel(packageRoot) {
    try { for (const name of REQUIRED) if ((await stat(join(packageRoot, name))).size === 0) return false; return true; }
    catch { return false; }
}
async function sha256(path) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest("hex");
}
async function verified(path) { try { return (await sha256(path)) === MODEL_SHA256; } catch { return false; } }

/** Runtime folders to install into. */
function targets() {
    if (!["auto", "native", "flatpak", "both"].includes(target)) throw new Error(`Unknown --target ${target} (use auto, native, flatpak or both)`);
    if (target !== "native" && target !== "auto" && process.platform !== "linux") throw new Error("Flatpak Vesktop only exists on Linux.");
    const roots = [];
    if (target === "native" || target === "both") roots.push({ kind: "native", root: getRuntimeRoot({ target: "native" }) });
    if (target === "flatpak" || target === "both") roots.push({ kind: "flatpak", root: getRuntimeRoot({ target: "flatpak" }) });
    if (target === "auto") for (const install of findVesktopInstalls()) roots.push({ kind: install.kind, root: install.runtimeRoot });
    return roots;
}

/** Puts the verified archive at `archive`, reusing a verified copy from another target when there is one. */
async function obtainArchive(archive, otherArchives) {
    if (await verified(archive)) { console.log("Using the SHA-256-verified downloaded model."); return; }
    for (const other of otherArchives) {
        if (other !== archive && await verified(other)) { await copyFile(other, archive); console.log("Reusing the verified model download."); return; }
    }
    console.log("Downloading NowCaption speech model v4 (about 106 MiB)…");
    // Give up only when no data arrives for a minute, so slow connections still finish.
    const controller = new AbortController();
    let idle = setTimeout(() => controller.abort(new Error("no data for 60 s")), 60_000);
    const part = `${archive}.part-${process.pid}`;
    try {
        const response = await fetch(MODEL_URL, { signal: controller.signal, redirect: "follow" })
            .catch(e => { throw new Error(`Model download failed: ${e.message}${e.cause?.code ? ` (${e.cause.code})` : ""}`); });
        if (!response.ok || !response.body) throw new Error(`Model download failed: HTTP ${response.status}`);
        await pipeline(Readable.fromWeb(response.body), async function* (chunks) {
            for await (const chunk of chunks) {
                clearTimeout(idle);
                idle = setTimeout(() => controller.abort(new Error("no data for 60 s")), 60_000);
                yield chunk;
            }
        }, createWriteStream(part, { flags: "wx" }));
        if ((await sha256(part)) !== MODEL_SHA256) throw new Error("Model SHA-256 mismatch: archive rejected.");
        await rm(archive, { force: true });
        await rename(part, archive);
    } finally { clearTimeout(idle); await rm(part, { force: true }); }
}

async function extractVerifiedArchive(root, archive) {
    const packageRoot = join(root, "models", MODEL_DIRECTORY);
    const stage = await mkdtemp(join(root, "models", ".nowcaption-extract-"));
    try {
        if (!(await verified(archive))) throw new Error("Model archive failed its SHA-256 check before extraction.");
        run(tarProgram(), ["-xjf", archive, "-C", stage]);
        const extracted = join(stage, MODEL_DIRECTORY);
        for (const name of REQUIRED) {
            const file = await stat(join(extracted, name));
            if (!file.isFile() || file.size === 0) throw new Error(`Archive missing required model file: ${name}`);
        }
        const backup = `${packageRoot}.previous-${process.pid}`;
        let hadPrevious = false;
        try { await rename(packageRoot, backup); hadPrevious = true; } catch (e) { if (e.code !== "ENOENT") throw e; }
        try { await rename(extracted, packageRoot); }
        catch (e) { if (hadPrevious) await rename(backup, packageRoot); throw e; }
        if (hadPrevious) await rm(backup, { recursive: true, force: true });
    } finally { await rm(stage, { recursive: true, force: true }); }
}

/**
 * sherpa-onnx-node loads the build matching the process that runs it. On a Mac, Node (which runs this script)
 * and Vesktop can differ (Rosetta), so both macOS builds are installed. npm won't install a package for
 * another CPU, so the other one is unpacked from `npm pack`.
 */
async function addOtherMacBuild(root) {
    for (const arch of ["arm64", "x64"]) {
        const name = `sherpa-onnx-darwin-${arch}`;
        const dir = join(root, "node_modules", name);
        if (await exists(join(dir, "package.json"))) continue;
        const temp = await mkdtemp(join(root, ".nowcaption-pack-"));
        try {
            const packed = JSON.parse(run("npm", ["pack", `${name}@${SHERPA_VERSION}`, "--json", "--pack-destination", temp], { capture: true }));
            await mkdir(dir, { recursive: true });
            run("tar", ["-xzf", join(temp, packed[0].filename), "-C", dir, "--strip-components=1"]);
            console.log(`Added ${name} (for Vesktop running as ${arch}).`);
        } finally { await rm(temp, { recursive: true, force: true }); }
    }
}

/** Loads the engine in a separate Node process, as Vesktop will. */
function checkEngineLoads(root) {
    try {
        run(process.execPath, ["-e", "require(require('module').createRequire(process.argv[1]).resolve('sherpa-onnx-node'))", join(root, "package.json")], { capture: true });
        return true;
    } catch (e) {
        console.warn(`WARNING: the engine didn't load with Node ${process.version} (${process.platform}/${process.arch}): ${e.message.split("\n").slice(-1)[0]}`);
        return false;
    }
}

async function installInto({ kind, root }, allArchives) {
    console.log(`\n== ${kind === "flatpak" ? "Flatpak Vesktop" : "Vesktop"}: ${root}`);
    await mkdir(join(root, "downloads"), { recursive: true });
    await mkdir(join(root, "models"), { recursive: true });
    const archive = join(root, "downloads", MODEL_ARCHIVE);
    if (!(await validModel(join(root, "models", MODEL_DIRECTORY)))) {
        await obtainArchive(archive, allArchives);
        await extractVerifiedArchive(root, archive);
        console.log("Speech model v4 installed.");
    } else console.log("Speech model v4 is already installed.");
    const packageJson = join(root, "package.json");
    if (!(await exists(packageJson))) {
        await writeFile(packageJson, JSON.stringify({ name: "nowcaption-vesktop-local-runtime", private: true, version: "0.2.0" }) + "\n");
    }
    console.log(`Installing the speech engine: ${RUNTIME_PACKAGE}`);
    run("npm", ["install", "--prefix", root, "--no-audit", "--no-fund", "--save-exact", RUNTIME_PACKAGE]);
    if (process.platform === "darwin") await addOtherMacBuild(root);
    return checkEngineLoads(root);
}

async function main() {
    if (Number(process.versions.node.split(".")[0]) < 20) throw new Error("Node.js 20 or newer is required for the installer.");
    if (process.platform === "win32" && process.arch === "arm64") {
        console.warn("WARNING: the speech engine has no Windows on Arm build. It works only if Vesktop runs as x64 (emulated).");
    }
    const list = targets();
    console.log(`Platform: ${process.platform}/${process.arch}`);
    for (const t of list) console.log(`Target: ${t.kind} → ${t.root}`);
    if (dryRun) { console.log("Dry run: no downloads, installations or file writes."); return; }
    const archives = list.map(t => join(t.root, "downloads", MODEL_ARCHIVE));
    let loads = true;
    for (const t of list) loads = (await installInto(t, archives)) && loads;
    // The archive is only needed to unpack the model; drop it so each Vesktop keeps just one copy.
    for (const archive of archives) await rm(archive, { force: true });
    console.log(loads ? "\nDone. Restart Vesktop to use speech model v4." : "\nInstalled, but see the warning above. docs/PLATFORM_SUPPORT.md has fixes.");
    if (!loads) process.exitCode = 1;
}
main().catch(e => { console.error(`INSTALL ERROR: ${e.message}`); process.exitCode = 1; });
