import { useState } from "react";
import {
  centsToYuanInput,
  formatYuan,
  parseYuanToCents,
  type ActivityView,
  type Payment,
  type SplitMode,
} from "@shared/domain";
import { IdentityBadge } from "@/components/IdentityBadge";
import { Button, Field, Input, Segmented, Select, Sheet, Textarea } from "@/components/ui";
import { nowInputValue } from "@/lib/format";

export interface PaymentFormValue {
  title: string;
  paidAt?: string;
  description?: string;
  splitMode: SplitMode;
  payers: { identityId: string; amountCents: number }[];
  participants: { identityId: string; shareCents?: number }[];
}

interface DraftPayer {
  identityId: string;
  amount: string;
}

interface DraftParticipant {
  identityId: string;
  share: string;
}

export function PaymentFormSheet({
  view,
  me,
  payment,
  busy,
  onClose,
  onSubmit,
}: {
  view: ActivityView;
  me: { id: string };
  payment?: Payment | null;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (value: PaymentFormValue) => void;
}) {
  const identities = view.identities;
  const lockedPayerId = payment ? payment.createdBy : me.id;
  const [title, setTitle] = useState(payment?.title ?? "");
  const [paidAt, setPaidAt] = useState(payment?.paidAt ?? nowInputValue());
  const [description, setDescription] = useState(payment?.description ?? "");
  const [splitMode, setSplitMode] = useState<SplitMode>(payment?.splitMode ?? "equal");
  const [payers, setPayers] = useState<DraftPayer[]>(
    payment
      ? payment.payers.map((payer) => ({
          identityId: payer.identityId,
          amount: centsToYuanInput(payer.amountCents),
        }))
      : [{ identityId: me.id, amount: "" }],
  );
  const [participants, setParticipants] = useState<DraftParticipant[]>(
    payment
      ? payment.participants.map((participant) => ({
          identityId: participant.identityId,
          share:
            participant.shareCents !== undefined
              ? centsToYuanInput(participant.shareCents)
              : "",
        }))
      : [{ identityId: me.id, share: "" }],
  );
  const [error, setError] = useState<string | null>(null);

  const totalCents = payers.reduce(
    (sum, payer) => sum + (parseYuanToCents(payer.amount) ?? 0),
    0,
  );
  const shareSumCents = participants.reduce(
    (sum, participant) => sum + (parseYuanToCents(participant.share) ?? 0),
    0,
  );
  const shareMismatch = splitMode === "custom" && shareSumCents !== totalCents;

  function distributeShares() {
    const count = participants.length;
    if (totalCents <= 0 || count === 0) return;
    const base = Math.floor(totalCents / count);
    let remainder = totalCents - base * count;
    setParticipants((current) =>
      current.map((participant) => {
        const extra = remainder > 0 ? 1 : 0;
        remainder -= extra;
        return { ...participant, share: centsToYuanInput(base + extra) };
      }),
    );
  }

  function changeSplitMode(mode: SplitMode) {
    setSplitMode(mode);
    setError(null);
    if (mode === "custom") {
      const allEmpty = participants.every(
        (participant) => parseYuanToCents(participant.share) === null,
      );
      if (allEmpty) distributeShares();
    }
  }

  function addPayer() {
    const used = new Set(payers.map((payer) => payer.identityId));
    const next = identities.find((identity) => !used.has(identity.id));
    if (!next) {
      setError("没有可添加的成员了");
      return;
    }
    setPayers((current) => [...current, { identityId: next.id, amount: "" }]);
  }

  function addParticipant() {
    const used = new Set(participants.map((participant) => participant.identityId));
    const next = identities.find((identity) => !used.has(identity.id));
    if (!next) {
      setError("没有可添加的成员了");
      return;
    }
    const remaining = Math.max(0, totalCents - shareSumCents);
    setParticipants((current) => [
      ...current,
      { identityId: next.id, share: splitMode === "custom" ? centsToYuanInput(remaining) : "" },
    ]);
  }

  function toggleParticipant(identityId: string) {
    setParticipants((current) =>
      current.some((participant) => participant.identityId === identityId)
        ? current.filter((participant) => participant.identityId !== identityId)
        : [...current, { identityId, share: "" }],
    );
  }

  function handleSubmit() {
    if (!title.trim()) {
      setError("请填写标题");
      return;
    }
    if (payers.length === 0) {
      setError("至少需要一位付款人");
      return;
    }
    for (const payer of payers) {
      if (parseYuanToCents(payer.amount) === null) {
        setError("请填写每位付款人的支付金额");
        return;
      }
    }
    if (!payers.some((payer) => payer.identityId === lockedPayerId)) {
      setError("付款创建者必须是付款人，不能被移除");
      return;
    }
    if (totalCents <= 0) {
      setError("付款总额需要大于 0");
      return;
    }
    if (participants.length === 0) {
      setError("至少需要一位参与人");
      return;
    }
    for (const participant of participants) {
      if (splitMode === "custom" && parseYuanToCents(participant.share) === null) {
        setError("分摊金额格式不正确");
        return;
      }
    }

    onSubmit({
      title: title.trim(),
      paidAt: paidAt || undefined,
      description: description.trim() || undefined,
      splitMode,
      payers: payers.map((payer) => ({
        identityId: payer.identityId,
        amountCents: parseYuanToCents(payer.amount) ?? 0,
      })),
      participants: participants.map((participant) => ({
        identityId: participant.identityId,
        ...(splitMode === "custom"
          ? { shareCents: parseYuanToCents(participant.share) ?? 0 }
          : {}),
      })),
    });
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={payment ? "编辑付款" : "记一笔"}
      footer={
        <div className="space-y-2.5">
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {!error && shareMismatch ? (
            <p className="text-xs text-amber-600">
              分摊金额与付款总额不一致，仍可保存，之后继续修改；对齐前这笔付款会标记为「待完善」。
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button className="flex-1" onClick={handleSubmit} disabled={busy}>
              {busy ? "保存中…" : payment ? "保存修改" : "创建付款"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="标题">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如：晚餐、门票、打车"
            maxLength={40}
          />
        </Field>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-700">付款人</h3>
            <button type="button" onClick={addPayer} className="text-sm font-medium text-teal-600">
              + 添加
            </button>
          </div>
          <div className="space-y-2">
            {payers.map((payer, index) => {
              const isLocked = payer.identityId === lockedPayerId;
              return (
                <div
                  key={`${payer.identityId}-${index}`}
                  className="grid grid-cols-[minmax(0,1fr)_6.5rem_2.5rem] items-center gap-2"
                >
                  <Select
                    value={payer.identityId}
                    disabled={isLocked}
                    onChange={(event) =>
                      setPayers((current) =>
                        current.map((item, i) =>
                          i === index ? { ...item, identityId: event.target.value } : item,
                        ),
                      )
                    }
                    className="min-w-0 disabled:bg-gray-100"
                  >
                    {identities.map((identity) => (
                      <option
                        key={identity.id}
                        value={identity.id}
                        disabled={payers.some(
                          (item, i) => i !== index && item.identityId === identity.id,
                        )}
                      >
                        {identity.name}
                      </option>
                    ))}
                  </Select>
                  <Input
                    value={payer.amount}
                    onChange={(event) =>
                      setPayers((current) =>
                        current.map((item, i) =>
                          i === index ? { ...item, amount: event.target.value } : item,
                        ),
                      )
                    }
                    inputMode="decimal"
                    placeholder="0.00"
                    className="text-right font-mono tabular-nums"
                  />
                  {isLocked ? (
                    <span className="text-center text-[10px] leading-tight text-gray-400">
                      创建者
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-label="移除付款人"
                      onClick={() =>
                        setPayers((current) => current.filter((_, i) => i !== index))
                      }
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100"
                    >
                      <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                        <path
                          d="M5 5l10 10M15 5L5 15"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  )}
                </div>
              );
            })}
            {payers.length === 0 ? (
              <p className="text-sm text-gray-400">还没有付款人，点「添加」选择。</p>
            ) : null}
          </div>
          <p className="mt-2 text-xs text-gray-400">总额 = 所有付款人支付金额之和</p>
        </section>

        <Field label="分摊方式">
          <Segmented
            value={splitMode}
            onChange={changeSplitMode}
            options={[
              { value: "equal", label: "均分" },
              { value: "custom", label: "自定义" },
            ]}
          />
        </Field>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-700">参与人</h3>
            {splitMode === "custom" ? (
              <button
                type="button"
                onClick={addParticipant}
                className="text-sm font-medium text-teal-600"
              >
                + 添加
              </button>
            ) : null}
          </div>

          {splitMode === "equal" ? (
            <div className="flex flex-wrap gap-2">
              {identities.map((identity) => {
                const selected = participants.some(
                  (participant) => participant.identityId === identity.id,
                );
                return (
                  <button
                    key={identity.id}
                    type="button"
                    onClick={() => toggleParticipant(identity.id)}
                    className={`flex items-center gap-1.5 rounded-full border py-1 pr-3 pl-1 text-sm transition-colors ${
                      selected
                        ? "border-teal-500 bg-teal-50 text-teal-700"
                        : "border-gray-200 bg-white text-gray-500"
                    }`}
                  >
                    <IdentityBadge identity={identity} size="sm" />
                    {identity.name}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2">
              {participants.map((participant, index) => (
                <div
                  key={`${participant.identityId}-${index}`}
                  className="grid grid-cols-[minmax(0,1fr)_6.5rem_2.5rem] items-center gap-2"
                >
                  <Select
                    value={participant.identityId}
                    onChange={(event) =>
                      setParticipants((current) =>
                        current.map((item, i) =>
                          i === index ? { ...item, identityId: event.target.value } : item,
                        ),
                      )
                    }
                    className="min-w-0 flex-1"
                  >
                    {identities.map((identity) => (
                      <option
                        key={identity.id}
                        value={identity.id}
                        disabled={participants.some(
                          (item, i) => i !== index && item.identityId === identity.id,
                        )}
                      >
                        {identity.name}
                      </option>
                    ))}
                  </Select>
                  <Input
                    value={participant.share}
                    onChange={(event) =>
                      setParticipants((current) =>
                        current.map((item, i) =>
                          i === index ? { ...item, share: event.target.value } : item,
                        ),
                      )
                    }
                    inputMode="decimal"
                    placeholder="0.00"
                    className="text-right font-mono tabular-nums"
                  />
                  <button
                    type="button"
                    aria-label="移除参与人"
                    onClick={() =>
                      setParticipants((current) => current.filter((_, i) => i !== index))
                    }
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100"
                  >
                    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                      <path
                        d="M5 5l10 10M15 5L5 15"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </div>
              ))}
              {participants.length > 0 && totalCents > 0 ? (
                <button
                  type="button"
                  onClick={distributeShares}
                  className="text-sm font-medium text-teal-600"
                >
                  按总额平均分配
                </button>
              ) : null}
              {participants.length === 0 ? (
                <p className="text-sm text-gray-400">还没有参与人，点「添加」选择。</p>
              ) : null}
            </div>
          )}
        </section>

        <Field
          label="时间"
          hint={
            paidAt ? (
              <button type="button" className="text-teal-600" onClick={() => setPaidAt("")}>
                清除
              </button>
            ) : null
          }
        >
          <Input
            type="datetime-local"
            value={paidAt}
            onChange={(event) => setPaidAt(event.target.value)}
          />
        </Field>

        <Field label="备注" hint="选填">
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="补充说明……"
            maxLength={200}
          />
        </Field>

        <div className="space-y-1.5 rounded-xl bg-gray-50 p-3 text-sm">
          <div className="flex justify-between text-gray-600">
            <span>总额（付款人合计）</span>
            <span className="font-mono font-semibold tabular-nums text-gray-900">
              {formatYuan(totalCents)}
            </span>
          </div>
          {splitMode === "custom" ? (
            <div className="flex justify-between text-gray-600">
              <span>分摊合计</span>
              <span
                className={`font-mono tabular-nums ${
                  shareMismatch ? "font-medium text-red-600" : "text-gray-900"
                }`}
              >
                {formatYuan(shareSumCents)}
              </span>
            </div>
          ) : participants.length > 0 && totalCents > 0 ? (
            <div className="flex justify-between text-gray-600">
              <span>每人约</span>
              <span className="font-mono tabular-nums text-gray-900">
                {formatYuan(Math.floor(totalCents / participants.length))}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </Sheet>
  );
}
