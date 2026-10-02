import { listCourses, getCourse } from "@/lib/models/courses";
import { listStudyTypes } from "@/lib/models/studyTypes";
import { listHospitals } from "@/lib/models/hospitals";
import { listGroups } from "@/lib/models/groups";
import { listStudents } from "@/lib/models/students";
import { listEvaluators } from "@/lib/models/evaluators";
import { listAllRotationBlocks } from "@/lib/models/rotationBlocks";
import { getTermSettings } from "@/lib/models/termSettings";
import { listCourseStudyTypes, listCourseHospitals } from "@/lib/models/courseSetup";
import SetupWizard from "./SetupWizard";

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const courseIdParam = typeof sp.courseId === "string" ? sp.courseId : undefined;

  const [term, courses, studyTypes, hospitals, groups, students, evaluators, blocks] = await Promise.all([
    getTermSettings(),
    listCourses(true),
    listStudyTypes(true),
    listHospitals(true),
    listGroups(true),
    listStudents(true),
    listEvaluators(true),
    listAllRotationBlocks(false),
  ]);

  // COURSE_SETUP_PLAN.md §4 step 2: resume the course the admin last picked
  // (via ?courseId=), falling back to nothing selected yet — the wizard's
  // first step is choosing/creating that draft.
  const selectedCourse = courseIdParam ? await getCourse(courseIdParam) : undefined;
  const [selectedCourseStudyTypes, selectedCourseHospitals] = selectedCourse
    ? await Promise.all([listCourseStudyTypes(selectedCourse.id), listCourseHospitals(selectedCourse.id)])
    : [[], []];

  return (
    <SetupWizard
      data={{ term, courses, studyTypes, hospitals, groups, students, evaluators, blocks }}
      course={{
        selected: selectedCourse,
        studyTypeIds: selectedCourseStudyTypes.map((r) => r.studyTypeId),
        hospitals: selectedCourseHospitals,
      }}
    />
  );
}
