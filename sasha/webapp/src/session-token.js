const TOKEN_KEY = "pt:session";

export function getSessionToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function setSessionToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // ignore
  }
}

export function clearSessionToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}
