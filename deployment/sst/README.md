# sst recipe

This file shows the native commands and configuration for lambda-1. The comparison runner still supplies a reviewed app identity, cache policy and runtime probes. The example resource names are stable across this workload's CLI and Git branches. Setup, dependency installation and cleanup are outside the timed update. Do not run a deployment before the campaign is approved.

- cd deployment/sst
- npm ci --prefix ../../providers/tools/sst
- npm ci --ignore-scripts --prefix ../../fixtures/lambdas
- node ../../providers/link-tools.mjs . ../../providers/tools/sst sst ../../fixtures/lambdas
- node ../../providers/install-sst-bridge.mjs
- SST_PACKAGE_ENCRYPTION_KEY must be supplied through the environment before packaging.
- node ../../providers/package-sst.mjs ../..
- ../../providers/tools/sst/node_modules/.bin/sst deploy --stage bench
- Fast update: ../../providers/tools/sst/node_modules/.bin/sst deploy --stage bench
- Cleanup: ../../providers/tools/sst/node_modules/.bin/sst remove --stage bench

The complete ZIP bridges and post-build probe are explained in [provider setup](../../docs/provider-setup.md). A successful command is not a qualified result.
