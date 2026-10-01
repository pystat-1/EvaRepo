import { useMutation, useQuery } from "@tanstack/react-query";
import { courseLabel, listCourses } from "@eva/db/repo/courses";
import { currentCourse, setCurrentCourse } from "@eva/db/repo/students";
import { r } from "../lib/repo";
import { confirmAction } from "./confirm";

// The current course, in the top bar: every screen and the evaluators'
// phones work on it. It stays the admin's choice until they choose another
// (a newly created course never takes over by itself).
export function CourseSwitcher() {
  const courses = useQuery({ queryKey: ["courses"], queryFn: () => listCourses(r) });
  const current = useQuery({ queryKey: ["currentCourse"], queryFn: () => currentCourse(r) });
  const choose = useMutation({ mutationFn: (id: string) => setCurrentCourse(r, id) });
  const list = (courses.data ?? []).filter((c) => c.status === "PUBLISHED" && c.active);
  if (list.length === 0) return null;

  const pick = async (id: string) => {
    const c = list.find((x) => x.id === id);
    if (!c || id === current.data?.id) return;
    const ok = await confirmAction(
      `جعل «${courseLabel(c)}» الدورة الحالية؟\nستعرضها كل الشاشات، وتنتقل إليها هواتف المقيّمين في المزامنة التالية.`,
      "اجعلها الحالية"
    );
    if (ok) choose.mutate(id);
  };

  return (
    <label className="course-switch" title="الدورة الحالية: تعمل عليها كل الشاشات وهواتف المقيّمين">
      <span>الدورة</span>
      <select value={current.data?.id ?? ""} onChange={(e) => void pick(e.target.value)} disabled={choose.isPending} aria-label="الدورة الحالية">
        {list.map((c) => (
          <option key={c.id} value={c.id}>
            {courseLabel(c)}
          </option>
        ))}
      </select>
    </label>
  );
}
