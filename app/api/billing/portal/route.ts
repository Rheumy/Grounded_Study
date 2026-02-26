import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/require-user-api";
import { getStripeClient, stripeEnabled } from "@/lib/billing/stripe";
import { getOrCreateSubscription } from "@/lib/billing/subscription";

export async function POST() {
  const user = await requireUserApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!stripeEnabled()) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 400 });
  }

  const subscription = await getOrCreateSubscription(user.id);
  if (!subscription.stripeCustomerId) {
    return NextResponse.json({ error: "No Stripe customer" }, { status: 400 });
  }

  const stripe = getStripeClient();
  const appUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const portal = await stripe.billingPortal.sessions.create({
    customer: subscription.stripeCustomerId,
    return_url: `${appUrl}/dashboard/billing`
  });

  return NextResponse.json({ url: portal.url });
}
