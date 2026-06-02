"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./icons";
import { useT } from "@/i18n/provider";

/** Delete with a double-click confirmation (no native confirm() - doesn't block the UI). */
export function DeleteButton({
  onDelete,
  label,
  className = "",
  redirectTo,
  onDone,
}: {
  onDelete: () => Promise<unknown>;
  label?: string;
  className?: string;
  redirectTo?: string;
  onDone?: () => void;
}) {
  const tr = useT();
  // Default label from i18n; "" (empty string) intentionally stays empty (icon only).
  const resolvedLabel = label ?? tr("delete.default");
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  async function handle() {
    if (!armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    try {
      await onDelete();
      if (onDone) onDone();
      else if (redirectTo) router.push(redirectTo);
      else router.refresh();
    } finally {
      setBusy(false);
      setArmed(false);
    }
  }

  return (
    <button
      onClick={handle}
      disabled={busy}
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors disabled:opacity-50 ${
        armed
          ? "bg-danger-muted text-danger"
          : "text-fg-subtle hover:bg-canvas-subtle hover:text-danger"
      } ${className}`}
      title={resolvedLabel}
    >
      <Icon name="trash" size={14} />
      {armed ? tr("common.confirm") : resolvedLabel}
    </button>
  );
}
