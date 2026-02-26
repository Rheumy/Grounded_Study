import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/require-user-api";
import { getStripeClient, stripeEnabled } from "@/lib/billing/stripe";
import { getOrCreateSubscription } from "@/lib/billing/subscription";
import { prisma } from "@/lib/db/prisma";

export async function POST() {
  const user = await requireUserApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!stripeEnabled()) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 400 });
  }

  const priceId = process.env.STRIPE_PRICE_PRO;
  if (!priceId) {
    return NextResponse.json({ error: "Stripe price not configured" }, { status: 400 });
  }

  const stripe = getStripeClient();
  const subscription = await getOrCreateSubscription(user.id);

  let customerId = subscription.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { userId: user.id }
    });
    customerId = customer.id;
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { stripeCustomerId: customerId }
    });
  }

  const appUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/dashboard/billing?success=true`,
    cancel_url: `${appUrl}/dashboard/billing?canceled=true`
  });

  return NextResponse.json({ url: session.url });
}
