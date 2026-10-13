# Run: Package five commerce functions

This application has 5 different commerce functions. The update changes all 5 selected functions.

## Check out and exercise the selected application

```sh
git checkout test/package-lambda-5
node fixtures/install.mjs
node scripts/check.mjs
git switch -c trial/lambda-5-candidate-001
```

The installation and checks use only this branch's selected application. They make no cloud requests. Each selected function exports `handler(event)`. Direct Lambda invocation verifies the business result; an API Gateway is not required.

## Prepare one platform

This branch supports candidate, serverless, sst, cdk. The commands below use candidate; replace it consistently when running another supported platform. Create a separate trial branch for each provider, and connect each managed platform only to its own branch. A push for one provider must not start another provider’s build or change its caches. Follow [provider setup](provider-setup.md), including its pinned tools and any account/artifact prerequisites.

```sh
node scripts/bench.mjs prepare package-lambda-5 candidate \
  --app-id commerce-lambda-5 --run-id review-001
```

Read `.work/commerce-lambda-5/candidate/plan.json`. Preparation writes source/configuration and argv command lists; it does not run them. Run the generated tool/dependency installation commands outside the timer. Qualify the complete native artifacts and run their business checks before accepting measurements. Packaging stops before upload or deployment; any infrastructure used to establish artifact parity belongs to untimed qualification.

## Qualify the result and keep bindings local

Copy the [qualification example](qualification.example.json) into `.work/commerce-lambda-5/candidate/qualification.json`. Set scenario to `package-lambda-5`, provider to `candidate`, appId to `commerce-lambda-5` and stage to the baseline's stage. Replace its example fields with this application's observed versions, cache evidence and artifact/runtime checks. The [selected manifest](../fixtures/manifest.json) is the source of required component names, requests and business expectations.

Supply every selected function ZIP and any required shared layer. SST also supplies one separately uploaded native source map per function. Count ZIP/layer bytes and separate raw map bytes once in the Upload size total; maps already inside a ZIP are counted there. See [result data](results.md) for the qualified artifact fields. Do not substitute a JavaScript bundle or a directory.

For AWS operations, bind environment.accountId to the verified disposable account. Keep tokens, resource IDs and endpoints in ignored qualification state. Set approved only after the technical checks; that flag does not authorize a campaign.

## Measure the clean build first

Keep the baseline source for this first attempt. Set the qualification's cacheEvidence.series to `clean`. The cache-control command resets only qualified owned output/cache paths; it keeps an immutable record of the action.

```sh
node scripts/cache.mjs candidate --scenario package-lambda-5 \
  --app-id commerce-lambda-5 --run-id clean-001 --series clean --qualification .work/commerce-lambda-5/candidate/qualification.json
node scripts/bench.mjs run package-lambda-5 candidate \
  --app-id commerce-lambda-5 --run-id clean-001 \
  --qualification .work/commerce-lambda-5/candidate/qualification.json \
  --cache-evidence .work/evidence/clean-001/candidate/cache-control.json --execute
```

Complete this passed clean-build attempt before editing the source. Its raw result and retained cache/artifact files are prerequisites for the cached rebuild. 

## Make and commit the prescribed edit

```sh
node scripts/revision.mjs package-lambda-5 trial-001
git add fixtures
git commit -m 'Change the selected application revision'
```

The update changes all 5 selected functions. The cached rebuild uses this committed edit and the preceding passed clean-build result.

## Measure the cached rebuild

Start immediately before the native package/build command. Stop when every deployable artifact is complete, before upload or deployment. Record total application Upload size separately: compressed ZIPs/layers plus raw source maps uploaded as separate files.

Set the qualification's cacheEvidence.series to `cached-source-edit`. The retained result must be the passed clean attempt from the preceding source commit.

```sh
node scripts/cache.mjs candidate --scenario package-lambda-5 \
  --app-id commerce-lambda-5 --run-id edited-001 --series cached-source-edit --qualification .work/commerce-lambda-5/candidate/qualification.json \
  --retain-from results/raw/clean-001-candidate.json
node scripts/bench.mjs run package-lambda-5 candidate \
  --app-id commerce-lambda-5 --run-id edited-001 \
  --qualification .work/commerce-lambda-5/candidate/qualification.json \
  --cache-evidence .work/evidence/edited-001/candidate/cache-control.json --execute
```

The runner executes only the selected native packaging/build command and retains its logs and result. Tool installation and baseline setup stay outside this interval.

Run one clean-cache series and one cached source-edit series. Keep the cache controls and raw logs.

Follow [measurement rules](methodology.md) and [cache controls](cache-controls.md). Record ten attempts, including errors, and use a unique run ID for each. [Result data](results.md) describes raw evidence and compressed artifact sizes.

## Finish the series

Retain native logs, actual build/cache decisions, source SHA and runtime checks. For cloud resources, run the saved cleanup commands after success or failure and verify deletion. 

```sh
node scripts/results.mjs
```

This reports recorded results and failures. Review and sanitize evidence before publishing it.
