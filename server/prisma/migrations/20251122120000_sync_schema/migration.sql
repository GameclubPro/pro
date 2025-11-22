-- Align database schema with current Prisma models (Room game/phaseEndsAt, roles, votes, night actions)

-- User: allow null tgUserId and add nativeId
ALTER TABLE `User`
  MODIFY `tgUserId` BIGINT NULL,
  ADD COLUMN `nativeId` VARCHAR(191) NULL AFTER `tgUserId`;

CREATE UNIQUE INDEX `User_nativeId_key` ON `User`(`nativeId`);

-- Room: add game/dayNumber/phaseEndsAt and fix updatedAt defaults
ALTER TABLE `Room`
  ADD COLUMN `game` ENUM('MAFIA', 'AUCTION') NOT NULL DEFAULT 'MAFIA' AFTER `code`,
  ADD COLUMN `dayNumber` INTEGER NOT NULL DEFAULT 0 AFTER `status`,
  ADD COLUMN `phaseEndsAt` DATETIME(3) NULL AFTER `dayNumber`,
  MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);

CREATE INDEX `Room_ownerId_idx` ON `Room`(`ownerId`);
CREATE INDEX `Room_game_idx` ON `Room`(`game`);
CREATE INDEX `Room_status_idx` ON `Room`(`status`);
CREATE INDEX `Room_status_phaseEndsAt_idx` ON `Room`(`status`, `phaseEndsAt`);

-- RoomPlayer: extend role enum and add readiness helpers
ALTER TABLE `RoomPlayer`
  MODIFY `role` ENUM('DON', 'MAFIA', 'DOCTOR', 'SHERIFF', 'BODYGUARD', 'PROSTITUTE', 'JOURNALIST', 'SNIPER', 'CIVIL') NULL,
  ADD COLUMN `ready` BOOLEAN NOT NULL DEFAULT false AFTER `alive`;

CREATE INDEX `RoomPlayer_roomId_ready_idx` ON `RoomPlayer`(`roomId`, `ready`);
CREATE INDEX `RoomPlayer_roomId_alive_idx` ON `RoomPlayer`(`roomId`, `alive`);
CREATE INDEX `RoomPlayer_roomId_role_alive_idx` ON `RoomPlayer`(`roomId`, `role`, `alive`);

-- Match/Event indexes for faster lookups
CREATE INDEX `Match_roomId_idx` ON `Match`(`roomId`);
CREATE INDEX `Match_startedAt_idx` ON `Match`(`startedAt`);
CREATE INDEX `Event_matchId_phase_idx` ON `Event`(`matchId`, `phase`);
CREATE INDEX `Event_createdAt_idx` ON `Event`(`createdAt`);

-- Vote: rename target column, add vote metadata, and new indexes/FKs
ALTER TABLE `Vote`
  CHANGE COLUMN `targetId` `targetPlayerId` INTEGER NULL,
  ADD COLUMN `type` ENUM('LYNCH', 'MAFIA') NOT NULL DEFAULT 'LYNCH' AFTER `targetPlayerId`,
  ADD COLUMN `dayNumber` INTEGER NOT NULL DEFAULT 0 AFTER `type`,
  ADD COLUMN `round` INTEGER NOT NULL DEFAULT 1 AFTER `dayNumber`;

CREATE UNIQUE INDEX `Vote_roomId_voterId_type_dayNumber_round_key` ON `Vote`(`roomId`, `voterId`, `type`, `dayNumber`, `round`);
CREATE INDEX `Vote_roomId_type_dayNumber_round_idx` ON `Vote`(`roomId`, `type`, `dayNumber`, `round`);
CREATE INDEX `Vote_roomId_dayNumber_round_idx` ON `Vote`(`roomId`, `dayNumber`, `round`);
CREATE INDEX `Vote_createdAt_idx` ON `Vote`(`createdAt`);

ALTER TABLE `Vote`
  ADD CONSTRAINT `Vote_targetPlayerId_fkey` FOREIGN KEY (`targetPlayerId`) REFERENCES `RoomPlayer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- NightAction: new table for per-night moves
CREATE TABLE `NightAction` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `matchId` INTEGER NOT NULL,
    `nightNumber` INTEGER NOT NULL,
    `actorPlayerId` INTEGER NOT NULL,
    `role` ENUM('DON', 'MAFIA', 'DOCTOR', 'SHERIFF', 'BODYGUARD', 'PROSTITUTE', 'JOURNALIST', 'SNIPER', 'CIVIL') NOT NULL,
    `targetPlayerId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `NightAction_matchId_nightNumber_actorPlayerId_key`(`matchId`, `nightNumber`, `actorPlayerId`),
    INDEX `NightAction_matchId_nightNumber_idx`(`matchId`, `nightNumber`),
    INDEX `NightAction_actorPlayerId_idx`(`actorPlayerId`),
    INDEX `NightAction_targetPlayerId_idx`(`targetPlayerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `NightAction` ADD CONSTRAINT `NightAction_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `Match`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `NightAction` ADD CONSTRAINT `NightAction_actorPlayerId_fkey` FOREIGN KEY (`actorPlayerId`) REFERENCES `RoomPlayer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `NightAction` ADD CONSTRAINT `NightAction_targetPlayerId_fkey` FOREIGN KEY (`targetPlayerId`) REFERENCES `RoomPlayer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
