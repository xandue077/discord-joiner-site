"use strict";

const API = "https://discord.com/api/v10";
const STORE_KEY = "ollie-discord-joiner-accounts-v1";
const $ = (id) => document.getElementById(id);

const elements = {
  notice: $("notice"),
  addForm: $("addForm"),
  tokens: $("tokens"),
  addBtn: $("addBtn"),
  accountList: $("accountList"),
  accountCount: $("accountCount"),
  selectAllBtn: $("selectAllBtn"),
  clearBtn: $("clearBtn"),
  joinForm: $("joinForm"),
  invite: $("invite"),
  joinBtn: $("joinBtn"),
  result: $("result"),
  captcha: $("captcha"),
  captchaDebug: $("captchaDebug"),
};

let accounts = [];
let hcaptchaPromise = null;
let activeWidget = null;

const debugLines = [];
const originalConsoleError = console.error.bind(console);

function setNotice(message, kind = "") {
  elements.notice.textContent = message;
  elements.notice.className = `notice ${kind}`.trim();
}

function formatDebugArg(value) {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function debugLine(line) {
  debugLines.push(String(line).slice(0, 800));
  if (debugLines.length > 24) debugLines.shift();
}

function showCaptchaDebug() {
  if (!debugLines.length) return;
  elements.captchaDebug.textContent = debugLines.join("\n\n");
  elements.captchaDebug.hidden = false;
}

console.error = (...args) => {
  debugLine(`console.error: ${args.map(formatDebugArg).join(" ")}`);
  originalConsoleError(...args);
};

window.addEventListener("error", (event) => {
  if (event.target?.src) debugLine(`resource failed: ${event.target.src}`);
  else if (event.message) debugLine(`window.error: ${event.message}`);
}, true);

window.addEventListener("unhandledrejection", (event) => {
  debugLine(`unhandledrejection: ${formatDebugArg(event.reason)}`);
});

function cleanToken(value) {
  return String(value ?? "").replace(/^Bot\s+/i, "").trim();
}

function displayName(account) {
  return account?.globalName || account?.username || account?.id || "account";
}

function inviteCode(value) {
  const raw = String(value ?? "").trim();
  if (/^[a-zA-Z0-9_-]{1,120}$/.test(raw)) return raw;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase();
    const allowed =
      host === "discord.gg" ||
      host === "discord.com" ||
      host === "discordapp.com" ||
      host.endsWith(".discord.com") ||
      host.endsWith(".discordapp.com");
    if (!allowed) throw new Error("Invite must be a discord.gg or discord.com link.");
    const code = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
    if (!/^[a-zA-Z0-9_-]{1,120}$/.test(code)) throw new Error("Missing invite code.");
    return code;
  } catch (error) {
    throw error instanceof TypeError ? new Error("Invalid invite link.") : error;
  }
}

function base64Json(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

function discordHeaders(extra = {}) {
  const locale = "en-US";
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return {
    "Content-Type": "application/json",
    "X-Context-Properties": base64Json({ location: "Markdown Link" }),
    "X-Discord-Locale": locale,
    "X-Discord-Timezone": timezone,
    "X-Debug-Options": "bugReporterEnabled",
    "X-Super-Properties": base64Json({
      os: "Windows",
      browser: "Discord Client",
      release_channel: "stable",
      client_version: "1.0.9210",
      os_version: "10.0.19044",
      os_arch: "x64",
      app_arch: "x64",
      system_locale: locale,
      has_client_mods: false,
      client_launch_id: randomId(),
      browser_user_agent: navigator.userAgent,
      browser_version: "35.3.0",
      os_sdk_version: "19044",
      client_build_number: 455964,
      native_build_number: 69976,
      client_event_source: null,
      launch_signature: randomId(),
      client_heartbeat_session_id: randomId(),
      client_app_state: "focused",
    }),
    ...extra,
  };
}

async function discordFetch(path, token, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: token,
      ...discordHeaders(options.headers),
    },
    cache: "no-store",
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text.slice(0, 200) };
  }
  return { ok: response.ok, status: response.status, code: data?.code, data };
}

async function directVerify(token) {
  const clean = cleanToken(token);
  if (!clean) throw new Error("Missing token.");
  const result = await discordFetch("/users/@me", clean, { method: "GET" });
  if (!result.ok) {
    const error = new Error(result.data?.message || `Discord returned HTTP ${result.status}.`);
    error.code = result.code;
    throw error;
  }
  const data = result.data;
  return {
    id: String(data.id ?? ""),
    token: clean,
    username: String(data.username ?? ""),
    globalName: String(data.global_name ?? ""),
    avatar: String(data.avatar ?? ""),
    verified: Boolean(data.verified),
    selected: true,
  };
}

async function directJoin(token, invite, captchaKey = "", rqtoken = "") {
  const code = inviteCode(invite);
  const headers = {};
  if (captchaKey) headers["X-Captcha-Key"] = captchaKey;
  if (rqtoken) headers["X-Captcha-Rqtoken"] = rqtoken;
  const result = await discordFetch(`/invites/${code}`, token, {
    method: "POST",
    headers,
    body: JSON.stringify({ session_id: null }),
  });
  if (result.ok) return result.data;
  if (result.data?.captcha_service) {
    const error = new Error("Discord requires a captcha.");
    error.captcha = {
      service: result.data.captcha_service,
      sitekey: result.data.captcha_sitekey,
      rqdata: result.data.captcha_rqdata,
      rqtoken: result.data.captcha_rqtoken,
    };
    throw error;
  }
  const error = new Error(result.data?.message || `Discord returned HTTP ${result.status}.`);
  error.code = result.code;
  error.status = result.status;
  throw error;
}

function ensureHcaptcha() {
  if (window.__hcaptchaReady && window.hcaptcha) return Promise.resolve();
  if (hcaptchaPromise) return hcaptchaPromise;
  hcaptchaPromise = new Promise((resolve, reject) => {
    window.ollieHcaptchaReady = () => {
      window.__hcaptchaReady = true;
      resolve();
    };
    const script = document.createElement("script");
    script.src = "https://js.hcaptcha.com/1/api.js?onload=ollieHcaptchaReady&render=explicit&recaptchacompat=off";
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      hcaptchaPromise = null;
      reject(new Error("Captcha widget blocked."));
    };
    document.head.append(script);
  });
  return hcaptchaPromise;
}

async function solveCaptcha(captcha) {
  await ensureHcaptcha();
  elements.captcha.hidden = false;
  elements.captcha.replaceChildren();

  if (activeWidget !== null && typeof window.hcaptcha.destroy === "function") {
    try {
      window.hcaptcha.destroy(activeWidget);
    } catch {
      activeWidget = null;
    }
  }

  window.ollieCaptchaError = (code) => {
    debugLine(`hcaptcha error-callback: ${String(code ?? "unknown")}`);
  };

  activeWidget = window.hcaptcha.render(elements.captcha, {
    sitekey: captcha.sitekey,
    size: "invisible",
    theme: "dark",
    "error-callback": "ollieCaptchaError",
  });

  if (captcha.rqdata && typeof window.hcaptcha.setData === "function") {
    window.hcaptcha.setData(activeWidget, { rqdata: captcha.rqdata });
  }

  setNotice("Solving Discord captcha...");
  const result = await window.hcaptcha.execute(activeWidget, {
    async: true,
    rqdata: captcha.rqdata,
  });
  const key = typeof result === "string" ? result : result?.response;
  if (!key) throw new Error("Captcha returned no token.");
  elements.captcha.hidden = true;
  return { key, rqtoken: captcha.rqtoken };
}

function loadAccounts() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    const clean = Array.isArray(saved) ? saved : [];
    const seen = new Set();
    accounts = clean
      .map((account) => ({
        id: String(account?.id ?? ""),
        token: cleanToken(account?.token),
        username: String(account?.username ?? ""),
        globalName: String(account?.globalName ?? ""),
        avatar: String(account?.avatar ?? ""),
        verified: Boolean(account?.verified),
        selected: account?.selected !== false,
      }))
      .filter((account) => {
        if (!account.token || seen.has(account.token)) return false;
        seen.add(account.token);
        return true;
      });
  } catch {
    accounts = [];
  }
}

function saveAccounts() {
  localStorage.setItem(STORE_KEY, JSON.stringify(accounts));
}

function renderAccounts() {
  elements.accountList.replaceChildren();
  const count = accounts.length;
  const selected = accounts.filter((account) => account.selected).length;
  elements.accountCount.textContent = `${count} saved · ${selected} selected`;
  elements.joinForm.hidden = count === 0;
  elements.selectAllBtn.disabled = count === 0;
  elements.clearBtn.disabled = count === 0;

  if (count === 0) {
    const empty = document.createElement("div");
    empty.className = "muted empty";
    empty.textContent = "No accounts saved yet. Paste one or many tokens above.";
    elements.accountList.append(empty);
    return;
  }

  for (const account of accounts) {
    const row = document.createElement("div");
    row.className = "account-row";

    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = Boolean(account.selected);
    check.dataset.action = "select";
    check.dataset.token = account.token;
    check.setAttribute("aria-label", `Select ${displayName(account)}`);

    const avatar = document.createElement("div");
    avatar.className = "avatar small";
    if (account.id && account.avatar) {
      const image = document.createElement("img");
      image.src = `https://cdn.discordapp.com/avatars/${account.id}/${account.avatar}.png?size=40`;
      image.alt = "";
      avatar.append(image);
    }

    const info = document.createElement("div");
    info.className = "account-info";
    const name = document.createElement("div");
    name.className = "account-name";
    name.textContent = displayName(account);
    const masked = document.createElement("div");
    masked.className = "muted";
    masked.textContent = `${account.token.slice(0, 6)}...${account.token.slice(-4)}${account.verified === false ? " · Discord unverified" : ""}`;
    info.append(name, masked);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.dataset.action = "remove";
    remove.dataset.token = account.token;
    remove.textContent = "Remove";

    row.append(check, avatar, info, remove);
    elements.accountList.append(row);
  }
}

function renderResults(results) {
  elements.result.replaceChildren();
  if (!results.length) {
    elements.result.hidden = true;
    return;
  }
  for (const result of results) {
    const line = document.createElement("div");
    line.className = `result-line ${result.ok ? "good" : "bad"}`;
    line.textContent = result.text;
    elements.result.append(line);
  }
  elements.result.hidden = false;
}

async function addAccounts(text) {
  const tokens = [...new Set(String(text || "").split(/\s+/).map(cleanToken).filter(Boolean))];
  if (!tokens.length) {
    setNotice("Paste at least one token.", "bad");
    return;
  }

  elements.addBtn.disabled = true;
  const added = [];
  const failed = [];

  for (const token of tokens) {
    try {
      const account = await directVerify(token);
      const index = accounts.findIndex((item) => item.id === account.id || item.token === token);
      if (index >= 0) accounts[index] = account;
      else accounts.push(account);
      added.push(displayName(account));
    } catch (error) {
      failed.push(`${token.slice(0, 6)}... ${friendlyJoinError(error)}`);
    }
    renderAccounts();
  }

  saveAccounts();
  renderAccounts();
  elements.tokens.value = "";
  elements.addBtn.disabled = false;

  if (failed.length) {
    setNotice(`Added ${added.length}. Failed: ${failed.slice(0, 3).join(" | ")}`, failed.length === tokens.length ? "bad" : "good");
  } else {
    setNotice(`Added ${added.length} account${added.length === 1 ? "" : "s"}.`, "good");
  }
}

function friendlyJoinError(error) {
  if ([40002, 50178].includes(error?.code)) {
    return "Discord requires this account to be verified first; verify its email or phone in Discord, then retry";
  }
  if (error?.code === 340015) {
    return "Discord has limited this account from joining new servers";
  }
  if (error?.code === 50009) {
    return "Discord channel verification level is too high for this account";
  }
  return error?.message || "Join failed";
}

async function joinOne(account, invite) {
  try {
    const data = await directJoin(account.token, invite);
    const guild = data?.guild ?? data;
    return { ok: true, text: `${displayName(account)} → joined ${guild?.name || "server"}` };
  } catch (error) {
    if (!error.captcha) throw error;
    const solved = await solveCaptcha(error.captcha);
    const data = await directJoin(account.token, invite, solved.key, solved.rqtoken);
    const guild = data?.guild ?? data;
    return { ok: true, text: `${displayName(account)} → joined ${guild?.name || "server"}` };
  }
}

async function joinSelected(invite) {
  const selected = accounts.filter((account) => account.selected);
  if (!selected.length) {
    setNotice("Select at least one account.", "bad");
    return;
  }

  elements.joinBtn.disabled = true;
  const results = [];
  let ok = 0;
  for (const [index, account] of selected.entries()) {
    setNotice(`Joining ${index + 1}/${selected.length}: ${displayName(account)}...`);
    try {
      const result = await joinOne(account, invite);
      results.push(result);
      ok += 1;
    } catch (error) {
      results.push({ ok: false, text: `${displayName(account)} → ${friendlyJoinError(error)}` });
      debugLine(`${displayName(account)}: ${formatDebugArg(error)}`);
      showCaptchaDebug();
    }
    renderResults(results);
  }
  elements.joinBtn.disabled = false;
  setNotice(`Finished: ${ok}/${selected.length} joined.`, ok === selected.length ? "good" : "bad");
}

elements.addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await addAccounts(elements.tokens.value);
});

elements.selectAllBtn.addEventListener("click", () => {
  for (const account of accounts) account.selected = true;
  saveAccounts();
  renderAccounts();
});

elements.clearBtn.addEventListener("click", () => {
  for (const account of accounts) account.selected = false;
  saveAccounts();
  renderAccounts();
});

elements.accountList.addEventListener("change", (event) => {
  if (event.target?.dataset?.action !== "select") return;
  const account = accounts.find((item) => item.token === event.target.dataset.token);
  if (!account) return;
  account.selected = event.target.checked;
  saveAccounts();
  renderAccounts();
});

elements.accountList.addEventListener("click", (event) => {
  if (event.target?.dataset?.action !== "remove") return;
  accounts = accounts.filter((item) => item.token !== event.target.dataset.token);
  saveAccounts();
  renderAccounts();
});

elements.joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await joinSelected(elements.invite.value.trim());
});

loadAccounts();
renderAccounts();
setNotice("GitHub Pages mode. Tokens stay in this browser.", "good");
