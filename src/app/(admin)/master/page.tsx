import { listHospitals } from "@/lib/models/hospitals";
import { listEvaluators } from "@/lib/models/evaluators";
import { listStudents } from "@/lib/models/students";
import { listCourses } from "@/lib/models/courses";
import { listGroups } from "@/lib/models/groups";
import { listStudyTypes } from "@/lib/models/studyTypes";
import MasterSheet from "./MasterSheet";

export default async function MasterPage() {
  const [hospitals, evaluators, students, courses, groups, studyTypes] = await Promise.all([
    listHospitals(true),
    listEvaluators(true),
    listStudents(true),
    listCourses(true),
    listGroups(true),
    listStudyTypes(true),
  ]);

  return (
    <MasterSheet
      hospitals={hospitals}
      evaluators={evaluators}
      students={students}
      courses={courses}
      groups={groups}
      studyTypes={studyTypes}
    />
  );
}
