import { describe, expect, it } from "vitest";
import { orderSchema } from "../src/modules/legacy-workspace/legacy-workspace.schema.js";
import { fieldInputSchema } from "../src/modules/order-fields/order-fields.routes.js";
import { parseCustomOrderSubmittedEvent } from "../src/modules/integrations/contracts.js";

describe("order custom fields", () => {
  it("validates field definitions and selectable options", () => {
    expect(
      fieldInputSchema.safeParse({
        label: "Print finish",
        type: "SELECT",
        options: ["Matte", "Gloss"],
      }).success,
    ).toBe(true);
    expect(
      fieldInputSchema.safeParse({
        label: "Print finish",
        type: "SELECT",
        options: [],
      }).success,
    ).toBe(false);
    expect(
      fieldInputSchema.safeParse({
        label: "Print finish",
        type: "MULTI_SELECT",
        options: ["Matte", "matte"],
      }).success,
    ).toBe(false);
  });

  it("accepts supported order values and rejects nested objects", () => {
    const order = {
      id: "#FF-10001",
      customer: "Example Customer",
      item: "Photo book",
      value: "₹1,000.00",
      status: "Pending",
      color: "orange",
      customFields: {
        print_finish: "Matte",
        copies: 2,
        gift_wrap: true,
        tags: ["Priority", "Wedding"],
      },
    };
    expect(orderSchema.safeParse(order).success).toBe(true);
    expect(
      orderSchema.safeParse({
        ...order,
        customFields: { unsupported: { nested: true } },
      }).success,
    ).toBe(false);
  });

  it("parses a fully custom external order event", () => {
    const parsed = parseCustomOrderSubmittedEvent({
      eventId: "7aa5ea19-33fb-43aa-a8e8-f73965df2798",
      eventType: "custom_order.submitted.v1",
      eventVersion: 1,
      occurredAt: "2026-09-07T14:30:00.000Z",
      source: "frames41",
      clientId: "frames41",
      correlationId: "0e137ec2-78c7-48b9-b66c-643b046fa7aa",
      aggregateId: "website-order-10428",
      payload: {
        externalId: "website-order-10428",
        fields: {
          customer_name: "Ananya Rao",
          order_amount: 12_500,
          gift_wrap: true,
        },
      },
    });
    expect(parsed.payload.fields).toEqual({
      customer_name: "Ananya Rao",
      order_amount: 12_500,
      gift_wrap: true,
    });
    expect(() =>
      parseCustomOrderSubmittedEvent({
        ...parsed,
        payload: { ...parsed.payload, fields: { nested: { value: true } } },
      }),
    ).toThrow("unsupported value");
  });
});
