import test from 'node:test';import assert from 'node:assert/strict';
import {withNativeWorkerTools} from './native-tool-input.mjs';
const input={approvalMode:'ask',mcpFromUserConfig:false,toolScope:{allow:['native:Read'],deny:['native:Bash']}};
const task={jobId:'job',lease:{id:'job',token:'own-lease'}};
test('native tool binding adds only the fixed relay alias while preserving native restrictions',()=>{
  const bound=withNativeWorkerTools({input,controller:{origin:'https://controller'},task});
  assert.deepEqual(bound.toolScope,{allow:['native:Read','mcp:worker_apps:*'],deny:['native:Bash']});
  assert.deepEqual(input.toolScope.allow,['native:Read']);
  const proxy=bound.integrations.custom.worker_apps;
  assert.equal(proxy.command,process.execPath);assert.ok(proxy.args[0].endsWith('worker-tool-proxy.mjs'));
  assert.equal(JSON.parse(proxy.env.OMB_WORKER_TOOL_TOKEN_BINDING).jobId,'job');
  assert.equal(JSON.stringify(proxy.args).includes('own-lease'),false);
});
test('native tool binding rejects conflicting proxy settings and unconfined modes',()=>{
  for(const value of [{...input,approvalMode:'full'},{...input,mcpFromUserConfig:true},{...input,toolScope:{allow:['invalid']}},
    {...input,integrations:{custom:{worker_apps:{command:'foreign'}}}}])
    assert.throws(()=>withNativeWorkerTools({input:value,controller:{},task}),/Trusted/);
});
