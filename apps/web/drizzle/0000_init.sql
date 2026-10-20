CREATE TABLE "allocations" (
	"chain_id" integer NOT NULL,
	"contract_address" text NOT NULL,
	"allocation_id_hex" text NOT NULL,
	"allocation_id" text NOT NULL,
	"beneficiary" text NOT NULL,
	"total_amount" numeric(78, 0) NOT NULL,
	"released_amount" numeric(78, 0) DEFAULT '0' NOT NULL,
	"start" numeric(20, 0) NOT NULL,
	"cliff_duration" numeric(20, 0) NOT NULL,
	"duration" numeric(20, 0) NOT NULL,
	"created_block" bigint NOT NULL,
	"created_tx_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allocations_chain_id_contract_address_allocation_id_hex_pk" PRIMARY KEY("chain_id","contract_address","allocation_id_hex")
);
--> statement-breakpoint
CREATE TABLE "indexed_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"contract_address" text NOT NULL,
	"transaction_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" text NOT NULL,
	"event_name" text NOT NULL,
	"allocation_id" text NOT NULL,
	"decoded_payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "indexed_events_event_key" UNIQUE("chain_id","transaction_hash","log_index")
);
--> statement-breakpoint
CREATE TABLE "indexer_cursors" (
	"chain_id" integer NOT NULL,
	"contract_address" text NOT NULL,
	"last_processed_block" bigint NOT NULL,
	"last_processed_block_hash" text NOT NULL,
	"last_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "indexer_cursors_chain_id_contract_address_pk" PRIMARY KEY("chain_id","contract_address")
);
--> statement-breakpoint
CREATE TABLE "reconciliation_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"contract_address" text NOT NULL,
	"token_address" text NOT NULL,
	"token_decimals" integer NOT NULL,
	"indexed_block_number" bigint NOT NULL,
	"chain_head_block" bigint,
	"stale" boolean NOT NULL,
	"source_filename" text,
	"summary_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_rows" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_id" integer NOT NULL,
	"position" integer NOT NULL,
	"source_row_number" integer,
	"allocation_id" text,
	"beneficiary_address" text,
	"expected_amount_raw" numeric(78, 0),
	"actual_amount_raw" numeric(78, 0),
	"status" text NOT NULL,
	"message" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reconciliation_rows" ADD CONSTRAINT "reconciliation_rows_report_id_reconciliation_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reconciliation_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "allocations_beneficiary_idx" ON "allocations" USING btree ("chain_id","contract_address","beneficiary");--> statement-breakpoint
CREATE INDEX "indexed_events_contract_block_idx" ON "indexed_events" USING btree ("chain_id","contract_address","block_number");--> statement-breakpoint
CREATE INDEX "reconciliation_rows_report_idx" ON "reconciliation_rows" USING btree ("report_id","position");