import type { CommerceAddress, CommerceLineItem } from "@/lib/fieldflow";

export const INTEGRATION_CLIENT_ID = "frames41";
export const ORDER_PAID_EVENT = "commerce.order.paid.v1";
export const DESK_STATUS_EVENT = "desk.order.status_changed.v1";

export type CommerceOrderPaidEvent = {
  eventId: string;
  eventType: typeof ORDER_PAID_EVENT;
  eventVersion: 1;
  occurredAt: string;
  source: "frames41";
  clientId: typeof INTEGRATION_CLIENT_ID;
  correlationId: string;
  aggregateId: string;
  payload: {
    externalOrderId: string;
    externalOrderNumber: string;
    customer: { name: string; email: string; phone: string };
    shippingAddress: CommerceAddress;
    items: CommerceLineItem[];
    amounts: {
      subtotalPaise: number;
      discountPaise: number;
      shippingPaise: number;
      totalPaise: number;
      paidPaise: number;
      balanceDuePaise: number;
      currency: "INR";
    };
    payment: {
      provider: "Razorpay";
      paymentId: string;
      method: string;
      isPartial: boolean;
      capturedAt: string;
    };
    placedAt: string;
    paidAt: string;
    promisedDeliveryAt: string;
    commerceStatus: "PAID" | "PROCESSING";
  };
};

export type DeskStatusChangedEvent = {
  eventId: string;
  eventType: typeof DESK_STATUS_EVENT;
  eventVersion: 1;
  occurredAt: string;
  source: "desk";
  clientId: typeof INTEGRATION_CLIENT_ID;
  correlationId: string;
  aggregateId: string;
  payload: {
    externalOrderId: string;
    externalOrderNumber: string;
    deskOrderId: string;
    deskStatus: "In progress" | "Completed" | "Cancelled";
    commerceStatus: "PROCESSING" | "READY_TO_SHIP" | "CANCELLED";
    changedBy: { id: string; name: string; role: string };
  };
};

function object(value: unknown, field: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, max = 500) {
  if (typeof value !== "string") throw new Error(`${field} must be text.`);
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > max) throw new Error(`${field} is invalid.`);
  return cleaned;
}

function optionalText(value: unknown, field: string, max = 2_000) {
  if (value === undefined || value === null || value === "") return undefined;
  return text(value, field, max);
}

function paise(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${field} must be a non-negative integer amount in paise.`);
  }
  return value as number;
}

function isoDate(value: unknown, field: string) {
  const cleaned = text(value, field, 80);
  if (Number.isNaN(Date.parse(cleaned))) throw new Error(`${field} is invalid.`);
  return new Date(cleaned).toISOString();
}

export function parseCommerceOrderPaidEvent(input: unknown): CommerceOrderPaidEvent {
  const event = object(input, "Event");
  if (event.eventType !== ORDER_PAID_EVENT || event.eventVersion !== 1) {
    throw new Error("Unsupported event type or version.");
  }
  if (event.source !== "frames41" || event.clientId !== INTEGRATION_CLIENT_ID) {
    throw new Error("Invalid integration source.");
  }
  const payload = object(event.payload, "payload");
  const customer = object(payload.customer, "payload.customer");
  const address = object(payload.shippingAddress, "payload.shippingAddress");
  const amounts = object(payload.amounts, "payload.amounts");
  const payment = object(payload.payment, "payload.payment");
  if (!Array.isArray(payload.items) || payload.items.length === 0 || payload.items.length > 200) {
    throw new Error("payload.items must contain between 1 and 200 items.");
  }
  const parsedAmounts = {
    subtotalPaise: paise(amounts.subtotalPaise, "payload.amounts.subtotalPaise"),
    discountPaise: paise(amounts.discountPaise, "payload.amounts.discountPaise"),
    shippingPaise: paise(amounts.shippingPaise, "payload.amounts.shippingPaise"),
    totalPaise: paise(amounts.totalPaise, "payload.amounts.totalPaise"),
    paidPaise: paise(amounts.paidPaise, "payload.amounts.paidPaise"),
    balanceDuePaise: paise(amounts.balanceDuePaise, "payload.amounts.balanceDuePaise"),
    currency: amounts.currency,
  };
  if (parsedAmounts.currency !== "INR") throw new Error("Only INR orders are supported.");
  if (parsedAmounts.paidPaise + parsedAmounts.balanceDuePaise !== parsedAmounts.totalPaise) {
    throw new Error("Paid amount and balance due must equal the order total.");
  }
  if (
    parsedAmounts.subtotalPaise - parsedAmounts.discountPaise + parsedAmounts.shippingPaise !==
    parsedAmounts.totalPaise
  ) {
    throw new Error("Order amount components do not equal the total.");
  }

  const items = payload.items.map((value, index) => {
    const item = object(value, `payload.items[${index}]`);
    const quantity = paise(item.quantity, `payload.items[${index}].quantity`);
    if (quantity < 1) throw new Error(`payload.items[${index}].quantity is invalid.`);
    const unitPricePaise = paise(item.unitPricePaise, `payload.items[${index}].unitPricePaise`);
    const totalPricePaise = paise(item.totalPricePaise, `payload.items[${index}].totalPricePaise`);
    if (unitPricePaise * quantity !== totalPricePaise) {
      throw new Error(`payload.items[${index}] price does not match quantity.`);
    }
    return {
      id: text(item.id, `payload.items[${index}].id`, 160),
      productId: text(item.productId, `payload.items[${index}].productId`, 160),
      sku: text(item.sku, `payload.items[${index}].sku`, 160),
      name: text(item.name, `payload.items[${index}].name`, 300),
      imageUrl: optionalText(item.imageUrl, `payload.items[${index}].imageUrl`),
      quantity,
      unitPricePaise,
      totalPricePaise,
      variant: optionalText(item.variant, `payload.items[${index}].variant`, 300),
      customization:
        item.customization === undefined ? undefined : object(item.customization, `payload.items[${index}].customization`),
    } satisfies CommerceLineItem;
  });
  if (items.reduce((sum, item) => sum + item.totalPricePaise, 0) !== parsedAmounts.subtotalPaise) {
    throw new Error("Line item totals must equal the order subtotal.");
  }

  if (payment.provider !== "Razorpay" || typeof payment.isPartial !== "boolean") {
    throw new Error("Invalid payment details.");
  }
  if (payload.commerceStatus !== "PAID" && payload.commerceStatus !== "PROCESSING") {
    throw new Error("Invalid commerce order status.");
  }

  return {
    eventId: text(event.eventId, "eventId", 160),
    eventType: ORDER_PAID_EVENT,
    eventVersion: 1,
    occurredAt: isoDate(event.occurredAt, "occurredAt"),
    source: "frames41",
    clientId: INTEGRATION_CLIENT_ID,
    correlationId: text(event.correlationId, "correlationId", 160),
    aggregateId: text(event.aggregateId, "aggregateId", 160),
    payload: {
      externalOrderId: text(payload.externalOrderId, "payload.externalOrderId", 160),
      externalOrderNumber: text(payload.externalOrderNumber, "payload.externalOrderNumber", 160),
      customer: {
        name: text(customer.name, "payload.customer.name", 160),
        email: text(customer.email, "payload.customer.email", 320),
        phone: text(customer.phone, "payload.customer.phone", 40),
      },
      shippingAddress: {
        line1: text(address.line1, "payload.shippingAddress.line1", 300),
        line2: optionalText(address.line2, "payload.shippingAddress.line2", 300),
        city: text(address.city, "payload.shippingAddress.city", 160),
        state: text(address.state, "payload.shippingAddress.state", 160),
        pincode: text(address.pincode, "payload.shippingAddress.pincode", 20),
      },
      items,
      amounts: parsedAmounts as CommerceOrderPaidEvent["payload"]["amounts"],
      payment: {
        provider: "Razorpay",
        paymentId: text(payment.paymentId, "payload.payment.paymentId", 160),
        method: text(payment.method, "payload.payment.method", 80),
        isPartial: payment.isPartial,
        capturedAt: isoDate(payment.capturedAt, "payload.payment.capturedAt"),
      },
      placedAt: isoDate(payload.placedAt, "payload.placedAt"),
      paidAt: isoDate(payload.paidAt, "payload.paidAt"),
      promisedDeliveryAt: isoDate(payload.promisedDeliveryAt, "payload.promisedDeliveryAt"),
      commerceStatus: payload.commerceStatus,
    },
  };
}
