import { useEffect, useMemo, useState } from "react";
import reactLogo from "./assets/react.svg";
import viteLogo from "/vite.svg";
import "./App.css";

function App() {
  const [count, setCount] = useState(0);

  const tg = useMemo(() => window.Telegram?.WebApp, []);

  useEffect(() => {
    tg?.ready();
    tg?.expand();
  }, [tg]);

  const sendToBot = () => {
    tg?.sendData(JSON.stringify({ action: "count", value: count, ts: Date.now() }));
  };

  return (
    <>
      <div>
        <a href="https://vite.dev" target="_blank" rel="noreferrer">
          <img src={viteLogo} className="logo" alt="Vite logo" />
        </a>
        <a href="https://react.dev" target="_blank" rel="noreferrer">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>

      <h1>Vite + React (Telegram Mini App)</h1>

      <div className="card">
        <button onClick={() => setCount((c) => c + 1)}>count is {count}</button>

        <div style={{ marginTop: 12 }}>
          <button onClick={sendToBot} disabled={!tg}>
            Отправить боту через sendData
          </button>
        </div>

        <p style={{ marginTop: 12, opacity: 0.8 }}>
          Telegram: {tg ? "yes" : "no (открой внутри Telegram)"}
        </p>
      </div>
    </>
  );
}

export default App;
