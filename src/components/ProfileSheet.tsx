import { useRef, useState } from "react";
import type { Identity } from "@shared/domain";
import { ApiError, uploadAvatar } from "@/lib/api";
import { Avatar, } from "@/components/IdentityBadge";
import { Button, Field, Input, Sheet } from "@/components/ui";
import { useToast } from "@/components/toast-context";
import type { RunCommand } from "@/hooks/useActivity";

export function ProfileSheet({
  me,
  busy,
  run,
  onClose,
}: {
  me: Identity;
  busy?: boolean;
  run: RunCommand;
  onClose: () => void;
}) {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(me.name);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [saving, setSaving] = useState(false);

  const currentAvatar = removeAvatar ? undefined : (preview ?? me.avatar);

  function pickFile(selected: File | null) {
    if (!selected) return;
    if (!selected.type.startsWith("image/")) {
      toast.show("请选择图片文件", "error");
      return;
    }
    if (selected.size > 10 * 1024 * 1024) {
      toast.show("图片不能超过 10MB", "error");
      return;
    }
    setFile(selected);
    setPreview(URL.createObjectURL(selected));
    setRemoveAvatar(false);
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.show("请输入名字", "error");
      return;
    }
    setSaving(true);
    try {
      let avatar: string | null | undefined;
      if (file) {
        avatar = await uploadAvatar(file);
      } else if (removeAvatar) {
        avatar = null;
      }

      await run({
        type: "identity.update",
        identityId: me.id,
        ...(trimmed !== me.name ? { name: trimmed } : {}),
        ...(avatar !== undefined ? { avatar } : {}),
      });
      toast.show("资料已更新", "success");
      onClose();
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : "保存失败，请稍后再试", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="我的资料"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button className="flex-1" onClick={() => void save()} disabled={saving || busy}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-col items-center gap-3">
          <Avatar
            identity={{ name: name || me.name, color: me.color, avatar: currentAvatar }}
            size="xl"
          />
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => fileInput.current?.click()}
              disabled={saving}
            >
              更换头像
            </Button>
            {currentAvatar ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setFile(null);
                  setPreview(null);
                  setRemoveAvatar(true);
                }}
                disabled={saving}
              >
                移除
              </Button>
            ) : null}
          </div>
          <p className="text-center text-xs text-gray-400">
            图片会自动裁成方形并压缩为 100×100 WebP
          </p>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              pickFile(event.target.files?.[0] ?? null);
              event.target.value = "";
            }}
          />
        </div>

        <Field label="名字">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={20}
            placeholder="在活动里显示的名字"
          />
        </Field>
      </div>
    </Sheet>
  );
}
