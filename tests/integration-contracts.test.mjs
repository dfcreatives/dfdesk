import assert from "node:assert/strict";
import test from "node:test";
import { parseCommerceOrderPaidEvent } from "../src/lib/integrations/contracts.ts";

function paidEvent() {
  return {
    eventId: "commerce-order-paid:40c18938-219c-46dc-ae74-f3a8b5762ed4",
    eventType: "commerce.order.paid.v1",
    eventVersion: 1,
    occurredAt: "2026-09-04T10:00:00.000Z",
    source: "frames41",
    clientId: "frames41",
    correlationId: "correlation-1",
    aggregateId: "40c18938-219c-46dc-ae74-f3a8b5762ed4",
    payload: {
      externalOrderId: "40c18938-219c-46dc-ae74-f3a8b5762ed4",
      externalOrderNumber: "F41-ABC123",
      customer: { name: "Test Customer", email: "test@example.com", phone: "9876543210" },
      shippingAddress: {
        line1: "41 Test Road", city: "Chennai", state: "Tamil Nadu", pincode: "600001",
      },
      items: [{
        id: "item-1", productId: "product-1", sku: "FRAME-1", name: "Custom Frame",
        imageUrl: "https://example.com/frame.jpg", quantity: 1,
        unitPricePaise: 100_000, totalPricePaise: 100_000,
        customization: { text: "Frames 41", customImageUrl: "https://example.com/custom.jpg" },
      }],
      amounts: {
        subtotalPaise: 100_000, discountPaise: 0, shippingPaise: 10_000,
        totalPaise: 110_000, paidPaise: 55_000, balanceDuePaise: 55_000, currency: "INR",
      },
      payment: {
        provider: "Razorpay", paymentId: "pay_test", method: "upi", isPartial: true,
        capturedAt: "2026-09-04T10:00:00.000Z",
      },
      placedAt: "2026-09-04T09:55:00.000Z",
      paidAt: "2026-09-04T10:00:00.000Z",
      promisedDeliveryAt: "2026-09-11T09:55:00.000Z",
      commerceStatus: "PROCESSING",
    },
  };
}

test("accepts a complete 50% paid order using integer paise", () => {
  const parsed = parseCommerceOrderPaidEvent(paidEvent());
  assert.equal(parsed.payload.amounts.balanceDuePaise, 55_000);
  assert.equal(parsed.payload.items[0].customization.customImageUrl, "https://example.com/custom.jpg");
});

test("rejects malformed money and unsupported event versions", () => {
  const malformed = paidEvent();
  malformed.payload.amounts.paidPaise = 55_000.5;
  assert.throws(() => parseCommerceOrderPaidEvent(malformed), /integer amount in paise/);

  const unsupported = paidEvent();
  unsupported.eventVersion = 2;
  assert.throws(() => parseCommerceOrderPaidEvent(unsupported), /Unsupported event type or version/);
});

test("rejects totals that do not reconcile", () => {
  const event = paidEvent();
  event.payload.amounts.balanceDuePaise = 1;
  assert.throws(() => parseCommerceOrderPaidEvent(event), /must equal the order total/);
});
