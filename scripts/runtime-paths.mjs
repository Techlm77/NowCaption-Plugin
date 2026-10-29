/* Runtime-path policy for the installer scripts. Keep in sync with
 * src/userplugins/nowCaption/engine/runtimePaths.ts (tests/runtime-parity.cjs checks that they agree).
 */
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Speech model v4 (models-v4 release of github.com/Techlm77/NowCaption). */
export const MODEL_DIRECTORY = "nowcaption-fastconformer-en-80ms-cc-by-v4";
export const VESKTOP_FLATPAK_ID = "dev.vencord.Vesktop";

export function getRuntimeRoot({ platform = process.platform, environment = process.env, home = homedir(), target } = {}) {
    // target: "native" or "flatpak" for the installer; inside Vesktop it's left out and FLATPAK_ID decides.
    const flatpakId = target === "flatpak" ? VESKTOP_FLATPAK_ID
        : target !== "native" && platform === "linux" ? environment.FLATPAK_ID?.trim() : undefined;
    if (!flatpakId && environment.NOWCAPTION_VESKTOP_HOME?.trim()) return resolve(environment.NOWCAPTION_VESKTOP_HOME);
    if (flatpakId) return join(home, ".var", "app", flatpakId, "data", "nowcaption-vesktop");
    if (platform === "win32") return join(environment.LOCALAPPDATA || join(home, "AppData", "Local"), "NowCaption-Vesktop");
    if (platform === "darwin") return join(home, "Library", "Application Support", "NowCaption-Vesktop");
    return join(environment.XDG_DATA_HOME || join(home, ".local", "share"), "nowcaption-vesktop");
}
