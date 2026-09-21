import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL ??=
    "postgresql://desk:desk@localhost:5432/desk?schema=desk";
  process.env.DF_INTEGRATION_SECRET ??=
    "test-secret-that-is-at-least-32-characters-long";
});

describe("commerce event validation", () => {
  it("rejects totals which do not reconcile", async () => {
    const { parseCommerceOrderPaidEvent } =
      await import("../src/modules/integrations/contracts.js");
    const event = {
      eventId: crypto.randomUUID(),
      eventType: "commerce.order.paid.v1",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      source: "frames41",
      clientId: "frames41",
      correlationId: crypto.randomUUID(),
      aggregateId: "order-1",
      payload: {
        externalOrderId: "order-1",
        externalOrderNumber: "1",
        customer: { name: "A", email: "a@example.com", phone: "9999999999" },
        shippingAddress: {
          line1: "Street",
          city: "City",
          state: "State",
          pincode: "000000",
        },
        items: [
          {
            id: "i",
            productId: "p",
            sku: "s",
            name: "Item",
            quantity: 1,
            unitPricePaise: 100,
            totalPricePaise: 100,
          },
        ],
        amounts: {
          subtotalPaise: 100,
          discountPaise: 0,
          shippingPaise: 0,
          totalPaise: 100,
          paidPaise: 10,
          balanceDuePaise: 80,
          currency: "INR",
        },
        payment: {
          provider: "Razorpay",
          paymentId: "pay",
          method: "upi",
          isPartial: true,
          capturedAt: new Date().toISOString(),
        },
        placedAt: new Date().toISOString(),
        paidAt: new Date().toISOString(),
        promisedDeliveryAt: new Date().toISOString(),
        commerceStatus: "PAID",
      },
    };
    expect(() => parseCommerceOrderPaidEvent(event)).toThrow(/balance due/);
  });
});
