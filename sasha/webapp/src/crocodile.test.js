import { describe, expect, it } from "vitest";
import {
  appendCustomWords,
  buildWordPool,
  normalizePacks,
  parseWords,
  removeCustomWordAt,
} from "./crocodile-helpers";

describe("crocodile helpers", () => {
  it("parses words line by line and trims empty lines", () => {
    expect(parseWords(" кот \n\nдом ")).toEqual(["кот", "дом"]);
  });

  it("dedupes custom words ignoring case", () => {
    expect(parseWords("кот\nКот\nдом\nдом")).toEqual(["кот", "дом"]);
  });

  it("normalizes packs selection with custom flag", () => {
    expect(normalizePacks(["easy", "custom"], true)).toEqual(["easy", "custom"]);
    expect(normalizePacks("hard", false)).toEqual(["hard"]);
    expect(normalizePacks(undefined, true)).toEqual(["easy", "medium", "hard", "custom"]);
  });

  it("appends custom words through + friendly input", () => {
    const current = "кот\nдом";
    expect(appendCustomWords(current, "лампа")).toBe("кот\nдом\nлампа");
    expect(appendCustomWords(current, "яблоко, телефон")).toBe("кот\nдом\nяблоко\nтелефон");
    expect(appendCustomWords(current, "кот, Дом")).toBe("кот\nдом");
    expect(appendCustomWords(current, "   \n  ")).toBe("кот\nдом");
  });

  it("removes a custom word by index safely", () => {
    const base = "кот\nдом\nлампа";
    expect(removeCustomWordAt(base, 1)).toBe("кот\nлампа");
    expect(removeCustomWordAt(base, 5)).toBe(base);
  });

  it("builds word pool respecting selected packs and levels", () => {
    const pool = buildWordPool({ difficulty: ["easy"], wordsPerTeam: 3 }, []);
    expect(pool.length).toBeGreaterThan(0);
    expect(new Set(pool.map((w) => w.level))).toEqual(new Set(["easy"]));

    const mixed = buildWordPool({ difficulty: ["custom"], wordsPerTeam: 3 }, ["ручка"]);
    expect(mixed[0]).toMatchObject({ word: "ручка", level: "custom" });
  });

  it("dedupes custom words when building pool", () => {
    const pool = buildWordPool({ difficulty: ["custom"], wordsPerTeam: 3 }, ["кот", "Кот"]);
    expect(pool).toHaveLength(1);
  });
});
