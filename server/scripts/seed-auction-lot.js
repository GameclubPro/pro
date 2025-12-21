'use strict';

const { PrismaClient } = require('@prisma/client');

const CATEGORY_SLUG = 'auto';
const CATEGORY_NAME = '\u0410\u0432\u0442\u043E';
const LOT_SLUG = 'vaz-2107';
const LOT_NAME = '\u0412\u0410\u0417-2107';
const LOT_IMAGE_URL = 'https://s3.regru.cloud/box/auction/auto/VAZ2107.png';
const LOT_BASE_PRICE = 120000;

const prisma = new PrismaClient();

async function main() {
  const category = await prisma.auctionLotCategory.upsert({
    where: { slug: CATEGORY_SLUG },
    update: { name: CATEGORY_NAME },
    create: { slug: CATEGORY_SLUG, name: CATEGORY_NAME },
  });

  const lotPayload = {
    name: LOT_NAME,
    slug: LOT_SLUG,
    categoryId: category.id,
    imageUrl: LOT_IMAGE_URL,
    basePrice: LOT_BASE_PRICE,
    active: true,
  };

  await prisma.auctionLot.upsert({
    where: { slug: LOT_SLUG },
    update: {
      name: LOT_NAME,
      categoryId: category.id,
      imageUrl: LOT_IMAGE_URL,
      basePrice: LOT_BASE_PRICE,
      active: true,
    },
    create: lotPayload,
  });

  console.log('Auction lot upserted:', LOT_NAME);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
