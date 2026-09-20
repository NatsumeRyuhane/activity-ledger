export interface RecentActivity {
  id: string;
  name: string;
  visitedAt: number;
}

const RECENT_KEY = "ledger.recent.v1";
const identityKey = (activityId: string) => `ledger.identity.v1.${activityId}`;
const adminKey = (activityId: string) => `ledger.admin.v1.${activityId}`;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable (private mode); silently ignore.
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function loadRecentActivities(): RecentActivity[] {
  const raw = read(RECENT_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is RecentActivity =>
          typeof item?.id === "string" && typeof item?.name === "string",
      )
      .sort((a, b) => b.visitedAt - a.visitedAt);
  } catch {
    return [];
  }
}

export function rememberActivity(id: string, name: string): void {
  const others = loadRecentActivities().filter((item) => item.id !== id);
  write(RECENT_KEY, JSON.stringify([{ id, name, visitedAt: Date.now() }, ...others].slice(0, 20)));
}

export function forgetActivity(id: string): void {
  const others = loadRecentActivities().filter((item) => item.id !== id);
  write(RECENT_KEY, JSON.stringify(others));
}

export function loadIdentityId(activityId: string): string | null {
  return read(identityKey(activityId));
}

export function saveIdentityId(activityId: string, identityId: string): void {
  write(identityKey(activityId), identityId);
}

export function clearIdentityId(activityId: string): void {
  remove(identityKey(activityId));
}

export function loadAdminPassword(activityId: string): string | null {
  try {
    return sessionStorage.getItem(adminKey(activityId));
  } catch {
    return null;
  }
}

export function saveAdminPassword(activityId: string, password: string): void {
  try {
    sessionStorage.setItem(adminKey(activityId), password);
  } catch {
    // ignore
  }
}
