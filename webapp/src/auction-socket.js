import io from "socket.io-client";

let socketInstance = null;
let socketApiBase = null;

export function ensureAuctionSocket({ apiBase, initData } = {}) {
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
    socketInstance = io(apiBase, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      auth: { initData: initData || "" },
      withCredentials: false,
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 700,
      reconnectionDelayMax: 3500,
      timeout: 8000,
    });
  } else if (socketInstance && initData != null) {
    socketInstance.auth = { ...(socketInstance.auth || {}), initData: initData || "" };
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
