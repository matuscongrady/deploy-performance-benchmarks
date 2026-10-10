# Run: Package one Python commerce API

This application is one Python commerce API. The update changes the API revision.

## Check out and exercise the selected application

```sh
git checkout test/package-python
node fixtures/install.mjs
node scripts/check.mjs
git switch -c trial/python-candidate-001
```

The installation and checks use only this branch's selected application. They make no cloud requests. For a hosted native build, select `fixtures/containers/python` as the application directory. Its requirements, runtime version and start command are complete. Do not use the repository root as the build context.

## Prepare one platform

This branch supports candidate, sst, cdk, ravion, render, heroku. The commands below use candidate; replace it consistently when running another supported platform. Create a separate trial branch for each provider, and connect each managed platform only to its own branch. A push for one provider must not start another provider’s build or change its caches. Follow [provider setup](provider-setup.md), including its pinned tools and any account/artifact prerequisites.

```sh
node scripts/bench.mjs prepare package-python candidate \
  --app-id commerce-python --run-id review-001
```

Read `.work/commerce-python/candidate/plan.json`. Preparation writes source/configuration and argv command lists; it does not run them. Run the generated tool/dependency installation commands outside the timer. Qualify the complete native artifacts and run their business checks before accepting measurements. Packaging stops before upload or deployment; any infrastructure used to establish artifact parity belongs to untimed qualification.

## Qualify the result and keep bindings local

Copy the [qualification example](qualification.example.json) into `.work/commerce-python/candidate/qualification.json`. Set scenario to `package-python`, provider to `candidate`, appId to `commerce-python` and stage to the baseline's stage. Replace its example fields with this application's observed versions, cache evidence and artifact/runtime checks. The [selected manifest](../fixtures/manifest.json) is the source of required component names, requests and business expectations.

Supply qualified native container artifacts as described in [result data](results.md). For OCI images, measure compressed image bytes; record other native formats separately. Do not use an unpacked local image size.

For AWS operations, bind environment.accountId to the verified disposable account. Keep tokens, resource IDs and endpoints in ignored qualification state. Set approved only after the technical checks; that flag does not authorize a campaign.

## Measure the clean build first

Keep the baseline source for this first attempt. Set the qualification's cacheEvidence.series to `clean`. First qualify the native builder’s no-cache control or an isolated clean builder. Save the actual invocation and its observed cache decision. Set cacheControl.localPaths to the builder’s qualified output/cache paths and cacheControl.nativeClean to its verified environment control when needed. Deleting ZIP or synth output directories does not disable Docker layers. Export the qualified control before the commands below; do not use the diagnostic Docker flag as proof of a native builder setting.

```sh
node scripts/cache.mjs candidate --scenario package-python \
  --app-id commerce-python --run-id clean-001 --series clean --qualification .work/commerce-python/candidate/qualification.json
node scripts/bench.mjs run package-python candidate \
  --app-id commerce-python --run-id clean-001 \
  --qualification .work/commerce-python/candidate/qualification.json \
  --cache-evidence .work/evidence/clean-001/candidate/cache-control.json --execute
```

Complete this passed clean-build attempt before editing the source. Its raw result and retained cache/artifact files are prerequisites for the cached rebuild. The native compressed image identity/size and runnable business output must be observed before accepting it. If no native clean control or complete artifact proof is available, this series is blocked.

## Make and commit the prescribed edit

```sh
node scripts/revision.mjs package-python trial-001
git add fixtures
git commit -m 'Change the selected application revision'
```

The update changes the API revision. The cached rebuild uses this committed edit and the preceding passed clean-build result.

## Measure the cached rebuild

Start immediately before the native package/build command. Stop when every deployable artifact is complete, before upload or deployment. Record compressed artifact size separately.

Set the qualification's cacheEvidence.series to `cached-source-edit`. The retained result must be the passed clean attempt from the preceding source commit. Turn off the clean-only native control, keep the same builder/base-image state and retain its qualified caches. Record actual layer reuse or misses and the new complete image identity/size. A retained directory does not by itself prove Docker reuse.

```sh
node scripts/cache.mjs candidate --scenario package-python \
  --app-id commerce-python --run-id edited-001 --series cached-source-edit --qualification .work/commerce-python/candidate/qualification.json \
  --retain-from results/raw/clean-001-candidate.json
node scripts/bench.mjs run package-python candidate \
  --app-id commerce-python --run-id edited-001 \
  --qualification .work/commerce-python/candidate/qualification.json \
  --cache-evidence .work/evidence/edited-001/candidate/cache-control.json --execute
```

The runner executes only the selected native packaging/build command and retains its logs and result. Tool installation and baseline setup stay outside this interval.

Run one clean-cache series and one cached source-edit series. Keep the cache controls and raw logs.

## Packaging on a managed builder

ravion, render, heroku use their native account-connected builders. The local cache and run examples above do not apply to these platforms. Configure the selected source directory and native builder, then run the baseline and edited builds through the platform. Keep its build ID, exact source commit, actual cache-control request, restore/hit/miss observations and logs. Use build-phase start/end events, excluding queueing, checkout and rollout. A reset that starts a build is part of that observed build, rather than a separate invisible reset. If native clean or retained-cache state cannot be established, leave that series unmeasured.

Record the complete native output and compressed size only when observable; slug and OCI formats stay separate. Verify the deployed business response to establish that this output contains the edited code. Assemble the observed result using [result data](results.md), then validate it:

```sh
node scripts/bench.mjs record-managed .work/observed-build.json
```

Missing account access, build events or artifact proof blocks the row. A local Docker build or a full deployment duration cannot replace the native packaging measurement.

Follow [measurement rules](methodology.md) and [cache controls](cache-controls.md). Record ten attempts, including errors, and use a unique run ID for each. [Result data](results.md) describes raw evidence and compressed artifact sizes.

## Finish the series

Retain native logs, actual build/cache decisions, source SHA and runtime checks. For cloud resources, run the saved cleanup commands after success or failure and verify deletion. 

```sh
node scripts/results.mjs
```

This reports recorded results and failures. Review and sanitize evidence before publishing it.
