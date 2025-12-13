import React from "react";
import SafeNotice from "./shared/SafeNotice";

export default function SketchBattle() {
  return (
    <SafeNotice
      emoji="✏️"
      title="Sketch Battle появится скоро"
      message="Заглушка уже тянет отступы через env(safe-area-inset-*) для полноэкранной мини‑апки. Как только добавим механику — анонсируем."
    />
  );
}
