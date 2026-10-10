# render recipe

This file shows the native commands and configuration for python. The comparison runner still supplies a reviewed app identity, cache policy and runtime probes. The example resource names are stable across this workload's CLI and Git branches. Setup, dependency installation and cleanup are outside the timed update. Do not run a deployment before the campaign is approved.

- Select deployment/render/render.yaml when creating the neutral native blueprint.
- Select the source directory shown by rootDir; do not build the benchmark harness as part of the app.
- Record service IDs, the actual builder capacity and URLs before qualification.
- Manual deploy: render deploys create SERVICE_ID --commit FULL_COMMIT --wait --confirm --output json
- Run all changed service commands concurrently; then check every service with the common business/revision probes.
- Cleanup: delete each recorded benchmark service in the Render dashboard, then verify every recorded service is absent.

Native builder and artifact-size qualification are explained in [provider setup](../../docs/provider-setup.md). A successful command is not a qualified result.
