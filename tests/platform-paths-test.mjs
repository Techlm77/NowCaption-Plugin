import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { getRuntimeRoot, MODEL_DIRECTORY } from "../scripts/runtime-paths.mjs";
const home="/mockhome";
const env={};
assert.equal(getRuntimeRoot({platform:"linux",environment:env,home}),join(home,".local","share","nowcaption-vesktop"));
assert.equal(getRuntimeRoot({platform:"linux",environment:{XDG_DATA_HOME:"/custom/data"},home}),join("/custom/data","nowcaption-vesktop"));
assert.equal(getRuntimeRoot({platform:"darwin",environment:env,home}),join(home,"Library","Application Support","NowCaption-Vesktop"));
assert.equal(getRuntimeRoot({platform:"win32",environment:env,home}),join(home,"AppData","Local","NowCaption-Vesktop"));
assert.equal(getRuntimeRoot({platform:"win32",environment:{LOCALAPPDATA:"/local"},home}),join("/local","NowCaption-Vesktop"));
assert.equal(getRuntimeRoot({platform:"darwin",environment:{NOWCAPTION_VESKTOP_HOME:"/portable/myasr"},home}),resolve("/portable/myasr"));
assert.equal(MODEL_DIRECTORY,"nowcaption-fastconformer-en-80ms-cc-by-v4");
// Flatpak Vesktop (dev.vencord.Vesktop): inside the sandbox FLATPAK_ID is set; the installer uses the "flatpak" target.
// Both must be the app's own data folder, which the sandbox can read, whatever the host's XDG_DATA_HOME says.
const flatpakRoot=join(home,".var","app","dev.vencord.Vesktop","data","nowcaption-vesktop");
assert.equal(getRuntimeRoot({platform:"linux",environment:{FLATPAK_ID:"dev.vencord.Vesktop",XDG_DATA_HOME:join(home,".var","app","dev.vencord.Vesktop","data")},home}),flatpakRoot);
assert.equal(getRuntimeRoot({platform:"linux",environment:{XDG_DATA_HOME:"/custom/data"},home,target:"flatpak"}),flatpakRoot);
assert.equal(getRuntimeRoot({platform:"linux",environment:{NOWCAPTION_VESKTOP_HOME:"/portable/x"},home,target:"flatpak"}),flatpakRoot,"the sandbox can't read a portable override");
assert.equal(getRuntimeRoot({platform:"win32",environment:{FLATPAK_ID:"x"},home}),join(home,"AppData","Local","NowCaption-Vesktop"),"FLATPAK_ID only matters on Linux");
console.log("Cross-platform runtime paths: PASS");
