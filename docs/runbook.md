# Run: Update one Python commerce API from another Git push after 15 minutes

This application is one Python commerce API. The update changes the API revision.

## Check out and exercise the selected application

```sh
git checkout test/deploy-python-git-repeat
node fixtures/install.mjs
node scripts/check.mjs
git switch -c trial/python-candidate-001
```

The installation and checks use only this branch's selected application. They make no cloud requests. For a hosted native build, select `fixtures/containers/python` as the application directory. Its requirements, runtime version and start command are complete. Do not use the repository root as the build context.

## Prepare one platform

This branch supports candidate, sst, cdk, ravion, render, heroku. The commands below use candidate; replace it consistently when running another supported platform. Create a separate trial branch for each provider, and connect each managed platform only to its own branch. A push for one provider must not start another provider’s build or change its caches. Follow [provider setup](provider-setup.md), including its pinned tools and any account/artifact prerequisites.

```sh
node scripts/bench.mjs prepare deploy-python-git-repeat candidate \
  --app-id commerce-python --run-id review-001
```

Read `.work/commerce-python/candidate/plan.json`. Preparation writes source/configuration and argv command lists; it does not run them. Run the generated installation and setup commands outside the timer. Use a disposable application, keep its app ID/stage/region fixed, and save the native resource bindings and cleanup commands. Verify every baseline business response before measuring an update.

## Qualify the result and keep bindings local

Copy the [qualification example](qualification.example.json) into `.work/commerce-python/candidate/qualification.json`. Set scenario to `deploy-python-git-repeat`, provider to `candidate`, appId to `commerce-python` and stage to the baseline's stage. Replace its example fields with this application's observed versions, cache evidence and artifact/runtime checks. The [selected manifest](../fixtures/manifest.json) is the source of required component names, requests and business expectations.

Supply baselineProbes and probes for every selected component. Before and after responses must match their expected business fields and revisions. 

For AWS operations, bind environment.accountId to the verified disposable account. Keep tokens, resource IDs and endpoints in ignored qualification state. Set approved only after the technical checks; that flag does not authorize a campaign.

## Make and commit the prescribed edit

```sh
node scripts/revision.mjs deploy-python-git-repeat trial-001
git add fixtures
git commit -m 'Change the selected application revision'
```

The update changes the API revision. The baseline must return its previous revision; updated probes must expect trial-001 on changed components and the prior revision on unchanged components.

## Measure this deployment

Start immediately before the actual Git push. Stop when every business response confirms the expected revision. Queueing, installation, building, upload and rollout are included. Then verify that the native pipeline succeeded; a failed pipeline disqualifies the result, but waiting for its terminal status does not extend the readiness timer.

Configure the reviewed Git trigger for this trial branch. [CI setup](ci-setup.md) covers the disabled-by-default GitHub workflow; managed platforms use their native Git connection. Set qualification pipeline.branch and pipeline.sourceCommit to the actual trial branch and committed SHA. Bind pipeline.completion to the native terminal-status observer. Repeat pushes also need previousReadyAt.

```sh
node scripts/git-push.mjs deploy-python-git-repeat candidate \
  --run-id trial-001 --qualification .work/commerce-python/candidate/qualification.json --execute
```

The runner starts immediately before the push and stops at verified business readiness. It then checks native pipeline success; failures are retained and cannot qualify. CI/hosted cache evidence is bound to the observed completed pipeline, rather than a local cache-control file.

Complete an untimed workflow deployment on the same trial branch. Wait 15 minutes after its verified readiness, edit again and push. Save actual restore/hit/miss evidence; another push is not automatically a warm build.

Follow [measurement rules](methodology.md) and [cache controls](cache-controls.md). Record ten attempts, including errors, and use a unique run ID for each. [Result data](results.md) describes raw evidence and compressed artifact sizes.

## Finish the series

Retain native logs, actual build/cache decisions, source SHA and runtime checks. For cloud resources, run the saved cleanup commands after success or failure and verify deletion. Disable deployment CI and remove campaign-only account access after cleanup.

```sh
node scripts/results.mjs
```

This reports recorded results and failures. Review and sanitize evidence before publishing it.
