import React from "react";

export default function SketchBattle() {
  return (
    <div
      style={{
        padding: "calc(16px + var(--safe-top)) calc(16px + var(--safe-right)) calc(16px + var(--safe-bottom)) calc(16px + var(--safe-left))",
        minHeight: "calc(var(--tg-vh, 100svh) - var(--safe-top, 0px) - var(--safe-bottom, 0px))",
        display: "grid",
        placeItems: "center",
        textAlign: "center",
      }}
    >
      Игра «Sketch Battle» временно недоступна.
    </div>
  );
}
