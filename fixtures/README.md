# Selected application

This application has five independently built commerce services. The update changes API, reporting and notifications. Inventory and webhooks keep their source, dependencies and deployed identities.

Three changed services and two unchanged services show whether deployment avoids unnecessary rebuilding and replacement. Each service has its own source context and dependency lock.

The machine-readable [manifest](manifest.json) contains every selected entrypoint, edit target, dependency lock, request and expected response. The only application contexts here are: `fixtures/containers/five-services/api`, `fixtures/containers/five-services/reporting`, `fixtures/containers/five-services/inventory`, `fixtures/containers/five-services/webhooks`, `fixtures/containers/five-services/notifications`.

Run `node fixtures/install.mjs` and `node fixtures/check.mjs` from the repository root. Each response must match the manifest's business fields and the expected revision. A health check alone can succeed on old code.

Application data and dates are fixed. No real payment, email or database service is used. This fixture measures building and deployment, rather than external service latency.
