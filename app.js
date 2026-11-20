let bridge = String(window.JOINER_BRIDGE_URL || "").replace(/\/$/, "");
const JOIN_PATH = "/invite-join";
const $ = (id) => document.getElementById(id);

const elements = {
  notice: $("notice"),
  loginForm: $("loginForm"),
  loginBtn: $("loginBtn"),
  token: $("token"),
  account: $("account"),
  accountName: $("accountName"),
  avatar: $("avatar"),
  joinForm: $("joinForm"),
  joinBtn: $("joinBtn"),
  invite: $("invite"),
  result: $("result"),
  captcha: $("captcha"),
  bridgeUrl: $("bridgeUrl"),
};

let token = "";
let captchaWidget = null;

function setNotice(message, kind = "") {
  elements.notice.textContent = message;
  elements.notice.className = `notice ${kind}`.trim();
}

async function refreshBridgeUrl() {
  try {
    const response = await fetch(`config.js?t=${Date.now()}`, { cache: "no-store" });
    const text = await response.text();
    const match = text.match(/window\.JOINER_BRIDGE_URL\s*=\s*"([^"]+)"/);
    if (match) {
      bridge = match[1].replace(/\/$/, "");
      elements.bridgeUrl.textContent = bridge;
    }
  } catch {
    return;
  }
}

async function api(path, body, retry = true) {
  if (!bridge) throw new Error("Bridge URL is missing.");
  const timeout = path === JOIN_PATH ? 60000 : 20000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`${bridge}${path}`, {
      method: body ? "POST" : "GET",
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = /^\s*</.test(text)
        ? { error: `Bridge gateway error (HTTP ${response.status}).` }
        : { error: text.slice(0, 200) };
    }
    if (!response.ok) {
      const error = new Error(data.error || `HTTP ${response.status}`);
      error.httpStatus = response.status;
      error.data = data;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.httpStatus || !retry) throw error;
    await refreshBridgeUrl();
    return api(path, body, false);
  } finally {
    clearTimeout(timer);
  }
}

function showAccount(account) {
  const name = account.globalName || account.username || "Discord account";
  elements.accountName.textContent = `${name} (${account.id || "unknown id"})`;
  elements.avatar.replaceChildren();
  if (account.id && account.avatar) {
    const image = document.createElement("img");
    image.src = `https://cdn.discordapp.com/avatars/${account.id}/${account.avatar}.png?size=80`;
    image.alt = "";
    elements.avatar.append(image);
  }
  elements.account.hidden = false;
  elements.joinForm.hidden = false;
}

function showResult(data) {
  const guild = data.guild;
  elements.result.replaceChildren();

  const title = document.createElement("div");
  title.className = "account-name";
  title.textContent = guild?.name ? `Joined ${guild.name}` : "Invite accepted";
  elements.result.append(title);

  const detail = document.createElement("div");
  detail.className = "muted";
  const parts = [];
  if (guild?.id) parts.push(`ID ${guild.id}`);
  if (guild?.memberCount) parts.push(`${guild.memberCount} members`);
  if (data.alreadyMember) parts.push("already a member");
  if (data.channelId) parts.push(`channel ${data.channelId}`);
  detail.textContent = parts.join(" · ");
  elements.result.append(detail);
  elements.result.hidden = false;
}

async function ensureHcaptcha() {
  if (window.hcaptcha) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://js.hcaptcha.com/1/api.js?render=explicit";
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Captcha widget blocked."));
    document.head.append(script);
  });
}

async function showCaptcha(captcha, request) {
  try {
    await ensureHcaptcha();
  } catch (error) {
    setNotice(error.message, "bad");
    return;
  }

  elements.captcha.hidden = false;
  elements.captcha.replaceChildren();
  captchaWidget = window.hcaptcha.render(elements.captcha, {
    sitekey: captcha.sitekey,
    rqdata: captcha.rqdata,
    theme: "dark",
    callback: async (captchaKey) => {
      elements.captcha.hidden = true;
      setNotice("Captcha solved. Joining...");
      try {
        const data = await api(JOIN_PATH, {
          token: request.token,
          invite: request.invite,
          captchaKey,
        });
        showResult(data);
        setNotice("Invite accepted.", "good");
      } catch (error) {
        if (error.data?.captcha) {
          await showCaptcha(error.data.captcha, request);
          return;
        }
        setNotice(`Join failed: ${error.message}`, "bad");
      }
    },
    "error-callback": () => setNotice("Captcha failed. Try again.", "bad"),
  });
  setNotice("Complete the captcha to join.", "good");
}

async function checkBridge() {
  try {
    await api("/health", null, false);
    setNotice("Bridge online. Ready to verify your account.", "good");
  } catch (error) {
    setNotice(`Bridge offline: ${error.message}`, "bad");
  }
}

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.result.hidden = true;
  elements.joinForm.hidden = true;
  elements.account.hidden = true;
  elements.captcha.hidden = true;
  token = elements.token.value.trim();

  elements.loginBtn.disabled = true;
  setNotice("Verifying account...");
  try {
    const data = await api("/verify", { token });
    showAccount(data.account);
    setNotice("Account verified. Paste an invite below.", "good");
  } catch (error) {
    setNotice(`Login failed: ${error.message}`, "bad");
  } finally {
    elements.loginBtn.disabled = false;
  }
});

elements.joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const invite = elements.invite.value.trim();

  elements.joinBtn.disabled = true;
  setNotice("Joining server...");
  try {
    const data = await api(JOIN_PATH, { token, invite });
    showResult(data);
    setNotice("Invite accepted.", "good");
  } catch (error) {
    if (error.data?.captcha) {
      await showCaptcha(error.data.captcha, { token, invite });
      return;
    }
    setNotice(`Join failed: ${error.message}`, "bad");
  } finally {
    elements.joinBtn.disabled = false;
  }
});

elements.bridgeUrl.textContent = bridge || "missing";
checkBridge();
