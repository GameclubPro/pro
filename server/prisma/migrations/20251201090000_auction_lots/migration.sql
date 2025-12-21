-- Auction lots catalog (categories + lots)

CREATE TABLE `AuctionLotCategory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AuctionLotCategory_slug_key`(`slug`),
    INDEX `AuctionLotCategory_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AuctionLot` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NULL,
    `categoryId` INTEGER NOT NULL,
    `imageUrl` TEXT NULL,
    `basePrice` INTEGER NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AuctionLot_slug_key`(`slug`),
    INDEX `AuctionLot_categoryId_idx`(`categoryId`),
    INDEX `AuctionLot_active_idx`(`active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `AuctionLot`
  ADD CONSTRAINT `AuctionLot_categoryId_fkey`
  FOREIGN KEY (`categoryId`) REFERENCES `AuctionLotCategory`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
