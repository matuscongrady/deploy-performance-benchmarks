# Deployment performance benchmarks

This repository measures two things developers wait for: packaging their application, and getting a code change running in the cloud.

The applications are small commerce backends. They do real work: price a cart, validate an order, generate a report, process a payment webhook and send a notification. There are no databases, payment accounts or email services to configure. Fixed input data makes it possible to check that every tool shipped working code.

## Pick a test

For the owner review, open [the visual plan](docs/review.html) in a browser. It explains the applications, clocks, proposed charts, Heroku setup and spending/cleanup rules. The preview numbers are illustrative.

Each test has its own `test/…` branch. Open its `TEST.md` for the application, exact source change, timer and commands. [The test list](docs/tests.md) links to every branch.

The source lives in folders on `main`. Each test branch contains the selected application, its dependencies, deployment configuration and the instructions needed to run it. Unrelated applications and tests stay on `main`. Run measurements on separate `trial/…` branches so the published test definitions stay intact.

| Application | Packaging | Deployment |
| --- | --- | --- |
| One report function | Build time and upload size | CLI; fresh CI; another push after 15 minutes |
| Five commerce functions | Build time and upload size | Same three journeys |
| Twenty-five commerce functions | Build time and upload size | Same three journeys |
| One Node.js API | Build time and artifact size | Same three journeys |
| One Python API | Build time and artifact size | Same three journeys |
| Five independent Node.js services | — | Change three services; keep two unchanged |

Lambda tools: the candidate CLI, Serverless Framework, SST and CDK. Container tools: the candidate CLI, SST, CDK, Ravion, Render and Heroku. A platform appears in a chart only when it supports the journey and we can verify the measurement.

## Why these tests

The report function uses PDF, spreadsheet and document libraries. It exposes the cost of bundling larger dependencies. The five-function backend adds ordinary commerce handlers. The twenty-five-function backend adds customer, inventory, payment, shipping and reporting work. This shows how packaging scales across different functions instead of timing twenty-five copies of one file.

The Node.js and Python APIs test each platform’s usual container builder separately. The candidate packages source automatically. Ravion, Render and Heroku use their native source builders. SST and CDK use their built-in Docker image builders with normal application Dockerfiles. We publish those recipes and settings. We do not force the candidate to build the competitors’ Dockerfile; that would hide the difference this test measures.

The five-service test checks whether a platform avoids rebuilding or uploading unchanged services. Each service has its own dependencies and build directory. A request to a changed service must return the new source revision; the other two must still return the old revision.

Deployment tests update an application that already exists. Initial account setup and infrastructure creation are outside the timer. Fast cloud update paths are allowed, including hotswap. We disclose differences in rollout guarantees and infrastructure handling.

## Try it locally

Use Node.js 22 or newer, npm, Git and `uv` (for Python 3.11). No cloud account is needed for these checks.

```sh
node scripts/bench.mjs list
node fixtures/install.mjs
node scripts/check.mjs
```

Installation uses the exact fixture dependencies. The check exercises the handlers and HTTP applications. It does not deploy anything. Provider tools have separate lockfiles; setup instructions say when to install them.

To inspect an individual provider’s native project and command plan:

```sh
node scripts/bench.mjs prepare package-lambda-5 serverless --run-id review-five
```

Preparation writes files under `.work/` and never runs a cloud command. For a measured run, use [the runbook](docs/runbook.md). It explains the baseline, source edits, cache controls, probes, evidence and cleanup.

## What is ready

The fixture checks and project generation can run locally. Cloud measurements need platform accounts, provider setup and qualified timing boundaries. Read the availability in each generated plan before starting. A bundler output directory is not automatically a complete Lambda upload package, and a managed platform does not necessarily expose a downloadable image.

SST and CDK have native Docker image builders. Their standard ECS service paths need an application Dockerfile. Their generated projects include it; the candidate’s project uses its automatic builder. All three deploy actual ECS services for this comparison.

Heroku’s generation and account plan must be selected before testing. Classic builds produce slugs; Cloud Native Buildpacks can produce container images. We will not put unlike artifact formats in the same size ranking.

If a platform exposes build time but hides its artifact size, it can appear in the speed chart. Its size stays unavailable.

The first local Lambda packaging campaign is complete for one, five and twenty-five functions. It used a source-built candidate prerelease; its raw evidence and charts are still awaiting publication. Those preliminary measurements are not launch performance claims. [Measurement rules](docs/methodology.md) define which records qualify. [The result format](docs/results.md) lets another person check or repeat a run without relying on this conversation.
