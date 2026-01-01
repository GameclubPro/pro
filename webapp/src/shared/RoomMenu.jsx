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

  const issueId = String(title || "MAFIA").toUpperCase().replace(/\s+/g, "-");

  return (
    <section className="mf-menu v2 mf-menu-tabloid" aria-label="Главное меню">
      <header className="mf-menu-hero mf-press-hero" role="banner">
        <div className="mf-press-meta" aria-hidden="true">
          <span className="mf-press-tag">ЭКСТРЕННЫЙ ВЫПУСК</span>
          <span className="mf-press-issue">ВЫПУСК № {issueId}</span>
          <span className="mf-press-city">ГОРОД БЕЗ СНА</span>
        </div>
        <div className="mf-menu-logo" aria-label={title}>
          {title}
        </div>
        <div className="mf-press-rule" aria-hidden="true" />
        <p className="mf-menu-tagline">{tagline}</p>
        <div className="mf-press-stamp" aria-hidden="true">
          СРОЧНО
        </div>
      </header>

      <div className="mf-menu-actions mf-press-layout" role="group" aria-label="Действия">
        <article className="mf-press-card mf-press-join" aria-label="Вступить по коду">
          <div className="mf-press-kicker">ОБЪЯВЛЕНИЯ</div>
          <div className="mf-press-title">Вступить по коду</div>
          <div className="mf-press-deck">Короткий путь в город.</div>

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
              className="mf-btn big mf-join-cta"
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
              <span className="mf-recent-label">Недавние коды</span>
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

        <article className="mf-press-card mf-press-create" aria-label="Создать комнату">
          <div className="mf-press-kicker">СЕНСАЦИЯ</div>
          <div className="mf-press-title">Создать комнату</div>
          <div className="mf-press-deck">Открой новое дело для команды.</div>
          <button
            className="mf-btn primary xl mf-create-cta mf-break-cta"
            onClick={onCreate}
            disabled={busy}
            type="button"
            aria-label="Создать комнату"
            title="Создать новую комнату"
          >
            {busy ? createBusyLabel : createButtonLabel}
          </button>
          <div className="mf-press-break" aria-hidden="true">
            BREAK GLASS
          </div>
        </article>
      </div>

      <section className="mf-menu-cards mf-press-briefs" aria-label="Кратко">
        <article className="mf-menu-card">
          <div className="ico" aria-hidden="true">
            ⚡
          </div>
          <div className="title">Сводка</div>
          <p className="text">Вход по коду и старт за минуту — без лишних шагов.</p>
        </article>
        <article className="mf-menu-card">
          <div className="ico" aria-hidden="true">
            🎮
          </div>
          <div className="title">Управление</div>
          <p className="text">Все контролы рядом, кнопки крупные, интерфейс читабельный.</p>
        </article>
        <article className="mf-menu-card">
          <div className="ico" aria-hidden="true">
            🤝
          </div>
          <div className="title">Команда</div>
          <p className="text">Собирайся с друзьями и играйте сколько хотите.</p>
        </article>
      </section>
    </section>
  );
}

export default RoomMenu;
