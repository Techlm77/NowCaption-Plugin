import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const src=join(dirname(fileURLToPath(import.meta.url)),'..','src','userplugins','nowCaption');
const index=await readFile(join(src,'index.ts'),'utf8');
const capture=await readFile(join(src,'audio','capture.ts'),'utf8');
const pattern=/new (?:window\.|globalThis\.)?RTCPeerConnection\(/g;
for(const origin of ['new RTCPeerConnection(config)','new window.RTCPeerConnection(config)','new globalThis.RTCPeerConnection(config)']){
 const changed=origin.replace(pattern,'new $self.ScopedPeerConnection(');
 assert(changed.includes('ScopedPeerConnection('));
}
assert(!'new MyRTCPeerConnection(config)'.replace(pattern,'').includes('ScopedPeerConnection'));
assert.match(index,/get ScopedPeerConnection/);
assert.match(index,/enableLegacyCapture/);
assert.match(capture,/observeScopedConnection/);
assert.match(capture,/observationEnabled = false/);
console.log('Scoped RTC patch: synthetic syntax-match tests pass. Actual Discord bundle match NOT verified.');
