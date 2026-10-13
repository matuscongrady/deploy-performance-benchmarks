import path from 'node:path';
const appName=value=>{if(!/^[a-z][a-z0-9-]{1,28}[a-z0-9]$/.test(value||''))throw Error('Invalid neutral Heroku app name');return value;};
export function herokuPushCommands(plan,mapping,{destination='heroku'}={}) {
  if(!['heroku','github'].includes(destination))throw Error('Choose native Heroku Git or GitHub automatic deployment');
  return mapping.services.filter(s=>s.changed).map(source=>{
    const service=plan.services.find(s=>s.name===source.name);if(!service)throw Error('Source projection has an unbound service');
    let remote,branch;
    if(destination==='heroku'){remote='https://git.heroku.com/'+appName(service.appName)+'.git';branch='refs/heads/main';}
    else{remote=service.githubRemote;branch=service.githubBranch;if(!/^(?:https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?|git@github\.com:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?)$/.test(remote||'')||!/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9/_.-]*$/.test(branch||'')||branch.includes('..'))throw Error('Bind a neutral app-only GitHub repository and branch without credentials');}
    return {name:source.name,nativeCommit:source.nativeCommit,argv:['env','-u','GIT_CURL_VERBOSE','git','-C',path.join(plan.outputDir,source.nativeRepo),'push','--porcelain',remote,source.nativeCommit+':'+branch]};
  });
}
