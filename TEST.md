# Package five commerce functions

This application has 5 different commerce functions. The update changes all 5 selected functions.

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
node scripts/bench.mjs prepare package-lambda-5 candidate --app-id commerce-lambda-5 --run-id review-lambda-5
```

Supported platforms here: candidate, serverless, sst, cdk.  A generated plan does not count as a successful benchmark.

## Make the measured change

```sh
git switch -c trial/lambda-5-candidate-001
node scripts/revision.mjs package-lambda-5 trial-001
git add fixtures
git commit -m 'Change the selected application revision'
```

Use a separate trial branch for each provider. Connect each managed platform only to its own branch so another provider’s push cannot start a build or alter its caches. The revision script changes only this test's edit targets. Keep the baseline source for the clean-build series; use the committed edit for the cached rebuild.

## What the clock measures

Start immediately before the native package/build command. Stop when every deployable artifact is complete, before upload or deployment. Record compressed artifact size separately.

Run one clean-cache series and one cached source-edit series. Keep the cache controls and raw logs.

Follow [the run procedure](docs/runbook.md), [measurement rules](docs/methodology.md) and [cache controls](docs/cache-controls.md). 

Keep ten measured attempts, including failures. Check the actual native artifact, business output, revision and deployment path before admitting a result. Use the saved cleanup commands and verify deletion afterward.
