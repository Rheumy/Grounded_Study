import { prisma } from "@/lib/db/prisma";

async function main() {
  const users = await prisma.user.findMany();
  for (const user of users) {
    const existing = await prisma.subscription.findFirst({ where: { userId: user.id } });
    if (!existing) {
      await prisma.subscription.create({
        data: {
          userId: user.id,
          plan: "FREE",
          status: "ACTIVE"
        }
      });
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
