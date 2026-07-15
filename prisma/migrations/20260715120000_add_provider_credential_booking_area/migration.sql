-- AlterTable: professional credential shown on bookings (e.g. "LMBT", "DPT").
ALTER TABLE "ServiceProvider" ADD COLUMN "credential" TEXT;

-- AlterTable: the Wake County town a booking's session takes place in.
-- Reuses the ServiceArea enum added in 20260715000000_add_user_area.
ALTER TABLE "Booking" ADD COLUMN "area" "ServiceArea";
