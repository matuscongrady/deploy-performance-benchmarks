# cdk recipe

This file shows the native commands and configuration for lambda-25. The comparison runner still supplies a reviewed app identity, cache policy and runtime probes. The example resource names are stable across this workload's CLI and Git branches. Setup, dependency installation and cleanup are outside the timed update. Do not run a deployment before the campaign is approved.

- cd deployment/cdk
- npm ci --prefix ../../providers/tools/cdk
- npm ci --ignore-scripts --prefix ../../fixtures/lambdas
- node ../../providers/link-tools.mjs . ../../providers/tools/cdk cdk ../../fixtures/lambdas
- node ../../providers/package-cdk.mjs ../../providers/tools/cdk
- ../../providers/tools/cdk/node_modules/.bin/cdk deploy --require-approval never --outputs-file native-outputs.json
- Fast update: ../../providers/tools/cdk/node_modules/.bin/cdk deploy --hotswap --require-approval never --outputs-file native-outputs.json
- Cleanup: ../../providers/tools/cdk/node_modules/.bin/cdk destroy --force

The complete ZIP bridges and post-build probe are explained in [provider setup](../../docs/provider-setup.md). A successful command is not a qualified result.
