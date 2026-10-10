/// <reference path="./.sst/platform/config.d.ts" />
export default $config({app(){return {name:"bench-commerce-python",home:'aws',removal:'remove',providers:{aws:{region:"eu-west-1"}}}},async run(){const vpc=new sst.aws.Vpc('Vpc');const cluster=new sst.aws.Cluster('Cluster',{vpc});const outputs={clusterArn:cluster.nodes.cluster.arn};
const api=new sst.aws.Service("api",{cluster,image:{context:"../../fixtures/containers/python",dockerfile:'Dockerfile.sst'},cpu:'0.25 vCPU',memory:'0.5 GB',environment:{PORT:'3000'},loadBalancer:{rules:[{listen:'80/http',forward:'3000/http'}],health:{'3000/http':{path:'/version'}}},wait:false});outputs["api"]={url:api.url,serviceArn:api.nodes.service.arn};
return outputs;}});
