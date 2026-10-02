import { listHospitals } from "@/lib/models/hospitals";
import { listEvaluators } from "@/lib/models/evaluators";
import { listStudents } from "@/lib/models/students";
import { listGroups } from "@/lib/models/groups";
import { listStudyTypes } from "@/lib/models/studyTypes";
import { listAllRotationBlocks } from "@/lib/models/rotationBlocks";
import { getTermSettings } from "@/lib/models/termSettings";
import MasterWorkbook from "./MasterWorkbook";

export default async function MasterPage() {
  const [term, hospitals, evaluators, students, groups, studyTypes, blocks] = await Promise.all([
    getTermSettings(),
    listHospitals(true),
    listEvaluators(true),
    listStudents(true),
    listGroups(true),
    listStudyTypes(true),
    listAllRotationBlocks(false),
  ]);

  return (
    <MasterWorkbook
      data={{ term, hospitals, evaluators, students, groups, studyTypes, blocks }}
    />
  );
}
