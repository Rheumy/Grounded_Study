import type { NextAuthOptions } from "next-auth";
import EmailProvider from "next-auth/providers/email";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db/prisma";
import {
  isBetaEmailAllowed,
  isEmailAuthEnabled,
  maskEmail,
  normalizeEmailIdentifier
} from "@/lib/auth/email-access";
import { safeSendVerificationRequest } from "@/lib/auth/email";
import { logger } from "@/lib/observability/logger";

const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const emailAuthEnabled = isEmailAuthEnabled();
const devBypassEnabled =
  process.env.NODE_ENV !== "production" && process.env.DEV_AUTH_BYPASS === "true";

export const authOptions: NextAuthOptions = {
  // @ts-expect-error - NextAuth and PrismaAdapter types often mismatch slightly
  adapter: PrismaAdapter(prisma),
  // NextAuth forces "jwt" strategy when using a Credentials Provider
  session: { strategy: "jwt", maxAge: 7_776_000 },
  jwt: { maxAge: 7_776_000 },
  pages: {
    signIn: "/auth/signin",
    verifyRequest: "/auth/verify-request",
    error: "/auth/signin"
  },
  providers: [
    ...(emailAuthEnabled
      ? [
          EmailProvider({
            from: process.env.EMAIL_FROM ?? "no-reply@grounded-study.local",
            maxAge: 24 * 60 * 60,
            sendVerificationRequest: safeSendVerificationRequest
          })
        ]
      : []),
    ...(devBypassEnabled
      ? [
          CredentialsProvider({
            id: "dev-bypass",
            name: "Dev Bypass",
            credentials: {
              email: { label: "Email", type: "text" }
            },
            async authorize(credentials) {
              const email = credentials?.email || process.env.DEV_AUTH_EMAIL;
              if (!email || email !== process.env.DEV_AUTH_EMAIL) {
                return null;
              }
              const user = await prisma.user.upsert({
                where: { email },
                update: {},
                create: { email }
              });
              // Ensure ID is passed cleanly
              return { id: String(user.id), email: user.email };
            }
          })
        ]
      : []),
    ...(googleEnabled
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID as string,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET as string
          })
        ]
      : [])
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (!account || (account.provider !== "google" && account.provider !== "email")) {
        return true;
      }

      const rawEmail = user?.email ?? (account.type === "email" ? account.providerAccountId : null);
      let normalizedEmail: string | null = null;

      if (rawEmail) {
        try {
          normalizedEmail = normalizeEmailIdentifier(rawEmail);
        } catch {
          normalizedEmail = null;
        }
      }

      if (isBetaEmailAllowed(normalizedEmail)) {
        return true;
      }

      logger.warn(
        {
          email: maskEmail(normalizedEmail),
          provider: account.provider
        },
        "Blocked sign-in outside beta allowlist"
      );
      return "/auth/not-allowed";
    },
    // 1. Pass the user ID into the JWT token during sign in
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    // 2. Pass the ID from the token into the active session
    async session({ session, token }) {
      if (session.user) {
        // 'as any' tells TypeScript to ignore the strict default properties
        (session.user as any).id = token.id;
        (session.user as any).isAdmin =
          Boolean(process.env.ADMIN_EMAIL) && session.user.email === process.env.ADMIN_EMAIL;
      }
      return session;
    }
  },
  events: {
    async signIn(message) {
      logger.info(
        {
          userId: message.user.id,
          email: maskEmail(message.user.email)
        },
        "User signed in"
      );
    }
  },
  debug: process.env.NODE_ENV === "development"
};
