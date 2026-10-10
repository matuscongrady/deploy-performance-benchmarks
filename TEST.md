# Update one Node.js commerce API from the CLI

This application is one Node.js commerce API. The update changes the API revision.

The app validates requests, calculates prices and renders receipts. It provides enough real work to check that a build is runnable, while keeping database and network dependencies out of the comparison.

This branch contains only this test's application, locks, platform configurations and measurement scripts. [The full catalogue and common sources live on main](https://github.com/matuscongrady/deploy-performance-benchmarks/tree/main).

## Run the application checks

```sh
node fixtures/install.mjs
node scripts/check.mjs
```

These commands install the locked dependencies and exercise the selected application. They do not contact AWS or deploy. 

For a hosted native build, select `fixtures/containers/node` as the application directory. Its package, lockfile and start command are complete. Do not use the repository root as the build context.

## Read the platform configurations

The files under `deployment/` are ordinary native configurations that point to the selected source. Each platform directory explains its install, setup, update and cleanup commands. The automatic-builder source has no default Dockerfile; CDK/SST explicitly select their named recipes. Account-specific values stay in ignored qualification state.

To prepare an executable native command plan without deploying:

```sh
node scripts/bench.mjs prepare deploy-node-cli candidate --app-id commerce-node --run-id review-node
```

Supported platforms here: candidate, sst, cdk, ravion, render, heroku. Heroku remains blocked until its account and buildpack are selected.  A generated plan does not count as a successful benchmark.

## Make the measured change

```sh
git switch -c trial/node-candidate-001
node scripts/revision.mjs deploy-node-cli trial-001
git add fixtures
git commit -m 'Change the selected application revision'
```

Use a separate trial branch for each provider. Connect each managed platform only to its own branch so another provider’s push cannot start a build or alter its caches. The revision script changes only this test's edit targets. Deploy and verify the baseline before making that edit.

## What the clock measures

Start immediately before the native update command. Stop after every business response confirms the expected revision.

Retain normal local caches and record what was reused.

Follow [the run procedure](docs/runbook.md), [measurement rules](docs/methodology.md) and [cache controls](docs/cache-controls.md). 

Keep ten measured attempts, including failures. Check the actual native artifact, business output, revision and deployment path before admitting a result. Use the saved cleanup commands and verify deletion afterward.
