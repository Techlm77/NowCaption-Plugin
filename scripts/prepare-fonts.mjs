#!/usr/bin/env node
/* Download a small verified font pack into a local GENERATED TypeScript module.
 * No bundled font binaries are included in the distribution ZIP.
 * Assets come from official upstream repositories and are SIL OFL-licensed.
 * SHA-1 below is Git blob hash ("blob <n>\0" + content), pinned to actual upstream bytes.
 * Optional cache permits repeat local builds without redownloading.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const pluginDir = resolve(process.argv[2] || "");
if (!process.argv[2]) { console.error("Usage: node scripts/prepare-fonts.mjs PLUGIN_FOLDER"); process.exit(2); }
const cacheDir = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "nowcaption-vesktop", "font-assets-v1");
// Pinned upstream commits (verified 2026-10-29), so an upstream edit can't break fresh installs.
const g = "https://raw.githubusercontent.com/google/fonts/58466038e19d5a14053e0c9f863715e74af0fe0e/ofl";
const d = "https://raw.githubusercontent.com/antijingoist/opendyslexic/1824da5c0e41dc3e13ffc7f3a636dcaf695d61b7";
const files = [
  { key:"atkinson", family:"NowCaption Atkinson", weight:"100 900", style:"normal", mime:"font/ttf", name:"AtkinsonNext.ttf", url:`${g}/atkinsonhyperlegiblenext/AtkinsonHyperlegibleNext%5Bwght%5D.ttf`, sha:"92a357554bdcca62a7e80d5e3724bf4eb8932e5e" },
  { key:"lexend", family:"NowCaption Lexend", weight:"100 900", style:"normal", mime:"font/ttf", name:"Lexend.ttf", url:`${g}/lexend/Lexend%5Bwght%5D.ttf`, sha:"f70999106bfa76d48051b73ad7c888573663879c" },
  { key:"opendyslexic", family:"NowCaption OpenDyslexic", weight:"400", style:"normal", mime:"font/woff2", name:"OpenDyslexic-Regular.woff2", url:`${d}/compiled/OpenDyslexic-Regular.woff2`, sha:"4ee220be7e9b551ad100468bd08ba35f6f9fe2f8" },
  { key:"opendyslexic", family:"NowCaption OpenDyslexic", weight:"700", style:"normal", mime:"font/woff2", name:"OpenDyslexic-Bold.woff2", url:`${d}/compiled/OpenDyslexic-Bold.woff2`, sha:"b5fd5e4f4b0977495d39bb3220096aef50120e31" }
];
const licenses = [
  {name:"AtkinsonNext-OFL.txt", url:`${g}/atkinsonhyperlegiblenext/OFL.txt`, sha:"88955733b80000358ef3e5521f3369b276e066a9"},
  {name:"Lexend-OFL.txt", url:`${g}/lexend/OFL.txt`, sha:"b1477aae6210797999bd5ad9c13bcae5fc98788b"},
  {name:"OpenDyslexic-OFL.txt", url:`${d}/OFL.txt`, sha:"bb867823f2408fb8d2b3af5cb118b4bc0cd61972"}
];
function gitBlobSha(bytes) {
  return createHash("sha1").update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest("hex");
}
function validFont(bytes, filename) {
  if (bytes.length < 1000 || bytes.length > 1024 * 1024) return false;
  return filename.endsWith(".woff2")
    ? bytes.subarray(0,4).toString("ascii")==="wOF2"
    : (bytes.subarray(0,4).toString("ascii")==="OTTO" || bytes.readUInt32BE(0)===0x00010000);
}
async function get({url,sha,name}, font=false) {
  const path = join(cacheDir,name);
  try {
    const b = await readFile(path);
    if ((!sha || gitBlobSha(b)===sha) && (!font || validFont(b,name))) return b;
  } catch { /* download */ }
  for (let attempt=1;attempt<=2;attempt++) {
    try {
      const response = await fetch(url, {signal:AbortSignal.timeout(30000)});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (Number(response.headers.get("content-length")) > 1024*1024) throw new Error("Asset unexpectedly large");
      const b=Buffer.from(await response.arrayBuffer());
      if (b.length > 1024*1024) throw new Error("Asset unexpectedly large");
      if (sha && gitBlobSha(b)!==sha) throw new Error("Git blob integrity mismatch: "+name);
      if (font && !validFont(b,name)) throw new Error("Downloaded content is not a valid font header: "+name);
      if (!font && !b.toString("utf8").includes("SIL OPEN FONT LICENSE")) throw new Error("Unexpected font license file");
      await writeFile(path,b);
      return b;
    } catch(e) {
      // Node's fetch only says "fetch failed"; the cause names the DNS, certificate or proxy problem.
      const cause = e?.cause?.code || e?.cause?.message;
      if (attempt===2) throw new Error(`${name}: ${String(e?.message||e)}${cause ? ` (${cause})` : ""}`);
    }
  }
  throw new Error(`Unable to retrieve ${name}`);
}
const fontAssets=[];
try {
  await mkdir(cacheDir,{recursive:true});
  for (const font of files) {
    const data = await get(font,true);
    fontAssets.push({key:font.key,family:font.family,weight:font.weight,style:font.style,mime:font.mime,dataBase64:data.toString("base64")});
    console.log(`Verified ${font.name} (${Math.round(data.length/1024)} KiB)`);
  }
  const licensesDir=join(pluginDir,"font-licenses");
  await mkdir(licensesDir,{recursive:true});
  for (const license of licenses) {
    const content=await get(license,false);
    await writeFile(join(licensesDir,license.name),content);
  }
  const output=join(pluginDir,"core/fontAssets.generated.ts");
  await writeFile(output,
    `/* Auto-generated locally; do not commit. Fonts and licenses: font-licenses/. */\n` +
    `export interface EmbeddedFontAsset { key:string; family:string; weight:string; style:string; mime:string; dataBase64:string; }\n` +
    `export const embeddedFontAssets: EmbeddedFontAsset[] = ${JSON.stringify(fontAssets)};\n`
  );
  console.log("Font pack ready: 3 families, 4 faces, licensed and embedded for offline caption display.");
} catch (e) {
  console.error("Font download/validation failed:", e.message);
  console.error("Your current Vencord build has not been replaced. Check your connection and retry.");
  process.exitCode=1;
}
