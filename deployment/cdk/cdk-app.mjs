import {App,Stack,CfnOutput,Duration} from 'aws-cdk-lib';
import {Runtime} from 'aws-cdk-lib/aws-lambda';
import {NodejsFunction} from 'aws-cdk-lib/aws-lambda-nodejs';
import {resolve} from 'node:path';
const app=new App(); const stack=new Stack(app,"bench-commerce-lambda-1", {env:{region:"eu-west-1"}});
const f_report=new NodejsFunction(stack,"report",{entry:resolve("../../fixtures/lambdas/handlers/report.mjs"),handler:'handler',depsLockFilePath:resolve('../../fixtures/lambdas/package-lock.json'),projectRoot:resolve('../../fixtures/lambdas'),runtime:Runtime.NODEJS_22_X,functionName:"bench-commerce-lambda-1-bench-report",memorySize:512,timeout:Duration.seconds(30),bundling:{minify:true,sourceMap:false,nodeModules:["pdfkit","exceljs","docx"]}});
new CfnOutput(stack,"reportArn",{value:f_report.functionArn});
app.synth();
