# Selected application

This application is one Python commerce API. The update changes the API revision.

The app validates requests, calculates prices and renders receipts. It provides enough real work to check that a build is runnable, while keeping database and network dependencies out of the comparison.

The machine-readable [manifest](manifest.json) contains every selected entrypoint, edit target, dependency lock, request and expected response. The only application contexts here are: `fixtures/containers/python`.

Run `node fixtures/install.mjs` and `node fixtures/check.mjs` from the repository root. Each response must match the manifest's business fields and the expected revision. A health check alone can succeed on old code.

Application data and dates are fixed. No real payment, email or database service is used. This fixture measures building and deployment, rather than external service latency.
