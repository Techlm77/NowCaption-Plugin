const fs=require('node:fs');
const path=require('node:path');
const {Worker}=require('node:worker_threads');
const assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'../src/userplugins/nowCaption/workerSource.ts'),'utf8');
const match=src.match(/String\.raw`([\s\S]*?)`/);
assert.ok(match,'worker string exists');
const worker=new Worker(match[1],{eval:true,workerData:{addonEntry:path.join(__dirname,'mock-sherpa.cjs'),model:'/tmp/fake-model'}});
let ready=false,ack=false,caption=false,stats=false,finished=false;
const timeout=setTimeout(()=>{console.error('Worker test timed out');void worker.terminate();process.exitCode=1;},4000);
worker.on('message',message=>{
  if(message.type==='fatal') throw Error(message.error);
  if(message.type==='ready'){
    ready=true;
    worker.postMessage({type:'add',track:'A1'});
    const pcm=new Float32Array(640);
    worker.postMessage({type:'feed',track:'A1',seq:1,samples:pcm.buffer},[pcm.buffer]);
    worker.postMessage({type:'stats'});
  }
  if(message.type==='caption') caption=true;
  if(message.type==='ack'){
    assert.equal(message.seq,1);
    assert.equal(message.track,'A1');
    assert.ok(Number.isFinite(message.processedMs));
    ack=true;
  }
  if(message.type==='metrics'){
    assert.equal(message.activeStreams,1);
    assert.equal(message.decodedBlocks,1);
    assert.ok(message.heapMiB>=0);
    assert.ok(message.cpuPercentOneCore===null || Number.isFinite(message.cpuPercentOneCore));
    stats=true;
  }
  if(!finished&&ready&&ack&&caption&&stats){
    finished=true;clearTimeout(timeout);
    console.log('Worker messaging and metrics: PASS');
    void worker.terminate();
  }
});
worker.on('error',e=>{clearTimeout(timeout);console.error(e);process.exitCode=1;});
