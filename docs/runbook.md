# Run: Update five services; three changed from the CLI

This application has five independently built commerce services. The update changes API, reporting and notifications. Inventory and webhooks keep their source, dependencies and deployed identities.

## Check out and exercise the selected application

```sh
git checkout test/deploy-five-services-cli
node fixtures/install.mjs
node scripts/check.mjs
git switch -c trial/five-services-candidate-001
```

The installation and checks use only this branch's selected application. They make no cloud requests. Configure five source paths, one for each directory under `fixtures/containers/five-services/`. Do not build all five from the repository root.

## Prepare one platform

This branch supports candidate, sst, cdk, ravion, render, heroku. The commands below use candidate; replace it consistently when running another supported platform. Create a separate trial branch for each provider, and connect each managed platform only to its own branch. A push for one provider must not start another provider’s build or change its caches. Follow [provider setup](provider-setup.md), including its pinned tools and any account/artifact prerequisites.

```sh
node scripts/bench.mjs prepare deploy-five-services-cli candidate \
  --app-id commerce-five-services --run-id review-001
```

Read `.work/commerce-five-services/candidate/plan.json`. Preparation writes source/configuration and argv command lists; it does not run them. Run the generated installation and setup commands outside the timer. Use a disposable application, keep its app ID/stage/region fixed, and save the native resource bindings and cleanup commands. Verify every baseline business response before measuring an update.

## Qualify the result and keep bindings local

Copy the [qualification example](qualification.example.json) into `.work/commerce-five-services/candidate/qualification.json`. Set scenario to `deploy-five-services-cli`, provider to `candidate`, appId to `commerce-five-services` and stage to the baseline's stage. Replace its example fields with this application's observed versions, cache evidence and artifact/runtime checks. The [selected manifest](../fixtures/manifest.json) is the source of required component names, requests and business expectations.

Supply baselineProbes and probes for every selected component. Before and after responses must match their expected business fields and revisions. Include component snapshots proving that inventory and webhooks retain their deployed identities.

For AWS operations, bind environment.accountId to the verified disposable account. Keep tokens, resource IDs and endpoints in ignored qualification state. Set approved only after the technical checks; that flag does not authorize a campaign.

## Make and commit the prescribed edit

```sh
node scripts/revision.mjs deploy-five-services-cli trial-001
git add fixtures
git commit -m 'Change the selected application revision'
```

The update changes API, reporting and notifications. Inventory and webhooks keep their source, dependencies and deployed identities. The baseline must return its previous revision; updated probes must expect trial-001 on changed components and the prior revision on unchanged components.

## Measure this deployment

Start immediately before the native update command. Stop after every business response confirms the expected revision.

Set the qualification's cacheEvidence.series to `cli-existing-cache`. This captures present local cache paths without deleting them or claiming a cache hit.

```sh
node scripts/cache.mjs candidate --scenario deploy-five-services-cli \
  --app-id commerce-five-services --run-id trial-001 --series cli-existing-cache --qualification .work/commerce-five-services/candidate/qualification.json
node scripts/bench.mjs run deploy-five-services-cli candidate \
  --app-id commerce-five-services --run-id trial-001 \
  --qualification .work/commerce-five-services/candidate/qualification.json \
  --cache-evidence .work/evidence/trial-001/candidate/cache-control.json --execute
```

The runner executes only the selected native update command and retains its logs and result. Tool installation and baseline setup stay outside this interval.

Retain normal local caches and record what was reused.

Follow [measurement rules](methodology.md) and [cache controls](cache-controls.md). Record ten attempts, including errors, and use a unique run ID for each. [Result data](results.md) describes raw evidence and compressed artifact sizes.

## Finish the series

Retain native logs, actual build/cache decisions, source SHA and runtime checks. For cloud resources, run the saved cleanup commands after success or failure and verify deletion. 

```sh
node scripts/results.mjs
```

This reports recorded results and failures. Review and sanitize evidence before publishing it.
