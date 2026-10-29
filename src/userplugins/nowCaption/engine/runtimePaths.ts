/* Single source of runtime-path policy for the native recognizer.
 * Keep in sync with scripts/runtime-paths.mjs (tests/runtime-parity.cjs checks that they agree).
 */
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type RuntimePlatform = "win32" | "darwin" | "linux" | string;
export type RuntimeTarget = "native" | "flatpak";

/** Speech model v4 (models-v4 release of github.com/Techlm77/NowCaption). */
export const MODEL_DIRECTORY = "nowcaption-fastconformer-en-80ms-cc-by-v4";
export const VESKTOP_FLATPAK_ID = "dev.vencord.Vesktop";

/**
 * Where the model and the sherpa-onnx runtime live.
 * Inside a Flatpak sandbox (FLATPAK_ID is set) and for the installer's "flatpak" target this is the app's own
 * data folder, ~/.var/app/<app id>/data, which the sandbox can always read (it is the sandbox's XDG_DATA_HOME).
 */
export function getRuntimeRoot(options: {
    platform?: RuntimePlatform;
    environment?: Record<string, string | undefined>;
    home?: string;
    target?: RuntimeTarget;
} = {}): string {
    const platform = options.platform ?? process.platform;
    const env = options.environment ?? process.env;
    const home = options.home ?? homedir();
    // target: "native" or "flatpak" for the installer; inside Vesktop it's left out and FLATPAK_ID decides.
    const flatpakId = options.target === "flatpak" ? VESKTOP_FLATPAK_ID
        : options.target !== "native" && platform === "linux" ? env.FLATPAK_ID?.trim() : undefined;
    // Optional override for portable installations. A Flatpak sandbox can't read arbitrary folders, so it isn't used there.
    if (!flatpakId && env.NOWCAPTION_VESKTOP_HOME?.trim()) return resolve(env.NOWCAPTION_VESKTOP_HOME);
    if (flatpakId) return join(home, ".var", "app", flatpakId, "data", "nowcaption-vesktop");
    if (platform === "win32") return join(env.LOCALAPPDATA || join(home, "AppData", "Local"), "NowCaption-Vesktop");
    if (platform === "darwin") return join(home, "Library", "Application Support", "NowCaption-Vesktop");
    return join(env.XDG_DATA_HOME || join(home, ".local", "share"), "nowcaption-vesktop");
}
