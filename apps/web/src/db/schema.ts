import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

// Token amounts and uint64 schedule values are stored as exact NUMERIC integers (read back as strings).
// Never use floating-point columns for token units.
const uint256 = (name: string) => numeric(name, { precision: 78, scale: 0 });
const uint64 = (name: string) => numeric(name, { precision: 20, scale: 0 });

/** Every decoded contract log. Idempotency key: (chain_id, transaction_hash, log_index). */
export const indexedEvents = pgTable(
  "indexed_events",
  {
    id: serial("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    contractAddress: text("contract_address").notNull(),
    transactionHash: text("transaction_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockHash: text("block_hash").notNull(),
    eventName: text("event_name").notNull(),
    allocationId: text("allocation_id").notNull(),
    decodedPayload: jsonb("decoded_payload").$type<Record<string, string>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("indexed_events_event_key").on(t.chainId, t.transactionHash, t.logIndex),
    index("indexed_events_contract_block_idx").on(t.chainId, t.contractAddress, t.blockNumber),
  ],
);

/** Read model of each schedule, projected from ScheduleCreated / TokensReleased events. */
export const allocations = pgTable(
  "allocations",
  {
    chainId: integer("chain_id").notNull(),
    contractAddress: text("contract_address").notNull(),
    allocationIdHex: text("allocation_id_hex").notNull(),
    allocationId: text("allocation_id").notNull(),
    beneficiary: text("beneficiary").notNull(),
    totalAmount: uint256("total_amount").notNull(),
    releasedAmount: uint256("released_amount").notNull().default("0"),
    start: uint64("start").notNull(),
    cliffDuration: uint64("cliff_duration").notNull(),
    duration: uint64("duration").notNull(),
    createdBlock: bigint("created_block", { mode: "bigint" }).notNull(),
    createdTxHash: text("created_tx_hash").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.contractAddress, t.allocationIdHex] }),
    index("allocations_beneficiary_idx").on(t.chainId, t.contractAddress, t.beneficiary),
  ],
);

export const indexerCursors = pgTable(
  "indexer_cursors",
  {
    chainId: integer("chain_id").notNull(),
    contractAddress: text("contract_address").notNull(),
    lastProcessedBlock: bigint("last_processed_block", { mode: "bigint" }).notNull(),
    lastProcessedBlockHash: text("last_processed_block_hash").notNull(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.contractAddress] })],
);

export const reconciliationReports = pgTable("reconciliation_reports", {
  id: serial("id").primaryKey(),
  chainId: integer("chain_id").notNull(),
  contractAddress: text("contract_address").notNull(),
  tokenAddress: text("token_address").notNull(),
  tokenDecimals: integer("token_decimals").notNull(),
  indexedBlockNumber: bigint("indexed_block_number", { mode: "bigint" }).notNull(),
  chainHeadBlock: bigint("chain_head_block", { mode: "bigint" }),
  stale: boolean("stale").notNull(),
  // Only the filename is kept; the uploaded CSV itself is not retained.
  sourceFilename: text("source_filename"),
  summaryJson: jsonb("summary_json").$type<Record<string, number>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reconciliationRows = pgTable(
  "reconciliation_rows",
  {
    id: serial("id").primaryKey(),
    reportId: integer("report_id")
      .notNull()
      .references(() => reconciliationReports.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    sourceRowNumber: integer("source_row_number"),
    allocationId: text("allocation_id"),
    beneficiaryAddress: text("beneficiary_address"),
    expectedAmountRaw: uint256("expected_amount_raw"),
    actualAmountRaw: uint256("actual_amount_raw"),
    status: text("status").notNull(),
    message: text("message").notNull(),
  },
  (t) => [index("reconciliation_rows_report_idx").on(t.reportId, t.position)],
);
