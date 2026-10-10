# cdk recipe

This file shows the native commands and configuration for node. The comparison runner still supplies a reviewed app identity, cache policy and runtime probes. The example resource names are stable across this workload's CLI and Git branches. Setup, dependency installation and cleanup are outside the timed update. Do not run a deployment before the campaign is approved.

- cd deployment/cdk
- npm ci --prefix ../../providers/tools/cdk
- node ../../providers/link-tools.mjs . ../../providers/tools/cdk cdk
- ../../providers/tools/cdk/node_modules/.bin/cdk deploy --require-approval never --outputs-file native-outputs.json
- Fast update: ../../providers/tools/cdk/node_modules/.bin/cdk deploy --hotswap --require-approval never --outputs-file native-outputs.json
- Cleanup: ../../providers/tools/cdk/node_modules/.bin/cdk destroy --force

Native builder and artifact-size qualification are explained in [provider setup](../../docs/provider-setup.md). A successful command is not a qualified result.
