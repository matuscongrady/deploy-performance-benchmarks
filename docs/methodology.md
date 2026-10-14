# Measurement rules

## Packaging

Use one local monotonic clock for elapsed intervals across every provider. Save its start/end nanoseconds, Linux boot ID and clocksource in immutable per-attempt evidence. Observe UTC separately for log correlation. A system-time correction must not change the measured interval or cause the runner to lose its original record. Keep the wall/monotonic offset diagnostic; do not enlarge a wall-time tolerance or correct results afterward. Continuity alone does not prove clock-rate accuracy: local WSL results remain diagnostics until a whole comparable cohort is repeated on an independently qualified controlled host.

Local Lambda packaging records two times from the same invocation. **Build the upload packages** starts at the first native build invocation, includes build planning, dependency installation or copying, bundling and archiving, and ends when every selected function ZIP, required shared layer and separate source map is ready. **Run the complete packaging recipe** starts immediately before its command and ends when the command returns. Keep both times. CLI startup, configuration loading or credential setup before the native build belong to the complete recipe time.

The build chart compares only the first boundary. A complete native ZIP that matches an uploaded ZIP proves the artifact, but does not prove that a private build bridge and an ordinary CLI command timed the same work. Label the operation chart with the actual command or bridge recipe; its numbers do not establish an ordinary CLI or packaging-engine ranking. Historical operation-only records have no build time. Do not calculate one by subtracting startup diagnostics afterward.

Initial fixture and tool dependency installation is outside both local Lambda clocks. Dependency installation or copying performed by the native packager to complete its output stays inside both clocks. Container builds include the dependency installation performed by their native recipe; disclose it and its cache state. Save exact lockfiles and installation commands. Managed builders use reliable native build-phase events, with scheduling, checkout and deployment excluded. A missing reliable boundary is unavailable.

### Evidence for the matched Lambda build clock

Use a fresh, reviewed campaign ID and preserve the original native monotonic markers. Linux's shared monotonic clock lets a CDK child build and its parent publisher describe one interval. The candidate's original trace supplies two monotonic/performance clock anchors and one successful `package:build-and-archive` span. Its build context must match the pre-command input and configuration digests. Wall time, output-file modification times and separate diagnostic runs cannot establish this interval.

Before the command, save hashes of the copied application, lockfiles, generated native configuration and reviewed instrumentation. The qualification pins configuration and instrumentation digests and retains a separate native boundary/runtime proof. The result binds the original markers to the current application, provider, attempt, fixture and source SHA, then checks every final ZIP/layer/map against the actual complete artifacts. The marked build interval must fall inside the measured command. Artifact verification, business probes and evidence inspection happen after the command; they do not extend either speed result.

Missing, repeated, reversed, failed, late or mismatched markers leave the attempt unqualified. Keep that attempt and its original trace. Enable the build comparison only after candidate, Serverless Framework, SST and CDK each have ten passed matched samples in the same fixture, cache series, campaign and host capacity. Each round uses one shared run ID and exact source SHA across all four providers; an incomplete round or a different source schedule blocks the comparison. Do not mix provider versions, settings or instrumentation within that comparison. The summaries expose `buildPublishable` separately from operation and size eligibility.

Run two separate series: a clean build with build artifacts removed, and a source edit after a completed build with normal build caches retained. Dependencies stay installed in both. Record the exact directories removed. Never silently blend the two series.

For the Lambda “Upload size” chart, count every compressed function ZIP, every required shared layer once, and every separately uploaded native source map once at its actual raw byte length. Keep code ZIP/layer bytes and separate source-map bytes as visible details; the headline is their total. Maps already inside a ZIP are included in that ZIP’s bytes and are not counted again. Save hashes and file lists for all upload files. Prove that those same artifacts were uploaded during an untimed qualification deployment and that every packaged handler passes its business probe. A JavaScript bundle, staging directory or synthesized template alone is not an upload package.

For containers, use the platform’s usual builder: the candidate’s automatic packaging, Ravion Railpack, Render’s native runtime, Heroku buildpacks, and SST/CDK’s built-in Docker image builds. SST/CDK get normal application Dockerfiles; the candidate does not use them. Record the builder/version, build commands, plan, CPU/memory, region, language runtime and output format. OCI compressed image bytes, uncompressed image size and Heroku classic slugs are different measures. Compare only identical formats. An inaccessible artifact has no size result; it does not have size zero.

### Managed build timing when artifact size is unavailable

Render, Ravion or Heroku may expose a successful native build phase without exposing artifact bytes. For the single Node.js or Python API packaging test, admit its time separately as `format: "provider-native"`, `name: "api"`, `complete: true`, `bytes: null` and `sizeAvailable: false`. This format is unavailable for Lambda packaging and local Docker builders. Ten qualified timing attempts can support a speed chart; they cannot support a size chart. Size summaries remain `null`, with zero measured size samples and `sizePublishable: false`.

The qualification must identify the managed native observer and include `artifacts.businessExpected`: the fixture's complete expected business response, including the current source revision. The observer must obtain source identity, native build ID, phase timestamps and successful native completion from the platform's actual build records. A static qualification declaration is not per-attempt evidence. An observer that cannot establish these facts remains a qualification prerequisite; do not estimate a build phase from total deployment duration.

Save the observer's original JSON and its SHA-256 in the result's `evidence` list. The artifact's `nativeBuild` references that same file as `evidenceFile` and `evidenceSHA`, and includes `runId`, `sourceCommit`, `scenario`, `appId`, `provider`, `nativeBuildId` and `phase`. `phase` contains `startedAt`, `finishedAt` and `status: "succeeded"`; those timestamps must equal the packaging record's timer boundaries. Dependency installation performed by the native builder stays inside that phase. Scheduling, deployment and business verification stay outside it.

The original observer JSON has this structure (replace the illustrative identity, timestamps and response with actual observations):

```json
{
  "schemaVersion": 1,
  "runId": "native-001",
  "sourceCommit": "<full current source SHA>",
  "scenario": "package-node",
  "appId": "example-api",
  "provider": "render",
  "nativeBuildId": "<observed native build ID>",
  "buildPhase": {
    "startedAt": "<native build start>",
    "finishedAt": "<native build completion>",
    "status": "succeeded"
  },
  "nativeCompletion": {
    "nativeBuildId": "<same native build ID>",
    "sourceCommit": "<same source SHA>",
    "status": "succeeded",
    "finishedAt": "<successful native completion>"
  },
  "businessVerification": {
    "verified": true,
    "nativeBuildId": "<same native build ID>",
    "sourceCommit": "<same source SHA>",
    "observations": [{
      "name": "api",
      "observedAt": "<probe time after native completion>",
      "expected": {"revision": "<current revision>", "<business fields>": "<fixture expectations>"},
      "observed": {"revision": "<current revision>", "<business fields>": "<actual response>"}
    }]
  }
}
```

Copy `businessVerification` exactly into the artifact summary and `buildPhase` into `nativeBuild.phase`. Import rereads the checksum-bound original JSON, compares all identities and summaries, requires successful completion of the same build/source, and verifies business observations occur after completion. It also checks the observed response against the qualification's full fixture expectations. A native success message alone, a previous revision's response or a build ID copied from another attempt does not qualify.

## Deployment

Create the application before measurement. Verify its baseline business output and source revision. Account setup, initial infrastructure provisioning, build-tool installation for local CLI tests and credentials setup are untimed. Keep the timed source edit and the final source commit in the record.

The Lambda updates change all selected functions. Each function has its own revision file, so this does not create an artificial shared-file dependency. The five-service update changes API, reporting and notifications; inventory and webhooks retain their original build contexts. Record hashes of each context before and after.

For CLI, start before the update command and probe the expected business revisions while it runs. Stop at the first verified response from every selected component. Include packaging, upload and rollout up to that point. Native command success, final business checks and rollback/stability admission happen afterward; a failed native deployment disqualifies the earlier readiness observation. For Git push, start before `git push` and probe concurrently; include scheduling, checkout, tool/dependency installation, building, upload and rollout up to first business readiness. After native terminal success, verify every business revision again before admission. These final probes stay outside the first-readiness timer. `commandDurationMs` is diagnostic, not the deployment result.

Stop when all changed components pass their business probes with the new revision and all unchanged components pass with the baseline revision. Reporting and notification probes submit new job IDs. A health endpoint, old replica response or CLI success alone is insufficient. Save the probe responses and observation timestamps.

The timer measures first verified business readiness. Acceptance also requires the native update to succeed. SST's container command can return before ECS completes its rollout, so the runner checks every changed service reaches `COMPLETED`, then repeats its business/revision probes. Those checks happen after the timer; a failed rollout, timeout or rollback disqualifies the attempt. CDK's pinned hotswap implementation already waits for ECS stability before returning. Neither finish line claims that a single early response proves a completed rollout.

Use the fastest supported cloud update path for the tested source edit. The candidate uses automatic fast deployment/hotswap; CDK uses hotswap; Serverless uses function deployment; SST uses its cloud deploy command. Local SST Live execution is not a deployed cloud service. If the fastest path uses different rollout guarantees, development-only behavior or infrastructure drift, disclose it beside the chart. Do not describe these paths as equivalent production rollouts.

For Lambda updates, retain the function identities, configuration hashes, code hashes and layers before and after the native command. SST 4.17.2 replaces its hash-named code and source-map upload objects as part of an ordinary code update. Those replacements are allowed only for the selected functions in the exact app/stage and qualified asset bucket. The observer checks bucket ownership and region outside timing, matches both object keys to the observed Lambda ZIP hashes, and checks the complete native replacement history and logical summary. Function, role, unrelated object or infrastructure replacements still disqualify the attempt. A failed history is retained with only operation metadata and whitelisted bucket/key fields; raw native inputs, outputs and error messages are excluded.

## Fresh and repeat CI

“Fresh CI” means an existing application updated through an ephemeral runner with no restored dependency/build cache, or a hosted platform build with a documented fresh-cache control. It does not mean creating the application for the first time. A fresh VM can restore caches; save both runner identity and cache logs.

For the repeat series, complete the previous update and verify readiness. Wait 15 minutes from that observation, change the source revision, then push. Save restored/missed cache keys and the builder’s reuse logs. Label the website chart “Another push after 15 minutes.” Mention “warm” only where reuse was demonstrated.

For the candidate's fastest Git path, qualify its native Console CI, including actual fresh-runner creation and the observed runner/cache state after 15 minutes. The supplied candidate GitHub Actions workflow is a separately labelled fallback. Do not present an ephemeral Actions runner with restored caches as a native Console runner, or combine those two pipeline engines into one result series. Framework competitors can use their native CLI through GitHub Actions; hosted platforms use their native Git automation.

Managed platforms may use different machines and caches from GitHub Actions. Publish those differences. If clearing a managed cache starts a deployment itself, that deployment cannot serve as a cache reset immediately followed by a supposedly untouched timed Git push.

## Repetitions and website results

Qualification runs are untimed and kept separately. Perform ten measured attempts for every published provider/scenario/cache series, alternating provider order rather than running one provider’s entire series first. Use a different revision per attempt. Keep failures, timeouts and retries; do not keep only the fastest runs.

Show median and min/max, sample count, versions, native settings and the source/data links. Keep full raw records and evidence so readers can calculate other statistics. A provider with missing prerequisites is “not measured”; it does not lose with an invented duration. A chart cannot support a claim that one tool wins every benchmark outside the tested matrix.

Stop iterating a fixture or timing rule once the comparative series starts. If application code, native settings or instrumentation changes, start a new versioned series for every affected provider. Optimizing the candidate is allowed; competitors keep their fastest supported paths and the disclosed usual settings. Publish the final version and the complete final series.
