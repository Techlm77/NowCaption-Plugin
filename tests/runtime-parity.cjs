const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const os=require('node:os');
const ts=require(require.resolve('typescript',{paths:[__dirname,process.env.VENCORD_DIR||path.join(os.homedir(),'Documents','Vencord-source'),process.cwd()]}));
const pathToCode=path.join(__dirname,'..','src','userplugins','nowCaption','engine','runtimePaths.ts');
const code=ts.transpileModule(fs.readFileSync(pathToCode,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const sandboxModule={exports:{}};
vm.runInNewContext(code,{module:sandboxModule,exports:sandboxModule.exports,require,process,Map});
const result=sandboxModule.exports.getRuntimeRoot;
const portable=fs.readFileSync(path.join(__dirname,'..','scripts','runtime-paths.mjs'),'utf8');
const scenarios=[
 {platform:'linux',environment:{},home:'/home/tester'},
 {platform:'linux',environment:{XDG_DATA_HOME:'/mnt/appdata'},home:'/home/tester'},
 {platform:'darwin',environment:{},home:'/Users/tester'},
 {platform:'win32',environment:{LOCALAPPDATA:'/WinLocal'},home:'/Windows/tester'},
 {platform:'win32',environment:{},home:'/Windows/tester'},
 {platform:'linux',environment:{NOWCAPTION_VESKTOP_HOME:'/portable/NowCaption'},home:'/home/tester'},
 {platform:'linux',environment:{FLATPAK_ID:'dev.vencord.Vesktop',XDG_DATA_HOME:'/home/tester/.var/app/dev.vencord.Vesktop/data'},home:'/home/tester'},
 {platform:'linux',environment:{},home:'/home/tester',target:'flatpak'},
 {platform:'linux',environment:{NOWCAPTION_VESKTOP_HOME:'/portable/NowCaption'},home:'/home/tester',target:'flatpak'},
 {platform:'linux',environment:{FLATPAK_ID:'org.example.Terminal'},home:'/home/tester',target:'native'}
];
(async()=>{
 const m=await import('../scripts/runtime-paths.mjs');
 for (const scenario of scenarios) assert.equal(result(scenario),m.getRuntimeRoot(scenario),JSON.stringify(scenario));
 assert.equal(sandboxModule.exports.MODEL_DIRECTORY,m.MODEL_DIRECTORY);
 console.log('Native and installer runtime-path policies match: PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
