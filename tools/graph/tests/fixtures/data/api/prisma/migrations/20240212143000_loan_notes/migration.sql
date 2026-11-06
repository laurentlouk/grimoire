/* A loan can carry a note; the rows before it get none. */
-- AlterTable
ALTER TABLE "Loan" ADD COLUMN "note" TEXT;
