import { useCallback, useEffect, useMemo, useState } from "react";
import type { ActivityView } from "@shared/domain";
import type { CommandInput } from "@shared/domain/commands";
import { ApiError, fetchActivity, sendCommand } from "@/lib/api";
import {
  clearIdentityId,
  loadAdminPassword,
  loadIdentityId,
  saveIdentityId,
} from "@/lib/storage";

type Status = "loading" | "ready" | "notfound" | "error";

export type RunCommand = (
  command: CommandInput,
  options?: { adminPassword?: string },
) => Promise<ActivityView>;

export type ActivityController = ReturnType<typeof useActivity>;

export function useActivity(activityId: string) {
  const [view, setView] = useState<ActivityView | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<ApiError | null>(null);
  const [nonce, setNonce] = useState(0);
  const [identityId, setIdentityIdState] = useState<string | null>(() =>
    loadIdentityId(activityId),
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const next = await fetchActivity(activityId);
        if (cancelled) return;
        setView(next);
        setError(null);
        setStatus("ready");
      } catch (caught) {
        if (cancelled) return;
        const apiError =
          caught instanceof ApiError
            ? caught
            : new ApiError("unknown", "加载失败，请稍后再试", 0);
        if (apiError.status === 404) {
          setStatus("notfound");
        } else {
          setError(apiError);
          setStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activityId, nonce]);

  const reload = useCallback(() => {
    setStatus("loading");
    setError(null);
    setNonce((value) => value + 1);
  }, []);

  const me = useMemo(
    () => view?.identities.find((identity) => identity.id === identityId) ?? null,
    [view, identityId],
  );

  const setIdentity = useCallback(
    (id: string | null) => {
      if (id) {
        saveIdentityId(activityId, id);
      } else {
        clearIdentityId(activityId);
      }
      setIdentityIdState(id);
    },
    [activityId],
  );

  const run: RunCommand = useCallback(
    async (command, options) => {
      if (!identityId) {
        throw new ApiError("unknown_identity", "请先选择你的身份", 403);
      }
      setBusy(true);
      try {
        const next = await sendCommand(
          activityId,
          identityId,
          command,
          options?.adminPassword ?? loadAdminPassword(activityId) ?? undefined,
        );
        setView(next);
        return next;
      } finally {
        setBusy(false);
      }
    },
    [activityId, identityId],
  );

  return {
    view,
    status,
    loading: status === "loading",
    notFound: status === "notfound",
    error,
    reload,
    identityId,
    me,
    setIdentity,
    run,
    busy,
  };
}
