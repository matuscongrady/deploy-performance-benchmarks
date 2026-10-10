# ravion recipe

This file shows the native commands and configuration for node. The comparison runner still supplies a reviewed app identity, cache policy and runtime probes. The example resource names are stable across this workload's CLI and Git branches. Setup, dependency installation and cleanup are outside the timed update. Do not run a deployment before the campaign is approved.

- Discover the current native schema: ravion project config schema
- List current modules: ravion module definition list
- Inspect the web module: ravion module schema rvn-ecs-web
- Export the owned Railpack project and exact-commit pipeline into ignored campaign state.
- Set RAVION_PIPELINE_ID, RAVION_VARIANT_ID and BENCH_COMMIT after validating the pipeline input.
- Native run: node providers/hosted.mjs ravion PIPELINE_ID VARIANT_ID FULL_COMMIT NEUTRAL_DESCRIPTION
- Cleanup: use the recorded owned project/module destruction procedure from the exported schema, verify its AWS resources are gone, then remove the temporary account connection. No unverified generic deletion command is supplied.

Native builder and artifact-size qualification are explained in [provider setup](../../docs/provider-setup.md). A successful command is not a qualified result.
