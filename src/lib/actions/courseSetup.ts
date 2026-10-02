"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "../auth";
import { getOrCreateCourseDraft, updateCourseSetup } from "../models/courses";
import { setCourseStudyTypes, setCourseHospitals } from "../models/courseSetup";

export async function createOrResumeCourseDraftAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  const year = Number(formData.get("year"));
  const number = Number(formData.get("number"));
  const label = String(formData.get("label") ?? "").trim();
  const course = await getOrCreateCourseDraft(session.sub, { year, number, label: label || undefined });
  revalidatePath("/setup");
  redirect(`/setup?courseId=${course.id}`);
}

export async function resumeCourseDraftAction(formData: FormData) {
  await requireRole("ADMIN");
  const courseId = String(formData.get("courseId") ?? "");
  redirect(`/setup?courseId=${courseId}`);
}

// These three save into an already-selected course (courseId is already in
// the URL), so they only revalidate — no redirect. Redirecting here would
// force a full navigation and reset the wizard's client-side `active` step
// back to the first step, same as every other in-place step save.
export async function saveCourseDatesAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  const courseId = String(formData.get("courseId") ?? "");
  const startDate = String(formData.get("startDate") ?? "").trim();
  const weekCount = Number(formData.get("weekCount"));
  await updateCourseSetup(session.sub, courseId, { startDate: startDate || undefined, weekCount });
  revalidatePath("/setup");
}

export async function setCourseStudyTypesAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  const courseId = String(formData.get("courseId") ?? "");
  const studyTypeIds = formData.getAll("studyTypeIds").map(String);
  await setCourseStudyTypes(session.sub, courseId, studyTypeIds);
  revalidatePath("/setup");
}

export async function setCourseHospitalsAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  const courseId = String(formData.get("courseId") ?? "");
  const hospitalIds = formData.getAll("hospitalIds").map(String);
  const hospitals = hospitalIds.map((hospitalId) => {
    const raw = String(formData.get(`capacity_${hospitalId}`) ?? "").trim();
    const capacity = raw ? Number(raw) : null;
    return { hospitalId, capacity: capacity && capacity > 0 ? capacity : null };
  });
  await setCourseHospitals(session.sub, courseId, hospitals);
  revalidatePath("/setup");
}
