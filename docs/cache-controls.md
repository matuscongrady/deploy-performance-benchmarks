# Cache controls

Cache state is part of a test, not a guess based on elapsed time. Keep the reset record, native logs and any cache-restore event with each attempt.

## Local Lambda packaging

Both artifact series use a prewarmed AWS identity and one verified short-lived session shared by all four local builders. A clean build clears qualified application build outputs; it does not represent a first login or cold identity lookup. Keep identity-cache files and global dependency download caches intact.

After native cloud qualification, resolve the disposable account's session once with `aws configure export-credentials --profile PROFILE --format process`. Capture that response only in the runner's memory. Never print it, put credentials in argv or write them to a file. Verify the exported environment with `aws sts get-caller-identity` without a profile override, then supply the same environment to every builder. Remove `AWS_PROFILE` and `AWS_DEFAULT_PROFILE` from those local packaging commands so they do not assume a fresh role independently. Native cloud qualification and cleanup can use their separately verified profiles.

Run one complete candidate package outside the comparative series to warm identity for that exact session. Every measured candidate trace must then show `aws:identity` with `source: "cache"` and the expected account, with no STS request. Keep only `identitySession: "shared-prewarmed"`, the verified account and expiration as result metadata. Check expiration before every attempt and stop the series if it is expiring; do not silently obtain a new session halfway through. Record this policy for both clean-output builds and cached source edits. Ordinary CLI deployment updates retain and disclose their own full-command credential/cache conditions.

Install dependencies once. Prepare the project with a stable application ID. For a clean-build attempt, run the matching reset before the native package command:

```sh
node scripts/cache.mjs cdk --scenario package-lambda-5 --app-id commerce-five \
  --run-id clean-001 --series clean
node scripts/bench.mjs run package-lambda-5 cdk --app-id commerce-five \
  --run-id clean-001 --execute --qualification .work/commerce-five/cdk/qualification.json \
  --cache-evidence .work/evidence/clean-001/cdk/cache-control.json
```

Use the measured provider in both commands. Commit the source first. Each cache capture requires the selected test, stable application ID and unique attempt ID. It writes `.work/evidence/RUN/PROVIDER/cache-control.json` exclusively: an earlier attempt is never overwritten. Its source commit, test, provider, application and series must match the timed run and the reviewed qualification policy. The runner rejects a clean reset path that reappears before the timer.

Serverless removes `.serverless`; CDK removes `cdk.out` and captured ZIPs; SST removes `.sst/artifacts` and captured ZIPs. Installed dependencies, SST platform/state and global caches remain. This is a clean build of the declared local outputs, not a claim that every external cache is empty.

The candidate needs `--qualification .work/APP/candidate/qualification.json` on the cache command. Set `cacheControl.localPaths` to its qualified paths. Other providers may also supply qualified paths when their artifact layout differs. Paths stay within the generated project; source, dependency directories and linked paths are rejected.

For the edited build, keep the same application directory, edit the selected revision files and commit the change. Then capture the retained state:

```sh
node scripts/cache.mjs cdk --scenario package-lambda-5 --app-id commerce-five \
  --run-id edited-001 --series cached-source-edit \
  --retain-from results/raw/clean-001-cdk.json
```

The preceding result must have passed for the same application, provider and test, with a different source commit. Its immutable proof and raw result checksums must match, and the retained cache paths and prior artifacts must still exist before rebuilding. No files are deleted for this series. The new build may replace those output files; importing historical results verifies saved proofs rather than requiring old live files to remain forever.

For CLI deployment updates, use `--series cli-existing-cache`. This observes the current qualified local paths without deleting them. It does not claim native cache hits. The native command logs remain evidence for reuse actually reported during the measured attempt.

Serverless CLI updates keep per-function native state under `.parallel-functions/FUNCTION/.serverless`. Include `.parallel-functions` in the deployment qualification's `cacheControl.localPaths`; observing only the parent `.serverless` would miss the state used by these commands. The wrapper refreshes selected source/config while retaining native installed dependencies and lockfiles. Qualify and record actual native reuse before describing a warm update. These contexts are excluded from application packaging and removed with the owned generated project after cleanup.

## Docker image builds

Do not prune the shared Docker daemon's cache. It may belong to another task. Use an isolated builder or the native provider's explicit no-cache setting for the clean series, and record the actual native Docker invocation. Keep the base-image state the same across tools. `--no-cache` disables layer reuse; it does not erase downloaded base images.

The local diagnostic Docker adapter supports `BENCH_DOCKER_NO_CACHE=1`; that flag alone does not prove parity with SST/CDK's native invocation. The generated SST/CDK native configurations do not yet wire that diagnostic environment flag to their builders. Qualify a real native no-cache setting, the actual invocation and final uploaded image before using a clean native-builder chart. Only after that proof, a qualification may specify `cacheControl.localPaths: []` with `cacheControl.nativeClean: {"verified": true, "env": {"BENCH_DOCKER_NO_CACHE": "1"}}` only when that native no-cache control has been verified. The runner checks that environment before timing. Cached trials retain the same native builder and three unchanged dependency layers. Five services retain five independent contexts.

## GitHub Actions

[CI setup](ci-setup.md) defines the executable deployment workflow. Fresh tests restore no cache. Repeat tests restore only the configured paths and retain the actual cache hit/miss event. They bind the preceding successful raw Git result and its checksum, rather than trusting a standalone readiness timestamp. The result records the actual idle interval after prior native completion/admission, which must reach 15 minutes before the push. A new VM can restore a cache. No cache hit means no claim of a warm build. Set `pipeline.engine` to `github-actions`. After native terminal success, the Git runner downloads `ci-PROVIDER-SHA-ATTEMPT` from the exact completed run. Its `ci-evidence.json` must report passed status and matching commit, test, provider, application, GitHub run ID and attempt. The observed runner and restore flags are bound to an immutable per-attempt proof, separate from the machine timing the push.

## Hosted builders

Ravion, Render and Heroku use their documented reset/restore controls. Save the exact command/API request, deployment/build ID and returned logs. If the control starts a deployment, it cannot be counted as an invisible cache-only reset before a fresh Git push. If a platform cannot establish a fresh Git-triggered build, leave it out of that chart and state why.


For hosted providers outside GitHub Actions, qualification must supply `pipeline.evidence.argv`, a read-only native observer. After terminal success it must emit JSON with `status: "passed"`, `sourceCommit`, `scenario`, `provider`, `appId`, `nativeRunId` matching the completion observer, and `runner` and `cache` objects containing actual observations. `cache.restored` must be an observed boolean. Cold pushes require `false`; unknown cache state or observed reuse cannot enter the cold chart. Repeat pushes accept either value and do not require a manual restore request: native builders may reuse work automatically or miss their cache. Keep the neutral 15-minute repeat label and disclose the observed hit or miss. State unavailable capacity explicitly; a static qualification declaration is insufficient. Missing observer access is a qualification prerequisite, so the runner refuses the push before changing anything. Retain both observer JSON and its bound per-attempt proof.
