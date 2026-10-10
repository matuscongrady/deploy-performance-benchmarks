# serverless recipe

This file shows the native commands and configuration for lambda-25. The comparison runner still supplies a reviewed app identity, cache policy and runtime probes. The example resource names are stable across this workload's CLI and Git branches. Setup, dependency installation and cleanup are outside the timed update. Do not run a deployment before the campaign is approved.

- Run these commands from the repository root.
- npm ci --ignore-scripts
- npm ci --prefix providers/tools/serverless
- node providers/link-tools.mjs . providers/tools/serverless serverless .
- providers/tools/serverless/node_modules/.bin/serverless package --stage bench --region eu-west-1
- Initial setup: providers/tools/serverless/node_modules/.bin/serverless deploy --stage bench --region eu-west-1
- Fast update: node providers/parallel-functions.mjs providers/tools/serverless/node_modules/.bin/serverless bench eu-west-1 report product-lookup cart-pricing create-order notification product-search category-list inventory-check reserve-stock release-stock shipping-quote tax-quote apply-discount payment-intent payment-webhook order-status cancel-order return-request customer-profile customer-token invoice catalog-import catalog-feed daily-summary shipment-update
- Cleanup: providers/tools/serverless/node_modules/.bin/serverless remove --stage bench --region eu-west-1

The complete ZIP bridges and post-build probe are explained in [provider setup](../../docs/provider-setup.md). A successful command is not a qualified result.
