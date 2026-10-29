/* Only a verified Discord user ID can key a durable speaker profile.
 * Never save a manual A1/A2 guess as a verified profile.
 */
import type { Layout } from "./types";

const PROFILE_KEY = "nowcaption-private-verified-speakers-v7";
export interface VerifiedProfile { color?: string; label?: string; layout?: Partial<Layout>; }
function all(): Record<string, VerifiedProfile> {
    try {
        const data = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}");
        return data && typeof data === "object" && !Array.isArray(data) ? data : {};
    } catch { return {}; }
}
export function loadVerifiedProfile(userId: string): VerifiedProfile | undefined {
    return /^\d{15,22}$/.test(userId) ? all()[userId] : undefined;
}
export function saveVerifiedProfile(userId: string, patch: Partial<VerifiedProfile>) {
    if (!/^\d{15,22}$/.test(userId)) return;
    try {
        const existing = all();
        existing[userId] = { ...existing[userId], ...patch,
            layout: patch.layout ? {...existing[userId]?.layout, ...patch.layout} : existing[userId]?.layout };
        localStorage.setItem(PROFILE_KEY, JSON.stringify(existing));
    } catch { /* optional storage */ }
}
