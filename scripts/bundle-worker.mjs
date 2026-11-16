import {build} from 'esbuild';
import {mkdirSync,copyFileSync,writeFileSync,readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {serverLocalePlugin} from './server-locale-plugin.mjs';
const root=join(dirname(fileURLToPath(import.meta.url)),'..'),output=join(root,'dist-worker');
mkdirSync(output,{recursive:true});
const yaml={name:'worker-yaml-esm',setup(build){build.onResolve({filter:/^yaml$/},()=>({path:join(root,'node_modules','yaml','browser','index.js')}));}};
await build({entryPoints:[join(root,'server','workers','native-bootstrap.mjs')],outfile:join(output,'native-bootstrap.mjs'),
  bundle:true,platform:'node',target:'node24',format:'esm',plugins:[yaml,serverLocalePlugin],
  banner:{js:'import {createRequire as __ombWorkerRequire} from "node:module"; const require=__ombWorkerRequire(import.meta.url);'},logLevel:'info'});
const files=['worker-tool-proxy.mjs','worker-mcp-bridge.mjs','worker-mcp-stdio.mjs','runtime-preflight.mjs','runtime-probe-server.mjs','service-storage.mjs','service-entry.mjs','service-health.mjs','worker-process.mjs','process-client.mjs','service-host.mjs','service-execution.mjs','linux-service-supervisor.mjs',
  'service-transport.mjs','worker-client.mjs','worker-assignment.mjs','provider-runner.mjs','event-wire.mjs','tls-request.mjs','transport-address.mjs'];
for(const file of files)copyFileSync(join(root,'server','workers',file),join(output,file));
const names=['native-bootstrap.mjs',...files];
const manifest={version:1,nodeMajor:24,providers:['claudeAgent','codex'],files:names.map(file=>{
  const bytes=readFileSync(join(output,file));return{path:file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
}),credentialsIncluded:false,providerCliIncluded:false,serviceEntrypointIncluded:true,productionReady:false};
writeFileSync(join(output,'package.json'),JSON.stringify({type:'module',private:true})+'\n');
writeFileSync(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
