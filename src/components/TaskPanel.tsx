"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import {
  Comment,
  Task,
  TaskDetail,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from "@/lib/types";
import { BLOCKER_TYPE_LABEL, PRIORITY_META, STATUS_META } from "@/lib/labels";
import { timeAgoText, safeHref, errMessage } from "@/lib/format";
import { Icon } from "./icons";
import { btnPrimary, inputCls } from "./ui";
import { DeleteButton } from "./DeleteButton";
import { useIsNarrow } from "@/lib/use-is-narrow";
import { useT } from "@/i18n/provider";

export function TaskPanel({
  task,
  milestoneTitle,
  onClose,
  onChanged,
}: {
  task: Task | null;
  milestoneTitle?: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const router = useRouter();
  const narrow = useIsNarrow();
  const t = useT();
  const handleChanged = onChanged ?? (() => router.refresh());
  const open = task !== null;

  // Dialog: Escape closes it, focus moves into the panel on open and returns to
  // the previous element on close. onClose lives in a ref so the effect does not
  // detach on every render (and does not trip react-hooks/refs via a write during render).
  const asideRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    asideRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open]);

  // Swipe-down closes the bottom sheet (mobile). The gesture only starts outside
  // the scrollable content ([data-sheet-scroll]) so it does not collide with scrolling.
  const [dragY, setDragY] = useState(0);
  const dragFrom = useRef<number | null>(null);

  function onTouchStart(e: React.TouchEvent) {
    if (!narrow || !open) return;
    if ((e.target as HTMLElement).closest("[data-sheet-scroll]")) return;
    dragFrom.current = e.touches[0].clientY;
  }
  function onTouchMove(e: React.TouchEvent) {
    if (dragFrom.current === null) return;
    const dy = e.touches[0].clientY - dragFrom.current;
    setDragY(dy > 0 ? dy : 0); // downward only
  }
  function onTouchEnd() {
    if (dragFrom.current === null) return;
    if (dragY > 110) onClose(); // threshold: dragged down far enough -> close
    setDragY(0);
    dragFrom.current = null;
  }

  // Mobile: bottom sheet sliding up from the bottom (rounded top, handle, safe-area).
  // Desktop: drawer from the right edge. Animated via translate.
  const sheet = narrow
    ? `inset-x-0 bottom-0 max-h-[92svh] rounded-t-2xl border-t pb-[env(safe-area-inset-bottom)] duration-300 ${
        open ? "translate-y-0" : "translate-y-full"
      }`
    : `right-0 top-13 bottom-0 w-full max-w-[400px] border-l duration-200 ${
        open ? "translate-x-0" : "translate-x-full"
      }`;

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed z-40 bg-black/10 transition-opacity ${
          narrow ? "inset-0" : "inset-x-0 bottom-0 top-13"
        } ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
      />
      <aside
        ref={asideRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("task.ariaDetail")}
        aria-hidden={!open}
        tabIndex={-1}
        inert={!open ? true : undefined}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={
          narrow && dragY > 0
            ? { transform: `translateY(${dragY}px)`, transition: "none" }
            : undefined
        }
        className={`fixed z-50 flex flex-col border-edge bg-canvas shadow-floating outline-none transition-transform ${sheet}`}
      >
        {narrow && task && (
          <div className="flex shrink-0 cursor-grab justify-center pb-1.5 pt-3 active:cursor-grabbing">
            <span className="h-1.5 w-10 rounded-full bg-edge-muted" />
          </div>
        )}
        {task && (
          <PanelBody
            key={task.id}
            task={task}
            milestoneTitle={milestoneTitle}
            onClose={onClose}
            onChanged={handleChanged}
          />
        )}
      </aside>
    </>
  );
}

function PanelBody({
  task,
  milestoneTitle,
  onClose,
  onChanged,
}: {
  task: Task;
  milestoneTitle?: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useT();
  const [title, setTitle] = useState(task.title);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [newComment, setNewComment] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Whether the title is currently being edited - so an SSE resync does not overwrite the text being typed.
  const titleFocused = useRef(false);

  useEffect(() => {
    let alive = true;
    api
      .listComments(task.id)
      .then((c) => alive && setComments(c))
      .catch(() => alive && setComments([]));
    api
      .getTaskDetail(task.id)
      .then((d) => alive && setDetail(d))
      .catch(() => alive && setDetail(null));
    return () => {
      alive = false;
    };
  }, [task.id]);

  // Resync the title from external changes (agent/SSE) - but only when the field
  // is NOT being edited, so we don't take away text the user is typing. The
  // description is read-only (rendered straight from the prop), so it follows the data on its own.
  useEffect(() => {
    if (!titleFocused.current) setTitle(task.title);
  }, [task.title]);

  async function patch(body: Parameters<typeof api.updateTask>[1]) {
    try {
      await api.updateTask(task.id, body);
      setError(null);
      onChanged();
    } catch (e) {
      // We don't roll back silently - we show the reason (e.g. 'blocked requires a reason').
      setError(errMessage(e, t("common.saveError")));
    }
  }

  async function saveTitle() {
    if (title.trim() && title !== task.title) await patch({ title });
  }
  async function addComment() {
    if (!newComment.trim()) return;
    setSending(true);
    setError(null);
    try {
      const c = await api.createComment(task.id, {
        body: newComment,
        author: "you",
      });
      setComments((prev) => [...(prev ?? []), c]);
      setNewComment("");
      onChanged();
    } catch (e) {
      // Surface the failure (mirror patch()) and keep the typed text so it is not lost.
      setError(errMessage(e, t("common.saveError")));
    } finally {
      setSending(false);
    }
  }

  // Block reason: the server stores the reason as a COMMENT at the moment of the
  // block transition (there is no dedicated field). The newest comment is NOT a
  // safe proxy - a later, unrelated comment would be misattributed. We instead pick
  // the most recent comment created at/before the task's last mutation
  // (task.updatedAt is bumped on the block transition and the reason comment shares
  // that timestamp), which excludes any comment appended after the latest save. If
  // none qualifies (e.g. the task was edited after commenting), we show nothing
  // rather than guess wrong.
  const blockReason =
    task.status === "blocked" && comments
      ? comments.reduce<Comment | null>((best, c) => {
          if (c.createdAt > task.updatedAt) return best;
          return !best || c.createdAt >= best.createdAt ? c : best;
        }, null)
      : null;

  return (
    <>
      {/* header */}
      <div className="flex items-start justify-between gap-2 border-b border-edge-muted px-4 py-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.5px] text-accent">
            {t("task.eyebrow")}
          </div>
          {milestoneTitle && (
            <div className="mt-0.5 truncate font-mono text-[11px] text-fg-subtle">
              {milestoneTitle}
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          className="-mr-1 rounded-md p-2 text-fg-subtle transition-colors hover:bg-canvas-subtle hover:text-fg active:bg-canvas-subtle"
          aria-label={t("common.close")}
        >
          <Icon name="close" size={20} />
        </button>
      </div>

      <div data-sheet-scroll className="flex-1 overflow-y-auto px-4 py-4">
        <textarea
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onFocus={() => (titleFocused.current = true)}
          onBlur={() => {
            titleFocused.current = false;
            saveTitle();
          }}
          rows={2}
          className="w-full resize-none rounded-md border border-transparent bg-transparent text-base font-semibold text-fg outline-none transition-colors hover:border-edge focus:border-accent focus:bg-canvas-subtle"
        />

        {/* status + priority */}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-[0.5px] text-fg-subtle">
              {t("task.status")}
            </span>
            <select
              value={task.status}
              onChange={(e) => patch({ status: e.target.value as Task["status"] })}
              className={inputCls}
            >
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(STATUS_META[s].labelKey)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-[0.5px] text-fg-subtle">
              {t("task.priority")}
            </span>
            <select
              value={task.priority}
              onChange={(e) =>
                patch({ priority: e.target.value as Task["priority"] })
              }
              className={inputCls}
            >
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(PRIORITY_META[p].labelKey)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* verification: 'done, unverified' (e.g. code waiting on hardware) */}
        {(task.verified || task.status === "done") && (
          <div className="mt-3">
            {task.verified ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-success-muted px-2 py-0.5 text-[11px] font-medium text-success">
                <Icon name="check" size={12} />
                {t("task.verified")}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-attention-muted px-2 py-0.5 text-[11px] font-medium text-attention">
                <Icon name="alert" size={12} />
                {t("task.unverified")}
              </span>
            )}
          </div>
        )}

        {error && (
          <p className="mt-2 rounded-md bg-danger-muted px-2.5 py-1.5 text-[13px] text-danger">
            {error}
          </p>
        )}

        {blockReason && (
          <div className="mt-3 flex items-start gap-2 rounded-md bg-danger-muted px-3 py-2 text-sm text-danger">
            <Icon name="block" size={15} className="mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.5px]">
                {t("task.blockReason")}
                {task.blockerType && (
                  <span className="rounded-full bg-danger/15 px-1.5 py-0.5 text-[10px] normal-case">
                    {t(BLOCKER_TYPE_LABEL[task.blockerType])}
                  </span>
                )}
              </div>
              <p className="mt-0.5 whitespace-pre-wrap">{blockReason.body}</p>
            </div>
          </div>
        )}

        {/* description - read-only (edited via MCP/API) */}
        {task.description.trim() && (
          <div className="mt-4 flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-[0.5px] text-fg-subtle">
              {t("task.description")}
            </span>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">
              {task.description}
            </p>
          </div>
        )}

        {/* labels, subtasks, dependencies (Stream B) - read-only; edited via MCP */}
        {detail &&
          (detail.labels.length > 0 ||
            detail.childCount > 0 ||
            detail.blockedBy.length > 0 ||
            detail.relatedTo.length > 0 ||
            detail.artifacts.length > 0) && (
            <div className="mt-4 space-y-3">
              {detail.labels.length > 0 && (
                <div>
                  <div className="mb-1 text-[11px] uppercase tracking-[0.5px] text-fg-subtle">
                    {t("task.labels")}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {detail.labels.map((l) => (
                      <span
                        key={l}
                        className="rounded-full bg-neutral-muted px-2 py-0.5 font-mono text-[11px] text-fg-muted"
                      >
                        {l}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {detail.childCount > 0 && (
                <div>
                  <div className="mb-1 text-[11px] uppercase tracking-[0.5px] text-fg-subtle">
                    {t("task.subtasks")}{" "}
                    <span className="font-mono">
                      ({detail.childProgress.done}/{detail.childProgress.total},{" "}
                      {detail.childProgress.percent}%)
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    {detail.children.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center gap-2 rounded-md bg-canvas-subtle px-2 py-1 text-xs"
                      >
                        <span className="font-mono text-[11px] text-fg-subtle">
                          {t(STATUS_META[c.status].labelKey)}
                        </span>
                        <span className="truncate text-fg">{c.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {detail.blockedBy.length > 0 && (
                <div>
                  <div className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-[0.5px] text-fg-subtle">
                    <Icon name="block" size={14} />
                    {t("task.blockedByHeading")}
                  </div>
                  <div className="flex flex-col gap-1">
                    {detail.blockedBy.map((b) => (
                      <div
                        key={b.id}
                        className="flex items-center gap-2 rounded-md bg-canvas-subtle px-2 py-1 text-xs"
                      >
                        <span className="font-mono text-[11px] text-fg-subtle">
                          {t(STATUS_META[b.status].labelKey)}
                        </span>
                        <span className="truncate text-fg">{b.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {detail.relatedTo.length > 0 && (
                <div>
                  <div className="mb-1 text-[11px] uppercase tracking-[0.5px] text-fg-subtle">
                    {t("task.related")}
                  </div>
                  <div className="flex flex-col gap-1">
                    {detail.relatedTo.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center gap-2 rounded-md bg-canvas-subtle px-2 py-1 text-xs"
                      >
                        <span className="font-mono text-[11px] text-fg-subtle">
                          {t(STATUS_META[r.status].labelKey)}
                        </span>
                        <span className="truncate text-fg">{r.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {detail.artifacts.length > 0 && (
                <div>
                  <div className="mb-1 text-[11px] uppercase tracking-[0.5px] text-fg-subtle">
                    {t("task.artifacts")}
                  </div>
                  <div className="flex flex-col gap-1">
                    {detail.artifacts.map((a) => {
                      const href = safeHref(a.value);
                      return (
                        <div
                          key={a.id}
                          className="flex items-center gap-2 rounded-md bg-canvas-subtle px-2 py-1 text-xs"
                        >
                          <span className="shrink-0 rounded bg-neutral-muted px-1.5 py-0.5 font-mono text-[10px] uppercase text-fg-muted">
                            {a.kind}
                          </span>
                          {href ? (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="truncate text-accent hover:underline"
                            >
                              {a.label || a.value}
                            </a>
                          ) : (
                            <span className="truncate font-mono text-fg">
                              {a.label ? `${a.label}: ${a.value}` : a.value}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

        {/* comments */}
        <div className="mt-5">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-[0.5px] text-fg-subtle">
            <Icon name="comment" size={14} />
            {t("task.comments")}
            {comments && <span className="font-mono">({comments.length})</span>}
          </div>
          <div className="flex flex-col gap-2">
            {comments === null ? (
              <p className="text-xs text-fg-subtle">{t("common.loadingEllipsis")}</p>
            ) : comments.length === 0 ? (
              <p className="text-xs text-fg-subtle">{t("task.noComments")}</p>
            ) : (
              comments.map((c) => (
                <div
                  key={c.id}
                  className="rounded-md border border-edge-muted bg-canvas-subtle px-3 py-2"
                >
                  <div className="mb-0.5 flex items-center justify-between">
                    <span className="font-mono text-[11px] text-accent">
                      {c.author || t("task.anon")}
                    </span>
                    <span className="font-mono text-[11px] text-fg-subtle">
                      {timeAgoText(c.createdAt, t)}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-fg">{c.body}</p>
                </div>
              ))
            )}
          </div>
          <div className="mt-2 flex flex-col gap-2">
            <textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              rows={2}
              placeholder={t("task.addCommentPlaceholder")}
              className={`${inputCls} resize-y`}
            />
            <button
              onClick={addComment}
              disabled={sending || !newComment.trim()}
              className={`self-start ${btnPrimary}`}
            >
              {t("task.send")}
            </button>
          </div>
        </div>
      </div>

      {/* footer: meta + delete */}
      <div className="flex items-center justify-between border-t border-edge-muted px-4 py-2.5">
        <span className="font-mono text-[11px] text-fg-subtle" title={task.id}>
          {task.id}
        </span>
        <DeleteButton
          label={t("task.deleteTask")}
          onDelete={() => api.deleteTask(task.id)}
          onDone={() => {
            onChanged();
            onClose();
          }}
        />
      </div>
    </>
  );
}
