import {appendFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repository='S-Adnan-11/palmsteeze';
const productionURL='https://palmsteeze.devs.surf';
const task='record:production';
type RecordInput={revision:string;deploymentId:string;verified:boolean};
type Deployment={id:number;sha:string;task:string;environment:string;payload?:{vercelDeploymentId?:string}};
type Status={state:string;environment_url:string};

export function validateDeploymentRecord(input:RecordInput) {
  if(input.verified!==true) throw new Error('Verify the current Vercel Production source and deployment ID before recording it.');
  if(!/^[a-f0-9]{40}$/.test(input.revision)) throw new Error('Use the full deployed commit SHA, not a branch name.');
  if(!/^dpl_[a-zA-Z0-9_-]{1,120}$/.test(input.deploymentId)) throw new Error('Supply the verified Vercel deployment ID.');
  return input;
}

// Records an existing, operator-verified release. This module never calls a
// hosting publish endpoint and never treats a health response as SHA evidence.
export async function recordProductionDeployment(input:RecordInput,options:{token:string;fetcher?:typeof fetch;runURL?:string}) {
  validateDeploymentRecord(input);
  if(!options.token) throw new Error('A GitHub token with deployment write permission is required.');
  const fetcher=options.fetcher||fetch;
  const health=await fetcher(productionURL,{redirect:'error',signal:AbortSignal.timeout(20000)});
  if(health.status!==200||!(await health.text()).includes('PalmSteeze')) throw new Error('The canonical production homepage is not healthy; no deployment record was written.');
  async function github<T>(route:string,method='GET',body?:unknown):Promise<T> {
    const response=await fetcher(`https://api.github.com/repos/${repository}${route}`,{
      method,headers:{Authorization:`Bearer ${options.token}`,Accept:'application/vnd.github+json','User-Agent':'PalmSteeze-deployment-record',...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000),
    });
    if(!response.ok) throw new Error(`GitHub deployment recording returned HTTP ${response.status}; credentials and response details withheld.`);
    return response.json() as Promise<T>;
  }
  const comparison=await github<{status:string}>(`/compare/${input.revision}...main`);
  if(!['ahead','identical'].includes(comparison.status)) throw new Error('The deployed revision must belong to main history.');
  const deployments=await github<Deployment[]>(`/deployments?sha=${input.revision}&environment=production&per_page=100`);
  let deployment=deployments.find(d=>d.task===task&&d.sha===input.revision&&d.environment==='production'&&d.payload?.vercelDeploymentId===input.deploymentId);
  if(!deployment) deployment=await github<Deployment>('/deployments','POST',{
    ref:input.revision,task,auto_merge:false,required_contexts:[],environment:'production',production_environment:true,transient_environment:false,
    description:'Record an existing Vercel Production release; no publishing performed.',
    payload:{provider:'Vercel',vercelDeploymentId:input.deploymentId,sourceVerification:'operator-confirmed',operation:'record-existing'},
  });
  if(!Number.isSafeInteger(deployment.id)||deployment.id<1||deployment.sha!==input.revision) throw new Error('GitHub returned an unexpected deployment record.');
  const statuses=await github<Status[]>(`/deployments/${deployment.id}/statuses?per_page=1`);
  const alreadyRecorded=statuses[0]?.state==='success'&&statuses[0]?.environment_url===productionURL;
  const runURL=options.runURL&&/^https:\/\/github\.com\/S-Adnan-11\/palmsteeze\/actions\/runs\/\d+$/.test(options.runURL)
    ?options.runURL:`https://github.com/${repository}/commit/${input.revision}`;
  if(!alreadyRecorded) await github(`/deployments/${deployment.id}/statuses`,'POST',{
    state:'success',environment_url:productionURL,log_url:runURL,
    description:'Existing Vercel release: operator verified source; canonical HTTPS health checked.',auto_inactive:true,
  });
  return {deploymentRecord:deployment.id,revision:input.revision,vercelDeploymentId:input.deploymentId,productionURL,alreadyRecorded,published:false};
}

async function main() {
  if(process.env.GITHUB_REPOSITORY&&process.env.GITHUB_REPOSITORY!==repository) throw new Error('This recorder targets only the PalmSteeze repository.');
  if(process.env.GITHUB_ACTIONS==='true'&&(process.env.GITHUB_EVENT_NAME!=='workflow_dispatch'||process.env.GITHUB_REF!=='refs/heads/main')) throw new Error('Run this manual recorder from main.');
  const result=await recordProductionDeployment({revision:process.env.DEPLOYED_REVISION||'',deploymentId:process.env.VERCEL_DEPLOYMENT_ID||'',verified:process.env.PRODUCTION_VERIFIED==='true'},
    {token:process.env.GH_TOKEN||process.env.GITHUB_TOKEN||'',runURL:process.env.GITHUB_RUN_ID?`https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`:undefined});
  console.log(JSON.stringify(result));
  if(process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,`### Recorded existing production release\n\nSource: ${result.revision}\n\n[Open production](${result.productionURL}) · Vercel ${result.vercelDeploymentId}\n\nThis workflow records an operator-verified release. It does not publish the application.\n`);
}
if(resolve(process.argv[1]||'')===fileURLToPath(import.meta.url)) void main().catch(error=>{console.error(error instanceof Error?error.message:'Deployment recording failed.');process.exitCode=1;});
