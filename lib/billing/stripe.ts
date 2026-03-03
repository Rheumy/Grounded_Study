import Stripe from "stripe";

export function stripeEnabled() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function getStripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("Stripe is not configured");
  }
  return new Stripe(key, {
    apiVersion: "2024-04-10"
  });
}
