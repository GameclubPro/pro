import io from "socket.io-client";
import { getSessionToken } from "./session-token";

let socketInstance = null;
let socketApiBase = null;

export function ensureAuctionSocket({ apiBase, initData, token } = {}) {
  if (!apiBase) return null;
  const shouldRecreate = !socketInstance || socketApiBase !== apiBase;
  if (shouldRecreate) {
    if (socketInstance) {
      try {
        socketInstance.removeAllListeners();
        socketInstance.disconnect();
      } catch {
        // ignore
      }
    }
    socketApiBase = apiBase;
    const authToken = token || getSessionToken() || "";
    socketInstance = io(apiBase, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      auth: { initData: initData || "", token: authToken },
      withCredentials: false,
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 700,
      reconnectionDelayMax: 3500,
      timeout: 8000,
    });
  } else if (socketInstance && initData != null) {
    const authToken = token || getSessionToken() || "";
    socketInstance.auth = {
      ...(socketInstance.auth || {}),
      initData: initData || "",
      token: authToken,
    };
  }
  return socketInstance;
}

export function getAuctionSocket() {
  return socketInstance;
}

export function disconnectAuctionSocket() {
  if (!socketInstance) return;
  try {
    socketInstance.removeAllListeners();
    socketInstance.disconnect();
  } catch {
    // ignore
  }
  socketInstance = null;
  socketApiBase = null;
}
