import React from "react";
import SafeNotice from "./shared/SafeNotice";

export default function Compatibility() {
  return (
    <SafeNotice
      emoji="💞"
      title="Игра «Совместимость» в разработке"
      message="Экран уже подружили с полноэкранным режимом Telegram и safe area. Чуть позже добавим механику — пока можно вернуться к другим режимам."
    />
  );
}
