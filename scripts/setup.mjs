#!/usr/bin/env node
/** The installer behind "Install on Windows.cmd", "Install on Mac.command" and "Install on Linux.sh": finds Vesktop,
 * closes it, installs the speech model and engine, builds Vencord with NowCaption, points Vesktop at the build, turns
 * NowCaption on and starts Vesktop again. Installing again updates. Everything it prints is also saved to a log.
 *
 *   node scripts/setup.mjs [--yes] [--no-start] [--no-dialog] [--vesktop-data DIR] [--vencord DIR] [--keep-old-models]
 *
 * --yes        don't ask (close a running Vesktop without asking)
 * --no-start   don't start Vesktop at the end
 * --no-dialog  no message box at the end (the window says the same)
 */
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { argValue, closeVesktop, detectVesktop, enableNowCaption, installLabel, prependPath, run, startVesktop, vesktopRunning } from "./common.mjs";
import { getRuntimeRoot } from "./runtime-paths.mjs";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const assumeYes = args.includes("--yes") || !process.stdin.isTTY;
const customDataDir = argValue(args, "--vesktop-data");
const passThrough = [];
if (argValue(args, "--vencord")) passThrough.push("--vencord", argValue(args, "--vencord"));
if (args.includes("--keep-old-models")) passThrough.push("--keep-old-models");

// The log goes next to the speech runtime. People share it when asking for help: it shows the home folder as ~.
const home = homedir();
const homePattern = home.length > 1 ? new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi") : undefined;
const hideHome = text => homePattern ? String(text).replace(homePattern, "~") : String(text);
const logDir = join(getRuntimeRoot({ target: "native" }), "logs");
const logFile = join(logDir, `install-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
try { mkdirSync(logDir, { recursive: true }); } catch { /* reported when writing fails */ }
const log = text => { try { appendFileSync(logFile, hideHome(text)); } catch { /* the window still shows it */ } };

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, text) => color ? `\x1b[${code}m${text}\x1b[0m` : text;
const say = (text = "") => { console.log(text); log(text.replace(/\x1b\[[0-9;]*m/g, "") + "\n"); };
let stepNumber = 0;
const STEPS = 5;
const heading = text => say(`\n${paint("1", `[${++stepNumber}/${STEPS}] ${text}`)}`);
const good = text => say(`  ${paint("32", "✓")} ${text}`);
const warn = text => say(`  ${paint("33", "!")} ${text}`);

async function ask(question, fallback = true) {
    if (assumeYes) return fallback;
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
        const answer = (await rl.question(`  ${question} ${fallback ? "[Y/n]" : "[y/N]"} `)).trim().toLowerCase();
        log(`  ${question} → ${answer || (fallback ? "y" : "n")}\n`);
        return answer ? answer.startsWith("y") : fallback;
    } finally { rl.close(); }
}

async function pause() {
    if (assumeYes || process.env.NOWCAPTION_NO_PAUSE) return;
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try { await rl.question("\nPress Enter to close this window. "); } finally { rl.close(); }
}

/** Runs one of the installer scripts, showing its output and saving it to the log. */
function runScript(script, scriptArgs) {
    return new Promise(done => {
        const child = spawn(process.execPath, [join(here, "scripts", script), ...scriptArgs], { stdio: ["inherit", "pipe", "pipe"], cwd: here });
        child.stdout.on("data", d => { process.stdout.write(d); log(d); });
        child.stderr.on("data", d => { process.stderr.write(d); log(d); });
        child.on("error", e => { say(e.message); done(1); });
        child.on("close", code => done(code ?? 1));
    });
}

/** A message box, so the result is seen even when the window is behind Vesktop. Returns whether one was shown. */
function dialog(title, message, ok) {
    if (args.includes("--no-dialog") || process.env.CI) return false;
    const env = { NC_TITLE: title, NC_MESSAGE: message };
    try {
        if (process.platform === "win32") {
            const ps = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
            run(ps, ["-NoProfile", "-NonInteractive", "-Command",
                `Add-Type -AssemblyName PresentationFramework; [void][System.Windows.MessageBox]::Show($env:NC_MESSAGE, $env:NC_TITLE, 'OK', '${ok ? "Information" : "Warning"}')`], { capture: true, env });
            return true;
        }
        if (process.platform === "darwin") {
            // Text as arguments: AppleScript reads environment variables in an old encoding (the "·" came out wrong).
            run("osascript", ["-e", "on run argv", "-e", `display dialog (item 1 of argv) with title (item 2 of argv) buttons {"OK"} default button "OK" with icon ${ok ? "note" : "caution"}`, "-e", "end run", message, title], { capture: true });
            return true;
        }
        if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
            for (const [program, programArgs] of [["zenity", [ok ? "--info" : "--warning", "--title", title, "--text", message]], ["kdialog", ["--title", title, ok ? "--msgbox" : "--sorry", message]]]) {
                try { run(program, programArgs, { capture: true }); return true; } catch { /* try the next one */ }
            }
        }
    } catch { /* the window shows the same message */ }
    return false;
}

function openPage(url) {
    try {
        const [program, programArgs] = process.platform === "win32" ? [join(process.env.SystemRoot || "C:\\Windows", "explorer.exe"), [url]]
            : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
        spawn(program, programArgs, { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
    } catch { /* the link is printed too */ }
}

async function fail(message, details) {
    say(`\n${paint("31", "✗ " + message)}`);
    if (details) say(details);
    say(`\nThe log of this installation is in ${logFile}`);
    dialog("NowCaption wasn't installed", `${message}\n\nThe installer window and its log have the details.`, false);
    process.exitCode = 1;
    await pause();
}

async function main() {
    // The installer's own tools (Node.js, pnpm) come first on PATH for every step.
    prependPath(dirname(process.execPath));
    say(paint("1", "NowCaption for Vesktop: installer"));
    say(`Live captions for Discord calls, made on this computer. Log: ${hideHome(logFile)}`);

    heading("Looking for Vesktop");
    const found = detectVesktop({ customDataDir });
    if (!found.installs.length) {
        const discordNote = found.vencordOnDiscord ? "\n  You have Vencord in the Discord app. NowCaption needs Vesktop, Vencord's own Discord app: it can import your Vencord settings when it starts the first time."
            : found.discord ? "\n  The Discord app was found, but NowCaption runs in Vesktop (a Discord app with Vencord built in)." : "";
        say(`  Vesktop isn't installed.${discordNote}`);
        say("  Install it from https://vesktop.dev, then run this installer again.");
        if (process.platform === "win32") say("  If you use the portable Vesktop (the .zip), start it, then run this installer again while it's open.");
        if (await ask("Open the Vesktop download page now?")) openPage("https://vesktop.dev/install");
        return fail("Vesktop isn't installed yet.");
    }
    for (const install of found.installs) good(`${installLabel(install)}${install.app ? `: ${hideHome(install.app)}` : ""}`);
    // Linux's tar unpacks the speech model (.tar.bz2) with the bzip2 program, which minimal systems can lack.
    if (process.platform === "linux" && !["bzip2", "/usr/bin/bzip2", "/bin/bzip2"].some(program => { try { run(program, ["--help"], { capture: true }); return true; } catch { return false; } })) {
        return fail("The bzip2 program is missing: it unpacks the speech model.",
            "  Install your distribution's bzip2 package, then run this installer again:\n" +
            "    Debian/Ubuntu: sudo apt install bzip2 · Fedora: sudo dnf install bzip2 · Arch: sudo pacman -S bzip2 · openSUSE: sudo zypper install bzip2");
    }
    if (found.installs.some(i => i.kind === "flatpak")) say("  Flathub's Vesktop gets its own copy of everything inside its sandbox folder.");

    heading("Closing Vesktop");
    const wasRunning = found.installs.filter(install => vesktopRunning(install));
    if (!wasRunning.length) good("Vesktop isn't running.");
    else {
        say("  Vesktop is open. It has to be closed while NowCaption is installed, and it's started again at the end.");
        if (!await ask("Close Vesktop now?")) return fail("Vesktop is still open. Quit it (also from its tray icon), then run this installer again.");
        for (const install of wasRunning) {
            if (await closeVesktop(install)) good(`Closed ${installLabel(install)}.`);
            else return fail(`${installLabel(install)} didn't close. Quit it from its tray icon, then run this installer again.`);
        }
    }

    heading("Installing the speech model and engine");
    const custom = found.installs.find(i => i.kind === "custom");
    const engineArgs = custom ? ["--target", "native"] : [];
    if (await runScript("install-engine.mjs", engineArgs) !== 0) return fail("The speech model or engine couldn't be installed.", "Check your internet connection and run this installer again.");

    heading("Building Vencord with NowCaption (the first time takes a few minutes)");
    const pluginArgs = ["--setup-vencord", "--create-state", ...passThrough];
    if (custom) pluginArgs.push("--vesktop-data", custom.portableFolder ?? custom.dataDir);
    if (await runScript("update-plugin.mjs", pluginArgs) !== 0) return fail("Vencord with NowCaption couldn't be built or set up.", "The messages above say why. Vesktop wasn't changed (an earlier NowCaption build, if there was one, was put back).");

    heading("Turning NowCaption on");
    for (const install of found.installs) {
        const result = await enableNowCaption(install.dataDir);
        if (result === "enabled") good(`NowCaption is turned on in ${installLabel(install)}.`);
        else if (result === "already") good(`NowCaption was already on in ${installLabel(install)}.`);
        else warn(`${result}: turn it on in Vesktop under Settings → Vencord → Plugins.`);
    }

    say(`\n${paint("32;1", "✓ NowCaption is installed.")}`);
    say("  In Vesktop, join a voice call and click CC · Captions at the top right.");
    say("  To update later, run this installer again.");
    const toStart = args.includes("--no-start") ? [] : (wasRunning.length ? wasRunning : found.installs.slice(0, 1));
    const message = "NowCaption is installed and turned on.\n\nIn Vesktop, join a voice call and click \"CC · Captions\" at the top right."
        + (toStart.length ? "\n\nVesktop opens when you click OK." : "");
    const shown = dialog("NowCaption is installed", message, true);
    for (const install of toStart) {
        if (startVesktop(install)) say(`  Starting ${installLabel(install)}…`);
        else say(`  Start ${installLabel(install)} yourself to use it.`);
    }
    log("\nSUCCESS\n");
    if (!shown) await pause();
}

main().catch(e => fail(`Something went wrong: ${e.message}`));
