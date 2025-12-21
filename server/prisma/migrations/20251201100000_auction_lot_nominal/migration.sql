-- Add nominal (real) price for auction lots

ALTER TABLE `AuctionLot`
  ADD COLUMN `nominalPrice` INTEGER NULL AFTER `basePrice`;
