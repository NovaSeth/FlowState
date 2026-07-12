"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Icon } from "./icons";
import { btnGhost, btnPrimary, inputCls } from "./ui";
import { useT } from "@/i18n/provider";

/* Per-row actions ("kebab") menu for the explorer containers - everything the
   REST API can do to a solution/project/milestone without leaving the UI:
   edit details (name, description, color), switch lifecycle status / outcome,
   delete. The dropdown and the edit dialog render through a portal so the
   scrollable Miller columns cannot clip them. */

export interface EntityPatch {
  name?: string;
  description?: string;
  color?: string;
  status?: string;
  outcome?: string | null;
}

interface Option {
  value: string;
  label: string;
}

export function EntityMenu({
  editTitle,
  openHref,
  openLabel,
  name,
  description,
  color,
  status,
  statusOptions,
  outcome,
  outcomeOptions,
  onSave,
  onDelete,
  onChanged,
  onDeleted,
}: {
  /** Localized dialog heading, e.g. "Edit project". */
  editTitle: string;
  /** Optional navigation item pinned first, e.g. the project's dashboard page. */
  openHref?: string;
  openLabel?: string;
  name: string;
  description: string;
  /** Present only for solutions - shows the color field. */
  color?: string;
  status: string;
  statusOptions: Option[];
  /** Present only for milestones - shows the outcome section (null = none). */
  outcome?: string | null;
  outcomeOptions?: Option[];
  onSave: (patch: EntityPatch) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
  /** Refetch after a successful save / status change. */
  onChanged: () => void;
  /** Cleanup after a successful delete (reset selection + refetch). */
  onDeleted: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  // Fixed-position anchor of the dropdown, computed from the trigger's rect.
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [armed]);

  function toggle() {
    if (open) {
      close();
      return;
    }
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setArmed(false);
    setError(null);
  }

  async function run(fn: () => Promise<unknown>, after: () => void) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      after();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.saveError"));
    } finally {
      setBusy(false);
    }
  }

  const itemCls =
    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-fg transition-colors hover:bg-canvas-subtle disabled:opacity-50";
  const sectionCls =
    "px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.5px] text-fg-subtle";

  const radio = (
    options: Option[],
    current: string | null | undefined,
    apply: (value: string) => EntityPatch,
  ) =>
    options.map((o) => (
      <button
        key={o.value}
        disabled={busy}
        onClick={() =>
          run(
            () => onSave(apply(o.value)),
            () => {
              onChanged();
              close();
            },
          )
        }
        className={itemCls}
        aria-pressed={o.value === (current ?? "")}
      >
        <span className="w-3.5 shrink-0">
          {o.value === (current ?? "") && <Icon name="check" size={13} />}
        </span>
        {o.label}
      </button>
    ));

  const menu =
    open && pos
      ? createPortal(
          <>
            {/* Click-away layer under the dropdown. */}
            <div className="fixed inset-0 z-40" onClick={close} />
            <div
              className="fixed z-50 max-h-[70vh] w-52 overflow-y-auto rounded-md border border-edge bg-canvas p-1 shadow-hover"
              style={{ top: pos.top, right: pos.right }}
              role="menu"
            >
              {openHref && openLabel && (
                <>
                  <Link href={openHref} onClick={close} className={itemCls}>
                    <span className="w-3.5 shrink-0">
                      <Icon name="overview" size={13} />
                    </span>
                    {openLabel}
                  </Link>
                  <div className="my-1 border-t border-edge-muted" />
                </>
              )}
              <button
                disabled={busy}
                onClick={() => {
                  close();
                  setEditing(true);
                }}
                className={itemCls}
              >
                <span className="w-3.5 shrink-0" />
                {t("entity.edit")}
              </button>
              <div className={sectionCls}>{t("entity.status")}</div>
              {radio(statusOptions, status, (value) => ({ status: value }))}
              {outcomeOptions && (
                <>
                  <div className={sectionCls}>{t("entity.outcome")}</div>
                  {radio(
                    [
                      { value: "", label: t("entity.noOutcome") },
                      ...outcomeOptions,
                    ],
                    outcome ?? "",
                    (value) => ({ outcome: value === "" ? null : value }),
                  )}
                </>
              )}
              <div className="my-1 border-t border-edge-muted" />
              <button
                disabled={busy}
                onClick={() => {
                  if (!armed) {
                    setArmed(true);
                    return;
                  }
                  run(onDelete, () => {
                    close();
                    onDeleted();
                  });
                }}
                className={`${itemCls} ${armed ? "bg-danger-muted text-danger hover:bg-danger-muted" : "text-danger"}`}
              >
                <span className="w-3.5 shrink-0">
                  <Icon name="trash" size={13} />
                </span>
                {armed ? t("common.confirm") : t("delete.default")}
              </button>
              {error && (
                <p className="px-2 py-1 text-[11px] text-danger">{error}</p>
              )}
            </div>
          </>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        aria-label={t("entity.actions")}
        title={t("entity.actions")}
        aria-expanded={open}
        className="flex h-6 w-6 items-center justify-center rounded bg-canvas text-fg-subtle transition-colors hover:bg-neutral-muted hover:text-fg"
      >
        <Icon name="kebab" size={15} />
      </button>
      {menu}
      {editing && (
        <EditEntityDialog
          title={editTitle}
          name={name}
          description={description}
          color={color}
          onSave={onSave}
          onChanged={onChanged}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}

/** Modal form for the fields that need typing: name, description, color. */
function EditEntityDialog({
  title,
  name,
  description,
  color,
  onSave,
  onChanged,
  onClose,
}: {
  title: string;
  name: string;
  description: string;
  color?: string;
  onSave: (patch: EntityPatch) => Promise<unknown>;
  onChanged: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const [draftName, setDraftName] = useState(name);
  const [draftDesc, setDraftDesc] = useState(description);
  const [draftColor, setDraftColor] = useState(color ?? "#0969da");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!draftName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const patch: EntityPatch = {
        name: draftName.trim(),
        description: draftDesc,
      };
      if (color !== undefined) patch.color = draftColor;
      await onSave(patch);
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.saveError"));
      setBusy(false);
    }
  }

  const labelCls =
    "text-[11px] font-semibold uppercase tracking-[0.5px] text-fg-subtle";

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-edge bg-canvas p-4 shadow-hover"
      >
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>{t("entity.name")}</span>
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>{t("entity.description")}</span>
          <textarea
            value={draftDesc}
            onChange={(e) => setDraftDesc(e.target.value)}
            rows={5}
            placeholder={t("entity.descriptionPlaceholder")}
            className={`${inputCls} resize-y`}
          />
        </label>
        {color !== undefined && (
          <label className="flex items-center gap-2">
            <span className={labelCls}>{t("entity.color")}</span>
            <input
              type="color"
              value={draftColor}
              onChange={(e) => setDraftColor(e.target.value)}
              className="h-7 w-10 cursor-pointer rounded border border-edge bg-canvas-subtle"
            />
            <code className="font-mono text-xs text-fg-muted">
              {draftColor}
            </code>
          </label>
        )}
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnGhost}>
            {t("forms.cancel")}
          </button>
          <button
            type="submit"
            disabled={busy || !draftName.trim()}
            className={btnPrimary}
          >
            {t("entity.save")}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
