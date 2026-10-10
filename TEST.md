# Update twenty-five commerce functions from a Git push with a fresh build environment

This application has 25 different commerce functions. The update changes all 25 selected functions.

The reporting function generates actual PDF, Excel and Word documents. Other selected handlers perform commerce operations; their source and expected business results are listed in the manifest. This exposes the cost of packaging real dependencies and updating a whole application.

This branch contains only this test's application, locks, platform configurations and measurement scripts. [The full catalogue and common sources live on main](https://github.com/matuscongrady/deploy-performance-benchmarks/tree/main).

## Run the application checks

```sh
node fixtures/install.mjs
node scripts/check.mjs
```

These commands install the locked dependencies and exercise the selected application. They do not contact AWS or deploy. 

Each selected function exports `handler(event)`. Direct Lambda invocation verifies the business result; an API Gateway is not required.

## Read the platform configurations

The files under `deployment/` are ordinary native configurations that point to the selected source. Each platform directory explains its install, setup, update and cleanup commands. The automatic-builder source has no default Dockerfile; CDK/SST explicitly select their named recipes. Account-specific values stay in ignored qualification state.

To prepare an executable native command plan without deploying:

```sh
node scripts/bench.mjs prepare deploy-lambda-25-git-cold candidate --app-id commerce-lambda-25 --run-id review-lambda-25
```

Supported platforms here: candidate, serverless, sst, cdk.  A generated plan does not count as a successful benchmark.

## Make the measured change

```sh
git switch -c trial/lambda-25-candidate-001
node scripts/revision.mjs deploy-lambda-25-git-cold trial-001
git add fixtures
git commit -m 'Change the selected application revision'
```

Use a separate trial branch for each provider. Connect each managed platform only to its own branch so another provider’s push cannot start a build or alter its caches. The revision script changes only this test's edit targets. Deploy and verify the baseline before making that edit.

## What the clock measures

Start immediately before the actual Git push. Stop when every business response confirms the expected revision. Queueing, installation, building, upload and rollout are included. Then verify that the native pipeline succeeded; a failed pipeline disqualifies the result, but waiting for its terminal status does not extend the readiness timer.

Use a fresh runner without restored CI caches. Record remote application caches separately.

Follow [the run procedure](docs/runbook.md), [measurement rules](docs/methodology.md) and [cache controls](docs/cache-controls.md). [CI setup](docs/ci-setup.md) describes the disabled-by-default GitHub workflow; hosted platforms use their own Git connection.

Keep ten measured attempts, including failures. Check the actual native artifact, business output, revision and deployment path before admitting a result. Use the saved cleanup commands and verify deletion afterward.
