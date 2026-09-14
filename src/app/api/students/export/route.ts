import { NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth";
import { listStudents } from "@/lib/models/students";
import Papa from "papaparse";

export async function GET() {
  try {
    await requireRole("ADMIN");
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.code }, { status: err.code === "unauthenticated" ? 401 : 403 });
    }
    throw err;
  }

  const students = await listStudents(true);
  const csv = Papa.unparse(
    students.map((s) => ({
      universityNumber: s.universityNumber,
      nameAr: s.nameAr,
      nameEn: s.nameEn ?? "",
      email: s.email ?? "",
      studyType: s.studyTypeName ?? "",
      group: s.groupName ?? "",
      active: s.active ? "yes" : "no",
    }))
  );

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="students-export.csv"`,
    },
  });
}
