import React from "react";

export default function SafeNotice({ emoji = "🚧", title, message }) {
  return (
    <div className="safe-screen">
      <div className="safe-screen__panel" role="status" aria-live="polite">
        <div className="safe-screen__badge" aria-hidden>
          {emoji}
        </div>
        {title && <h2 className="safe-screen__title">{title}</h2>}
        {message && <p className="safe-screen__text">{message}</p>}
      </div>
    </div>
  );
}
