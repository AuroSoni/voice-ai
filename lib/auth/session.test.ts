import { afterEach, describe, expect, it, vi } from "vitest";
import { authMode, checkPassword, createSession, readCookie, verifySession } from "./session";

afterEach(() => vi.unstubAllEnvs());

describe("session", () => {
  it("verifies its own tokens and rejects tampered or expired ones", async () => {
    vi.stubEnv("APP_PASSWORD", "hunter2");
    const token = await createSession();
    expect(await verifySession(token)).toBe(true);
    expect(await verifySession(token.slice(0, -2) + "xx")).toBe(false);
    expect(await verifySession(`${Math.floor(Date.now() / 1000) + 9999999}.${token.split(".")[1]}`)).toBe(false);
    expect(await verifySession(token, Date.now() + 15 * 86400_000)).toBe(false);
    expect(await verifySession(undefined)).toBe(false);
  });

  it("invalidates sessions when the password changes", async () => {
    vi.stubEnv("APP_PASSWORD", "one");
    const token = await createSession();
    vi.stubEnv("APP_PASSWORD", "two");
    expect(await verifySession(token)).toBe(false);
  });

  it("checks the password", async () => {
    vi.stubEnv("APP_PASSWORD", "hunter2");
    expect(await checkPassword("hunter2")).toBe(true);
    expect(await checkPassword("hunter3")).toBe(false);
    expect(await checkPassword("")).toBe(false);
  });

  it("fails closed on deployments without a password", () => {
    vi.stubEnv("APP_PASSWORD", "");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(authMode()).toBe("locked");
    vi.stubEnv("ALLOW_PUBLIC", "1");
    expect(authMode()).toBe("open");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("ALLOW_PUBLIC", "");
    expect(authMode()).toBe("open");
    vi.stubEnv("APP_PASSWORD", "x");
    expect(authMode()).toBe("password");
  });

  it("reads cookies", () => {
    expect(readCookie("a=1; stt_session=abc.def; b=2", "stt_session")).toBe("abc.def");
    expect(readCookie(null, "x")).toBeUndefined();
  });
});
