# Cache controls

Cache state is part of a test, not a guess based on elapsed time. Keep the reset record, native logs and any cache-restore event with each attempt.

## Local Lambda packaging

Install dependencies once. Prepare the project with a stable application ID. For a clean-build attempt, run the matching reset before the native package command:

```sh
node scripts/cache.mjs serverless --app-id commerce-five
node scripts/cache.mjs cdk --app-id commerce-five
node scripts/cache.mjs sst --app-id commerce-five
```

Run only the command for the provider being measured. Serverless removes `.serverless`; CDK removes `cdk.out` and captured ZIPs; SST removes `.sst/artifacts` and captured ZIPs. It preserves installed dependencies and SST's platform/state directories. It does not delete infrastructure state or your global tool caches. Keep `cache-reset.json` as evidence and record those retained caches.

The candidate's exact cache paths depend on the supplied binary. Identify them during artifact qualification and add `cacheControl.localPaths` to its ignored qualification file. Then run:

```sh
node scripts/cache.mjs candidate --app-id commerce-five --qualification PATH_TO_QUALIFICATION
```

The command only removes qualified paths inside the generated project. Never supply application source or dependency directories. If the binary also uses a cache outside this project, isolate it through the binary's supported settings and document that control before calling the result a clean build.

For a cached-source-edit attempt, finish the preceding build, retain its output/cache, change the selected revision files and build again. Save the preceding record and native reuse logs. Do not use a fresh random project directory and call it cached.

## Docker image builds

Do not prune the shared Docker daemon's cache. It may belong to another task. Use an isolated builder or the native provider's explicit no-cache setting for the clean series, and record the actual native Docker invocation. Keep the base-image state the same across tools. `--no-cache` disables layer reuse; it does not erase downloaded base images.

The local diagnostic Docker adapter supports `BENCH_DOCKER_NO_CACHE=1`; that flag alone does not prove parity with SST/CDK's native invocation. Qualify the native builder's matching setting and final uploaded image before putting the diagnostic phase in a native-builder chart. Cached trials retain the same native builder and three unchanged dependency layers. Five services retain five independent contexts.

## GitHub Actions

[CI setup](ci-setup.md) defines the executable deployment workflow. Fresh tests restore no cache. Repeat tests restore only the configured paths, retain the actual cache hit/miss event and keep the previous verified readiness timestamp. A new VM can restore a cache. No cache hit means no claim of a warm build.

## Hosted builders

Ravion, Render and Heroku use their documented reset/restore controls. Save the exact command/API request, deployment/build ID and returned logs. If the control starts a deployment, it cannot be counted as an invisible cache-only reset before a fresh Git push. If a platform cannot establish a fresh Git-triggered build, leave it out of that chart and state why.
