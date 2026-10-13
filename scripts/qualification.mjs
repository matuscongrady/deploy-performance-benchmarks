import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {root,json} from './lib.mjs';
import {needsSstRollout,validateSstRolloutBindings} from './sst-rollout.mjs';
import {validateBuildQualification,verifyBuildQualificationEvidence} from './build-timing.mjs';
function contains(actual,expected) {if(Array.isArray(expected))return Array.isArray(actual)&&actual.length===expected.length&&expected.every((v,i)=>contains(actual[i],v));if(expected&&typeof expected==='object')return actual&&Object.entries(expected).every(([k,v])=>contains(actual[k],v));return actual===expected;}
export async function checkQualification(q,scenario,provider,{sourceBound=false}={}) {
  validateBuildQualification(q,scenario,provider);
  await verifyBuildQualificationEvidence(q,{base:root});
  if(q.scenario!==scenario.id||q.provider!==provider||q.approved!==true)throw Error('A matching reviewed qualification file is required');
  if(!q.toolVersion?.reported||!q.cacheEvidence?.series||!q.environment?.region)throw Error('Qualification must record actual version, cache series and region');
  if(provider==='candidate'&&(!/^[a-f0-9]{64}$/.test(q.toolVersion.sha256||'')||!q.toolVersion.source))throw Error('The candidate needs its exact executable hash and source reference');
  if(!Array.isArray(q.qualificationEvidence)||!q.qualificationEvidence.length)throw Error('Qualification needs saved native artifact/readiness evidence');
  if(scenario.kind==='package') {
    if(scenario.fixture.startsWith('lambda-')) {
      const m=await json(path.join(root,'fixtures/manifest.json'));const names=m.lambda.workloads.find(w=>w.id===scenario.fixture).functions;const a=q.artifacts;
      if(!a||a.qualified!==true||a.format!=='lambda-zip'||a.functionCount!==names.length||!Array.isArray(a.files))throw Error('Packaging qualification needs every selected function ZIP');
      const functions=a.files.filter(f=>(f.role||'function')==='function');if(functions.length!==names.length||names.some(name=>functions.filter(f=>f.name===name).length!==1))throw Error('Packaging qualification is missing selected function ZIPs');
      if(functions.some(f=>!/^[\w./-]+\.[\w$]+$/.test(f.handler||'')||!/^[\w./-]+\.(mjs|cjs|js)$/.test(f.module||'')))throw Error('Every qualified ZIP needs its actual runtime handler and module filename');
      const maps=a.files.filter(f=>f.role==='source-map');
      if(a.files.some(f=>!['function','layer','source-map'].includes(f.role||'function'))||maps.some(f=>f.uploadedSeparately!==true||!names.includes(f.name))||new Set(maps.map(f=>f.name)).size!==maps.length)throw Error('Auxiliary source maps must be separate native uploads for selected functions');
      if(provider==='sst'&&(maps.length!==names.length||names.some(name=>!maps.some(f=>f.name===name))))throw Error('SST qualification must include every separately uploaded native source map');
    } else {
      const a=q.artifacts;
      if(!a||a.qualified!==true||!['oci-compressed','heroku-slug','provider-native'].includes(a.format))throw Error('Container packaging needs a qualified native artifact format');
      if(a.format==='oci-compressed'&&(!Array.isArray(a.images)||a.images.length!==1||a.images[0].name!=='api'||!a.nativeBuild||Boolean(a.nativeBuild.file)===Boolean(a.nativeBuild.argv)))throw Error('Container packaging needs exactly the selected API image and one native identity producer');
      if(a.format==='heroku-slug'&&(provider!=='heroku'||!Array.isArray(a.files)||a.files.length!==1||a.files[0].name!=='api'))throw Error('Slug qualification needs the selected Heroku API artifact');
      if(a.format==='provider-native'&&(!['render','ravion','heroku'].includes(provider)||a.name!=='api'||a.sizeAvailable!==false))throw Error('Time-only packaging qualification needs the selected managed API and unavailable size');
      if(a.format==='provider-native') {
        const m=await json(path.join(root,'fixtures/manifest.json')),expected=m.containers.find(c=>c.id==='container-'+scenario.fixture).businessProbe.expected;
        if(!contains(a.businessExpected,expected)||typeof a.businessExpected?.revision!=='string'||!a.businessExpected.revision)throw Error('Time-only packaging needs the full API business assertion and current source revision');
      }
    }
  }
  if(scenario.kind==='deploy') {
    if(needsSstRollout(scenario,provider))validateSstRolloutBindings(q);
    if(scenario.fixture==='five-services'&&(!Array.isArray(q.componentSnapshots)||q.componentSnapshots.length!==5))throw Error('Five native deployment/artifact/configuration snapshots are required');
    const m=await json(path.join(root,'fixtures/manifest.json'));
    const components=scenario.fixture.startsWith('lambda-')?m.lambda.functions.filter(f=>m.lambda.workloads.find(w=>w.id===scenario.fixture).functions.includes(f.name)).map(f=>({name:f.name,expected:f.probe.expected})):scenario.fixture==='five-services'?m.fiveServices.services.map(s=>({name:s.name,expected:s.businessProbe.expected})):[{name:'api',expected:m.containers.find(c=>c.id==='container-'+scenario.fixture).businessProbe.expected}];
    for(const list of ['baselineProbes','probes']) {
      if(!Array.isArray(q[list])||q[list].length!==components.length)throw Error('Every component needs a '+list+' business probe');
      for(const c of components){const found=q[list].filter(p=>p.name===c.name);if(found.length!==1||!contains(found[0].expected,c.expected)||typeof found[0].expected.revision!=='string')throw Error('Missing full business/revision assertion for '+c.name+' in '+list);}
    }
    // Execution binds revisions to current source; historical result imports retain their recorded source.
    if(sourceBound) {
    const sourceComponents=scenario.fixture.startsWith('lambda-')?m.lambda.functions.filter(f=>components.some(c=>c.name===f.name)):scenario.fixture==='five-services'?m.fiveServices.services:[{name:'api',...m.containers.find(c=>c.id==='container-'+scenario.fixture)}];
    for(const c of sourceComponents) {
      const text=await readFile(path.join(root,c.revisionFile),'utf8');
      const revision=text.match(/(?:revision|REVISION)\s*=\s*(['"])([a-z0-9-]+)\1/)?.[2];
      if(!revision||q.probes.find(p=>p.name===c.name).expected.revision!==revision)throw Error('Updated probe revision differs from the selected source: '+c.name);
    }
    }
    for(const c of components) {const before=q.baselineProbes.find(p=>p.name===c.name),after=q.probes.find(p=>p.name===c.name);const changed=scenario.fixture!=='five-services'||m.fiveServices.changedServices.includes(c.name);if(changed=== (before.expected.revision===after.expected.revision))throw Error('Incorrect changed/unchanged revision for '+c.name);}
  }
}
