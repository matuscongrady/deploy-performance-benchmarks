# Run a test

Prepare and review a campaign before enabling CI or executing deployment commands.

## 1. Choose the branch and install the fixtures

```sh
git clone https://github.com/matuscongrady/deploy-performance-benchmarks.git
cd deploy-performance-benchmarks
git checkout test/deploy-lambda-5-cli
node fixtures/install.mjs
node scripts/check.mjs
```

Installation uses npm lockfiles and hash-checked Python requirements. Python checks use `uv`, which installs Python 3.11.14 in user space. Install `uv` using its [official instructions](https://docs.astral.sh/uv/getting-started/installation/). `--node-only` on the fixture scripts intentionally excludes Python; it is not a complete check.

Read `TEST.md`. It is the selected test’s instructions, not a record of a previous run. Create a separate trial branch for each provider before changing source. This example uses Serverless Framework:

```sh
git switch -c trial/lambda-five-serverless-001
```

## 2. Prepare the provider

Use [provider setup](provider-setup.md). Pin the candidate executable with `CANDIDATE_CLI`; keep its download/source reference, version and SHA256. Do not benchmark an unidentified local binary. Install each competitor’s tools with its checked-in lockfile. Record the actual version reported by the CLI as well as the package version.

If several AWS accounts are connected to the candidate's Console organization, set `CANDIDATE_AWS_ACCOUNT` to the connected disposable account name. Preparation passes that value as the native `--awsAccount` flag for setup, updates and cleanup. Local packaging does not accept that option. The flag selects the target account; it does not supply AWS credentials. Check generated options against the pinned binary's help before creating resources.

```sh
node scripts/bench.mjs prepare deploy-lambda-5-cli serverless --app-id commerce-five --run-id five-001
```

Read `.work/commerce-five/serverless/plan.json`. It contains the working directory, native commands, settings and prerequisites. Preparation never runs those commands. A plan marked `qualification-required`, `account-required` or `unsupported` must be resolved before measurement; changing a label in a file is not qualification.

Execute the plan’s setup commands outside the timer. Use a disposable application with a unique neutral run ID. Check the AWS account/region or platform workspace before creating it. Save the cleanup commands and resource IDs immediately. Never store tokens in this repository.

## 3. Qualify the measurement once

For each provider/fixture, do an untimed end-to-end deployment. Invoke every selected handler or service with the fixture’s business input. Compare the response recursively with `fixtures/manifest.json`, including `revision: baseline`.

For a packaging chart, also identify the complete uploaded ZIPs/layers and separate source maps, or the compressed image manifest. Lambda Upload size adds compressed code ZIPs/layers and separately uploaded raw maps once; maps inside ZIPs stay included in code bytes. Compare the artifact hashes with the native upload and verify the packaged code’s behavior. Establish the native build’s start/end boundary from actual logs. Record any bundling/minification/external dependency settings. This step is necessary even if `synth` or `package` succeeds.

For deployment, save every native function name/service URL, baseline response and deployment ID. Test the runtime probe file before measuring. All five-service probes are required, including unchanged services. For that test, also supply five `componentSnapshots` commands in the qualification file. On ECS, use `node scripts/component-state.mjs ecs REGION CLUSTER SERVICE` for each service; generated native outputs provide the resource identities. On managed platforms, bind an equivalent native API/CLI observation to `{deploymentId, configurationHash, artifactIds}`. Save the adapter and raw responses. The runner verifies that inventory and webhooks retain the same deployed artifact, deployment and configuration. Native build/upload logs are still needed to determine whether any unnecessary build work occurred. Save whether the selected update path actually hotswapped or fell back to infrastructure deployment.

For AWS deployments, set `environment.accountId` to the verified 12-digit disposable account ID. The timed runner checks the authenticated identity before starting. Set the qualification’s `appId` to the existing application’s `--app-id`. Copy `docs/qualification.example.json` into the ignored run directory and replace its values with observed evidence. The `approved` field means the measurement has been technically qualified. It does not grant account access or approve a benchmark campaign. Set it only after the checks above. For packaging, replace `probes` with a qualified `artifacts` object as described in [result data](results.md).

For Lambda updates, bind every existing function in `nativeResources` as `{name, type: "lambda", arn}`. Use the workload names from the selected manifest and ARNs from the untimed native deployment. Set `nativeBindings.owner` to the exact task owner used during preparation. Candidate/SLS/CDK also need `nativeStackName`; candidate needs `nativeDeploymentBucket` and each function’s generated `resourceName`. SST needs `nativeAppName`, `nativeStateBucket` and `nativeAssetBucket`, with the asset bucket tagged `benchmark:owner` for the same task owner. These are observed identities, not proposed names.

Run an excluded code update with the actual native fast path before starting the measured series. The runner observes function ownership, configuration, code and layers before and after every update. Candidate/SLS/CDK must retain their CloudFormation stack and physical-resource inventory. Candidate must commit the next fast release with matching deployed code. CDK must report hotswapping with no ignored changes. Serverless must report every selected function update as successful. SST must complete the exact attempt’s backend update and event history without creating, replacing or deleting resources. `SST_RUN_ID` binds that history to the run; native build settings stay unchanged. All these checks run outside the business-readiness timer. Failed admission retains the attempt as failed.

Lambda Git measurements require the same immutable update admission from the native CI/hosted observer. The current CLI runner produces it automatically; qualify and bind the Git observer before measuring that journey. An unbound Git result is rejected rather than accepted on business probes alone.

## 4. Make the source change

```sh
node scripts/revision.mjs deploy-lambda-5-cli trial-001
git add fixtures
git commit -m 'Update the five commerce functions for trial 001'
```

This changes only selected revision files. All Lambda functions selected by this test change. For the five-service test, only API, reporting and notifications change. The business behavior stays the same.

Keep the native application name, stage and region stable across setup and updates. Use the same `--app-id` when regenerating the native project from changed source. It keeps native resource names and build caches stable. Give every measured attempt a new `--run-id`; the run ID identifies evidence, not the application. Save the baseline source SHA and hashes of unchanged build contexts.

## 5. Measure

For supported local packaging or CLI update plans:

```sh
node scripts/cache.mjs serverless --scenario deploy-lambda-5-cli \
  --app-id commerce-five --run-id five-001 --series cli-existing-cache
node scripts/bench.mjs run deploy-lambda-5-cli serverless \
  --app-id commerce-five --run-id five-001 --execute \
  --qualification .work/commerce-five/serverless/qualification.json \
  --cache-evidence .work/evidence/five-001/serverless/cache-control.json
```

The cache command records this attempt's source commit and current owned cache paths. For packaging, use the clean-build and cached-source-edit commands in the selected branch's runbook instead. The runner requires the matching immutable cache record, saves native command logs, waits for runtime probes, and writes a result to `results/raw/`. It refuses an unqualified provider plan or dirty source tree. Run tool installation and baseline setup separately; the measured commands must not contain them.

For Git push, configure each platform to follow only its own provider-specific trial branch and commit first. A push for another provider must not trigger this platform or change its caches. Add `pipeline.branch`, `pipeline.sourceCommit` and `pipeline.configurationEvidence` to the qualification file. Also bind `pipeline.completion.argv` to a native observer that returns `{sourceCommit, status, runId}` for the pushed SHA. `status` is `pending`, `succeeded`, `failed` or `cancelled`. For GitHub Actions use `node scripts/github-run.mjs OWNER/REPO PUSHED_SHA`; hosted platforms need the corresponding qualified native deployment observer. The runner checks successful terminal completion after the readiness timer stops, so a failed or still-running workflow cannot qualify a result. A repeat push also needs `predecessor: {file, sha256, record}`: the saved preceding successful raw Git result, its SHA-256 and its full JSON record. It must identify the same app, provider, stage, region, fixture series and provider trial branch, with a different ancestor source commit. Use an actual cold or repeat Git result to seed this relationship; a timestamp from an unrecorded deployment is insufficient. Baseline probes must assert its full business output and revisions. GitHub Actions observes the latest workflow on that branch; hosted platforms must supply `pipeline.currentDeployment.argv`, a read-only latest-deployment observer returning `{latest: true, sourceCommit, status: "succeeded", runId, finishedAt}` (and `runAttempt` for GitHub). Missing native identity leaves the row unqualified. Then use the push runner:

```sh
node scripts/git-push.mjs deploy-lambda-5-git-cold serverless \
  --run-id five-push-001 --qualification PATH_TO_QUALIFICATION --execute
```

The push runner verifies the baseline, starts its clock before the actual push and waits for every business probe. It keeps the exact pushed SHA and saves a raw record. Capture native deployment/build IDs and logs alongside that record. For managed packaging, use build-phase events from those logs rather than the push-to-readiness duration. The repository includes a deployment workflow for candidate, Serverless Framework, SST and CDK. It stays disabled until `BENCH_CI_ENABLED=true`. Follow [CI setup](ci-setup.md) to bind the reviewed qualification, existing application, account and cache controls before timing a push. Hosted platforms use their native Git integration instead. The separate source-check workflow is not a deployment benchmark.

Create the raw JSON record from those events using [the result format](results.md), then validate/import it with:

```sh
node scripts/bench.mjs record-managed path/to/observed-record.json
```

Use native build phase timing for packaging. Use push-to-business-readiness elapsed time for Git deployment. Never put a full managed deployment duration into the packaging chart.

## 6. Repeat and clean up

Follow the cache series and repetitions in [the measurement rules](methodology.md) and [cache controls](cache-controls.md). Use unique revisions. For the repeat-push test, wait 15 minutes after the preceding deployment passed every probe. Preserve failures and cache logs.

Run the plan’s cleanup commands after the series, including on failures. Verify deletion in the provider/AWS account. Remove the temporary Git connection only after hosted test cleanup. Do not remove pre-existing account connections or applications.

```sh
node scripts/results.mjs
```

The report prints median/range and failure counts. It does not manufacture missing results. Review and sanitize raw evidence before publishing it on a results branch or release; retain enough IDs and logs to match timings to real deployments without exposing credentials.

## Spending and interrupted cleanup

Before provisioning, record the campaign's total spending limit and reserve in ignored state. Price the actual generated resources in their actual region, including hosted-plan/build-minute charges, temporary capacity, native runner storage and anything retained while waiting. Do not infer a full-campaign bill from only web-service prices.

Execute predeclared comparison rows across all supported providers. Before each row, check its estimated remaining lifetime and costs plus the reserved cleanup/retry amount against the remaining budget. If it does not fit, stop and clean up the whole row; report it as unrun rather than silently excluding a competitor. Keep every failed attempt and retry. Do not combine qualification diagnostics with a publishable series after changing code, settings or timing rules.

Persist exact owned resource IDs as they are created, with account/region, owner and recovery procedure. Cleanup runs after success, failure and interruption, before moving to the next batch. Verify deletion from the native platform and AWS by those exact IDs. Include owned load balancers, NAT gateways/public IPs, tasks, runners and disks, images/buckets/logs and any provider apps/projects; stopping a process or hibernating a runner does not establish deletion. Preserve unrelated resources and existing subscriptions. At campaign end, disable benchmark CI and remove the benchmark's temporary AWS connection through its recorded native teardown procedure.
