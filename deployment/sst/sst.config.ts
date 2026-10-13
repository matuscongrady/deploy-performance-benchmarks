/// <reference path="./.sst/platform/config.d.ts" />
export default $config({
 app() { return { name:"bench-commerce-lambda-25",home:'aws',removal:'remove',providers:{aws:{region:"eu-west-1"}}}; },
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
 const f_product_search = new sst.aws.Function("product-search", {handler:"../../fixtures/lambdas/handlers/product-search.handler",runtime:'nodejs22.x',memory:'512 MB',timeout:'30 seconds',nodejs:{install:[]}});
 functions["product-search"]=f_product_search.arn;
 const f_category_list = new sst.aws.Function("category-list", {handler:"../../fixtures/lambdas/handlers/category-list.handler",runtime:'nodejs22.x',memory:'512 MB',timeout:'30 seconds',nodejs:{install:[]}});
 functions["category-list"]=f_category_list.arn;
 const f_inventory_check = new sst.aws.Function("inventory-check", {handler:"../../fixtures/lambdas/handlers/inventory-check.handler",runtime:'nodejs22.x',memory:'512 MB',timeout:'30 seconds',nodejs:{install:[]}});
 functions["inventory-check"]=f_inventory_check.arn;
 const f_reserve_stock = new sst.aws.Function("reserve-stock", {handler:"../../fixtures/lambdas/handlers/reserve-stock.handler",runtime:'nodejs22.x',memory:'512 MB',timeout:'30 seconds',nodejs:{install:[]}});
 functions["reserve-stock"]=f_reserve_stock.arn;
 const f_release_stock = new sst.aws.Function("release-stock", {handler:"../../fixtures/lambdas/handlers/release-stock.handler",runtime:'nodejs22.x',memory:'512 MB',timeout:'30 seconds',nodejs:{install:[]}});
 functions["release-stock"]=f_release_stock.arn;
 const f_shipping_quote = new sst.aws.Function("shipping-quote", {handler:"../../fixtures/lambdas/handlers/shipping-quote.handler",runtime:'nodejs22.x',memory:'512 MB',timeout:'30 seconds',nodejs:{install:[]}});
 functions["shipping-quote"]=f_shipping_quote.arn;
 const f_tax_quote = new sst.aws.Function("tax-quote", {handler:"../../fixtures/lambdas/handlers/tax-quote.handler",runtime:'nodejs22.x',memory:'512 MB',timeout:'30 seconds',nodejs:{install:[]}});
 functions["tax-quote"]=f_tax_quote.arn;
 const f_apply_discount = new sst.aws.Function("apply-discount", {handler:"../../fixtures/lambdas/handlers/apply-discount.handler",runtime:'nodejs22.x',memory:'512 MB',timeout:'30 seconds',nodejs:{install:[]}});
 functions["apply-discount"]=f_apply_discount.arn;
 const f_payment_intent = new sst.aws.Function("payment-intent", {handler:"../../fixtures/lambdas/handlers/payment-intent.handler",runtime:'nodejs22.x',memory:'512 MB',timeout:'30 seconds',nodejs:{install:[]}});
 functions["payment-intent"]=f_payment_intent.arn;
 const f_payment_webhook = new sst.aws.Function("payment-webhook", {handler:"../../fixtures/lambdas/handlers/payment-webhook.handler",runtime:'nodejs22.x',memory:'512 MB',timeout:'30 seconds',nodejs:{install:[]}});
 functions["payment-webhook"]=f_payment_webhook.arn;
 const f_order_status = new sst.aws.Function("order-status", {handler:"../../fixtures/lambdas/handlers/order-status.handler",runtime:'nodejs22.x',memory:'512 MB',timeout:'30 seconds',nodejs:{install:[]}});
 functions["order-status"]=f_order_status.arn;
 const f_cancel_order = new sst.aws.Function("cancel-order", {handler:"../../fixtures/lambdas/handlers/cancel-order.handler",runtime:'nodejs22.x',memory:'512 MB',timeout:'30 seconds',nodejs:{install:[]}});
 functions["cancel-order"]=f_cancel_order.arn;
 const f_return_request = new sst.aws.Function("return-request", {handler:"../../fixtures/lambdas/handlers/return-request.handler",runtime:'nodejs22.x',memory:'512 MB',timeout:'30 seconds',nodejs:{install:[]}});
 functions["return-request"]=f_return_request.arn;
 const f_customer_profile = new sst.aws.Function("customer-profile", {handler:"../../fixtures/lambdas/handlers/customer-profile.handler",runtime:'nodejs22.x',memory:'512 MB',timeout:'30 seconds',nodejs:{install:[]}});
 functions["customer-profile"]=f_customer_profile.arn;
 const f_customer_token = new sst.aws.Function("customer-token", {handler:"../../fixtures/lambdas/handlers/customer-token.handler",runtime:'nodejs22.x',memory:'512 MB',timeout:'30 seconds',nodejs:{install:[]}});
 functions["customer-token"]=f_customer_token.arn;
 const f_invoice = new sst.aws.Function("invoice", {handler:"../../fixtures/lambdas/handlers/invoice.handler",runtime:'nodejs22.x',memory:'512 MB',timeout:'30 seconds',nodejs:{install:[]}});
 functions["invoice"]=f_invoice.arn;
 const f_catalog_import = new sst.aws.Function("catalog-import", {handler:"../../fixtures/lambdas/handlers/catalog-import.handler",runtime:'nodejs22.x',memory:'512 MB',timeout:'30 seconds',nodejs:{install:[]}});
 functions["catalog-import"]=f_catalog_import.arn;
 const f_catalog_feed = new sst.aws.Function("catalog-feed", {handler:"../../fixtures/lambdas/handlers/catalog-feed.handler",runtime:'nodejs22.x',memory:'512 MB',timeout:'30 seconds',nodejs:{install:[]}});
 functions["catalog-feed"]=f_catalog_feed.arn;
 const f_daily_summary = new sst.aws.Function("daily-summary", {handler:"../../fixtures/lambdas/handlers/daily-summary.handler",runtime:'nodejs22.x',memory:'512 MB',timeout:'30 seconds',nodejs:{install:[]}});
 functions["daily-summary"]=f_daily_summary.arn;
 const f_shipment_update = new sst.aws.Function("shipment-update", {handler:"../../fixtures/lambdas/handlers/shipment-update.handler",runtime:'nodejs22.x',memory:'512 MB',timeout:'30 seconds',nodejs:{install:[]}});
 functions["shipment-update"]=f_shipment_update.arn;
 return {functions};
 }
});
