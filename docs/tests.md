# Choose a test

Each link opens the test branch’s instructions. Packaging speed and size come from the same native build, so they share a branch. Each deployment journey has a separate branch.

| Test | Branch |
| --- | --- |
| Package one report function | [Open test](https://github.com/matuscongrady/deploy-performance-benchmarks/blob/test/package-lambda-1/TEST.md) |
| Update one report function from the CLI | [Open test](https://github.com/matuscongrady/deploy-performance-benchmarks/blob/test/deploy-lambda-1-cli/TEST.md) |
| Update one report function from a Git push with a fresh build environment | [Open test](https://github.com/matuscongrady/deploy-performance-benchmarks/blob/test/deploy-lambda-1-git-cold/TEST.md) |
| Update one report function from another Git push after 15 minutes | [Open test](https://github.com/matuscongrady/deploy-performance-benchmarks/blob/test/deploy-lambda-1-git-repeat/TEST.md) |
| Package five commerce functions | [Open test](https://github.com/matuscongrady/deploy-performance-benchmarks/blob/test/package-lambda-5/TEST.md) |
| Update five commerce functions from the CLI | [Open test](https://github.com/matuscongrady/deploy-performance-benchmarks/blob/test/deploy-lambda-5-cli/TEST.md) |
| Update five commerce functions from a Git push with a fresh build environment | [Open test](https://github.com/matuscongrady/deploy-performance-benchmarks/blob/test/deploy-lambda-5-git-cold/TEST.md) |
| Update five commerce functions from another Git push after 15 minutes | [Open test](https://github.com/matuscongrady/deploy-performance-benchmarks/blob/test/deploy-lambda-5-git-repeat/TEST.md) |
| Package twenty-five commerce functions | [Open test](https://github.com/matuscongrady/deploy-performance-benchmarks/blob/test/package-lambda-25/TEST.md) |
| Update twenty-five commerce functions from the CLI | [Open test](https://github.com/matuscongrady/deploy-performance-benchmarks/blob/test/deploy-lambda-25-cli/TEST.md) |
| Update twenty-five commerce functions from a Git push with a fresh build environment | [Open test](https://github.com/matuscongrady/deploy-performance-benchmarks/blob/test/deploy-lambda-25-git-cold/TEST.md) |
| Update twenty-five commerce functions from another Git push after 15 minutes | [Open test](https://github.com/matuscongrady/deploy-performance-benchmarks/blob/test/deploy-lambda-25-git-repeat/TEST.md) |
| Package one Node.js commerce API | [Open test](https://github.com/matuscongrady/deploy-performance-benchmarks/blob/test/package-node/TEST.md) |
| Update one Node.js commerce API from the CLI | [Open test](https://github.com/matuscongrady/deploy-performance-benchmarks/blob/test/deploy-node-cli/TEST.md) |
| Update one Node.js commerce API from a Git push with a fresh build environment | [Open test](https://github.com/matuscongrady/deploy-performance-benchmarks/blob/test/deploy-node-git-cold/TEST.md) |
| Update one Node.js commerce API from another Git push after 15 minutes | [Open test](https://github.com/matuscongrady/deploy-performance-benchmarks/blob/test/deploy-node-git-repeat/TEST.md) |
| Package one Python commerce API | [Open test](https://github.com/matuscongrady/deploy-performance-benchmarks/blob/test/package-python/TEST.md) |
| Update one Python commerce API from the CLI | [Open test](https://github.com/matuscongrady/deploy-performance-benchmarks/blob/test/deploy-python-cli/TEST.md) |
| Update one Python commerce API from a Git push with a fresh build environment | [Open test](https://github.com/matuscongrady/deploy-performance-benchmarks/blob/test/deploy-python-git-cold/TEST.md) |
| Update one Python commerce API from another Git push after 15 minutes | [Open test](https://github.com/matuscongrady/deploy-performance-benchmarks/blob/test/deploy-python-git-repeat/TEST.md) |
| Update five services; three changed from the CLI | [Open test](https://github.com/matuscongrady/deploy-performance-benchmarks/blob/test/deploy-five-services-cli/TEST.md) |
| Update five services; three changed from a Git push with a fresh build environment | [Open test](https://github.com/matuscongrady/deploy-performance-benchmarks/blob/test/deploy-five-services-git-cold/TEST.md) |
| Update five services; three changed from another Git push after 15 minutes | [Open test](https://github.com/matuscongrady/deploy-performance-benchmarks/blob/test/deploy-five-services-git-repeat/TEST.md) |

The human-readable title tells you what runs. The branch name is only the checkout name. Use `node scripts/bench.mjs list` to see the same list locally.

A fresh CI test and a repeat-push test share the same existing application; the repeat test’s branch describes its preceding untimed deploy. Their published test-definition branches do not themselves constitute measured source changes.
