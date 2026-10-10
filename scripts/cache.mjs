import path from 'node:path';
import {rm,lstat,realpath} from 'node:fs/promises';
import {root,parseArgs,safeId,json,save} from './lib.mjs';
const {positional,flags}=parseArgs(process.argv.slice(2));
try {
 const [provider]=positional;const appId=safeId(flags['app-id'],'application ID');
 const allowed={serverless:['.serverless'],cdk:['cdk.out','package-artifacts'],sst:['.sst/artifacts','package-artifacts']};
 const project=path.join(root,'.work',appId,provider);const resolved=await realpath(project);if(resolved!==project)throw Error('Refusing a linked project directory');
 const paths=provider==='candidate'?(await json(flags.qualification)).cacheControl?.localPaths:allowed[provider];
 if(!Array.isArray(paths)||!paths.length)throw Error('Provider cache paths have not been qualified');
 const observations=[];
 for(const relative of paths){if(typeof relative!=='string'||path.isAbsolute(relative)||relative.split('/').includes('..')||['.','app','node_modules'].includes(relative))throw Error('Unsafe cache path');const target=path.join(project,relative);const info=await lstat(target).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(info?.isSymbolicLink())throw Error('Refusing a linked cache');if(info){const resolvedTarget=await realpath(target);if(path.relative(resolved,resolvedTarget).startsWith('..'))throw Error('Cache path leaves the owned project');}if(info)await rm(target,{recursive:true,force:false});observations.push({path:relative,existed:Boolean(info),removed:!await lstat(target).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;})});}
 const record={provider,appId,resetAt:new Date().toISOString(),paths:observations,dependenciesRetained:true,remoteCachesCleared:false,dockerCacheCleared:false};const file=path.join(root,'.work',appId,provider,'cache-reset.json');await save(file,record);console.log(JSON.stringify(record,null,2));
}catch(e){console.error(e.message);process.exitCode=1;}
