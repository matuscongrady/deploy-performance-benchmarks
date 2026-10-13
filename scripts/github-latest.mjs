// Read-only latest workflow observer for predecessor admission, scoped to one provider trial branch.
import {command} from './lib.mjs';
const [repository,branch]=process.argv.slice(2);
if(!/^[\w.-]+\/[\w.-]+$/.test(repository||'')||!/^trial\/[a-z0-9-]+$/.test(branch||''))throw Error('Usage: node scripts/github-latest.mjs OWNER/REPO trial/BRANCH');
const result=await command(['gh','api',`repos/${repository}/actions/workflows/deploy-benchmark.yml/runs?branch=${encodeURIComponent(branch)}&per_page=1`]);
if(result.exitCode!==0){process.stderr.write(result.stderr);process.exit(result.exitCode||1);}
const run=JSON.parse(result.stdout).workflow_runs?.[0];
console.log(JSON.stringify({latest:true,sourceCommit:run?.head_sha,status:!run||run.status!=='completed'?'pending':run.conclusion==='success'?'succeeded':run.conclusion==='cancelled'?'cancelled':'failed',runId:run?.id,runAttempt:run?.run_attempt,finishedAt:run?.updated_at,repository,branch,url:run?.html_url}));
