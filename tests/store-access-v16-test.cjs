const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const ts=require('typescript');
const base=path.join(__dirname,'../src/userplugins/nowCaption');
let clock=5000;
function load(file,stubs,globals={}){
 const src=fs.readFileSync(path.join(base,file),'utf8');
 const js=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const m={exports:{}};
 vm.runInNewContext(js,{module:m,exports:m.exports,require:id=>{if(id in stubs)return stubs[id];throw Error(`unexpected: ${id}`);},performance:{now:()=>clock},Object,Set,Map,Number,Math,...globals});
 return m.exports;
}
const uid='123456789012345678';
const voiceChannel='100';
const selected={getVoiceChannelId:()=>voiceChannel};
const states={getVoiceStatesForChannel:()=>({[uid]:{userId:uid}})};
const moduleLookup=()=>{throw Error('Simulated unavailable Discord module lookup');};
const reactStores={SelectedChannelStore:selected,VoiceStateStore:states,UserStore:{getCurrentUser:()=>({id:'999999999999999999'})}};
const tile={getAttribute:key=>key==='data-user-id'?uid:null,
 querySelectorAll:()=>[],children:[],getBoundingClientRect:()=>({left:30,top:70,width:280,height:240}),getClientRects:()=>[{}],closest:()=>null};
const tiles=load('ui/voiceTiles.ts',{'@webpack':{findByProps:moduleLookup},'@webpack/common':reactStores},{document:{querySelectorAll:()=>[tile]},innerWidth:1200,innerHeight:800});
assert.equal(tiles.voiceTileRects().get(uid).width,280,'the stable Vencord stores bypass failing dynamic lookup');
const events=[];
const slots=new Map();
const speaker=load('audio/voiceIdentity.ts',{
 '@webpack':{findByProps:name=>name==='getUserIdBySsrc'?{getUserIdBySsrc:()=>uid}:moduleLookup()},
 '@webpack/common':reactStores,
 '../core/diagnostics':{info:(...v)=>events.push(v),warn:()=>{}},
 '../core/state':{slots},'../core/speakerProfiles':{loadVerifiedProfile:()=>undefined}
});
const slot={id:'A1',track:{readyState:'live'},receiver:{getStats:async()=>new Map([[1,{type:'inbound-rtp',kind:'audio',ssrc:87}]])},label:'',userId:''};
slots.set('A1',slot);
(async()=>{await speaker.probeIdentities();assert.equal(slot.verifiedUserId,uid,'identity verification works with registered stores');console.log('PASS: v16 registered Discord stores recover identity and tile lookup when dynamic findByProps throws');})().catch(e=>{console.error(e);process.exitCode=1});
