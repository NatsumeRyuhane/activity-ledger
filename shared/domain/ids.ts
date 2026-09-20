import { customAlphabet } from "nanoid";

const ACTIVITY_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

export const newActivityId = customAlphabet(ACTIVITY_ALPHABET, 10);
export const newIdentityId = customAlphabet(ID_ALPHABET, 12);
export const newPaymentId = customAlphabet(ID_ALPHABET, 12);

export const IDENTITY_COLORS = [
  "#f97316",
  "#0ea5e9",
  "#22c55e",
  "#a855f7",
  "#ef4444",
  "#14b8a6",
  "#eab308",
  "#ec4899",
  "#6366f1",
  "#84cc16",
];

export function pickIdentityColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return IDENTITY_COLORS[hash % IDENTITY_COLORS.length];
}
