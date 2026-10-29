#!/usr/bin/env node
/* Create a type-safe placeholder for local builds before font downloading.
 * This is never used instead of the real verified font bundle by the updater.
 */
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const here=dirname(fileURLToPath(import.meta.url));
const file=resolve(here,"..","src","userplugins","nowCaption","core","fontAssets.generated.ts");
try { await access(file); }
catch {
    await mkdir(dirname(file), {recursive:true});
    await writeFile(file, `/* Placeholder. Locally generated; do not commit. */\nexport interface EmbeddedFontAsset { key:string; family:string; weight:string; style:string; mime:string; dataBase64:string; }\nexport const embeddedFontAssets: EmbeddedFontAsset[] = [];\n`);
    console.log("Created empty local font manifest for type checking.");
}
