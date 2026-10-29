const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const os=require('node:os');
const ts=require(require.resolve('typescript',{paths:[__dirname,process.env.VENCORD_DIR || path.join(os.homedir(),'Documents/Vencord-source'),process.cwd()]}));
const src=fs.readFileSync(path.join(__dirname,'../src/userplugins/nowCaption/audio/voiceIdentity.ts'),'utf8');
const compiled=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const slots=new Map(), events=[];
let now=5000, members={}, mapping={};
const alpha='123456789012345678',beta='987654321098765432';
let onExit=null;
const stubs={
 '@webpack/common':{SelectedChannelStore:undefined,VoiceStateStore:undefined},
 '@webpack':{findByProps:(name)=> {
   if(name==='getUserIdBySsrc')return{getUserIdBySsrc:(ssrc)=>mapping[ssrc]};
   if(name==='getVoiceChannelId')return{getVoiceChannelId:()=> 'voice1'};
   if(name==='getVoiceStatesForChannel')return{getVoiceStatesForChannel:()=>members};
 }},
 '../core/diagnostics':{info:(...a)=>events.push(a),debug:()=>{},warn:()=>{}},
 '../core/state':{slots},
 '../core/speakerProfiles':{loadVerifiedProfile:()=>undefined}
};
const m={exports:{}};
const context={module:m,exports:m.exports,require:(name)=>stubs[name],Map,Set,Number,Object,performance:{now:()=>now}};
vm.runInNewContext(compiled,context);
const id=m.exports;
const receiver=(ssrc)=>({getStats:async()=>new Map([['1',{type:'inbound-rtp',kind:'audio',ssrc}]])});
slots.set('A1',{id:'A1',track:{readyState:'live'},receiver:receiver(11),userId:'',label:'Dalton',verifiedUserId:undefined});
(async()=>{
 await id.probeIdentities();
 assert.equal(slots.get('A1').verifiedUserId,undefined,'must NOT guess based on A1 / join order');
 now+=3000;
 mapping[11]=beta;
 await id.probeIdentities();
 assert.equal(slots.get('A1').verifiedUserId,undefined,'must confirm voice membership');
 now+=3000;
 members={[beta]:{userId:beta}};
 await id.probeIdentities();
 assert.equal(slots.get('A1').verifiedUserId,beta,'must map via SSRC + membership');
 assert.equal(slots.get('A1').label,'','stale Dalton label must not remain on Blair');
 assert.ok(events.some(e=>e[1]==='verified'));
 assert.equal(slots.get('A1').identityStatus,'verified');
 id.setVerifiedMemberLeftCallback(slot=>{onExit=slot;});
 members={[alpha]:{userId:alpha}}; // another person remains in VC
 for(let i=0;i<5;i++) {now+=3000;await id.probeIdentities();}
 assert.equal(onExit,slots.get('A1'),'verified user left: cleanup callback invoked');
 console.log('Speaker identification (no join-order guesses, membership guard): PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
