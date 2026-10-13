#!/usr/bin/env node
// Optional BENCH_NODE runtime for local ZIP probes on a host with another Node major.
import {spawnSync} from 'node:child_process';
import {realpathSync} from 'node:fs';
import {relative,isAbsolute,join} from 'node:path';
const root=realpathSync(process.env.BENCH_ZIP_RUNTIME_ROOT || '');
const cwd=realpathSync(process.cwd()),rel=relative(root,cwd);
if(isAbsolute(rel)||rel==='..'||rel.startsWith('../'))throw Error('ZIP runtime cwd escapes its isolated extraction root');
const image='node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94';
const child=spawnSync('docker',['run','--rm','--network','none','--mount',`type=bind,src=${root},dst=${root},readonly`,'--mount',`type=bind,src=${join(root,'opt')},dst=/opt,readonly`,'--workdir',cwd,'-e','NODE_PATH','-e','LAMBDA_TASK_ROOT',image,'node',...process.argv.slice(2)],{stdio:'inherit'});
if(child.error)throw child.error;process.exitCode=child.status||0;
