# Provider setup

The repository can generate provider projects without credentials or cloud access. Generated projects go in `.work/`. A command plan is a recipe, not a successful benchmark: every provider still needs artifact and runtime qualification before its results can be published.

Use disposable resources and a neutral run name. Keep account IDs, tokens, connection ARNs and service URLs in local environment variables or ignored state files. Never put them in a test branch.

## Tools and source

Tool packages and their transitive dependencies are pinned under `providers/tools/`. Run `npm ci --prefix providers/tools/cdk`, `npm ci --prefix providers/tools/sst`, or `npm ci --prefix providers/tools/serverless` before using the corresponding adapter. Generated command plans include these installs outside the measured interval.

| Provider | Pinned local tool | Build/deploy path |
| --- | --- | --- |
| Candidate | Supplied executable and SHA-256 | Native JavaScript bundle builder; native source buildpack for Python; automatic fast update |
| Serverless Framework | 4.43.0 | Built-in esbuild, individual ZIPs, `deploy function` for each changed function |
| SST | 4.17.2 | Cloud deployment; usual production function builder; native ECS image builder |
| CDK | CLI 2.1145.0, library 2.273.0 | NodejsFunction; `deploy --hotswap`; native ECS image builder |
| Ravion | CLI 1.14.3 | Native Railpack build/deploy pipeline, current standard module defaults |
| Render | CLI 2.28.0 | Native Node/Python runtime, Git automation or commit-specific manual deployment |
| Heroku | CLI 11.11.0; official builds plugin 2.0.4 | Cedar Basic, official Node/Python buildpacks; native source/cache qualification required |

Record the actual executable version and hash before a run. Hosted builders and runtime patch releases can change even when a local CLI is pinned; save their reported versions and build capacity. Generated Serverless configurations require the exact `frameworkVersion: 4.43.0`. The Serverless npm package starts a downloaded CLI: verify the downloaded executable reports the pinned version instead of assuming that the npm lockfile alone proves it.

## Candidate

Set `CANDIDATE_CLI` to the absolute path of the reviewed executable. Record where the binary came from, its version, commit and SHA-256. Keep the generated file named `candidate.yml` and retain the neutral `projectName`.

For JavaScript, the recipe uses the CLI's optimized `js-bundle` packaging. Node container output is explicitly ESM because the original `.mjs` server starts through an `import.meta.url` entrypoint guard; this is source compatibility, not a shared minification policy. It does not replace the builder with a hand-written Dockerfile. Python uses the CLI's native `buildpack` source builder. The configuration pins Node's major version to 22 while keeping native production minification, map and shared-layer defaults.

Initial setup uses `deploy --fullDeploy`. Timed updates use ordinary `deploy`, which must attempt the automatic fast path. Confirm the actual selected path in the operation evidence; a full fallback is a different result. Package measurements must include every final function ZIP and shared layer ZIP, counting a shared layer once.

The candidate recipe intentionally stays blocked until the supplied artifact passes the complete-artifact and live revision probes. A path to an old binary is not evidence that it contains the reviewed fast-deployment fixes.

## Lambda competitors

Functions are invoked directly. An API Gateway is unnecessary for these tests. After setup, save each native function ARN/name in an ignored binding file and run the fixture's business probe against every selected function. A successful CLI exit is insufficient.

Serverless Framework uses its built-in esbuild builder. Production minification is enabled and source maps are disabled. The report's PDF/Excel/Word libraries are installed with their runtime assets rather than bundling code that cannot find its fonts or other files. Generated package rules exclude protocol plans, qualification state, native output bindings and logs. Every changed function receives its own `deploy function` command. The wrapper runs at most eight native commands concurrently and waits for all of them; set and record `BENCH_FUNCTION_CONCURRENCY` to change the limit. The total update includes the complete command group. Each command gets its own source/config working directory so concurrent packaging cannot overwrite another function's files. Dependencies are shared through links; the measured wrapper includes this small working-directory preparation.

CDK uses `NodejsFunction` with production minification, maps disabled and the report libraries installed with their assets. Its timeout and memory match the other recipes. The untimed install step links the pinned esbuild tool into the generated application's dependency tree. The packaging adapter synthesizes the native app, then calls `FileAssetHandler.packageFile` from pinned `@aws-cdk/cdk-assets-lib` 1.5.1 to create the publisher's final ZIPs without uploading. Archives run with the pinned CLI's eight-way asset-publish concurrency, since file zipping occurs in that phase. It finds code assets through the template's S3 keys, captures functions and layers once, and excludes the infrastructure template. Any AWS access through this bridge throws. This is a bridge to a private native API, so compare its final ZIPs with a real deployment before qualifying the row; `cdk synth` alone is not the measured boundary.

CDK's `--hotswap` path is included because this comparison requests fast updates. CDK documents it as a development feature that introduces CloudFormation drift. Record that guarantee alongside the speed result.

SST uses cloud `deploy`, never Live mode. Its production function builder keeps its own defaults and installs the report libraries with runtime assets. Its packaging bridge calls the unmodified Node runtime from the checksum-pinned 4.17.2 release, then executes that release's exact Function archive code as soon as each build completes with its pinned archiver and glob dependencies. This includes runtime dependency installation, encrypted resource metadata and final ZIP creation; it excludes source maps that native production packaging uploads separately. SST has no official standalone packaging command, so this bridge must pass native deployment parity before its timing can appear in a comparison.

### Repeat the local complete-ZIP checks

Prepare the selected Lambda scenario with the repository harness. Run the generated plan's `commands.install` once, outside timing, then its `commands.package` in the generated project directory. CDK needs Node and npm. SST's untimed bridge preparation also needs Docker; it downloads the checksum-pinned source archive and compiles it with a digest-pinned Go image. It does not mount AWS credentials or run a cloud operation.

SST native packages contain `resource.enc`. Set `SST_PACKAGE_ENCRYPTION_KEY` to the selected app's encryption key through the environment when checking exact deployment parity. Never save that value in the repository or command plan. A public test key can be generated for local business checks with `Buffer.alloc(32).toString('base64')`; that check cannot establish byte equality with a deployed app using a different key.

Both bridges write `package-artifacts/manifest.json` with every final ZIP, its bytes and SHA-256. In the generated project, run `node /absolute/path/to/repo/providers/probe-packages.mjs`. This unpacks the actual ZIPs and invokes every selected handler with its business input. The probe reads each current source revision and rejects a valid ZIP from an older source revision. It checks the PDF, Excel and Word output from the report function as well as the smaller handlers. These checks do not make AWS requests. For other providers, give `providers/check-lambda-zips.mjs` an artifact-binding JSON file, the fixture manifest, the workload ID and the generated project directory. Each function binding must include its original name, ZIP path, actual handler and module filename; shared layer bindings have `role: "layer"`. The helper extracts standard Node layers and runs every handler in an isolated process. Set `BENCH_NODE` to the chosen Node executable when qualifying runtime compatibility. If the host runs another Node major, set it to the absolute path of `providers/node22-runtime.mjs`; that wrapper invokes each handler in the digest-pinned Node 22 image with networking disabled and only its temporary extraction directory mounted. Pull that image before timing.

Native packaging may install dependencies in newly created artifact directories. Retain their generated lockfiles in ignored evidence: the native dependency installation and archive behavior must be reproduced, rather than replaced with a faster custom implementation. The bridge commands currently include artifact manifest capture in their measured interval; disclose that small overhead alongside the method.

## Native container builders on SST and CDK

The competitor recipes use SST's `aws.Service` image builder and CDK's `ContainerImage.fromAsset` on ECS/Fargate. They use simple, average-quality provider-owned Dockerfiles: an official slim image, locked dependency installation, source copying and the normal start command. There is no custom bundler, cache mount or elaborate multi-stage optimization. The candidate keeps its automatic optimized builder; it is not forced to build these Dockerfiles.

Standalone branch configs and generated projects explicitly select `Dockerfile.cdk` or `Dockerfile.sst`. Both use the same recipe bytes and source files; the runner does not add a default `Dockerfile`. Their shared `.dockerignore` keeps both recipes out of the runtime image. CDK retains its selected recipe in the staged build context, as required by its native asset builder, and excludes the other recipe. This keeps the asset identity stable when a standalone baseline is followed by a runner update.

Each generated Node Dockerfile installs the locked production dependencies before copying source. Python installs the hash-locked requirements before copying source. The official Node 22.22.0 and Python 3.11.14 slim base images are pinned by registry digest. Both bind port 3000. Each of the five services has its own context and dependency lockfile, so changing three service revisions preserves the other two contexts exactly.

The initial deployment creates an owned VPC, ECS cluster and HTTP service load balancers. Setup is outside the timed update. Keep the resource name stable across baseline and update; changing it creates a different stack. The generated CDK VPC has public task subnets and no NAT gateway. SST retains its native VPC defaults. Record the selected network and runtime capacity; account/region checks and verified cleanup remain required.

Timed CDK updates use `deploy --hotswap`. Its native ECS hotswap behavior can lower the minimum healthy task count and change availability guarantees. SST uses cloud `deploy` with its default `wait:false`; the shared runtime probe continues after the CLI exits. In both cases, the finish line remains the new version and business response from every changed service, with both unchanged services checked at their prior revision.

SST container qualifications also need `nativeResources`, with `{name, type: "ecs", arn, clusterArn}` for every service, from the baseline outputs. These apply to CLI and Git tests. They must match the qualified account, region, application and stage. Wait for baseline ECS rollouts to complete before timing. The runner records their deployment IDs, checks changed services finish a new ECS rollout after the readiness timer, then verifies the expected business revision again. A stale baseline snapshot, rollback or failed rollout cannot pass on the strength of an earlier response. Preserve these read-only observations; the account role needs ECS service inspection permissions.

The local `package-container.mjs` helper builds the explicitly selected named Dockerfile with Docker and captures the image identity and recipe hash. It is a diagnostic of the image-build phase. It becomes a valid isolated native build measurement only after evidence shows that its platform, builder invocation, build arguments and cache behavior match the actual SST/CDK deployment and that the produced image matches the uploaded digest. Set `BENCH_DOCKER_NO_CACHE=1` for a cache-disabled diagnostic: the helper passes Docker's actual `--no-cache` flag and records that command. Native deployment cache controls must still be qualified separately. Its manifest deliberately leaves compressed size unavailable. A synthesized template does not prove an image has been built. Record compressed OCI bytes from the qualified registry image, never local unpacked size or a `docker save` tar. Keep registry inspection outside the build timer. Remove the helper's recorded local image tags after qualification; cloud resource deletion does not remove them.

## Render

The adapter writes a `render.yaml` blueprint using native Node/Python services and their original source directories. Create it from the neutral repository in the intended workspace. The blueprint selects Starter runtime instances; record the actual workspace plan and build-pipeline CPU/memory separately. Do not upgrade the builder silently.

Set `RENDER_SERVICE_API` for the single-container case. For five services, set `RENDER_SERVICE_API`, `RENDER_SERVICE_REPORTING`, `RENDER_SERVICE_INVENTORY`, `RENDER_SERVICE_WEBHOOKS` and `RENDER_SERVICE_NOTIFICATIONS`. Set `BENCH_COMMIT` to the full commit SHA for a manual run. The recipe uses `render deploys create SERVICE --commit SHA --wait`. For five services, the three changed services are triggered concurrently, every native command must succeed, and the shared live probes check all five services. Supplied IDs and an exact commit unlock recipe qualification; they do not prove it has passed.

Native Git automation uses the provider Git connection and blueprint source paths. The two unchanged service directories must not be edited. Observe whether the provider skips them; do not force a build just to make counts look equal.

Render's native runtime artifact is not automatically an exported OCI image. Keep its artifact format visible and leave image size unavailable unless an equivalent, measured value can be established. A deployment duration includes more than build time. A cold Git test needs a verified fresh cache; Render's clear-cache deployment command itself starts a deployment and cannot be treated as a cache-only preparation step.

## Ravion

Ravion's current modules are account-discovered schemas. The adapter provides schema discovery and native run commands rather than inventing a module input file. In the connected account, inspect `ravion project config schema`, `ravion module definition list` and `ravion module schema rvn-ecs-web`. Create or pull the owned project configuration through the CLI, select the default Railpack source builder, and export the resulting project and pipeline files into the campaign's ignored evidence directory.

Use a new standard module with its actual default Sandbox builder. Current docs describe 14 vCPUs, 28 GiB memory and 30 GiB disk. Older migrated modules may retain EC2 settings, so their stored capacity must be inspected instead of called the default. Preserve independent build contexts and lockfiles for all five services.

The qualified pipeline must accept a `commit` input, build that exact source revision and deploy it. Set `RAVION_PIPELINE_ID`, `RAVION_VARIANT_ID` and the full `BENCH_COMMIT` only after validating that contract. Supplied bindings unlock recipe qualification; saved native pipeline and artifact evidence still have to pass review. `providers/hosted.mjs` creates the native run, waits for that returned run ID, and reports a small non-secret status record. Save module version, Railpack version, builder capacity and actual cache restoration evidence. The wrapper itself does not prove commit attribution or runtime readiness.

Do not use pipeline queue time as packaging time. Extract the actual build step interval and match the produced ECR digest and compressed image size to the deployed revision. Git-trigger wiring is validated separately; the CLI run command does not substitute for a push.

## Heroku

Use Cedar Common Runtime Basic with the official Node/Python buildpacks for the low-cost comparison. Basic is always on and is billed for its actual lifetime. Keep the actual builder version, stack, runtime version and compressed slug identity/size. Slug sizes have a separate format from OCI image bytes. Fir requires a Private Space; switching to it is a separately priced change, not an automatic prerequisite for including Heroku.

The account needs billing verification and CLI authentication. The native measurement recipe remains blocked until source-root, cache, exact-build attribution and runtime probes have been qualified. Heroku is included in the planned matrix; account access alone does not qualify its measurements.

Install the pinned tools outside timing and sign in interactively:

```sh
npm install --prefix ~/.local/share/benchmark-tools/heroku-11.11.0 heroku@11.11.0
ln -s ~/.local/share/benchmark-tools/heroku-11.11.0/node_modules/.bin/heroku ~/.local/bin/heroku
heroku plugins:install @heroku-cli/heroku-builds@2.0.4
heroku login
```

Preserve an existing executable rather than replacing it with this example link. Do not record the CLI's credentials or source archive download URLs in public evidence.

Heroku's native app source belongs at the build root. Stage the selected fixture into an app-only source branch or use a plain Git subtree projection; do not replace the official buildpack with a third-party monorepo buildpack. Keep the original scenario commit, derived commit and verified application-file tree mapping as immutable evidence. Document native additions such as `Procfile` and runtime selectors. For Python, qualify the pinned patch first: Heroku supports only the latest patch for each major version. If its supported `3.11` selector is needed, disclose that native configuration and the exact resolved runtime.

The CLI journey uses the native direct Heroku Git deployment. The GitHub journey pushes to a connected app-only GitHub branch and uses Heroku's automatic deployment. They have different push destinations and pipeline boundaries; keep those visible in the results. Five services need five independently bound apps and source inputs. The three changed inputs deploy concurrently; preserve the two unchanged source/artifact/release identities. A projection must not manufacture new commits for unchanged application trees, since that could trigger unnecessary native builds. Record and verify every native commit against the scenario's selected source before translating it into the shared result identity.

For a fresh build, use the official plugin's `heroku builds:cache:purge --app OWNED_APP` outside the Git-push timer and save its native response, then verify cache observations during the measured build. Repeat builds retain normal native caches. Use native build-phase evidence for packaging; the total Git push/build/release duration is a deployment measurement. Inspect the compressed slug through the native Build/Slug API and downloaded proof outside packaging time; do not substitute an extracted directory's size.

After the paired batch, destroy only the recorded owned apps using `heroku apps:destroy --app OWNED_APP --confirm OWNED_APP`. Verify those exact app IDs are absent and that no campaign-owned dynos/add-ons remain. No Eco subscription, Private Space, database or paid add-on is required by these fixtures.

Sources: [pricing](https://www.heroku.com/pricing/), [billing](https://devcenter.heroku.com/articles/usage-and-billing), [Git deployment](https://devcenter.heroku.com/articles/git), [GitHub deployment](https://devcenter.heroku.com/articles/github-integration), [official cache purge](https://devcenter.heroku.com/articles/slug-compiler), [Python runtime policy](https://devcenter.heroku.com/articles/python-support), [slug API](https://devcenter.heroku.com/articles/platform-api-reference#slug).

## Before a campaign

Qualify setup, one source edit, runtime revision/business probes, artifact capture and deletion for each selected provider. Retain exact commands and recoverable resource ownership in ignored state. Check the account/region before creating or deleting resources. Test branches contain the reproducible recipes; cloud bindings are local campaign state, never committed credentials.

Sources checked October 10, 2026: [SST Function](https://sst.dev/docs/component/aws/function/), [SST Service](https://sst.dev/docs/component/aws/service/), [CDK NodejsFunction](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_nodejs-readme.html), [CDK container assets](https://docs.aws.amazon.com/cdk/v2/guide/build-containers.html), [Render native runtimes](https://render.com/docs/native-runtimes), [Render deploys](https://render.com/docs/deploys), [Ravion build modules](https://www.ravion.com/docs/modules/build), [Ravion project configuration](https://www.ravion.com/docs/config-as-code/project-config-file), [Heroku buildpacks](https://devcenter.heroku.com/articles/buildpacks).

## Native bridge source and licenses

The SST bridge downloads [the 4.17.2 source release](https://github.com/anomalyco/sst/tree/v4.17.2). It compiles the unmodified `pkg/runtime` implementation and extracts only the archive body from `platform/src/components/aws/function.ts`; the downloaded source retains its [MIT license](https://github.com/anomalyco/sst/blob/v4.17.2/LICENSE). The installer also saves that license beside its extracted archive code. Compiled bridges, extracted upstream code and per-run packages remain ignored local build outputs.

The CDK bridge imports the pinned asset library from its installed npm package. Its [source](https://github.com/aws/aws-cdk-cli/tree/main/packages/%40aws-cdk/cdk-assets-lib) and installed [Apache 2.0 license](https://github.com/aws/aws-cdk-cli/blob/main/LICENSE) identify the upstream implementation; this repository does not replace its archive recipe. Both bridges record their exact method and still require qualification against a native deployment.
