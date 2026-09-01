import { describe, expect, it } from "vitest";
import {
  constantTimeEquals,
  hashPassword,
  ipHash,
  randomSalt,
  randomToken,
  sha256Hex,
  utcDay,
  verifyPassword,
  visitorHash,
} from "../../src/lib/crypto";

const SECRET = "test-secret";
const DAY_ONE = Date.parse("2026-03-10T12:00:00Z") / 1000;
const DAY_ONE_LATER = Date.parse("2026-03-10T23:59:00Z") / 1000;
const DAY_TWO = Date.parse("2026-03-11T00:01:00Z") / 1000;

describe("utcDay", () => {
  it("formats a unix second as a UTC calendar day", () => {
    expect(utcDay(DAY_ONE)).toBe("2026-03-10");
  });

  it("rolls over at UTC midnight, not local midnight", () => {
    expect(utcDay(DAY_TWO)).toBe("2026-03-11");
  });
});

describe("visitorHash", () => {
  it("is stable for the same visitor within one day", async () => {
    const a = await visitorHash(SECRET, "1.2.3.4", "UA/1", "abc", DAY_ONE);
    const b = await visitorHash(SECRET, "1.2.3.4", "UA/1", "abc", DAY_ONE_LATER);
    expect(a).toBe(b);
  });

  it("differs for the same visitor on the next day, so they cannot be followed", async () => {
    const a = await visitorHash(SECRET, "1.2.3.4", "UA/1", "abc", DAY_ONE);
    const b = await visitorHash(SECRET, "1.2.3.4", "UA/1", "abc", DAY_TWO);
    expect(a).not.toBe(b);
  });

  it("differs between two visitors", async () => {
    const a = await visitorHash(SECRET, "1.2.3.4", "UA/1", "abc", DAY_ONE);
    const b = await visitorHash(SECRET, "5.6.7.8", "UA/1", "abc", DAY_ONE);
    expect(a).not.toBe(b);
  });

  it("differs across links for the same visitor", async () => {
    const a = await visitorHash(SECRET, "1.2.3.4", "UA/1", "abc", DAY_ONE);
    const b = await visitorHash(SECRET, "1.2.3.4", "UA/1", "xyz", DAY_ONE);
    expect(a).not.toBe(b);
  });

  it("returns 32 hex characters and leaks none of its inputs", async () => {
    // The claim this stands behind is that no input to the hash — not the IP,
    // not the raw user-agent (the highest-entropy of the three), not the slug —
    // can be read back out of the value that reaches storage.
    const ip = "203.0.113.9";
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140.0.0.0 Safari/537.36";
    const slug = "quarterly-report";

    const hash = await visitorHash(SECRET, ip, ua, slug, DAY_ONE);

    expect(hash).toMatch(/^[0-9a-f]{32}$/);
    expect(hash).not.toContain(ip);
    expect(hash).not.toContain(ua);
    expect(hash).not.toContain("Macintosh");
    expect(hash).not.toContain("Chrome");
    expect(hash).not.toContain(slug);
    expect(hash).not.toContain("quarterly");
    expect(hash).not.toContain(SECRET);
  });
});

describe("ipHash", () => {
  it("rotates daily like the visitor hash", async () => {
    const a = await ipHash(SECRET, "1.2.3.4", DAY_ONE);
    const b = await ipHash(SECRET, "1.2.3.4", DAY_TWO);
    expect(a).not.toBe(b);
  });
});

describe("constantTimeEquals", () => {
  it("is true for equal strings", async () => {
    expect(await constantTimeEquals("hunter2", "hunter2")).toBe(true);
  });

  it("is false for different strings of equal length", async () => {
    expect(await constantTimeEquals("hunter2", "hunter3")).toBe(false);
  });

  it("is false for different lengths without throwing", async () => {
    expect(await constantTimeEquals("short", "a much longer value")).toBe(false);
  });
});

describe("randomToken", () => {
  it("returns 64 hex characters", () => {
    expect(randomToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 500 }, () => randomToken()));
    expect(seen.size).toBe(500);
  });
});

describe("sha256Hex", () => {
  it("matches the known digest of the empty string", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("password hashing", () => {
  it("verifies the correct password", async () => {
    const salt = randomSalt();
    const hash = await hashPassword("open sesame", salt);
    expect(await verifyPassword("open sesame", salt, hash)).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const salt = randomSalt();
    const hash = await hashPassword("open sesame", salt);
    expect(await verifyPassword("open sesam", salt, hash)).toBe(false);
  });

  it("produces different hashes for the same password under different salts", async () => {
    const a = await hashPassword("same", randomSalt());
    const b = await hashPassword("same", randomSalt());
    expect(a).not.toBe(b);
  });
});
