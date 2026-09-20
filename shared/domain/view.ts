import type { Identity, LedgerEvent, Payment, ActivityMeta } from "./types";
import type { SettlementReport } from "./settlement";

export interface ActivityView {
  activity: ActivityMeta;
  identities: Identity[];
  payments: Payment[];
  settlement: SettlementReport;
  events: (LedgerEvent & { voided: boolean })[];
  headSeq: number;
}
