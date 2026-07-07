-- Rename Purchase.itemDescription -> itemName. A RENAME preserves the existing
-- data and the NOT NULL constraint in place (no default-then-drop dance needed,
-- unlike an add-column), and keeps every row intact.
ALTER TABLE "Purchase" RENAME COLUMN "itemDescription" TO "itemName";
