/* Pure recognition-hypothesis stability regression tests (no network/ONNX/Discord). */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const os=require('node:os');
const ts=require(require.resolve('typescript',{paths:[__dirname,process.env.VENCORD_DIR || path.join(os.homedir(),'Documents/Vencord-source'),process.cwd()]}));
const src=fs.readFileSync(path.join(__dirname,'../src/userplugins/nowCaption/core/captionStability.ts'),'utf8');
const js=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const ctx={module:{exports:{}},exports:{}};ctx.exports=ctx.module.exports;
vm.runInNewContext(js,ctx);const {CaptionStability}=ctx.module.exports;

const model=new CaptionStability();
let displayed='';
let pending='';
function update(text,t,mode='steady'){
  const r=model.update(text,t,mode);
  assert.equal(typeof r.append,'string');
  assert.equal(typeof r.draft,'string');
  displayed+=r.append;
  pending=r.draft;
  assert.ok(!displayed.includes('  '),'confirmed words are well-formed');
  return r;
}
update('H',0);
assert.equal(pending,'','a live incomplete word should not flicker letter by letter');
update('He',120);
assert.equal(pending,'');
update('Hello',240);
assert.equal(pending,'');
update('Hello world',360);
assert.equal(pending,'Hello');
update('Hello world now',480);
assert.equal(pending,'Hello world');
update('Hello world now coming',600);
assert.equal(displayed,'Hello ');
assert.equal(pending,'world now');
// Revise only unsettled words: committed history must remain unchanged.
update('Hello world now becomes',720);
assert.equal(displayed,'Hello world ');
update('Hello world now becomes clear',840);
assert.equal(displayed,'Hello world ');
let r=update('Hello world now becomes clear',1800);
assert.equal(r.draft,'clear');
assert.equal(displayed,'Hello world now becomes ');
assert.equal(r.append,'now becomes ');
// Display refreshes without new speech must not append duplicate text.
r=update('Hello world now becomes clear',1980);
assert.equal(r.append,'');
assert.equal(displayed,'Hello world now becomes ');
// A paused partial word may later grow: it should not split a finalized word.
let grown=update('Hello world now becomes clearer',2050);
assert.equal(grown.reset,false);
assert.equal(displayed,'Hello world now becomes ');
// Reset if the model starts an entirely new transcript.
r=update('A fresh stream of words',2100);
assert.equal(r.reset,true);
assert.equal(r.append,'');
const immediate=new CaptionStability();
assert.equal(immediate.update('Wo',0,'immediate').draft,'Wo');
assert.equal(immediate.update('World',120,'immediate').draft,'World');
// Simulate 20 minutes of a growing transcript; stable confirmed words stay incremental.
const long=new CaptionStability();let source='', confirmed=0;
for(let i=0;i<1000;i++){
  source+=`word${i} `;
  const d=long.update(source,i*120,'steady');
  confirmed+=d.append.length;
  assert.ok(confirmed<=source.length);
  assert.equal(d.reset,false);
}
console.log('PASS: stable prefix, live draft, idle settle, reset, immediate option, 1000 updates');
