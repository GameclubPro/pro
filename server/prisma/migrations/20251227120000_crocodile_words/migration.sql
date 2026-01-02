-- Crocodile words dictionary

CREATE TABLE `CrocodileWord` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `word` VARCHAR(191) NOT NULL,
    `wordKey` VARCHAR(191) NOT NULL,
    `difficulty` ENUM('EASY', 'MEDIUM', 'HARD') NOT NULL DEFAULT 'EASY',
    `pack` VARCHAR(191) NULL,
    `imageUrl` TEXT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CrocodileWord_wordKey_difficulty_key`(`wordKey`, `difficulty`),
    INDEX `CrocodileWord_difficulty_idx`(`difficulty`),
    INDEX `CrocodileWord_active_idx`(`active`),
    INDEX `CrocodileWord_pack_idx`(`pack`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
