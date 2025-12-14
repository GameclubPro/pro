import { PropsWithChildren } from "react";
import { useTelegramViewport } from "./useTelegramViewport";

export default function AppLayout({ children }: PropsWithChildren) {
  useTelegramViewport();

  return (
    <div id="app">
      <div className="tg-page">{children}</div>
    </div>
  );
}
