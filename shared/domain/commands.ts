import { z } from "zod";

const MAX_DATE_LENGTH = 32;
const dateString = z
  .string()
  .max(MAX_DATE_LENGTH)
  .regex(/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/, "时间格式不正确");

function uniqueIds(items: { identityId: string }[]): boolean {
  return new Set(items.map((item) => item.identityId)).size === items.length;
}

export const paymentPatchSchema = z
  .object({
    title: z.string().trim().min(1, "标题不能为空").max(40).optional(),
    paidAt: dateString.nullable().optional(),
    description: z.string().trim().max(200).nullable().optional(),
    splitMode: z.enum(["equal", "custom"]).optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, "没有需要修改的内容");

export const commandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("identity.update"),
      identityId: z.string().min(1),
      name: z.string().trim().min(1, "请输入名字").max(20, "名字太长了").optional(),
      avatar: z
        .string()
        .max(300_000)
        .regex(/^data:image\/webp;base64,[A-Za-z0-9+/=]+$/, "头像格式不正确")
        .nullable()
        .optional(),
    })
    .refine(
      (value) => value.name !== undefined || value.avatar !== undefined,
      "没有需要修改的内容",
    ),
  z.object({
    type: z.literal("payment.create"),
    title: z.string().trim().min(1, "请输入标题").max(40, "标题太长了"),
    paidAt: dateString.optional(),
    description: z.string().trim().max(200).optional(),
    splitMode: z.enum(["equal", "custom"]),
    payers: z
      .array(
        z.object({
          identityId: z.string().min(1),
          amountCents: z.number().int().min(0).max(100_000_000_000),
        }),
      )
      .min(1, "至少需要一位付款人")
      .max(100),
    participants: z
      .array(
        z.object({
          identityId: z.string().min(1),
          shareCents: z.number().int().min(0).max(100_000_000_000).optional(),
        }),
      )
      .max(100),
  })
    .refine((value) => uniqueIds(value.payers), "付款人不能重复")
    .refine((value) => uniqueIds(value.participants), "参与人不能重复"),
  z.object({
    type: z.literal("payment.edit"),
    paymentId: z.string().min(1),
    title: z.string().trim().min(1, "请输入标题").max(40, "标题太长了"),
    paidAt: dateString.optional(),
    description: z.string().trim().max(200).optional(),
    splitMode: z.enum(["equal", "custom"]),
    payers: z
      .array(
        z.object({
          identityId: z.string().min(1),
          amountCents: z.number().int().min(0).max(100_000_000_000),
        }),
      )
      .min(1, "至少需要一位付款人")
      .max(100),
    participants: z
      .array(
        z.object({
          identityId: z.string().min(1),
          shareCents: z.number().int().min(0).max(100_000_000_000).optional(),
        }),
      )
      .max(100),
  })
    .refine((value) => uniqueIds(value.payers), "付款人不能重复")
    .refine((value) => uniqueIds(value.participants), "参与人不能重复"),
  z.object({
    type: z.literal("payment.update"),
    paymentId: z.string().min(1),
    patch: paymentPatchSchema,
  }),
  z.object({ type: z.literal("payment.void"), paymentId: z.string().min(1) }),
  z.object({
    type: z.literal("payer.set"),
    paymentId: z.string().min(1),
    identityId: z.string().min(1),
    amountCents: z.number().int().min(0).max(100_000_000_000),
  }),
  z.object({
    type: z.literal("payer.remove"),
    paymentId: z.string().min(1),
    identityId: z.string().min(1),
  }),
  z.object({
    type: z.literal("participant.set"),
    paymentId: z.string().min(1),
    identityId: z.string().min(1),
    shareCents: z.number().int().min(0).max(100_000_000_000).optional(),
  }),
  z.object({
    type: z.literal("participant.remove"),
    paymentId: z.string().min(1),
    identityId: z.string().min(1),
  }),
  z.object({
    type: z.literal("entry.confirm"),
    paymentId: z.string().min(1),
  }),
  z.object({
    type: z.literal("entry.decline"),
    paymentId: z.string().min(1),
  }),
  z.object({
    type: z.literal("activity.close"),
    forced: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("rollback"),
    targetSeq: z.number().int().min(1),
    reason: z.string().trim().max(100).optional(),
  }),
  z.object({
    type: z.literal("settings.update"),
    name: z.string().trim().min(1).max(30).optional(),
    description: z.string().trim().max(200).nullable().optional(),
  }),
  z.object({
    type: z.literal("admin.setPassword"),
    newPassword: z.string().min(4, "密码至少 4 位").max(128),
  }),
]);

export type Command = z.infer<typeof commandSchema>;

export type CommandInput = z.input<typeof commandSchema>;
