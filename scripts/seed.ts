// Seeds an initial admin account plus a couple of sample lookups so the app
// is usable immediately after setup. Run with: npm run seed
//
// TODO(verify-on-deploy): converted from raw SQL to Prisma by hand in a
// sandbox that cannot run `prisma generate` (see the top of src/lib/db.ts
// for why) — re-check this file once a real client has been generated.
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@eva.local";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";

  const existing = await prisma.account.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin account already exists: ${email}`);
  } else {
    const passwordHash = await hashPassword(password);
    await prisma.account.create({
      data: {
        email,
        passwordHash,
        name: "Administrator",
        role: "ADMIN",
      },
    });
    console.log(`Created admin account:\n  email:    ${email}\n  password: ${password}`);
    console.log("Change this password after first login (change-password UI is a follow-up item).");
  }

  const studyTypes = [
    { name: "Nursing", nameAr: "تمريض" },
    { name: "Medicine", nameAr: "طب" },
  ];
  for (const st of studyTypes) {
    const exists = await prisma.studyType.findUnique({ where: { name: st.name } });
    if (!exists) {
      await prisma.studyType.create({ data: { name: st.name, nameAr: st.nameAr } });
    }
  }

  console.log("Seed complete.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
