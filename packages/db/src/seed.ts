import bcrypt from 'bcryptjs';
import { prisma, UserRole } from './index.js';

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'admin123';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin user already exists: ${email}`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.create({
    data: {
      email,
      passwordHash,
      role: UserRole.admin,
    },
  });

  console.log(`Created admin user: ${email}`);

  for (const u of [
    { key: 'nifty50', name: 'Nifty 50' },
    { key: 'nifty100', name: 'Nifty 100' },
    { key: 'nifty200', name: 'Nifty 200' },
    { key: 'nifty500', name: 'Nifty 500' },
    { key: 'nifty250', name: 'Nifty Midcap 250' },
    { key: 'smallcap250', name: 'Nifty Smallcap 250' },
    { key: 'total_nse', name: 'All NSE (uploaded CSV)' },
  ]) {
    await prisma.universe.upsert({
      where: { key: u.key },
      create: { key: u.key, name: u.name, type: 'builtin' },
      update: { name: u.name },
    });
  }

  console.log('Seeded builtin universes');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
