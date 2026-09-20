import { formatYuan } from "./money";
import { payerTotal } from "./settlement";
import type {
  ActivityCreatedPayload,
  EntryConfirmedPayload,
  EntryDeclinedPayload,
  IdentityCreatedPayload,
  IdentityUpdatedPayload,
  LedgerEvent,
  ParticipantRemovedPayload,
  ParticipantSetPayload,
  PayerRemovedPayload,
  PayerSetPayload,
  PaymentCreatedPayload,
  PaymentUpdatedPayload,
  PaymentVoidedPayload,
  RollbackPayload,
  SettingsUpdatedPayload,
} from "./types";

export type DescriptionPart =
  | { kind: "text"; value: string }
  | { kind: "identity"; identityId: string };

export interface EventDescription {
  /** Whose pill leads the line. */
  actorIdentityId: string | null;
  parts: DescriptionPart[];
}

export interface EventContext {
  /** Payment id -> title, so events about deleted payments still read well. */
  paymentTitles: Map<string, string>;
}

const text = (value: string): DescriptionPart => ({ kind: "text", value });
const who = (identityId: string): DescriptionPart => ({ kind: "identity", identityId });

export function describeEvent(event: LedgerEvent, ctx: EventContext): EventDescription {
  const actor = event.actorIdentityId;
  const paymentTitle = (id: string) => ctx.paymentTitles.get(id) ?? "已作废的付款";
  const paymentLabel = (id: string) => `付款「${paymentTitle(id)}」`;

  switch (event.type) {
    case "activity.created": {
      const payload = event.payload as ActivityCreatedPayload;
      return {
        actorIdentityId: payload.creator.id,
        parts: [text(`创建了活动「${payload.activity.name}」`)],
      };
    }
    case "identity.created": {
      const payload = event.payload as IdentityCreatedPayload;
      return { actorIdentityId: payload.identity.id, parts: [text("加入了活动")] };
    }
    case "identity.updated": {
      const payload = event.payload as IdentityUpdatedPayload;
      const fields: string[] = [];
      if (payload.name !== undefined) fields.push("名字");
      if (payload.avatar !== undefined) fields.push("头像");
      return {
        actorIdentityId: actor,
        parts: [text(`修改了${fields.length > 0 ? fields.join("和") : "资料"}`)],
      };
    }
    case "payment.created": {
      const payload = event.payload as PaymentCreatedPayload;
      return {
        actorIdentityId: actor,
        parts: [
          text(
            `创建了${paymentLabel(payload.payment.id)}，总额 ${formatYuan(payerTotal(payload.payment))}`,
          ),
        ],
      };
    }
    case "payment.updated": {
      const payload = event.payload as PaymentUpdatedPayload;
      const fields: string[] = [];
      if (payload.patch.title !== undefined) fields.push("标题");
      if (payload.patch.paidAt !== undefined) fields.push("时间");
      if (payload.patch.description !== undefined) fields.push("备注");
      if (payload.patch.splitMode !== undefined) fields.push("分摊方式");
      return {
        actorIdentityId: actor,
        parts: [
          text(`修改了${paymentLabel(payload.paymentId)}的${fields.length > 0 ? fields.join("、") : "信息"}`),
        ],
      };
    }
    case "payment.voided": {
      const payload = event.payload as PaymentVoidedPayload;
      return { actorIdentityId: actor, parts: [text(`作废了${paymentLabel(payload.paymentId)}`)] };
    }
    case "payer.set": {
      const payload = event.payload as PayerSetPayload;
      const tail = text(`在${paymentLabel(payload.paymentId)}中支付了 ${formatYuan(payload.amountCents)}`);
      if (payload.identityId === actor) return { actorIdentityId: actor, parts: [tail] };
      return {
        actorIdentityId: actor,
        parts: [text("登记 "), who(payload.identityId), text(" "), tail],
      };
    }
    case "payer.removed": {
      const payload = event.payload as PayerRemovedPayload;
      if (payload.identityId === actor) {
        return {
          actorIdentityId: actor,
          parts: [text(`退出了${paymentLabel(payload.paymentId)}的付款人`)],
        };
      }
      return {
        actorIdentityId: actor,
        parts: [
          text("将 "),
          who(payload.identityId),
          text(` 移出${paymentLabel(payload.paymentId)}的付款人`),
        ],
      };
    }
    case "participant.set": {
      const payload = event.payload as ParticipantSetPayload;
      const share =
        payload.shareCents !== undefined ? `，分摊 ${formatYuan(payload.shareCents)}` : "";
      if (payload.identityId === actor) {
        return {
          actorIdentityId: actor,
          parts: [text(`加入了${paymentLabel(payload.paymentId)}${share}`)],
        };
      }
      return {
        actorIdentityId: actor,
        parts: [
          text("将 "),
          who(payload.identityId),
          text(` 加入${paymentLabel(payload.paymentId)}${share}`),
        ],
      };
    }
    case "participant.removed": {
      const payload = event.payload as ParticipantRemovedPayload;
      if (payload.identityId === actor) {
        return { actorIdentityId: actor, parts: [text(`退出了${paymentLabel(payload.paymentId)}`)] };
      }
      return {
        actorIdentityId: actor,
        parts: [text("将 "), who(payload.identityId), text(` 移出${paymentLabel(payload.paymentId)}`)],
      };
    }
    case "entry.confirmed": {
      const payload = event.payload as EntryConfirmedPayload;
      if (payload.identityId !== actor) {
        return {
          actorIdentityId: actor,
          parts: [
            text("将 "),
            who(payload.identityId),
            text(` 在${paymentLabel(payload.paymentId)}中的参与标记为已确认`),
          ],
        };
      }
      return {
        actorIdentityId: actor,
        parts: [text(`确认了在${paymentLabel(payload.paymentId)}中的参与`)],
      };
    }
    case "entry.declined": {
      const payload = event.payload as EntryDeclinedPayload;
      if (payload.identityId !== actor) {
        return {
          actorIdentityId: actor,
          parts: [text("将 "), who(payload.identityId), text(` 视为未参与${paymentLabel(payload.paymentId)}`)],
        };
      }
      return {
        actorIdentityId: actor,
        parts: [text(`声明未参与${paymentLabel(payload.paymentId)}`)],
      };
    }
    case "settings.updated": {
      const payload = event.payload as SettingsUpdatedPayload;
      if (payload.name !== undefined) {
        return { actorIdentityId: actor, parts: [text(`将活动更名为「${payload.name}」`)] };
      }
      return { actorIdentityId: actor, parts: [text("修改了活动信息")] };
    }
    case "settings.password_changed":
      return { actorIdentityId: actor, parts: [text("更新了管理员密码")] };
    case "activity.closed": {
      const payload = event.payload as import("./types").ActivityClosedPayload;
      return {
        actorIdentityId: actor,
        parts: [
          text(payload.forced ? "强制关闭了活动（未确认的成员按未参与处理）" : "关闭了活动"),
        ],
      };
    }
    case "rollback": {
      const payload = event.payload as RollbackPayload;
      return {
        actorIdentityId: actor,
        parts: [
          text(`回滚到第 ${payload.targetSeq} 条记录${payload.reason ? `（${payload.reason}）` : ""}`),
        ],
      };
    }
    default:
      return { actorIdentityId: actor, parts: [text("进行了操作")] };
  }
}

/** Flattens a description to plain text (used in tests and fallbacks). */
export function descriptionToText(
  description: EventDescription,
  nameOf: (identityId: string) => string,
): string {
  const body = description.parts
    .map((part) => (part.kind === "text" ? part.value : nameOf(part.identityId)))
    .join("");
  return description.actorIdentityId
    ? `${nameOf(description.actorIdentityId)} ${body}`
    : body;
}
