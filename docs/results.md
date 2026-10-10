# Result data

Use schema version 1. Each attempt is one JSON file; failures are attempts too. Do not overwrite a failed attempt with its successful retry. The runner saves local attempts automatically. Hosted measurements can be imported after their evidence checksums have been verified.

Required fields:

| Field | Meaning |
| --- | --- |
| `scenario`, `provider`, `runId`, `appId`, `stage` | Exact test, tool, unique attempt and existing application/stage |
| `sourceCommit` | Full 40-character Git SHA of the tested source |
| `kind`, `status` | `package` or `deploy`; `passed`, `failed` or `unqualified` |
| `startedAt`, `finishedAt`, `durationMs` | Observed timer boundaries and elapsed milliseconds |
| `commandDurationMs` | Optional native command elapsed time; not deployment readiness |
| `toolVersion` | Reported CLI/builder version; candidate binary SHA256/source reference |
| `environment`, `timerHost` | Actual builder/CI runner capacity and region; Git push timing machine is recorded separately |
| `settings` | Builder, minification, external dependencies, hotswap/fallback and rollout behavior |
| `cacheEvidence` | Per-attempt test/app/provider/run/source/series binding, observed controls, `proofFile` and `proofSHA` |
| `evidence` | Relative log/artifact paths and SHA256 checksums |
| `readiness` | Deployment business probe responses with correct revisions |
| `artifacts` | Packaging’s complete artifact set, format, sizes and hashes |

For a deployment, `readiness.verified` must be true, with observations of every selected component. For five services, three observations have the new revision and two have the baseline revision. Also retain the baseline commit and response evidence. Five-service records require `reuse.verified: true` and native before/after identity observations for inventory and webhooks, including artifact IDs, deployment ID and configuration hash. Version probes alone cannot establish that those services were reused. A managed build needs build ID, phase timestamps and complete log evidence. Git journeys need the pushed SHA and local push start, plus `pipelineCompletion` showing native terminal success for that SHA. The completion check runs after the business readiness timer. The five-service after snapshot runs only after successful native pipeline completion, so a later replacement cannot escape the unchanged-service check. A failed pipeline cannot qualify a result even if a changed function briefly answered correctly.

A local Lambda artifact qualification looks like:

```json
{
  "qualified": true,
  "format": "lambda-zip",
  "functionCount": 1,
  "files": [
    {"name": "report", "role": "function", "path": "OUTPUT_FROM_NATIVE_BUILDER/report.zip", "handler": "index.handler", "module": "index.mjs"},
    {"name": "shared-dependencies", "role": "layer", "path": "OUTPUT_FROM_NATIVE_BUILDER/dependencies.zip"}
  ]
}
```

Remove the layer entry if there is no layer. The example paths are instructions to replace, not presumed native paths. Use one function entry per selected function. Shared layers appear once. Each function includes its actual runtime `handler` and module filename. After the package timer stops, the runner unpacks every ZIP and invokes its business request in a separate Node process. The response must match the current source revision; stale but valid ZIPs fail qualification. Confirm that the native uploader uses the same artifacts; a generated bundler directory does not pass this check.

For OCI output, save the registry manifest/index and sum unique config and compressed layer blob sizes for one runnable platform image. Attestations, other architectures and manifest envelope bytes are excluded. `docker images` reports a different size; neither that value nor a `docker save` tar is an OCI compressed upload size. Classic Heroku slugs must be labelled `heroku-slug`, with platform-reported compressed size.

An OCI artifact qualification uses a current native build identity and either a selected local manifest or a registry reference:

```json
{
  "qualified": true,
  "format": "oci-compressed",
  "platform": "linux/amd64",
  "nativeBuild": {"file": "package-artifacts/manifest.json"},
  "images": [
    {"name": "api", "manifestPath": "OUTPUT_FROM_NATIVE_BUILDER/image-manifest.json"}
  ]
}
```

Replace the manifest path with an actual native selected-image manifest inside the generated project. For registry inspection, replace `manifestPath` with `reference`, containing the actual registry image reference. A digest-pinned reference is preferable; a current build tag is accepted only when the resulting manifest's config digest matches the current build identity. The current Node/Python packaging tests each require exactly one image.

The timed build writes the identity file with `provider`, `sourceCommit`, `runId` and `images: [{"service": "api", "imageId": "sha256:CURRENT_BUILT_CONFIG_DIGEST"}]`. The runner supplies `BENCH_SOURCE_COMMIT` and `BENCH_RUN_ID` to the build; the collector checks those values and verifies that the file was written during the measured command. SST/CDK's diagnostic helper produces this shape. A reviewed native identity observer can instead be configured as `nativeBuild: {"argv": ["COMMAND", "ARGUMENT"]}`; it runs outside the timer, receives `BENCH_SOURCE_COMMIT`, `BENCH_RUN_ID` and `BENCH_PROVIDER`, and must return the same current-build identity shape. Its identity must come from the actual build output, not an old image or a static qualification declaration.

After the package timer stops, the collector checks the selected image manifest's `config.digest` against that fresh native image identity. It saves raw manifest/index and identity proof files with hashes in the result. A stale manifest for a different build, an identity from another attempt and an uncompressed layer descriptor fail. A fixed `expectedDigest` may additionally constrain an image whose current manifest digest is already known; it cannot replace the current-build identity. Matching digests do not establish native invocation or deployment parity by themselves: the reviewed qualification must still show that the builder, platform, cache controls and uploaded artifact match the native deployment, and that the image passes the application's business/revision checks. SST/CDK's helper remains a diagnostic until that evidence exists.

The result validator checks mandatory fields and imported evidence hashes. It does not independently prove a cloud event happened, that manual timestamps are accurate, or that every native artifact was found. Review the qualification and raw evidence before using a record in a chart.

Use the OCI collector after the native image build, outside the speed timer:

```sh
node scripts/oci-size.mjs --image QUALIFIED_REGISTRY_IMAGE \
  --expected-config-digest sha256:CURRENT_BUILT_CONFIG_DIGEST \
  --platform linux/amd64 --output .work/evidence/IMAGE_SIZE
```

It selects the runnable platform image, excludes attestations and sums unique config/compressed layer blobs. Keep its `image-manifest.json`, optional `image-index.json` and `size.json` as evidence. For a local downloaded manifest, use `--manifest FILE --expected-digest sha256:DIGEST` instead of `--image`; `--expected-config-digest` can additionally bind it to the actual build. A local uncompressed Docker image or an OCI index without a selected child manifest is rejected. Registry access is read-only but requires the appropriate login for a private image. The timed runner uses the same reader after the timer; hosted records can also be imported with these retained native proofs.

Imported records also need `qualificationFile`, pointing to their reviewed ignored qualification JSON. The importer validates the scenario/provider, artifact shape, component observations, duration boundaries and evidence hashes.

Passed OCI imports must include the retained raw `image-manifest` and `native-build-identity` files under `artifacts.files`; an image index also needs its `image-index` file. Each entry includes its role, `name: "api"`, byte length, SHA256 and a root-relative `evidenceFile` pointing to the immutable retained copy. That exact path and hash must also appear in `evidence`. Live builder output paths alone do not qualify an import. The importer rereads those files, recomputes the compressed blob sizes and manifest digest, and checks the raw native proof's source commit, run ID, provider and built config digest against the result and image manifest. Updating the summary to a new attempt while retaining an old raw proof fails. The platform must equal the qualification's selected platform (default `linux/amd64`), and an optional qualified `expectedDigest` must match. For index-based images, the retained index must select this exact manifest for the declared platform.


Every passed record needs an immutable cache-control JSON proof and a matching entry in `evidence` with the same path and SHA256. The proof identifies `runId`, `sourceCommit`, `scenario`, `provider`, `appId` and `series`. Local records are captured with `cache.mjs` and passed to the timed runner using `--cache-evidence FILE`; qualification's `cacheEvidence.series` declares policy, not observed proof. Git records obtain their proof after native completion from the exact CI artifact or hosted evidence observer. Importing a result checks proof contents, native observer identities and hashes as well as the record fields. A wrong attempt, stale commit or static cache declaration cannot pass.

For GitHub Actions, the cache proof includes the completed native run ID and attempt, observed cache request/restore/exact-hit flags and actual runner. The record flattens observed CPU, cores, memory, architecture and Node version for capacity grouping; unavailable measurements remain unavailable. `timerHost` describes the local push timer and never substitutes for build capacity. Cache restoration alone does not prove compiler or image-layer reuse.

SST container deployment records also require `rolloutAdmission`: every changed ECS service must finish its current rollout successfully, followed by another verified business/revision check of all components. These admission checks run outside the readiness timer. Git records carry the same admission from the immutable CI artifact; a missing check, failed rollout or rollback to an old response cannot qualify. This additional check is necessary for the configured SST `wait:false` path; CDK's native ECS hotswap already waits for services to stabilize.
