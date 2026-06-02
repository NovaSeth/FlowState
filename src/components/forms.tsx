"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/types";
import { PRIORITY_META, STATUS_META } from "@/lib/labels";
import { errMessage } from "@/lib/format";
import { Icon } from "./icons";
import { btnGhost, btnPrimary, inputCls } from "./ui";
import { useT } from "@/i18n/provider";

function AddTrigger({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-edge px-3 py-1.5 text-sm text-fg-muted transition-colors hover:border-accent hover:text-accent"
    >
      <Icon name="plus" size={15} />
      {label}
    </button>
  );
}

function useCreate(reset: () => void, onDone?: () => void) {
  const router = useRouter();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      reset();
      if (onDone) onDone();
      else router.refresh();
    } catch (e) {
      setError(errMessage(e, t("forms.genericError")));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="text-xs text-danger">{error}</p>;
}

// --- New solution ---
export function NewSolutionForm({ onDone }: { onDone?: () => void } = {}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const { busy, error, run } = useCreate(() => {
    setName("");
    setOpen(false);
  }, onDone);
  if (!open) return <AddTrigger label={t("forms.newSolution")} onClick={() => setOpen(true)} />;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(() => api.createSolution({ name }));
      }}
      className="flex w-full max-w-md flex-col gap-2 rounded-md border border-edge bg-canvas p-3 shadow-resting"
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("forms.solutionNamePlaceholder")}
        className={inputCls}
      />
      <ErrorLine error={error} />
      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy || !name.trim()} className={btnPrimary}>
          {t("forms.add")}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={btnGhost}>
          {t("forms.cancel")}
        </button>
      </div>
    </form>
  );
}

// --- New project (within a solution) ---
export function NewProjectForm({
  solutionId,
  onDone,
}: {
  solutionId: string;
  onDone?: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const { busy, error, run } = useCreate(() => {
    setName("");
    setOpen(false);
  }, onDone);
  if (!open) return <AddTrigger label={t("forms.newProject")} onClick={() => setOpen(true)} />;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(() => api.createProject({ solutionId, name }));
      }}
      className="flex w-full max-w-md flex-col gap-2 rounded-md border border-edge bg-canvas p-3 shadow-resting"
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("forms.projectNamePlaceholder")}
        className={inputCls}
      />
      <ErrorLine error={error} />
      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy || !name.trim()} className={btnPrimary}>
          {t("forms.add")}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={btnGhost}>
          {t("forms.cancel")}
        </button>
      </div>
    </form>
  );
}

// --- New milestone ---
export function NewMilestoneForm({
  projectId,
  onDone,
}: {
  projectId: string;
  onDone?: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const { busy, error, run } = useCreate(() => {
    setTitle("");
    setOpen(false);
  }, onDone);
  if (!open) return <AddTrigger label={t("forms.newMilestone")} onClick={() => setOpen(true)} />;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(() => api.createMilestone({ projectId, title }));
      }}
      className="flex w-full max-w-md flex-col gap-2 rounded-md border border-edge bg-canvas p-3 shadow-resting"
    >
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("forms.milestoneTitlePlaceholder")}
        className={inputCls}
      />
      <ErrorLine error={error} />
      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy || !title.trim()} className={btnPrimary}>
          {t("forms.add")}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={btnGhost}>
          {t("forms.cancel")}
        </button>
      </div>
    </form>
  );
}

// --- New task ---
export function NewTaskForm({
  milestones,
  defaultMilestoneId,
  defaultStatus,
  onDone,
}: {
  milestones: { id: string; title: string }[];
  defaultMilestoneId?: string;
  defaultStatus?: (typeof TASK_STATUSES)[number];
  onDone?: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [milestoneId, setMilestoneId] = useState(
    defaultMilestoneId ?? milestones[0]?.id ?? "",
  );
  const [status, setStatus] = useState(defaultStatus ?? "todo");
  const [priority, setPriority] = useState<(typeof TASK_PRIORITIES)[number]>(
    "none",
  );
  const { busy, error, run } = useCreate(() => {
    setTitle("");
    setOpen(false);
  }, onDone);

  if (!open)
    return <AddTrigger label={t("forms.newTask")} onClick={() => setOpen(true)} />;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(() => api.createTask({ milestoneId, title, status, priority }));
      }}
      className="flex w-full max-w-lg flex-col gap-2 rounded-md border border-edge bg-canvas p-3 shadow-resting"
    >
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("forms.taskTitlePlaceholder")}
        className={inputCls}
      />
      <div className="grid grid-cols-3 gap-2">
        <select
          value={milestoneId}
          onChange={(e) => setMilestoneId(e.target.value)}
          className={inputCls}
        >
          {milestones.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) =>
            setStatus(e.target.value as (typeof TASK_STATUSES)[number])
          }
          className={inputCls}
        >
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(STATUS_META[s].labelKey)}
            </option>
          ))}
        </select>
        <select
          value={priority}
          onChange={(e) =>
            setPriority(e.target.value as (typeof TASK_PRIORITIES)[number])
          }
          className={inputCls}
        >
          {TASK_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {t(PRIORITY_META[p].labelKey)}
            </option>
          ))}
        </select>
      </div>
      <ErrorLine error={error} />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy || !title.trim() || !milestoneId}
          className={btnPrimary}
        >
          {t("forms.add")}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={btnGhost}>
          {t("forms.cancel")}
        </button>
      </div>
    </form>
  );
}
