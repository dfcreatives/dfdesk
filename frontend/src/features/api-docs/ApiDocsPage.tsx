import { useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Clipboard,
  Code2,
  Menu,
  X,
} from "lucide-react";
import "./api-docs.css";

const fieldResponse = `{
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
      }
    ]
  },
  "meta": { "requestId": "d42a59e3-c9e8-4bd8-a825-2dd2da377b44" }
}`;

const submitRequest = `{
  "externalId": "website-order-10428",
  "fields": {
    "customer_name": "Ananya Rao",
    "print_finish": "Matte",
    "copies": 2,
    "gift_wrap": true,
    "delivery_date": "2026-10-18",
    "tags": ["Wedding", "Priority"]
  }
}`;

const submitResponse = `{
  "data": {
    "order": {
      "id": "#CO-72B1A8F4",
      "externalId": "website-order-10428",
      "fields": {
        "customer_name": "Ananya Rao",
        "print_finish": "Matte",
        "copies": 2,
        "gift_wrap": true,
        "delivery_date": "2026-10-18",
        "tags": ["Wedding", "Priority"]
      }
    }
  },
  "meta": { "requestId": "d42a59e3-c9e8-4bd8-a825-2dd2da377b44" }
}`;

const curlExample = `curl -X POST https://your-desk.example/api/v1/custom-orders \\
  -b cookies.txt \\
  -H "Content-Type: application/json" \\
  -H "Origin: https://your-desk.example" \\
  -H "X-CSRF-Token: YOUR_CSRF_TOKEN" \\
  -d '${submitRequest.replace(/\n/g, "\n  ")}'`;

const navItems = [
  ["overview", "Overview"],
  ["authentication", "Authentication"],
  ["fields", "Get field definitions"],
  ["submit", "Submit a custom order"],
  ["types", "Field types"],
  ["errors", "Errors"],
] as const;

const fieldTypes = [
  ["TEXT", "string", "Single-line text"],
  ["TEXTAREA", "string", "Long-form text"],
  ["NUMBER", "number", "Any finite number"],
  ["CURRENCY", "number", "Non-negative amount in rupees"],
  ["DATE", "string", "Date in YYYY-MM-DD format"],
  ["PHONE", "string", "Phone number with at least 7 digits"],
  ["EMAIL", "string", "Valid email address"],
  ["SELECT", "string", "One value from options"],
  ["MULTI_SELECT", "string[]", "Values from options"],
  ["CHECKBOX", "boolean", "true or false"],
] as const;

function CodeBlock({
  code,
  language = "json",
}: {
  code: string;
  language?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  return (
    <div className="api-code">
      <div className="api-code-bar">
        <span>{language}</span>
        <button type="button" onClick={copy} aria-label="Copy code">
          {copied ? <Check size={14} /> : <Clipboard size={14} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function Endpoint({ method, path }: { method: "GET" | "POST"; path: string }) {
  return (
    <div className="api-endpoint" aria-label={`${method} ${path}`}>
      <span className={`api-method api-method-${method.toLowerCase()}`}>
        {method}
      </span>
      <code>{path}</code>
    </div>
  );
}

export default function ApiDocsPage() {
  const [menuOpen, setMenuOpen] = useState(false);

  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <div className="api-docs-page">
      <header className="api-docs-header">
        <a className="api-docs-brand" href="/overview" aria-label="Desk home">
          <img src="/df-desk-logo.svg" alt="Desk" />
        </a>
        <div className="api-docs-header-title">
          <span>Developers</span>
          <i />
          <strong>API reference</strong>
        </div>
        <a className="api-docs-back" href="/orders">
          <ArrowLeft size={15} /> Back to Desk
        </a>
        <button
          className="api-docs-menu-button"
          type="button"
          aria-label={menuOpen ? "Close documentation menu" : "Open documentation menu"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </header>

      <div className="api-docs-layout">
        <aside className={`api-docs-sidebar${menuOpen ? " open" : ""}`}>
          <p>Custom orders</p>
          <nav aria-label="API documentation">
            {navItems.map(([id, label], index) => (
              <a
                key={id}
                className={index === 0 ? "active" : ""}
                href={`#${id}`}
                onClick={closeMenu}
              >
                {label}
                <ChevronRight size={13} />
              </a>
            ))}
          </nav>
          <div className="api-docs-version">
            <Code2 size={16} />
            <div>
              <span>API version</span>
              <strong>v1</strong>
            </div>
          </div>
        </aside>

        <main className="api-docs-content">
          <section id="overview" className="api-docs-hero">
            <span className="api-docs-eyebrow">CUSTOM ORDER API</span>
            <h1>Build order forms that fit your workflow.</h1>
            <p>
              Discover the fields configured in Desk, render them in your own
              interface, and submit a complete custom order with one API call.
            </p>
            <div className="api-docs-base-url">
              <span>Base URL</span>
              <code>https://your-desk.example/api/v1</code>
            </div>
            <div className="api-callout">
              <strong>Internal staff API</strong>
              <p>
                These endpoints use a Desk session. Creating an order requires
                an Admin or Manager account.
              </p>
            </div>
          </section>

          <section id="authentication" className="api-docs-section">
            <span className="api-docs-step">01</span>
            <h2>Authentication</h2>
            <p>
              Log in through <code>POST /api/v1/auth/login</code> and keep the
              returned session cookies. For every modifying request, send the
              <code> desk_session</code> and <code>desk_csrf</code> cookies, the
              CSRF token in <code>X-CSRF-Token</code>, and an allowed
              <code> Origin</code> header.
            </p>
            <div className="api-note">
              Never expose session cookies or CSRF tokens in client-side logs,
              URLs, or source control.
            </div>
          </section>

          <section id="fields" className="api-docs-section">
            <span className="api-docs-step">02</span>
            <h2>Get field definitions</h2>
            <p>
              Fetch definitions whenever your form opens. Labels, options, and
              display order can change; the field <code>key</code> is the stable
              identifier to use when submitting values.
            </p>
            <Endpoint method="GET" path="/api/v1/order-fields" />
            <h3>Example response</h3>
            <CodeBlock code={fieldResponse} />
          </section>

          <section id="submit" className="api-docs-section">
            <span className="api-docs-step">03</span>
            <h2>Submit a custom order</h2>
            <p>
              Send an object keyed by the active field definitions. Unknown
              keys and values that do not match their configured type are
              rejected. <code>externalId</code> is optional, but recommended for
              preventing duplicate submissions.
            </p>
            <Endpoint method="POST" path="/api/v1/custom-orders" />

            <div className="api-parameter-table" role="table" aria-label="Request body parameters">
              <div className="api-table-row api-table-head" role="row">
                <span>Property</span><span>Type</span><span>Description</span>
              </div>
              <div className="api-table-row" role="row">
                <code>externalId</code><span>string · optional</span><span>Your unique order identifier</span>
              </div>
              <div className="api-table-row" role="row">
                <code>fields</code><span>object · required</span><span>Values keyed by field definition</span>
              </div>
            </div>

            <h3>Request body</h3>
            <CodeBlock code={submitRequest} />
            <h3>cURL</h3>
            <CodeBlock code={curlExample} language="bash" />
            <h3>201 response</h3>
            <CodeBlock code={submitResponse} />
          </section>

          <section id="types" className="api-docs-section">
            <span className="api-docs-step">04</span>
            <h2>Field types</h2>
            <p>
              Match the JSON value to the field type returned by the definition
              endpoint. Empty optional values can be omitted or sent as
              <code> null</code>.
            </p>
            <div className="api-type-table">
              <div className="api-type-row api-table-head">
                <span>Field type</span><span>JSON value</span><span>Validation</span>
              </div>
              {fieldTypes.map(([type, value, rule]) => (
                <div className="api-type-row" key={type}>
                  <code>{type}</code><code>{value}</code><span>{rule}</span>
                </div>
              ))}
            </div>
          </section>

          <section id="errors" className="api-docs-section api-docs-last-section">
            <span className="api-docs-step">05</span>
            <h2>Errors</h2>
            <p>
              Errors use <code>application/problem+json</code> and include a
              request ID for support and tracing.
            </p>
            <div className="api-error-grid">
              <div><strong>400</strong><span>Invalid field or value</span></div>
              <div><strong>401</strong><span>Missing or expired session</span></div>
              <div><strong>403</strong><span>Invalid CSRF or role</span></div>
              <div><strong>409</strong><span>Duplicate external ID</span></div>
            </div>
            <CodeBlock code={`{
  "type": "https://desk.local/problems/bad_request",
  "title": "Request failed",
  "status": 400,
  "detail": "Unknown custom field: paper_size.",
  "code": "BAD_REQUEST",
  "requestId": "a8bd59aa-905f-42cb-ad3f-f6cc45ed701b"
}`} />
          </section>
        </main>
      </div>
    </div>
  );
}
