# Applications used in the tests

These are small commerce applications, with code that does actual work. They are not copies of one handler with different names. The same source and dependency locks go to every platform.

The tests measure building and updating an application. They do not measure database speed, payment processing or email delivery. Product data lives in the source tree, dates are fixed and external operations return a result rather than contacting another service. That keeps the result checks repeatable and avoids charging a real card or sending real email.

## Run the applications before measuring them

You need Node.js 22, npm and [uv](https://docs.astral.sh/uv/). Run these from the repository root:

```sh
node fixtures/install.mjs
node fixtures/check.mjs
```

Installation uses the committed npm lockfiles and hash-checked Python requirements. The Python 3.11.14 environment is local to its fixture; uv installs that interpreter if it is missing. Installation is setup, not part of a measured packaging run unless the test explicitly measures dependency installation.

The checks invoke all 25 functions, generate real documents, send HTTP requests to each Node service and check the Python API. They also reject invalid quantities and an invalid payment signature. They need no accounts or cloud credentials.

If you only need the Node fixtures, use `--node-only` with both commands. That deliberately leaves Python unchecked.

## Lambda applications

`lambdas/workloads.json` selects the functions. Each file exports `handler(event)` and returns a JSON object containing its revision.

| Application | Functions | Code edit for a rebuild or deployment |
| --- | --- | --- |
| 1 function | Sales report | Change the reporting revision file |
| 5 functions | Sales report, product lookup, cart pricing, order creation and notification | Change all five revision files |
| 25 functions | The five above, plus search, categories, stock, shipping, tax, discounts, payments, fulfillment and customer functions | Change all 25 revision files |

The sales report builds a PDF, an Excel workbook and a Word document from the same order. It imports PDFKit, ExcelJS and docx and uses all three. This represents a dependency-heavy business function. The four other functions in the small application validate product requests, calculate money with Decimal.js, create a repeatable order identifier and render an email with Handlebars.

The larger application has these 25 handlers:

| File in `lambdas/handlers/` | Work performed |
| --- | --- |
| `report.mjs` | Generate PDF, Excel and Word sales reports |
| `product-lookup.mjs` | Validate a product ID and return catalog details |
| `cart-pricing.mjs` | Validate lines and calculate the cart total |
| `create-order.mjs` | Validate an order and calculate its ID and total |
| `notification.mjs` | Validate a recipient and render an order email |
| `product-search.mjs` | Search product names |
| `category-list.mjs` | Return distinct catalog categories |
| `inventory-check.mjs` | Check whether requested stock is available |
| `reserve-stock.mjs` | Validate a reservation and calculate remaining stock |
| `release-stock.mjs` | Validate a stock-release request |
| `shipping-quote.mjs` | Calculate shipping for a destination and weight |
| `tax-quote.mjs` | Calculate tax for a regional rate |
| `apply-discount.mjs` | Apply a coupon using decimal arithmetic |
| `payment-intent.mjs` | Validate a payment request and calculate its idempotency ID |
| `payment-webhook.mjs` | Verify an HMAC signature before accepting a payment event |
| `order-status.mjs` | Look up an order status |
| `cancel-order.mjs` | Decide whether an order can be cancelled |
| `return-request.mjs` | Check a return against a 30-day window |
| `customer-profile.mjs` | Normalize an email and escape a customer name |
| `customer-token.mjs` | Sign and verify a customer JWT |
| `invoice.mjs` | Render an HTML invoice |
| `catalog-import.mjs` | Parse and validate a CSV product import |
| `catalog-feed.mjs` | Generate an XML catalog |
| `daily-summary.mjs` | Aggregate sales for a date |
| `shipment-update.mjs` | Parse and validate a carrier's XML update |

The public fixture signing string is not a credential. Do not replace it with a real secret.

Each handler has its own revision file. The standard update changes every function in the selected application, so deployment timings cover the whole application. All functions must return the new revision. Keeping the files separate also permits a separately labelled single-function edit without changing shared source.

Default invocation input is `{}`. The sample order contains two coffees at USD 12.50 and one mug at USD 8.00. Cart pricing returns `subtotal: "33.00"`. Reporting returns the same total and the sizes and signatures of all three generated files. The PDF starts with `%PDF`; Excel and Word documents start with `PK` because they are ZIP-based formats. The check also verifies that each file contains more than 1 KB of output.

## One-container applications

`containers/node/` and `containers/python/` implement the same storefront API. The Node app uses Express, Zod, Decimal.js, Handlebars and Luxon. The Python app uses FastAPI and Pydantic, with Python's decimal and datetime libraries.

These are two separate language tests. They are not a claim that Express and FastAPI have identical dependency sizes.

Both expose these routes:

| Request | What to check |
| --- | --- |
| `GET /health` | `status: "ok"` |
| `GET /version` | The expected application revision |
| `GET /products` | Coffee and mug products |
| `POST /quote` | Correct decimal pricing and the expected revision |
| `POST /receipt` | Rendered receipt HTML and the expected revision |

Use this quote request after deployment:

```json
{"lines":[{"productId":"coffee","quantity":2},{"productId":"mug","quantity":1}]}
```

The response must contain `total: "33.00"`, `currency: "USD"` and the new revision. A health check alone is insufficient: it can succeed on the old application.

To run Node locally:

```sh
cd fixtures/containers/node
PORT=3000 npm start
```

To run Python locally after installing the fixtures:

```sh
cd fixtures/containers/python
PORT=3000 .venv/bin/uvicorn app:app --host 0.0.0.0 --port 3000
```

`revision.mjs` and `revision.py` are the respective edit targets. The directories contain no Dockerfile. Automatic builders receive the app source, its lockfile and its start command. A provider configuration may add its required build recipe without changing the application.

## Five-container application

`containers/five-services/` contains five independently built and deployed HTTP services. These are five workloads, not five sidecars in one task.

| Service | Business check | Edited in the update test? |
| --- | --- | --- |
| `api` | Price two coffees at USD 25.00 | Yes |
| `reporting` | Process a supplied job ID and generate an actual PDF | Yes |
| `inventory` | Reserve two mugs and report ten remaining | No |
| `webhooks` | Verify and accept a signed payment event | No |
| `notifications` | Process a supplied job ID and render an order email | Yes |

Each service directory contains its own package manifest, lockfile and revision file. Use that directory as the build context. Using the whole repository as every service's context would let unrelated edits invalidate all five builds.

Edit the three named services' `revision.mjs` files and leave the other two directories untouched. After deployment, verify the new revisions on those three and the previous revisions on inventory and webhooks. Inspect the build and upload records as well; unchanged source alone does not prove cache reuse.

Reporting and notifications process fresh jobs through their HTTP endpoints. The response includes the supplied `jobId` and the revision of the code that processed it. They do not use an external queue and do not benchmark background-worker startup. The deployment probe must supply a new job ID for each check.

Each service's `probe.json` contains its request and expected fields. The webhook probe computes its signature with HMAC-SHA256 using the documented fixture signing string.

## What an agent needs to repeat a check

`manifest.json` lists every entrypoint, build context, lockfile, edit target, request and expected response. All paths are relative to the repository root. Expected objects are subsets of the full result; arrays must match their expected length and order. Always check the expected revision in addition to the business result.

The local checks prove that the applications behave as described. They do not prove that a platform packaged the application correctly. Before accepting a timed result, run the same checks against its generated artifact or deployed application.
