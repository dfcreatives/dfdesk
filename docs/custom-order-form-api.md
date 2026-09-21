  # Custom order form API

This API lets an authenticated Desk client discover the custom fields configured for a workspace and submit an order containing values for those fields.

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

## Submission flow

1. Call `GET /api/v1/order-fields` when the form opens.
2. Render an input for each returned field definition.
3. Use each definition's stable `key` in the submitted `customFields` object.
4. Validate required and type-specific values in the client.
5. Submit the complete order to `POST /api/v1/orders`.

Always discover fields from the API. Labels and ordering can change.

## Get custom-field definitions

```http
GET /api/v1/order-fields
Cookie: desk_session=...
```

```bash
curl -b cookies.txt http://localhost:4000/api/v1/order-fields
```

Example response:

```json
{
  "data": {
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
| `400` | Invalid standard field, missing required field, unknown custom key, or wrong custom value type |
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
