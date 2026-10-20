# Custom order forms and ecommerce API

Each ecommerce account can have multiple custom order forms. A form ID is stable and scopes its field keys, submissions, and imported orders. Use the signed integration API below from ecommerce servers; cookie-authenticated endpoints are for Desk staff and administrators.

> This is an internal staff API, not an anonymous storefront endpoint. Reading the form requires an authenticated account. Creating or updating an order requires an `Admin` or `Manager` account.

## Base URL and response format

The local API base URL is `http://localhost:4000`. Successful JSON responses use this envelope:

```json
{
  "data": {},
  "meta": { "requestId": "d42a59e3-c9e8-4bd8-a825-2dd2da377b44" }
}
```

## Authentication and CSRF

Log in and save the returned cookies:

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "name": "Manager Name",
  "password": "manager-password"
}
```

```bash
curl -i -c cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"name":"Manager Name","password":"manager-password"}' \
  http://localhost:4000/api/v1/auth/login
```

The response contains `data.csrfToken`. Every modifying request must send:

- The session and `desk_csrf` cookies
- `X-CSRF-Token: CSRF_TOKEN`, using the token returned by login
- An `Origin` matching the API origin or an origin configured in `FRONTEND_ORIGINS`

Keep session cookies and CSRF tokens secret.

## Ecommerce integration flow

An Admin creates one store connection per ecommerce account in **Orders → Customize order fields → Connect a store**. A connection is the identity and credentials for one ecommerce backend. Desk returns a `clientKey` and displays its `signingSecret` once; save both in that backend's server environment. Then create one order form per distinct checkout/custom-order form on that store. A form ID is returned by `GET /api/v1/order-forms` and in the signed forms discovery response.

Sign requests with HMAC-SHA256 using `timestamp + "." + rawRequestBody`, where timestamp is Unix seconds and the body is the exact UTF-8 request body sent. For a GET with no body, sign `timestamp + "."`. Send `X-DF-Client: <clientKey>`, `X-DF-Timestamp: <unix-seconds>`, and `X-DF-Signature: sha256=<lowercase-hex-digest>`. The client key and secret belong to that ecommerce connection. Never expose the secret in browser code.

Example Node.js signing helper:

```js
import { createHmac } from "node:crypto";

function integrationHeaders(clientKey, signingSecret, body = "") {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", signingSecret)
    .update(`${timestamp}.${body}`, "utf8")
    .digest("hex");
  return {
    "X-DF-Client": clientKey,
    "X-DF-Timestamp": timestamp,
    "X-DF-Signature": `sha256=${signature}`,
  };
}
```

Call `GET /api/v1/integrations/forms` with the helper above and an empty body to discover that account's active forms and fields. For each submitted event, include the selected stable `formId` and send `POST /api/v1/integrations/orders/custom` signed over the exact JSON string being sent. The server rejects forms belonging to another account and unknown field keys.

Example event:

```json
{
  "eventId": "5ef473ca-c2a0-47fb-a746-c1b9b6045145",
  "eventType": "custom_order.submitted.v1",
  "eventVersion": 1,
  "occurredAt": "2026-10-03T10:00:00.000Z",
  "source": "ecommerce",
  "clientId": "<connection client key>",
  "correlationId": "8642473e-b3d1-4c62-8ec9-26cb27b11aa2",
  "aggregateId": "store-order-10428",
  "payload": {
    "externalId": "store-order-10428",
    "formId": "<form UUID>",
    "fields": { "print_finish": "Matte", "gift_wrap": true }
  }
}
```

For write requests also send `X-DF-Event-Id`, `X-Correlation-Id`, and `Idempotency-Key` (equal to `eventId`). The exact field keys and allowed values come from the form discovery response.

Example submission:

```js
const body = JSON.stringify(event);
const headers = {
  ...integrationHeaders(clientKey, signingSecret, body),
  "Content-Type": "application/json",
  "X-DF-Event-Id": event.eventId,
  "X-Correlation-Id": event.correlationId,
  "Idempotency-Key": event.eventId,
};
const response = await fetch(`${DESK_API_URL}/api/v1/integrations/orders/custom`, {
  method: "POST",
  headers,
  body,
});
```

The first accepted event returns `201` and `data.accepted`, `data.duplicate`, and `data.deskOrderId`. Replaying the same event ID with the same body returns `200` with `duplicate: true`. Reusing an external order ID with a different event returns `409`.

## Manage stores and forms (Desk Admin)

These routes use the Desk session cookie and CSRF protection described above.

- `GET /api/v1/order-forms/connections` — list this workspace's store connections.
- `POST /api/v1/order-forms/connections` — create a connection. Send `{ "displayName": "Main website" }`. The `data` response contains the `connection.clientKey` and one-time `signingSecret`.
- `GET /api/v1/order-forms` — list forms, their IDs, store connections, and counts.
- `POST /api/v1/order-forms` — create a form with `{ "name": "Custom photo book", "integrationConnectionId": "<connection UUID>" }`.
- `PATCH /api/v1/order-forms/{formId}` — rename or disable a non-default form.
- `DELETE /api/v1/order-forms/{formId}` — archive a non-default form.

Creating connections and forms requires the `Admin` role. Form field editing supports both Admins and Managers.

## Desk staff submission flow

1. Call `GET /api/v1/order-forms` to list workspace forms, then `GET /api/v1/order-fields?formId=<UUID>` when the selected form opens.
2. Render an input for each returned field definition.
3. Use each definition's stable `key` in the submitted `customFields` object and include the same `formId` in the order.
4. Validate required and type-specific values in the client.
5. Submit the complete order to `POST /api/v1/orders`.

Always discover fields from the API. Labels and ordering can change.

## Get custom-field definitions

```http
GET /api/v1/order-fields?formId=<FORM_UUID>
Cookie: desk_session=...
```

```bash
curl -b cookies.txt 'http://localhost:4000/api/v1/order-fields?formId=FORM_UUID'
```

Example response:

```json
{
  "data": {
    "formId": "a8ccf4fa-b497-49ba-a132-9ba4eb9ecc3d",
    "fields": [
      {
        "id": "c8ccf4fa-b497-49ba-a132-9ba4eb9ecc3d",
        "key": "print_finish",
        "label": "Print finish",
        "type": "SELECT",
        "required": true,
        "placeholder": null,
        "helpText": "Choose the finish requested by the customer.",
        "options": ["Matte", "Gloss"],
        "position": 0,
        "showInList": true
      },
      {
        "id": "bdc48ad6-f07f-42d7-97ca-d9d13b3be001",
        "key": "gift_wrap",
        "label": "Gift wrap",
        "type": "CHECKBOX",
        "required": false,
        "placeholder": null,
        "helpText": null,
        "options": [],
        "position": 1,
        "showInList": false
      }
    ]
  },
  "meta": { "requestId": "d42a59e3-c9e8-4bd8-a825-2dd2da377b44" }
}
```

### Field types

| Type | Suggested control | Submitted JSON value |
| --- | --- | --- |
| `TEXT` | Text input | String |
| `TEXTAREA` | Textarea | String |
| `NUMBER` | Number input | Number |
| `CURRENCY` | Decimal input | Non-negative number in rupees |
| `DATE` | Date input | `YYYY-MM-DD` string |
| `PHONE` | Telephone input | String containing at least seven digits |
| `EMAIL` | Email input | Valid email string |
| `SELECT` | Select | One string from `options` |
| `MULTI_SELECT` | Checkbox/select group | Array of strings from `options` |
| `CHECKBOX` | Checkbox | Boolean |

For a `CURRENCY` custom field, submit `1250.5`, not `"₹1,250.50"`.

## Submit an order

```http
POST /api/v1/orders
Content-Type: application/json
Origin: DESK_ORIGIN
X-CSRF-Token: CSRF_TOKEN
Cookie: desk_session=...; desk_csrf=...
```

Request example:

```json
{
  "id": "#FF-10428",
  "formId": "a8ccf4fa-b497-49ba-a132-9ba4eb9ecc3d",
  "createdAt": 1788782400000,
  "source": "Desk",
  "customer": "Ananya Rao",
  "customerMobile": "+91 98765 43210",
  "customerEmail": "ananya@example.com",
  "item": "Wedding photo book",
  "value": "12500.00",
  "advanceAmount": 5000,
  "advancePaymentMethod": "UPI",
  "deadline": "2026-09-12",
  "status": "Pending",
  "color": "orange",
  "customFields": {
    "print_finish": "Matte",
    "gift_wrap": true,
    "copies": 2,
    "occasion_date": "2026-10-18",
    "production_notes": "Use the approved cover image.",
    "tags": ["Wedding", "Priority"]
  }
}
```

```bash
curl -i -b cookies.txt \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:3000' \
  -H 'X-CSRF-Token: CSRF_TOKEN' \
  -d '{
    "id":"#FF-10428",
    "formId":"a8ccf4fa-b497-49ba-a132-9ba4eb9ecc3d",
    "customer":"Ananya Rao",
    "customerMobile":"+91 98765 43210",
    "item":"Wedding photo book",
    "value":"12500.00",
    "advanceAmount":5000,
    "advancePaymentMethod":"UPI",
    "deadline":"2026-09-12",
    "status":"Pending",
    "color":"orange",
    "customFields":{"print_finish":"Matte","gift_wrap":true}
  }' \
  http://localhost:4000/api/v1/orders
```

The endpoint returns `201 Created`. `data` contains the refreshed workspace, including the created order in `data.orders`.

### Standard properties

| Property | Required | Rules |
| --- | --- | --- |
| `id` | Yes | Unique display ID, 1–80 characters |
| `customer` | Yes | 1–160 characters |
| `item` | Yes | Product/service summary, 1–500 characters |
| `value` | Yes | Total as a numeric string; stored as integer paise |
| `status` | Yes | Non-empty string, up to 80 characters |
| `color` | Yes | Status colour key, up to 40 characters |
| `customerMobile` | No | Up to 32 characters |
| `customerEmail` | No | Valid email address |
| `advanceAmount` | No | Non-negative number in rupees |
| `advancePaymentMethod` | No | `Cash`, `UPI`, `Split`, or `Razorpay` |
| `deadline` | No | Use `YYYY-MM-DD` |
| `assignedEmployeeId` | No | Existing employee UUID |
| `customFields` | No | Object keyed by values returned from `/api/v1/order-fields` |

Omit `source` or set it to `Desk`. Clients cannot create a `Frames 41` order through this endpoint.

## Update form details

Use the display order ID in the path. URL-encode IDs containing `#`.

```http
PATCH /api/v1/orders/%23FF-10428
Content-Type: application/json
Origin: DESK_ORIGIN
X-CSRF-Token: CSRF_TOKEN

{
  "deadline": "2026-09-14",
  "customFields": {
    "print_finish": "Gloss",
    "gift_wrap": false
  }
}
```

When `customFields` is present, send the complete current custom-field object. Omitted active values are removed. Omitting `customFields` leaves all custom values unchanged.

## Read submitted orders

```http
GET /api/v1/orders
GET /api/v1/orders/%23FF-10428
```

Returned orders contain a `customFields` object when they have active custom-field values.

## Errors

Errors use `application/problem+json`:

```json
{
  "type": "https://desk.local/problems/validation_failed",
  "title": "Validation failed",
  "status": 400,
  "detail": "The request contains invalid values.",
  "code": "VALIDATION_FAILED",
  "requestId": "a8bd59aa-905f-42cb-ad3f-f6cc45ed701b",
  "errors": {
    "customerEmail": ["Invalid email address"]
  }
}
```

Common statuses:

| Status | Meaning |
| --- | --- |
| `400` | Invalid form/order data, missing required field, or wrong custom value type. Signed ecommerce submissions also reject unknown field keys. |
| `401` | No valid Desk session |
| `403` | Invalid origin/CSRF token or insufficient role |
| `404` | Order or field not found in the workspace |
| `409` | Display order ID already exists |

## Manage the form schema

Admins and Managers can use:

- `POST /api/v1/order-fields` — create a definition
- `PATCH /api/v1/order-fields/{fieldId}` — update or reorder a definition
- `DELETE /api/v1/order-fields/{fieldId}` — archive a definition

Create example:

```json
{
  "formId": "a8ccf4fa-b497-49ba-a132-9ba4eb9ecc3d",
  "label": "Print finish",
  "type": "SELECT",
  "required": true,
  "placeholder": null,
  "helpText": "Choose the finish requested by the customer.",
  "options": ["Matte", "Gloss"],
  "showInList": true
}
```

The server generates the stable `key`. A form supports up to 50 active custom fields. Archiving hides a field but preserves historical values. A type cannot change after the field has values, and options currently used by orders cannot be removed.

## Integration notes

- Commerce-owned properties on `Frames 41` orders remain read-only. Local workflow properties and custom fields remain editable.
- Currency custom fields use rupees. Core commerce amounts such as `totalPaise` use integer paise.
- `POST /api/v1/orders` stores `advanceAmount` on the order but does not independently create a collection record. Call `POST /api/v1/payments` if the integration must also create a payment ledger entry.
- Fetch definitions whenever the form opens so added, reordered, or archived fields appear immediately.
