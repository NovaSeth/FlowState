"use client";

import { api } from "@/lib/api";
import { DeleteButton } from "./DeleteButton";
import { useT } from "@/i18n/provider";

/** Client-side wrapper for deleting a solution (a server page can't pass a function). */
export function DeleteSolutionButton({ id }: { id: string }) {
  const t = useT();
  return (
    <DeleteButton
      label={t("delete.solution")}
      redirectTo="/"
      onDelete={() => api.deleteSolution(id)}
    />
  );
}
