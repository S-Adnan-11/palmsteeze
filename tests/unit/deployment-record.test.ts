import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recordProductionDeployment,validateDeploymentRecord} from '../../scripts/record-production-deployment';

const revision='a'.repeat(40);
const input={revision,deploymentId:'dpl_fixture',verified:true};
const deployment={id:12,sha:revision,task:'record:production',environment:'production',payload:{vercelDeploymentId:input.deploymentId}};
const productionURL='https://palmsteeze.devs.surf';

test('deployment records require explicit source verification and exact provider identifiers',()=>{
  for(const invalid of [{...input,verified:false},{...input,revision:'main'},{...input,revision:'A'.repeat(40)},{...input,deploymentId:'https://untrusted.example'},{...input,deploymentId:'dpl_fixture\n'}]) assert.throws(()=>validateDeploymentRecord(invalid));
  assert.deepEqual(validateDeploymentRecord(input),input);
});

test('unhealthy production or a revision outside main cannot write a deployment record',async()=>{
  let writes=0;
  const unhealthy:typeof fetch=async()=>new Response('Unavailable',{status:503});
  await assert.rejects(recordProductionDeployment(input,{token:'fixture',fetcher:unhealthy}),/not healthy/);
  const diverged:typeof fetch=async(url,init)=>{
    if(init?.method==='POST') writes++;
    return String(url)===productionURL?new Response('PalmSteeze'):Response.json({status:'diverged'});
  };
  await assert.rejects(recordProductionDeployment(input,{token:'fixture',fetcher:diverged}),/main history/);
  assert.equal(writes,0);
});

test('recording uses the verified deployed SHA and never sends a hosting publish request',async()=>{
  const posts:{url:string;body:Record<string,unknown>}[]=[];
  const fetcher:typeof fetch=async(url,init)=>{
    const value=String(url);
    assert.ok(value===productionURL||value.startsWith('https://api.github.com/repos/S-Adnan-11/palmsteeze/'));
    if(value===productionURL) return new Response('PalmSteeze');
    if(init?.method==='POST') {
      posts.push({url:value,body:JSON.parse(String(init.body))});
      return Response.json(value.endsWith('/deployments')?deployment:{state:'success'});
    }
    if(value.includes('/compare/')) return Response.json({status:'ahead'});
    return Response.json([]);
  };
  const result=await recordProductionDeployment(input,{token:'fixture',fetcher});
  assert.equal(result.published,false);assert.equal(result.revision,revision);
  assert.equal(posts.length,2);assert.equal(posts[0].body.ref,revision);
  assert.equal(posts[0].body.task,'record:production');assert.equal(posts[0].body.auto_merge,false);
  assert.deepEqual(posts[0].body.required_contexts,[]);
  assert.equal(posts[1].body.environment_url,productionURL);assert.equal(posts[1].body.state,'success');
});

test('recording an already successful provider deployment creates no duplicate records or statuses',async()=>{
  const fetcher:typeof fetch=async(url,init)=>{
    assert.notEqual(init?.method,'POST');
    const value=String(url);
    if(value===productionURL) return new Response('PalmSteeze');
    if(value.includes('/compare/')) return Response.json({status:'identical'});
    if(value.includes('/statuses')) return Response.json([{state:'success',environment_url:productionURL}]);
    return Response.json([deployment]);
  };
  const result=await recordProductionDeployment(input,{token:'fixture',fetcher});
  assert.equal(result.alreadyRecorded,true);assert.equal(result.deploymentRecord,12);
});

test('GitHub refusal stops recording without reflecting credentials or response bodies',async()=>{
  const fetcher:typeof fetch=async url=>String(url)===productionURL?new Response('PalmSteeze'):new Response('fixture-sensitive-detail',{status:403});
  await assert.rejects(recordProductionDeployment(input,{token:'fixture-sensitive-token',fetcher}),error=>{
    assert.ok(error instanceof Error);assert.match(error.message,/HTTP 403/);
    assert.doesNotMatch(error.message,/fixture-sensitive/);return true;
  });
});
