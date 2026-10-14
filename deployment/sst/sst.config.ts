/// <reference path="./.sst/platform/config.d.ts" />
export default $config({
 app() { return { name:"bench-commerce-lambda-1",home:'aws',removal:'remove',providers:{aws:{region:"eu-west-1"}}}; },
 async run() {
 const functions = {};
 const f_report = new sst.aws.Function("report", {handler:"../../fixtures/lambdas/handlers/report.handler",runtime:'nodejs22.x',memory:'512 MB',timeout:'30 seconds',nodejs:{install:["pdfkit"]}});
 functions["report"]=f_report.arn;
 return {functions};
 }
});
