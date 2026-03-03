import { NextResponse } from "next/server";
import { getStripeClient, stripeEnabled } from "@/lib/billing/stripe";
import { prisma } from "@/lib/db/prisma";
import Stripe from "stripe";
import type { SubscriptionStatus, PlanTier } from "@prisma/client";

const statusMap: Record<string, SubscriptionStatus> = {
  active: "ACTIVE",
  trialing: "TRIALING",
  past_due: "PAST_DUE",
  canceled: "CANCELED",
  incomplete: "INCOMPLETE"
};

export async function POST(request: Request) {
  if (!stripeEnabled()) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 400 });
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Webhook secret missing" }, { status: 400 });
  }

  const stripe = getStripeClient();
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type.startsWith("customer.subscription")) {
    const sub = event.data.object as Stripe.Subscription;
    const customerId = sub.customer as string;

    const status: SubscriptionStatus = statusMap[sub.status] ?? "INCOMPLETE";
    const plan: PlanTier = sub.status === "active" || sub.status === "trialing" ? "PRO" : "FREE";

    const record = await prisma.subscription.findFirst({
      where: { stripeCustomerId: customerId }
    });

    if (record) {
      await prisma.subscription.update({
        where: { id: record.id },
        data: {
          status,
          plan,
          stripeSubId: sub.id
        }
      });
    }
  }

  return NextResponse.json({ received: true });
}