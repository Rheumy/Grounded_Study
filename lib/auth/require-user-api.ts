import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";

export async function requireUserApi() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return null;
  }
  return session.user;
}
