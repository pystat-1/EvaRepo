import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireRole, AuthError } from "@/lib/auth";
import { listGradingCenter } from "@/lib/models/gradingCenter";
import { listRubricSections } from "@/lib/models/rubric";

const ATTENDANCE_LABEL: Record<string, string> = { present: "حاضر", late: "متأخر", absent: "غائب" };

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// Lets an evaluator download their own day's grading detail as a real
// spreadsheet — one row per student, one column per rubric section (not
// just the total), so the file carries the same detail the Grading Center
// shows on screen.
export async function GET(req: NextRequest) {
  let evaluatorId: string;
  try {
    const session = await requireRole("EVALUATOR");
    evaluatorId = session.sub;
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.code }, { status: err.code === "unauthenticated" ? 401 : 403 });
    }
    throw err;
  }

  const dateISO = req.nextUrl.searchParams.get("date")?.trim() || todayISO();

  const [{ rows, maxTotal }, sections] = await Promise.all([
    listGradingCenter({ evaluatorId, dateFrom: dateISO, dateTo: dateISO }, 1000),
    listRubricSections(),
  ]);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Eva";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(`تقييم ${dateISO}`, { views: [{ rightToLeft: true }] });

  const columns = [
    { header: "الرمز", key: "code", width: 14 },
    { header: "الرقم الجامعي", key: "universityNumber", width: 16 },
    { header: "اسم الطالب", key: "name", width: 24 },
    { header: "الدورة", key: "course", width: 12 },
    { header: "نوع الدراسة", key: "studyType", width: 14 },
    { header: "المجموعة", key: "group", width: 14 },
    { header: "المستشفى", key: "hospital", width: 18 },
    { header: "الحضور", key: "attendance", width: 10 },
    ...sections.map((s) => ({ header: `${s.labelAr} (${s.maxScore})`, key: `section_${s.id}`, width: 16 })),
    { header: `المجموع (من ${maxTotal})`, key: "total", width: 14 },
    { header: "ملاحظات", key: "notes", width: 24 },
    { header: "التغذية الراجعة", key: "feedback", width: 24 },
    { header: "الحالة", key: "status", width: 10 },
  ];
  sheet.columns = columns;
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { horizontal: "center" };

  for (const r of rows) {
    const scoreBySection = new Map(r.scores.map((s) => [s.sectionId, s.score]));
    const rowData: Record<string, string | number> = {
      code: r.studentCode ?? "",
      universityNumber: r.universityNumber,
      name: r.studentName,
      course: r.courseLabel ?? "",
      studyType: r.studyTypeName ?? "",
      group: r.groupName ?? "",
      hospital: r.hospitalName ?? "",
      attendance: ATTENDANCE_LABEL[r.attendance] ?? r.attendance,
      total: r.total,
      notes: r.notes ?? "",
      feedback: r.feedback ?? "",
      status: r.locked ? "مقفل" : "مفتوح",
    };
    for (const s of sections) {
      rowData[`section_${s.id}`] = scoreBySection.get(s.id) ?? "";
    }
    sheet.addRow(rowData);
  }

  sheet.autoFilter = { from: "A1", to: `${sheet.getColumn(columns.length).letter}1` };

  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="evaluations-${dateISO}.xlsx"`,
    },
  });
}
