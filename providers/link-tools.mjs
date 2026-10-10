import {mkdir,symlink,lstat,readdir,readFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
const [project,toolRoot,provider,sourceArg]=process.argv.slice(2);
if(!project || !toolRoot) throw new Error('Usage: node providers/link-tools.mjs PROJECT TOOL_ROOT PROVIDER [SOURCE_ROOT]');
async function link(target,source){if(resolve(target)===resolve(source))return;await mkdir(dirname(target),{recursive:true});if(!(await lstat(target).catch(()=>null)))await symlink(source,target);}
const source=sourceArg?resolve(sourceArg):join(resolve(project),'app');
const root=join(resolve(project),'node_modules');
await mkdir(root,{recursive:true});
for(const entry of await readdir(join(resolve(toolRoot),'node_modules')))if(entry!=='.bin')await link(join(root,entry),join(resolve(toolRoot),'node_modules',entry));
const pkg=await readFile(join(source,'package.json'),'utf8').then(JSON.parse,()=>null);
for(const dep of Object.keys(pkg?.dependencies || {}))await link(join(root,dep),join(source,'node_modules',dep));
if(provider==='cdk'){
 const deps=join(source,'node_modules');
 await link(join(deps,'esbuild'),join(resolve(toolRoot),'node_modules/esbuild'));
 await link(join(deps,'.bin/esbuild'),join(resolve(toolRoot),'node_modules/.bin/esbuild'));
}
