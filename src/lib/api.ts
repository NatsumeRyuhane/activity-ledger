import type { ActivityView } from "@shared/domain";
import type { CommandInput } from "@shared/domain/commands";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError("network", "网络连接失败，请检查网络后重试", 0);
  }

  const data = (await response.json().catch(() => null)) as
    | { error?: { code?: string; message?: string } }
    | null;

  if (!response.ok) {
    throw new ApiError(
      data?.error?.code ?? "unknown",
      data?.error?.message ?? "操作失败，请稍后再试",
      response.status,
    );
  }
  return data as T;
}

export function createActivity(input: {
  name: string;
  creatorName: string;
  description?: string;
  password?: string;
}) {
  return request<{ activityId: string; identityId: string }>("/api/activities", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function verifyAdminPassword(activityId: string, password: string): Promise<void> {
  await request<{ ok: boolean }>(`/api/activities/${activityId}/admin/verify`, {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export function createIdentity(activityId: string, name: string) {
  return request<{ view: ActivityView; identityId: string }>(
    `/api/activities/${activityId}/identities`,
    { method: "POST", body: JSON.stringify({ name }) },
  );
}

export async function uploadAvatar(file: File): Promise<string> {
  let response: Response;
  try {
    response = await fetch("/api/avatars", {
      method: "POST",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file,
    });
  } catch {
    throw new ApiError("network", "网络连接失败，请检查网络后重试", 0);
  }
  const data = (await response.json().catch(() => null)) as
    | { avatar?: string; error?: { code?: string; message?: string } }
    | null;
  if (!response.ok || !data?.avatar) {
    throw new ApiError(
      data?.error?.code ?? "unknown",
      data?.error?.message ?? "头像上传失败，请稍后再试",
      response.status,
    );
  }
  return data.avatar;
}

export function fetchActivity(activityId: string) {
  return request<ActivityView>(`/api/activities/${activityId}`);
}

export function sendCommand(
  activityId: string,
  actorIdentityId: string,
  command: CommandInput,
  adminPassword?: string,
) {
  return request<ActivityView>(`/api/activities/${activityId}/commands`, {
    method: "POST",
    body: JSON.stringify({ actorIdentityId, adminPassword, command }),
  });
}
