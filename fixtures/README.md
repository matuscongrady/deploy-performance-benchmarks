# Selected application

This application has 25 different commerce functions. The update changes all 25 selected functions.

The reporting function generates actual PDF, Excel and Word documents. Other selected handlers perform commerce operations; their source and expected business results are listed in the manifest. This exposes the cost of packaging real dependencies and updating a whole application.

The machine-readable [manifest](manifest.json) contains every selected entrypoint, edit target, dependency lock, request and expected response. All selected Lambda handlers appear under `lambdas/handlers/`.

Run `node fixtures/install.mjs` and `node fixtures/check.mjs` from the repository root. Each response must match the manifest's business fields and the expected revision. A health check alone can succeed on old code.

Application data and dates are fixed. No real payment, email or database service is used. This fixture measures building and deployment, rather than external service latency.
