import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {command} from './lib.mjs';
const [functionName,region='eu-west-1',payload='{}']=process.argv.slice(2);
const dir=await mkdtemp(path.join(os.tmpdir(),'bench-invoke-'));
try {
  if(!functionName) throw Error('Usage: node scripts/invoke-lambda.mjs FUNCTION REGION PAYLOAD_JSON'); JSON.parse(payload);
  const output=path.join(dir,'response.json');
  const response=await command(['aws','lambda','invoke','--function-name',functionName,'--region',region,'--cli-binary-format','raw-in-base64-out','--payload',payload,output],{timeoutMs:60000});
  if(response.exitCode!==0) throw Error('AWS Lambda invocation failed');
  const meta=JSON.parse(response.stdout); if(meta.FunctionError) throw Error('Lambda returned '+meta.FunctionError);
  const result=JSON.parse(await readFile(output,'utf8')); console.log(JSON.stringify(result));
} catch(e){console.error(e.message);process.exitCode=1;} finally {await rm(dir,{recursive:true,force:true});}
