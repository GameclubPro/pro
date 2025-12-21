'use strict';

const { PrismaClient } = require('@prisma/client');

const CATEGORY_SLUG = 'auto';
const CATEGORY_NAME = '\u0410\u0432\u0442\u043E';
const LOTS = [
  {
    slug: 'vaz-2107',
    name: '\u0412\u0410\u0417-2107',
    imageUrl: 'https://s3.regru.cloud/box/auction/auto/VAZ2107.png',
    basePrice: 120000,
    nominalPrice: 180000,
  },
  {
    slug: 'lada-niva',
    name: '\u041B\u0430\u0434\u0430 \u041D\u0438\u0432\u0430',
    imageUrl: 'https://s3.regru.cloud/box/auction/auto/LadaNiva.png',
    basePrice: 120000,
    nominalPrice: 180000,
  },
];

const prisma = new PrismaClient();

async function main() {
  const category = await prisma.auctionLotCategory.upsert({
    where: { slug: CATEGORY_SLUG },
    update: { name: CATEGORY_NAME },
    create: { slug: CATEGORY_SLUG, name: CATEGORY_NAME },
  });

  for (const lot of LOTS) {
    const lotPayload = {
      name: lot.name,
      slug: lot.slug,
      categoryId: category.id,
      imageUrl: lot.imageUrl,
      basePrice: lot.basePrice,
      nominalPrice: lot.nominalPrice,
      active: true,
    };

    await prisma.auctionLot.upsert({
      where: { slug: lot.slug },
      update: {
        name: lot.name,
        categoryId: category.id,
        imageUrl: lot.imageUrl,
        basePrice: lot.basePrice,
        nominalPrice: lot.nominalPrice,
        active: true,
      },
      create: lotPayload,
    });

    console.log('Auction lot upserted:', lot.name);
  }
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
