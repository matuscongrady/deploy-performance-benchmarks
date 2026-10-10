# sst recipe

This file shows the native commands and configuration for node. The comparison runner still supplies a reviewed app identity, cache policy and runtime probes. The example resource names are stable across this workload's CLI and Git branches. Setup, dependency installation and cleanup are outside the timed update. Do not run a deployment before the campaign is approved.

- cd deployment/sst
- npm ci --prefix ../../providers/tools/sst
- node ../../providers/link-tools.mjs . ../../providers/tools/sst sst
- ../../providers/tools/sst/node_modules/.bin/sst deploy --stage bench
- Fast update: ../../providers/tools/sst/node_modules/.bin/sst deploy --stage bench
- Cleanup: ../../providers/tools/sst/node_modules/.bin/sst remove --stage bench

Native builder and artifact-size qualification are explained in [provider setup](../../docs/provider-setup.md). A successful command is not a qualified result.
