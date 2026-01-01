import { useEffect, useMemo, useRef, useState } from "react";

// Разрешаем 1 (для тестового кода 1234), но по-прежнему исключаем 0/O/I.
const DEFAULT_CODE_ALPHABET_RE = /[^A-HJKMNPQRSTUVWXYZ123456789]/g;

function sanitizeCode(value, alphabetRe, maxLen) {
  const re = alphabetRe || DEFAULT_CODE_ALPHABET_RE;
  return (value || "").toUpperCase().replace(re, "").slice(0, maxLen);
}

/**
 * Shared menu for room-based games (Mafia / Auction) with "mf-menu v2" styling.
 */
export function RoomMenu({
  busy = false,
  onCreate,
  onJoin,
  recentRooms = [],
  title = "MAFIA",
  tagline = "Играй в Telegram — быстро и красиво",
  codePlaceholder = "Код комнаты",
  joinButtonLabel = "Войти в комнату",
  joinBusyLabel = "Соединяем...",
  createButtonLabel = "Создать комнату",
  createBusyLabel = "Создаём...",
  minCodeLength = 4,
  maxCodeLength = 8,
  codeAlphabetRe = DEFAULT_CODE_ALPHABET_RE,
  codePattern,
  error,
  onClearError,
  initialCode = "",
  code,
  onCodeChange,
}) {
  const inputRef = useRef(null);
  const [codeDraft, setCodeDraft] = useState(
    sanitizeCode(code ?? initialCode, codeAlphabetRe, maxCodeLength)
  );
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    setLocalError(error || "");
  }, [error]);

  useEffect(() => {
    if (code === undefined) {
      setCodeDraft((prev) => sanitizeCode(prev || initialCode, codeAlphabetRe, maxCodeLength));
    } else {
      setCodeDraft(sanitizeCode(code, codeAlphabetRe, maxCodeLength));
    }
  }, [code, initialCode, codeAlphabetRe, maxCodeLength]);

  const normalized = useMemo(
    () => sanitizeCode(codeDraft, codeAlphabetRe, maxCodeLength),
    [codeDraft, codeAlphabetRe, maxCodeLength]
  );

  const activeError = localError || "";

  const submit = () => {
    const c = normalized.trim();
    if (!c) {
      setLocalError("Код пустой");
      return;
    }
    if (c.length < minCodeLength) {
      setLocalError(`Минимум ${minCodeLength} символа`);
      return;
    }
    setLocalError("");
    onJoin?.(c);
  };

  const handleChange = (value) => {
    const clean = sanitizeCode(value, codeAlphabetRe, maxCodeLength);
    setCodeDraft(clean);
    if (activeError) {
      setLocalError("");
      onClearError?.();
    }
    onCodeChange?.(clean);
  };

  const pattern =
    codePattern ||
    `[A-HJKMNPQRSTUVWXYZ123456789]{${Math.max(1, minCodeLength)},${Math.max(
      minCodeLength,
      maxCodeLength
    )}}`;

  const caseId = String(title || "MAFIA").toUpperCase().replace(/\s+/g, "-");

  return (
    <section className="mf-menu v2 mf-menu-evidence" aria-label="Главное меню">
      <header className="mf-menu-hero mf-case-hero" role="banner">
        <div className="mf-case-meta" aria-hidden="true">
          <span className="mf-case-label">ДОСЬЕ</span>
          <span className="mf-case-id">№ {caseId}</span>
          <span className="mf-case-status">ОТКРЫТО</span>
        </div>
        <div className="mf-menu-logo" aria-label={title}>
          {title}
        </div>
        <p className="mf-menu-tagline">{tagline}</p>
        <div className="mf-case-stamp" aria-hidden="true">
          СЕКРЕТНО
        </div>
        <div className="mf-case-pin" aria-hidden="true" />
      </header>

      <div className="mf-menu-board">
        <div className="mf-menu-actions" role="group" aria-label="Действия">
          <article className="mf-evidence-card mf-evidence-join" aria-label="Вступить по коду">
            <div className="mf-evidence-head">
              <span className="mf-evidence-tag">УЛИКА A</span>
              <div className="mf-evidence-title">Вступить по коду</div>
              <span className="mf-evidence-note">Быстрый вход</span>
            </div>

            <div className="mf-join-inline">
              <label htmlFor="mf-join-code" className="sr-only">
                Код комнаты
              </label>
              <input
                id="mf-join-code"
                ref={inputRef}
                className="mf-input big"
                placeholder={codePlaceholder}
                inputMode="text"
                maxLength={maxCodeLength}
                pattern={pattern}
                title={`${minCodeLength}–${maxCodeLength} символов: буквы и цифры без O/0/I/1`}
                aria-invalid={activeError ? "true" : "false"}
                value={normalized}
                onChange={(e) => handleChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
                disabled={busy}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
              />
              <button
                className="mf-btn primary big mf-join-cta"
                onClick={submit}
                disabled={busy}
                type="button"
                aria-label="Присоединиться по коду"
              >
                {busy ? joinBusyLabel : joinButtonLabel}
              </button>
            </div>
            {activeError && (
              <div className="mf-form-hint danger" role="alert">
                {activeError}
              </div>
            )}

            {!!recentRooms.length && (
              <div className="mf-recent" role="group" aria-label="Недавние комнаты">
                <div className="mf-recent-label">Недавние коды</div>
                {recentRooms.slice(0, 6).map((c) => (
                  <button
                    key={c}
                    className="mf-chip ghost"
                    onClick={() => onJoin?.(String(c).toUpperCase())}
                    type="button"
                    title={`Подключиться: ${c}`}
                  >
                    {String(c).toUpperCase()}
                  </button>
                ))}
              </div>
            )}
          </article>

          <article className="mf-evidence-card mf-evidence-create" aria-label="Создать комнату">
            <div className="mf-evidence-head">
              <span className="mf-evidence-tag">УЛИКА B</span>
              <div className="mf-evidence-title">Создать комнату</div>
              <span className="mf-evidence-note">Открыть дело</span>
            </div>
            <p className="mf-evidence-text">
              Собери команду, открой новое дело и задай роли для начала игры.
            </p>
            <button
              className="mf-btn primary xl mf-create-cta"
              onClick={onCreate}
              disabled={busy}
              type="button"
              aria-label="Создать комнату"
              title="Создать новую комнату"
            >
              {busy ? createBusyLabel : createButtonLabel}
            </button>
            <div className="mf-evidence-stamp" aria-hidden="true">
              OPEN CASE
            </div>
          </article>
        </div>
      </div>

      <section className="mf-menu-cards mf-menu-notes" aria-label="Как играть">
        <article className="mf-menu-card">
          <div className="ico" aria-hidden="true">
            ⚡
          </div>
          <div className="title">Быстро</div>
          <p className="text">Зайди, создай комнату и зови друзей — без лишних шагов.</p>
        </article>
        <article className="mf-menu-card">
          <div className="ico" aria-hidden="true">
            🎮
          </div>
          <div className="title">Удобно</div>
          <p className="text">Все контролы рядом, кнопки крупные, интерфейс читабельный.</p>
        </article>
        <article className="mf-menu-card">
          <div className="ico" aria-hidden="true">
            🤝
          </div>
          <div className="title">Командно</div>
          <p className="text">Собирайся с друзьями и играйте сколько хотите.</p>
        </article>
      </section>
    </section>
  );
}

export default RoomMenu;
