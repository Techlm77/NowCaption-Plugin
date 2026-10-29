// v19: SSRC lookups scoped to the track's own connection, fail-closed re-checks, receiver reuse,
// colour reset, one-time fallback lookups, manual tile re-checks, and stream/voice cards that don't overlap.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const base=path.join(__dirname,'../src/userplugins/nowCaption');
let clock=10000;
function load(file,stubs,globals={}) {
    const js=ts.transpileModule(fs.readFileSync(path.join(base,file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
    const m={exports:{}};
    vm.runInNewContext(js,{module:m,exports:m.exports,require:x=>{if(x in stubs)return stubs[x];throw Error(`Missing stub ${x}`);},
        performance:{now:()=>clock},Set,Map,Number,Object,Array,Math,WeakMap,...globals});
    return m.exports;
}
const alex='123456789012345678',blair='987654321098765432',casey='555555555555555555';
const pcVoice={name:'voice pc'},pcStream={name:'stream pc'},pcUnknown={name:'unlisted pc'};
let voiceMap={42:alex},streamMap={42:blair};
let streamMapsEveryone=false;
const voiceConnection={context:'default',destroyed:false,transport:{pc:pcVoice},getUserIdBySsrc:s=>voiceMap[s]};
const streamConnection={context:'stream',streamUserId:blair,destroyed:false,rtc:{peer:pcStream},
    getUserIdBySsrc:s=>streamMapsEveryone?blair:streamMap[s]};
let legacyLookups=0;
const slots=new Map(),events=[];
let members={[alex]:{userId:alex},[blair]:{userId:blair},[casey]:{userId:casey}};
const identity=load('audio/voiceIdentity.ts',{
    '@webpack':{findByProps:name=>{if(name==='getUserIdBySsrc'){legacyLookups++;return null;}return null;}},
    '@webpack/common':{MediaEngineStore:{getMediaEngine:()=>({connections:[voiceConnection,streamConnection]})},
        SelectedChannelStore:{getVoiceChannelId:()=> 'voice'},VoiceStateStore:{getVoiceStatesForChannel:()=>members}},
    '../core/diagnostics':{info:(...a)=>events.push(a),debug(){},warn(){}},
    '../core/state':{slots,peers:new Set([pcVoice,pcStream])},
    '../core/speakerProfiles':{loadVerifiedProfile:()=>undefined}
});

// Scoped: the connection that owns the track's RTCPeerConnection decides, whatever the track's label says.
let r=identity.mapAudioSsrc(42,'voice',pcStream);
assert.equal(r.scoped,true);assert.equal(r.userId,blair,'Go Live audio labelled as voice is looked up on its own connection');
r=identity.mapAudioSsrc(42,'voice',pcVoice);
assert.equal(r.userId,alex);assert.equal(r.ambiguous,false);
// Unscoped: the same SSRC number owned by someone else on a Go Live connection can't be attributed.
r=identity.mapAudioSsrc(42,'voice',pcUnknown);
assert.equal(r.scoped,false);assert.equal(r.ambiguous,true,'SSRC collision across connections is ambiguous');
streamMapsEveryone=true;
r=identity.mapAudioSsrc(42,'voice',pcUnknown);
assert.equal(r.userId,alex,'a Go Live connection that reports its streamer for any SSRC is ignored');
assert.equal(r.ambiguous,false);
streamMapsEveryone=false;
identity.mapAudioSsrc(77,'voice');identity.mapAudioSsrc(78,'voice');identity.mapAudioSsrc(79,'stream');
assert.equal(legacyLookups,1,'a missing legacy module is looked up once, not on every probe');

// Verification and re-checks.
let statsSsrcs=[42],syncSources=[];
const changed=[];
identity.setSpeakerChangedCallback(s=>changed.push(s.id));
const receiver={getStats:async()=>new Map(statsSsrcs.map((ssrc,i)=>[String(i),{type:'inbound-rtp',kind:'audio',ssrc}])),
    getSynchronizationSources:()=>syncSources};
const slot={id:'A1',instanceKey:1,pc:pcVoice,track:{readyState:'live'},receiver,userId:'',label:'',sourceKind:'voice'};
slots.set('A1',slot);
(async()=>{
    await identity.probeIdentities();
    assert.equal(slot.verifiedUserId,alex,'verified through its own connection');
    slot.color='#ff0000'; // e.g. from Alex's saved profile
    // Stats can list an old SSRC as well; during a pause (nothing played lately) the verified one stands.
    statsSsrcs=[42,43];syncSources=[];
    for(let i=0;i<3;i++){clock+=3000;await identity.probeIdentities();}
    assert.equal(slot.verifiedUserId,alex,'a pause with stale stats keeps the verified name (no flapping)');
    assert.equal(changed.length,0);
    // Two sources actually playing on one verified receiver: fail closed.
    syncSources=[{source:42,timestamp:3},{source:43,timestamp:2}];clock+=3000;
    await identity.probeIdentities();
    assert.equal(slot.verifiedUserId,undefined,'two audio SSRCs playing on a verified receiver fail closed');
    assert.equal(slot.identityStatus,'multiple_audio_ssrc');
    assert.equal(slot.color,undefined,"the previous person's colour doesn't carry over");
    assert.deepEqual(changed,['A1'],'captions and placement are reset for a possible new speaker');
    assert.equal(slot.identityEpoch,1);
    // Stats can keep an old SSRC; if only one was played in the last few seconds, that one counts.
    syncSources=[{source:42,timestamp:5}];clock+=3000;
    await identity.probeIdentities();
    assert.equal(slot.verifiedUserId,alex,'recent playout disambiguates lingering stats');
    // Discord reuses the receiver for Casey: the newest played SSRC changes before the next probe.
    voiceMap[43]=casey;
    syncSources=[{source:42,timestamp:5},{source:43,timestamp:9}];
    identity.checkVerifiedSources();
    assert.equal(slot.verifiedUserId,undefined,'receiver reuse clears the identity on the next tick');
    assert.equal(slot.identityStatus,'ssrc_changed');
    statsSsrcs=[43];syncSources=[{source:43,timestamp:12}];clock+=3000;
    await identity.probeIdentities();
    assert.equal(slot.verifiedUserId,casey,'and the new speaker is verified on the next probe');
    statsSsrcs=[];syncSources=[];clock+=3000;
    await identity.probeIdentities();
    assert.equal(slot.verifiedUserId,casey,'no inbound audio: nothing can be misattributed, keep the identity');
    assert.equal(slot.identityEpoch,2,'receiver reuse also starts the captions again');

    // Go Live audio arrives without a "screen share" label, so it starts as "voice". Only a Go Live connection knows
    // its SSRC: it is Blair's stream, not his microphone, and his real microphone must still verify afterwards.
    streamMap[61]=blair;voiceMap[62]=blair;
    const game={id:'A6',instanceKey:6,pc:pcStream,track:{readyState:'live'},receiver:{getStats:async()=>new Map([['g',{type:'inbound-rtp',kind:'audio',ssrc:61}]]),getSynchronizationSources:()=>[]},userId:'',label:'',sourceKind:'voice'};
    const mic={id:'A7',instanceKey:7,pc:pcVoice,track:{readyState:'live'},receiver:{getStats:async()=>new Map([['m',{type:'inbound-rtp',kind:'audio',ssrc:62}]]),getSynchronizationSources:()=>[]},userId:'',label:'',sourceKind:'voice'};
    slots.set('A6',game);clock+=3000;
    await identity.probeIdentities();
    assert.equal(game.verifiedUserId,blair);
    assert.equal(game.sourceKind,'stream','Go Live audio is classified as stream audio by its connection');
    assert.equal(game.sourceKindOrigin,'connection');
    slots.set('A7',mic);clock+=3000;
    await identity.probeIdentities();
    assert.equal(mic.verifiedUserId,blair,"Blair's microphone verifies too (not identity_already_in_use)");
    assert.equal(mic.sourceKind,'voice');
    // Unscoped (the connection's peer can't be found): the same rule applies.
    const game2={id:'A8',instanceKey:8,pc:pcUnknown,track:{readyState:'live'},receiver:{getStats:async()=>new Map([['h',{type:'inbound-rtp',kind:'audio',ssrc:63}]]),getSynchronizationSources:()=>[]},userId:'',label:'',sourceKind:'voice'};
    streamMap[63]=casey;slots.set('A8',game2);clock+=3000;
    await identity.probeIdentities();
    assert.equal(game2.sourceKind,'stream');assert.equal(game2.verifiedUserId,casey);
    // A track someone marked as voice by hand is not silently reclassified.
    const manual={id:'A9',instanceKey:9,pc:pcStream,track:{readyState:'live'},receiver:{getStats:async()=>new Map([['k',{type:'inbound-rtp',kind:'audio',ssrc:64}]]),getSynchronizationSources:()=>[]},userId:'',label:'',sourceKind:'voice',sourceKindOrigin:'manual'};
    streamMap[64]=alex;slots.set('A9',manual);clock+=3000;
    await identity.probeIdentities();
    assert.equal(manual.verifiedUserId,undefined);assert.equal(manual.identityStatus,'stream_audio_marked_as_voice');
    for(const id of ['A6','A7','A8','A9'])slots.delete(id);

    // Tiles: manual bindings and stream/voice placement.
    class Tile {
        constructor(className,left,id){this.className=className;this.rect={left,top:90,width:320,height:200};this.attrs=id?{'data-user-id':id}:{};this.isConnected=true;this.children=[];this.parentElement=null;}
        getBoundingClientRect(){return this.rect;}
        getClientRects(){return [this.rect];}
        getAttribute(k){return this.attrs[k]??null;}
        closest(){return null;}
    }
    const voiceTile=new Tile('videoTile__voice',20,alex);
    const previewTile=new Tile('streamPreview streamTile',360,alex);
    const focusTile=new Tile('videoTile__focus',700,blair);
    let shown=[voiceTile,previewTile,focusTile];
    const listeners={};
    const tiles=load('ui/voiceTiles.ts',{'@webpack':{findByProps:()=>null},
        '@webpack/common':{SelectedChannelStore:{getVoiceChannelId:()=> 'voice'},VoiceStateStore:{getVoiceStatesForChannel:()=>members}}},
        {document:{querySelectorAll:()=>shown,addEventListener:(n,fn)=>listeners[n]=fn,removeEventListener:(n,fn)=>{if(listeners[n]===fn)delete listeners[n];}},
         innerWidth:1200,innerHeight:800,Element:Tile,setTimeout:()=>1,clearTimeout(){}});
    const voice={id:'A2',instanceKey:2,enabled:true,sourceKind:'voice',verifiedUserId:alex,track:{readyState:'live'}};
    const stream={id:'A3',instanceKey:3,enabled:true,sourceKind:'stream',verifiedUserId:alex,track:{readyState:'live'}};
    assert.equal(tiles.tileForSlot(stream,[stream]).left,20,'stream audio alone uses the speaker tile (v18 behaviour)');
    assert.equal(tiles.tileForSlot(voice,[voice,stream]).left,20);
    assert.equal(tiles.tileForSlot(stream,[voice,stream]).left,360,"with their voice captioned too, stream captions use the stream preview");
    shown=[previewTile,focusTile];clock+=300;
    assert.equal(tiles.tileForSlot(stream,[voice,stream]),undefined,'no separate preview: stream captions float instead of covering voice captions');
    shown=[voiceTile,previewTile,focusTile];clock+=300;

    // A manual pick on the focused tile follows what it shows: if Discord swaps the person, the binding goes.
    const unverified={id:'A4',instanceKey:4,enabled:true,sourceKind:'voice',track:{readyState:'live'}};
    assert(tiles.beginTilePick(unverified,()=>{}));
    listeners.pointerdown({button:0,target:focusTile,preventDefault(){},stopImmediatePropagation(){}});
    assert.equal(tiles.tileForSlot(unverified).left,700,'manual binding attached');
    focusTile.attrs['data-user-id']=casey;clock+=800;
    assert.equal(tiles.tileForSlot(unverified),undefined,'tile now shows someone else: binding dropped');
    focusTile.attrs['data-user-id']=blair;
    // A verified identity outranks a manual pick on a tile that showed nobody identifiable.
    const blank=new Tile('videoTile__blank',40,undefined);blank.rect={left:40,top:400,width:300,height:200};
    shown=[voiceTile,previewTile,focusTile,blank];clock+=300;
    const pick={id:'A5',instanceKey:5,enabled:true,sourceKind:'voice',track:{readyState:'live'}};
    assert(tiles.beginTilePick(pick,()=>{}));
    listeners.pointerdown({button:0,target:blank,preventDefault(){},stopImmediatePropagation(){}});
    assert.equal(tiles.tileForSlot(pick).left,40);
    pick.verifiedUserId=blair;
    assert.equal(tiles.tileForSlot(pick).left,700,"once verified, captions go to the verified person's tile");
    assert.equal(tiles.isManuallyAttached(pick),false);
    console.log('PASS v19: scoped SSRC lookup, fail-closed re-checks, receiver reuse, colour reset, one-time lookups, manual tile re-checks, stream/voice placement');
})().catch(e=>{console.error(e);process.exitCode=1;});
