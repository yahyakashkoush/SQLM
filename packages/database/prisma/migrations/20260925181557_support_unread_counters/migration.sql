-- AlterTable
ALTER TABLE "support_tickets" ADD COLUMN     "customerUnread" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastMessageAt" TIMESTAMP(3),
ADD COLUMN     "staffUnread" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ticket_messages" ADD COLUMN     "internal" BOOLEAN NOT NULL DEFAULT false;
