"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { checkPassword, createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";

function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "/";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export async function login(formData: FormData) {
  const next = safeNext(formData.get("next"));
  if (!(await checkPassword(String(formData.get("password") ?? "")))) {
    redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  }
  (await cookies()).set(SESSION_COOKIE, await createSession(), sessionCookieOptions());
  redirect(next);
}
