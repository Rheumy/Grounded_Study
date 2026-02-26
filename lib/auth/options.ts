import type { NextAuthOptions } from "next-auth";
import EmailProvider from "next-auth/providers/email";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db/prisma";
import { safeSendVerificationRequest } from "@/lib/auth/email";
import { logger } from "@/lib/observability/logger";

const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const devBypassEnabled =
  process.env.NODE_ENV !== "production" && process.env.DEV_AUTH_BYPASS === "true";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  pages: {
    signIn: "/signin"
  },
  providers: [
    EmailProvider({
      from: process.env.EMAIL_FROM ?? "no-reply@grounded-study.local",
      sendVerificationRequest: safeSendVerificationRequest
    }),
    ...(devBypassEnabled
      ? [
          CredentialsProvider({
            id: "dev-bypass",
            name: "Dev Bypass",
            credentials: {
              email: { label: "Email", type: "text" }
            },
            async authorize(credentials) {
              const email = credentials?.email ?? process.env.DEV_AUTH_EMAIL;
              if (!email || email !== process.env.DEV_AUTH_EMAIL) {
                return null;
              }
              const user = await prisma.user.upsert({
                where: { email },
                update: {},
                create: { email }
              });
              return { id: user.id, email: user.email };
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
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
        session.user.isAdmin =
          Boolean(process.env.ADMIN_EMAIL) && session.user.email === process.env.ADMIN_EMAIL;
      }
      return session;
    }
  },
  events: {
    async signIn(message) {
      logger.info({ userId: message.user.id, email: message.user.email }, "User signed in");
    }
  },
  debug: process.env.NODE_ENV === "development"
};
