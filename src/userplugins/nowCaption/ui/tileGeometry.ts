/** Three complete caption rows, positioned completely inside a Discord tile.
 * Returns undefined if the tile cannot fit the configured text size.
 * Do not use a forced minimum width that would overflow a narrow tile.
 */
import type { TileRect } from "./voiceTiles";

export const TILE_ROWS = 3;
export const TILE_TOP_INSET = 8;
export const TILE_SIDE_INSET = 8;
export const TILE_BOTTOM_NAME_RESERVE = 34; // only a minimum safety margin, captions appear at top
export const TILE_TEXT_PAD_Y = 8; // CSS: 4px padding top + 4px bottom; no border
export function tileCaptionRect(tile: TileRect, fontSize: number, viewportWidth: number, viewportHeight: number): TileRect | undefined {
    const line = Math.ceil(fontSize * 1.55);
    const height = TILE_ROWS * line + TILE_TEXT_PAD_Y;
    const left = Math.max(tile.left + TILE_SIDE_INSET, TILE_SIDE_INSET);
    const right = Math.min(tile.left + tile.width - TILE_SIDE_INSET, viewportWidth - TILE_SIDE_INSET);
    const x = Math.ceil(left);
    const top = Math.max(Math.ceil(tile.top + TILE_TOP_INSET), TILE_TOP_INSET);
    const width = Math.floor(right) - x;
    const bottom = Math.min(tile.top + tile.height - TILE_BOTTOM_NAME_RESERVE, viewportHeight - TILE_SIDE_INSET);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 80 ||
        top + height > Math.floor(bottom)) return undefined;
    return { left: x, top, width, height };
}
