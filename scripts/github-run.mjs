// Read-only observer for this repository's deployment workflow, keyed by pushed SHA.
import {command} from './lib.mjs';
const [repository,sourceCommit]=process.argv.slice(2);
if(!/^[\w.-]+\/[\w.-]+$/.test(repository||'')||!/^[a-f0-9]{40}$/.test(sourceCommit||''))throw Error('Usage: node scripts/github-run.mjs OWNER/REPO FULL_PUSHED_SHA');
const r=await command(['gh','api',`repos/${repository}/actions/workflows/deploy-benchmark.yml/runs?head_sha=${sourceCommit}&per_page=20`]);
if(r.exitCode!==0){process.stderr.write(r.stderr);process.exit(r.exitCode||1);}
const runs=JSON.parse(r.stdout).workflow_runs.filter(r=>r.head_sha===sourceCommit).sort((a,b)=>b.id-a.id);
const run=runs[0];
const status=!run||run.status!=='completed'?'pending':run.conclusion==='success'?'succeeded':run.conclusion==='cancelled'?'cancelled':'failed';
console.log(JSON.stringify({sourceCommit,status,runId:run?.id,url:run?.html_url,conclusion:run?.conclusion}));
