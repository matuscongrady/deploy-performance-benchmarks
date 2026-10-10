# candidate recipe

This file shows the native commands and configuration for node. The comparison runner still supplies a reviewed app identity, cache policy and runtime probes. The example resource names are stable across this workload's CLI and Git branches. Setup, dependency installation and cleanup are outside the timed update. Do not run a deployment before the campaign is approved.

- cd deployment/candidate
- Use the reviewed CANDIDATE_CLI executable.
- package --configPath candidate.yml --stage bench --region eu-west-1 --autoConfirmOperation --preserveTempFiles
- Initial setup: deploy --configPath candidate.yml --stage bench --region eu-west-1 --autoConfirmOperation --fullDeploy
- Fast update: deploy --configPath candidate.yml --stage bench --region eu-west-1 --autoConfirmOperation
- Cleanup: delete --configPath candidate.yml --stage bench --region eu-west-1 --autoConfirmOperation

Native builder and artifact-size qualification are explained in [provider setup](../../docs/provider-setup.md). A successful command is not a qualified result.
