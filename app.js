const bridge = String(window.JOINER_BRIDGE_URL || "").replace(/\/$/, "");
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
  bridgeUrl: $("bridgeUrl"),
};

let token = "";

function setNotice(message, kind = "") {
  elements.notice.textContent = message;
  elements.notice.className = `notice ${kind}`.trim();
}

async function api(path, body) {
  if (!bridge) throw new Error("Bridge URL is missing.");
  const response = await fetch(`${bridge}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text.slice(0, 200) };
  }
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
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

async function checkBridge() {
  try {
    await api("/health");
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
  token = elements.token.value.trim();

  elements.loginBtn.disabled = true;
  setNotice("Verifying account...");
  try {
    const data = await api("/channels", { token });
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
    const data = await api("/join", { token, invite });
    showResult(data);
    setNotice("Invite accepted.", "good");
  } catch (error) {
    setNotice(`Join failed: ${error.message}`, "bad");
  } finally {
    elements.joinBtn.disabled = false;
  }
});

elements.bridgeUrl.textContent = bridge || "missing";
checkBridge();
