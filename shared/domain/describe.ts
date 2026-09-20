import { formatYuan } from "./money";
import { payerTotal } from "./settlement";
import type {
  ActivityCreatedPayload,
  IdentityId,
  LedgerEvent,
  ParticipantSetPayload,
  ParticipantRemovedPayload,
  PayerRemovedPayload,
  PayerSetPayload,
  PaymentCreatedPayload,
  PaymentUpdatedPayload,
  PaymentVoidedPayload,
  RollbackPayload,
  SettingsUpdatedPayload,
} from "./types";

export interface EventContext {
  names: Map<IdentityId, string>;
  paymentTitles: Map<string, string>;
}

export function describeEvent(event: LedgerEvent, ctx: EventContext): string {
  const actor = event.actorIdentityId ? (ctx.names.get(event.actorIdentityId) ?? "未知用户") : "系统";
  const paymentTitle = (id: string) => `「${ctx.paymentTitles.get(id) ?? "已作废的付款"}」`;
  const who = (id: IdentityId, selfWord = "自己") =>
    id === event.actorIdentityId ? selfWord : (ctx.names.get(id) ?? "未知用户");

  switch (event.type) {
    case "activity.created": {
      const payload = event.payload as ActivityCreatedPayload;
      return `${actor} 创建了活动「${payload.activity.name}」`;
    }
    case "identity.created": {
      const payload = event.payload as import("./types").IdentityCreatedPayload;
      return `${payload.identity.name} 加入了活动`;
    }
    case "payment.created": {
      const payload = event.payload as PaymentCreatedPayload;
      return `${actor} 创建了付款${paymentTitle(payload.payment.id)}，总额 ${formatYuan(payerTotal(payload.payment))}`;
    }
    case "payment.updated": {
      const payload = event.payload as PaymentUpdatedPayload;
      const fields: string[] = [];
      if (payload.patch.title !== undefined) fields.push("标题");
      if (payload.patch.paidAt !== undefined) fields.push("时间");
      if (payload.patch.description !== undefined) fields.push("备注");
      if (payload.patch.splitMode !== undefined) fields.push("分摊方式");
      const what = fields.length > 0 ? fields.join("、") : "信息";
      return `${actor} 修改了付款${paymentTitle(payload.paymentId)}的${what}`;
    }
    case "payment.voided": {
      const payload = event.payload as PaymentVoidedPayload;
      return `${actor} 作废了付款${paymentTitle(payload.paymentId)}`;
    }
    case "payer.set": {
      const payload = event.payload as PayerSetPayload;
      return `${actor} 登记 ${who(payload.identityId)} 在付款${paymentTitle(payload.paymentId)}中支付了 ${formatYuan(payload.amountCents)}`;
    }
    case "payer.removed": {
      const payload = event.payload as PayerRemovedPayload;
      return `${actor} 将 ${who(payload.identityId)} 移出了付款${paymentTitle(payload.paymentId)}的付款人`;
    }
    case "participant.set": {
      const payload = event.payload as ParticipantSetPayload;
      const share =
        payload.shareCents !== undefined ? `，分摊 ${formatYuan(payload.shareCents)}` : "";
      if (payload.identityId === event.actorIdentityId) {
        return `${actor} 加入了付款${paymentTitle(payload.paymentId)}${share}`;
      }
      return `${actor} 将 ${who(payload.identityId)} 加入付款${paymentTitle(payload.paymentId)}${share}`;
    }
    case "participant.removed": {
      const payload = event.payload as ParticipantRemovedPayload;
      if (payload.identityId === event.actorIdentityId) {
        return `${actor} 退出了付款${paymentTitle(payload.paymentId)}`;
      }
      return `${actor} 将 ${who(payload.identityId)} 移出了付款${paymentTitle(payload.paymentId)}`;
    }
    case "settings.updated": {
      const payload = event.payload as SettingsUpdatedPayload;
      if (payload.name !== undefined) return `${actor} 将活动更名为「${payload.name}」`;
      return `${actor} 修改了活动信息`;
    }
    case "settings.password_changed":
      return `${actor} 更新了管理员密码`;
    case "rollback": {
      const payload = event.payload as RollbackPayload;
      return `${actor} 回滚到第 ${payload.targetSeq} 条记录${payload.reason ? `（${payload.reason}）` : ""}`;
    }
    default:
      return `${actor} 进行了操作`;
  }
}
