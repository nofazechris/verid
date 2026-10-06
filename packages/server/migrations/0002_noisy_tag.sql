DROP INDEX IF EXISTS "settlements_exec_idx";--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "escrow_address" text NOT NULL;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "chain_id" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "deadline" bigint NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "settlements_exec_unique" ON "settlements" USING btree ("execution_id");