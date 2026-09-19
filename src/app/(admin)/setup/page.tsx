import { listCourses } from "@/lib/models/courses";
import { listStudyTypes } from "@/lib/models/studyTypes";
import { listHospitals } from "@/lib/models/hospitals";
import { listGroups } from "@/lib/models/groups";
import { listStudents } from "@/lib/models/students";
import { listEvaluators } from "@/lib/models/evaluators";
import { listAllRotationBlocks } from "@/lib/models/rotationBlocks";
import { getTermSettings } from "@/lib/models/termSettings";
import SetupWizard from "./SetupWizard";

export default async function SetupPage() {
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

  return (
    <SetupWizard
      data={{ term, courses, studyTypes, hospitals, groups, students, evaluators, blocks }}
    />
  );
}
