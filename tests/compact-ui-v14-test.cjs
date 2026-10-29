const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const ts=require(require.resolve('typescript',{paths:[__dirname,process.env.VENCORD_DIR||path.join(os.homedir(),'Documents/Vencord-source'),process.cwd()]}));
const source=path.join(__dirname,'../src/userplugins/nowCaption');
function load(file,stubs){
    const js=ts.transpileModule(fs.readFileSync(path.join(source,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const m={exports:{}};
    new Function('module','exports','require',js)(m,m.exports,id=>{
        if(id in stubs)return stubs[id];throw Error(`Unexpected import: ${id}`);
    });
    return m.exports;
}
const card=load('ui/components/CaptionCard.ts',{
  '@webpack/common':{React:{createElement:()=>{}}},'../../core/state':{runtime:{},MAX_CAPTIONED:4},
  '../../core/diagnostics':{},'../../core/settings':{clamp:()=>{},fontStack:()=>{},layouts:()=>{},preferences:{},saveLayout:()=>{}},
  '../../core/speakerProfiles':{},'../identity':{displayName:()=>''},'./captionModel':{CaptionViewModel:class{}},'../tileGeometry':{tileCaptionRect:()=>undefined}
});
assert.equal(card.FRAME_HEIGHT,26,'tab, borders and bottom breathing room preserve complete text rows');
for(const size of [12,15,20,30]){
    const line=card.rowPx(size);
    for(const height of [65,101,145,222,333]){
        const snap=card.rowSnappedHeight(height,size);
        assert.equal((snap-card.FRAME_HEIGHT)%line,0,'height must snap to whole caption lines');
        assert(snap>=card.FRAME_HEIGHT+2*line,'at least two caption lines');
    }
}
const css=fs.readFileSync(path.join(source,'ui/styles.css'),'utf8');
const jsx=fs.readFileSync(path.join(source,'ui/components/CaptionCard.ts'),'utf8');
assert(css.includes('width:max-content;max-width:min(300px, calc(100% - 54px))'),'tab width must follow name, not full card');
assert(css.includes('.nc14-card-surface{position:absolute;top:21px'),'caption surface must start beneath tab');
assert(css.includes('.nc14-voice-activity i:nth-child(2)'),'voice activity icon must have static bars');
assert(css.includes(':focus-within .nc14-card-actions'),'edit and close need keyboard access');
assert(css.includes('@media(hover:none)'),'touch users need visible controls');
assert(jsx.includes('className:"nc14-card-surface"'),'body must be separate from title tab');
assert(jsx.includes('className:"nc14-voice-activity"'),'tab must contain signal icon');
assert(jsx.includes('className:"nc10-paragraph"'),'caption transcript still one continuous paragraph');
assert(jsx.includes('onPointerDown:(e:any)=>{'),'drag pointer handling must remain');
assert(jsx.includes('onPointerMove:(e:any)=>{'),'row-aligned resize must remain');
console.log('PASS: compact stepped card, text-row sizing, accessible hover/touch controls, voice indicator');
