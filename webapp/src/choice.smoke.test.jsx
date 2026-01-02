import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import Choice from "./choice.jsx";

// Smoke test to ensure Choice renders without throwing (guards black screen regressions)
describe("Choice smoke render", () => {
  it("renders intro screen without crashing", () => {
    const store = new Map();
    global.localStorage = {
      getItem: (k) => store.get(k) || null,
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k),
    };
    const html = renderToString(
      <Choice goBack={() => {}} onProgress={() => {}} setBackHandler={() => {}} />
    );
    expect(html).toContain("Свободный режим");
  });
});
