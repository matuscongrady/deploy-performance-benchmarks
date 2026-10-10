# Result data

Use schema version 1. Each attempt is one JSON file; failures are attempts too. Do not overwrite a failed attempt with its successful retry. The runner saves local attempts automatically. Hosted measurements can be imported after their evidence checksums have been verified.

Required fields:

| Field | Meaning |
| --- | --- |
| `scenario`, `provider`, `runId` | Exact test, tool and unique attempt |
| `sourceCommit` | Full 40-character Git SHA of the tested source |
| `kind`, `status` | `package` or `deploy`; `passed`, `failed` or `unqualified` |
| `startedAt`, `finishedAt`, `durationMs` | Observed timer boundaries and elapsed milliseconds |
| `commandDurationMs` | Optional native command elapsed time; not deployment readiness |
| `toolVersion` | Reported CLI/builder version; candidate binary SHA256/source reference |
| `environment` | Runner/plan, CPU/memory, runtime, region and hardware, where exposed |
| `settings` | Builder, minification, external dependencies, hotswap/fallback and rollout behavior |
| `cacheEvidence` | Clean or repeat series, runner identity, reset/restore controls and hit/miss evidence |
| `evidence` | Relative log/artifact paths and SHA256 checksums |
| `readiness` | Deployment business probe responses with correct revisions |
| `artifacts` | Packaging’s complete artifact set, format, sizes and hashes |

For a deployment, `readiness.verified` must be true, with observations of every selected component. For five services, three observations have the new revision and two have the baseline revision. Also retain the baseline commit and response evidence. Five-service records require `reuse.verified: true` and native before/after identity observations for inventory and webhooks, including artifact IDs, deployment ID and configuration hash. Version probes alone cannot establish that those services were reused. A managed build needs build ID, phase timestamps and complete log evidence. Git journeys need the pushed SHA and local push start, plus `pipelineCompletion` showing native terminal success for that SHA. The completion check runs after the business readiness timer. A failed pipeline cannot qualify a result even if a changed function briefly answered correctly.

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

For OCI output, save the registry manifest/index and sum compressed blob sizes, deduplicating digest references as appropriate to the declared single-image/platform scope. `docker images` reports a different size. The local file-size collector cannot infer OCI compressed blob sizes from an exported tarball; managed OCI numbers need the registry manifest evidence and an imported record. Classic Heroku slugs must be labelled `heroku-slug`, with platform-reported compressed size.

The result validator checks mandatory fields and imported evidence hashes. It does not independently prove a cloud event happened, that manual timestamps are accurate, or that every native artifact was found. Review the qualification and raw evidence before using a record in a chart.

Use the OCI collector after the native image build, outside the speed timer:

```sh
node scripts/oci-size.mjs --image QUALIFIED_REGISTRY_IMAGE \
  --platform linux/amd64 --output .work/evidence/IMAGE_SIZE
```

It selects the runnable platform image, excludes attestations and sums unique config/compressed layer blobs. Keep its `image-manifest.json` and `size.json` as evidence. For a local downloaded manifest, use `--manifest FILE --expected-digest sha256:DIGEST` instead of `--image`. A local uncompressed Docker image or an OCI index without a selected child manifest is rejected. Registry access is read-only but requires the appropriate login for a private image.

Imported records also need `qualificationFile`, pointing to their reviewed ignored qualification JSON. The importer validates the scenario/provider, artifact shape, component observations, duration boundaries and evidence hashes.
