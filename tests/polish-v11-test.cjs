const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const ts = require(require.resolve('typescript',{paths:[__dirname,process.env.VENCORD_DIR||path.join(os.homedir(),'Documents/Vencord-source'),process.cwd()]}));
const sourceRoot = path.join(__dirname,'../src/userplugins/nowCaption');
function load(file, stubs={}) {
  const source=fs.readFileSync(path.join(sourceRoot,file),'utf8');
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const m={exports:{}};
  new Function('require','module','exports',js)(name=>{
    if (Object.hasOwn(stubs,name)) return stubs[name];
    throw new Error(`Unexpected dependency ${name}`);
  },m,m.exports);
  return m.exports;
}
const {CaptionStability}=load('core/captionStability.ts');
const {CaptionViewModel}=load('ui/components/captionModel.ts',{'../../core/captionStability':{CaptionStability}});
const presenter = new CaptionViewModel();
const wordList=['Hello','there','Alex','this','is','a','test','of','stable','live','captions','without','jumpy','manual','line','wrapping'];
let whole='';
for(let i=0;i<wordList.length;i++) {
  whole += (i?' ':'')+wordList[i];
  presenter.update(whole,i*120);
  assert.equal(presenter.snapshot().text,whole.toLowerCase());
}
const before=presenter.snapshot();
assert.equal(presenter.update(whole,wordList.length*120+120),false,'unchanged text should not rerender');
assert.deepEqual(presenter.snapshot(),before);
presenter.update(whole+' next',wordList.length*120+300);
assert(presenter.snapshot().text.endsWith('next'),'immediate tail appears without a wait');
const slots=new Map();
const {fallbackName,displayName,likelyName,speakerTitle}=load('ui/identity.ts',{
  '@webpack/common':{UserStore:{getUser:id=>({globalName:id==='987654321012345678'?'Blair':'Other'})}},
  '../core/state':{slots}
});
const a1={id:'A1',instanceKey:1,label:'',verifiedUserId:undefined,sourceKind:'voice'};
const a2={id:'A2',instanceKey:2,label:'',verifiedUserId:undefined,sourceKind:'stream'};
slots.set('A1',a1);slots.set('A2',a2);
assert.equal(fallbackName('A1'),'User 1');
assert.equal(displayName(a1),'User 1');
assert.equal(displayName(a2),'Stream 2');
a1.label='Dalton';
assert.equal(displayName(a1),'Dalton');
a2.linkedVoiceTrackId='A1';a2.linkedVoiceInstanceKey=1;
assert.equal(displayName(a2),"Dalton's Stream",'manual association uses current name');
a2.linkedVoiceInstanceKey=0;
assert.equal(displayName(a2),'Stream 2','never carry a link forward to a reused A1 instance');
a2.verifiedUserId='987654321012345678';
assert.equal(displayName(a2),"Blair's Stream",'verified mapping takes priority');
// A voice-activity guess never becomes the speaker's name; it is only shown marked "likely".
const a3={id:'A3',instanceKey:3,label:'',verifiedUserId:undefined,suggestedUserId:'987654321012345678',sourceKind:'voice'};
assert.equal(displayName(a3),'User 3','a guessed identity is not shown as the name');
assert.equal(likelyName(a3),'Blair');
assert.equal(speakerTitle(a3),'User 3 (likely Blair)');
a3.verifiedUserId='987654321012345678';
assert.equal(displayName(a3),'Blair','verified identity names the speaker');
assert.equal(speakerTitle(a3),'Blair','no "likely" once verified');
const css=fs.readFileSync(path.join(sourceRoot,'ui/styles.css'),'utf8');
const card=fs.readFileSync(path.join(sourceRoot,'ui/components/CaptionCard.ts'),'utf8');
const menu=fs.readFileSync(path.join(sourceRoot,'ui/reactUI.ts'),'utf8');
assert(css.includes('.nc10-card-name{') && css.includes('pointer-events:none'),'speaker name must not block drag');
assert(!card.includes('className:"nc10-edit"'),'unused rename control must be removed');
assert(!card.includes('className:"nc10-verification"'),'no floating identity question-mark on titlebar');
assert(!menu.includes('field("Text updates"'),'hide obsolete steady/immediate setting');
assert(menu.includes('field("Audio type"'),'allow explicitly marking stream audio');
assert(menu.includes('field("Stream belongs to"'),'allow explicit link without false automatic attribution');
console.log('v11/v12 regression: immediate captions, natural wrapping, draggable title, stream labels and stale-link guard: PASS');
