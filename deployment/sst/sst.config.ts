/// <reference path="./.sst/platform/config.d.ts" />
export default $config({
 app() { return { name:"bench-commerce-lambda-5",home:'aws',removal:'remove',providers:{aws:{region:"eu-west-1"}}}; },
 async run() {
 const functions = {};
 const f_report = new sst.aws.Function("report", {handler:"../../fixtures/lambdas/handlers/report.handler",runtime:'nodejs22.x',memory:'512 MB',timeout:'30 seconds',nodejs:{install:["pdfkit"]}});
 functions["report"]=f_report.arn;
 const f_product_lookup = new sst.aws.Function("product-lookup", {handler:"../../fixtures/lambdas/handlers/product-lookup.handler",runtime:'nodejs22.x',memory:'512 MB',timeout:'30 seconds',nodejs:{install:[]}});
 functions["product-lookup"]=f_product_lookup.arn;
 const f_cart_pricing = new sst.aws.Function("cart-pricing", {handler:"../../fixtures/lambdas/handlers/cart-pricing.handler",runtime:'nodejs22.x',memory:'512 MB',timeout:'30 seconds',nodejs:{install:[]}});
 functions["cart-pricing"]=f_cart_pricing.arn;
 const f_create_order = new sst.aws.Function("create-order", {handler:"../../fixtures/lambdas/handlers/create-order.handler",runtime:'nodejs22.x',memory:'512 MB',timeout:'30 seconds',nodejs:{install:[]}});
 functions["create-order"]=f_create_order.arn;
 const f_notification = new sst.aws.Function("notification", {handler:"../../fixtures/lambdas/handlers/notification.handler",runtime:'nodejs22.x',memory:'512 MB',timeout:'30 seconds',nodejs:{install:[]}});
 functions["notification"]=f_notification.arn;
 return {functions};
 }
});
