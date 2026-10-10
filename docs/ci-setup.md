# Git-push deployments on GitHub Actions

The deployment workflow is checked in, but disabled. It runs only when the repository variable `BENCH_CI_ENABLED` is exactly `true`. Preparing or publishing this repository does not enable it.

This workflow covers candidate, Serverless Framework, SST and CDK. Render and Ravion use their own Git-triggered pipelines. Heroku still needs its account and buildpack decision. Do not route those platforms through this workflow and call that their native Git deployment.

## First create and check the application

Follow [provider setup](provider-setup.md) and deploy the baseline outside the timer. Keep its application ID, stage and region fixed. Save the native stack name, each function name or service URL, its baseline business response and the cleanup commands.

Prepare the same fixture and provider selected by the test branch. The workflow reads `.benchmark-test.json`; it refuses packaging tests and CLI-only deployment tests. Make the prescribed source edit on a `trial/...` branch derived from `test/...`.

You can inspect the generated CI commands locally without installing tools or contacting AWS:

```sh
BENCH_PROVIDER=serverless BENCH_APP_ID=commerce-five BENCH_REGION=eu-west-1 \
  node scripts/ci.mjs --plan-only deploy-lambda-5-git-cold
```

The plan includes setup and cleanup commands for reference. CI executes **only installs and updates**. It checks that the baseline stack exists and that its business/revision probes work before an update. It never performs the initial setup or automatic cleanup.

## Configure the repository

In GitHub, open **Settings → Secrets and variables → Actions**. Create these repository variables:

| Variable | Value |
| --- | --- |
| `BENCH_CI_ENABLED` | Leave unset or `false` until the campaign is approved |
| `BENCH_PROVIDER` | `candidate`, `serverless`, `sst` or `cdk` |
| `BENCH_APP_ID` | The application ID used for the existing baseline |
| `BENCH_REGION` | Its AWS region |
| `BENCH_STAGE` | Its stage; defaults to `bench` |
| `BENCH_CANDIDATE_SHA256` | Candidate only: the reviewed executable's SHA-256 |

Create these repository secrets:

| Secret | Purpose |
| --- | --- |
| `BENCH_AWS_ROLE_ARN` | The disposable account's GitHub OIDC role |
| `BENCH_QUALIFICATION_JSON` | The reviewed qualification described below |
| `SERVERLESS_ACCESS_KEY` | Serverless Framework only: its account access key |
| `BENCH_CANDIDATE_ARTIFACT_URL` | Candidate only: HTTPS URL of the reviewed Linux x86-64 executable |
| `BENCH_CANDIDATE_ARTIFACT_TOKEN` | Optional bearer token needed to download that executable |

Keep account IDs and resource bindings in the qualification secret, not in branch files. The candidate URL must return the executable itself, rather than an archive. The downloader verifies its SHA-256 before making it executable. It forwards the bearer token only to the original download host; an HTTPS redirect to a different host receives no token.

One repository configuration selects one provider/application at a time. Keep a separate existing application for each provider. Change the variables and qualification deliberately between series. Concurrent updates to the same selected application are queued rather than cancelled.

## Give GitHub access through OIDC

In the disposable AWS account, configure the GitHub OIDC identity provider with audience `sts.amazonaws.com`. Limit the role's trust to this repository and its `trial/...` branches. The subject pattern is `repo:OWNER/REPOSITORY:ref:refs/heads/trial/*`. Do not trust every repository or every branch.

Give the role access only to the benchmark resources and the native artifact/cache stores needed by the selected tool. Fast updates need Lambda or ECS update permissions, artifact access and any required role passing. Some tools also inspect CloudFormation or can fall back to a full update; qualify their actual policy with the baseline. Do not use an administrator role from an account containing production.

The workflow requests short-lived credentials using the pinned official AWS action. It verifies the returned account against the qualification before any update. No long-lived AWS access keys belong in GitHub secrets for this workflow.

See [the AWS action's OIDC setup instructions](https://github.com/aws-actions/configure-aws-credentials/tree/7474bc4690e29a8392af63c5b98e7449536d5c3a#oidc).

## Prepare the qualification for each push

Start with the deployment qualification in [the runbook](runbook.md). In addition to its complete baseline and updated probes, supply these fields:

```json
{
  "appId": "commerce-five",
  "stage": "bench",
  "nativeStackName": "REPLACE_WITH_EXISTING_STACK_NAME",
  "environment": {
    "region": "eu-west-1",
    "accountId": "REPLACE_WITH_DISPOSABLE_ACCOUNT_ID"
  },
  "pipeline": {
    "branch": "trial/lambda-five-001",
    "sourceCommit": "REPLACE_WITH_FULL_COMMITTED_SOURCE_SHA",
    "configurationEvidence": "REPLACE_WITH_REVIEWED_WORKFLOW_AND_SETUP_REFERENCE",
    "workflowSha256": "REPLACE_WITH_SHA256_OF_DEPLOY_WORKFLOW"
  }
}
```

`nativeStackName` applies to candidate, Serverless Framework and CDK. SST uses Pulumi and has no application CloudFormation stack. For SST, omit `nativeStackName` and provide `nativeResources` instead: one entry per selected function or service, using the ARNs from the qualified baseline. For Lambda use `{name, type: "lambda", arn}`. For ECS use `{name, type: "ecs", arn, clusterArn}`. CI reads every resource and checks its account, region, `sst:app` and `sst:stage` tags against the generated app. A missing or differently tagged resource fails before the update. The OIDC role needs `lambda:GetFunction` and ECS service/tag read permissions for those checks.

This is an addition to the qualification, not a complete example. Keep `scenario`, `provider`, `approved`, actual tool version, cache series, settings and the original qualification evidence references. The approved qualification is the operator's reviewed binding to an application; CI does not recreate the original artifact qualification from those references. Keep the original evidence with the external campaign records.

Get the workflow checksum with:

```sh
sha256sum .github/workflows/deploy-benchmark.yml
```

Commit the source edit first, then put that commit's full SHA in the qualification secret. Its scenario, provider, application ID, region, stage and trial branch must match. Every changed function/service's updated probe must expect the new revision. Unchanged services keep their previous revision.

A repeat-push qualification must also contain `previousReadyAt`, copied from the preceding deployment's verified readiness time. CI refuses a repeat before 15 minutes have elapsed. The operator must also wait before calling the external push runner; a queued job is not a substitute for that wait.

Command probes use this exact form:

```json
{
  "name": "cart-pricing",
  "argv": ["node", "scripts/invoke-lambda.mjs", "QUALIFIED_FUNCTION_NAME", "eu-west-1", "{}"],
  "expected": {"subtotal": "33.00", "currency": "USD", "revision": "trial-001"}
}
```

CI accepts only that native Lambda helper for command probes. Service probes use HTTP or HTTPS URLs without embedded credentials and the fixture's business requests. Five-service component snapshots use `node scripts/component-state.mjs ecs REGION CLUSTER SERVICE`. Other commands and shell scripts in qualification JSON are refused.

## Cold and repeat pushes

A cold test uses a fresh GitHub-hosted VM and restores no Actions dependency/build cache. The VM still contains GitHub's standard tools. Existing application-side caches and remote registry caches may also exist; record them separately. “Cold CI” does not mean erasing the deployed application's artifact store.

The workflow saves these narrowly scoped caches after a successful deployment:

| Provider | Cached paths |
| --- | --- |
| Candidate | npm's package download cache |
| Serverless Framework | npm's package download cache |
| CDK | npm's package download cache |
| SST | npm's package download cache and generated platform dependencies |

Before measuring a repeat series, complete an untimed workflow deployment on the same trial branch to populate its cache. GitHub restricts cache visibility by branch; a cache saved on a different trial branch may not be available. Wait 15 minutes after that deployment passes every probe, then commit another revision, update the qualification secret and push again.

A repeat push restores a compatible cache from the same provider, fixture, application ID and dependency locks. It uses a new VM. It does not restore cloud credentials, CloudFormation state, qualifications or arbitrary caller-supplied paths.

`ci-evidence.json` records the actual matched cache key and whether it was an exact match. A prefix match is a real restoration too. A miss stays a miss. Restoring npm downloads does not mean a compiler or container builder reused its output. Docker layers and candidate remote build caches need their own native hit/miss evidence; this workflow does not manufacture it or label every repeat run warm.

## Measure and keep the evidence

After approval, enable `BENCH_CI_ENABLED`, configure the qualification secret, and use `scripts/git-push.mjs` as described in the runbook. Its clock starts before the push. Runner scheduling, checkout, Node setup, cache restoration, candidate download, tool/dependency installation, authentication, building, uploading, deployment and business checks all fall inside that elapsed interval.

The GitHub job runs each adapter's fastest selected native update commands. It verifies the actual local CLI version before the update. The candidate executable is checked against the qualification's hash. It checks every required business response and revision after the native command succeeds, including unchanged service identities for the five-service case.

The `ci-...` Actions artifact contains native command logs and `ci-evidence.json`, tied to the source SHA, runner image, run ID and attempt. These are supporting evidence, not an alternative elapsed-time result. Download them into the campaign's ignored evidence directory and match them to the external push record. Check the native logs for the actual fast/fallback path and build/cache reuse before admitting a chart result.

Known secret values and account IDs are redacted from saved command logs. Still review artifacts before publishing them: resource names, URLs and native output can need further sanitization. Do not upload the qualification secret or credential files.

When a series finishes or fails, disable the workflow and use the saved provider cleanup commands outside CI. Verify deletion in the disposable account. Remove the temporary OIDC role/trust if it was created only for this campaign. Preserve the run records and failures.

All third-party workflow actions are pinned to immutable commits, checked against their official repositories on October 10, 2026: [checkout](https://github.com/actions/checkout/tree/11d5960a326750d5838078e36cf38b85af677262), [setup-node](https://github.com/actions/setup-node/tree/49933ea5288caeca8642d1e84afbd3f7d6820020), [cache](https://github.com/actions/cache/tree/0057852bfaa89a56745cba8c7296529d2fc39830), [AWS credentials](https://github.com/aws-actions/configure-aws-credentials/tree/7474bc4690e29a8392af63c5b98e7449536d5c3a), [upload-artifact](https://github.com/actions/upload-artifact/tree/ea165f8d65b6e75b540449e92b4886f43607fa02).
