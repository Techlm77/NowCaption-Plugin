const fs = require('node:fs');const path = require('node:path');const os = require('node:os');
const ts = require(require.resolve('typescript', {paths:[__dirname,process.env.VENCORD_DIR || path.join(os.homedir(),'Documents/Vencord-source'),process.cwd()]}));
function scan(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(x=>x.isDirectory()?scan(path.join(dir,x.name)):x.name.endsWith('.ts')?[path.join(dir,x.name)]:[])}
let bad=0;
for(const file of scan(path.join(__dirname,'src'))){
 const source=fs.readFileSync(file,'utf8');
 const result=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,isolatedModules:true},fileName:file,reportDiagnostics:true});
 const errs=result.diagnostics.filter(x=>x.category===ts.DiagnosticCategory.Error);
 for(const err of errs){console.log(path.relative(__dirname,file),ts.flattenDiagnosticMessageText(err.messageText,'\n'));bad++;}
 if(file.endsWith('workerSource.ts')){
  const content=source;
  // run Node syntax test on the eval string without importing the actual ONNX dependency.
  const match=content.match(/String\.raw`([\s\S]*?)`/);
  if(!match){ console.error('worker source not available');bad++;}
  else try{ new Function(match[1]); }catch(e){console.error('worker JS syntax',e);bad++;}
 }
}
console.log('Transpiled and checked',scan(path.join(__dirname,'src')).length,'TypeScript files. Errors:',bad);process.exit(bad?1:0);
