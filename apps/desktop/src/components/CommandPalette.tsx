import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { useQuery } from "@tanstack/react-query";
import { listStudents } from "@eva/db/repo/students";
import { matchesSearch } from "@eva/core/text/arabic";
import { r } from "../lib/repo";

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

// Ctrl+K: jump to any screen or student, or run an action, from the
// keyboard (the pattern VS Code, Linear and Slack use). Matching is
// Arabic-aware (hamza, taa marbuta, alef maqsura…).
export function CommandPalette({ actions, onOpenStudent }: { actions: PaletteAction[]; onOpenStudent: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const students = useQuery({ queryKey: ["students", "palette"], queryFn: () => listStudents(r, { includeInactive: true }), enabled: open });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const close = () => {
    setOpen(false);
    setQ("");
  };
  const hits = q.trim().length >= 2 ? (students.data ?? []).filter((s) => matchesSearch(q, s.nameAr, s.universityNumber, s.code)).slice(0, 12) : [];
  const acts = actions.filter((a) => !q.trim() || matchesSearch(q, a.label, a.hint));

  if (!open) return null;
  return (
    <div className="palette-backdrop" onMouseDown={close}>
      <Command className="palette" label="بحث وأوامر" shouldFilter={false} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && close()}>
        <Command.Input autoFocus value={q} onValueChange={setQ} placeholder="اكتب اسم طالب أو رقمه، أو اسم شاشة أو أمر…" />
        <Command.List>
          <Command.Empty>لا نتائج</Command.Empty>
          {hits.length > 0 && (
            <Command.Group heading="الطلاب">
              {hits.map((s) => (
                <Command.Item key={s.id} value={`s-${s.id}`} onSelect={() => (close(), onOpenStudent(s.id))}>
                  <span>{s.nameAr}</span>
                  <span className="muted tabular">{s.universityNumber} · {s.groupName ?? "—"}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
          <Command.Group heading="الشاشات والأوامر">
            {acts.map((a) => (
              <Command.Item key={a.id} value={a.id} onSelect={() => (close(), a.run())}>
                <span>{a.label}</span>
                {a.hint && <span className="muted">{a.hint}</span>}
              </Command.Item>
            ))}
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}
