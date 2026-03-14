import { TOKEN_KEY, ALLOWED_ORIGINS_KEY, CONFIRM_WRITES_KEY } from "../shared/constants";

interface StatusResponse {
  connected: boolean;
  eventsPerSec: number;
  tabCount: number;
}

const statusDot = document.getElementById("statusDot") as HTMLDivElement;
const statusLabel = document.getElementById("statusLabel") as HTMLSpanElement;
const metricsEl = document.getElementById("metrics") as HTMLDivElement;
const tokenInput = document.getElementById("tokenInput") as HTMLInputElement;
const saveBtn = document.getElementById("saveBtn") as HTMLButtonElement;
const savedMsg = document.getElementById("savedMsg") as HTMLSpanElement;
const confirmWritesToggle = document.getElementById("confirmWritesToggle") as HTMLInputElement;
const originsList = document.getElementById("originsList") as HTMLUListElement;
const originInput = document.getElementById("originInput") as HTMLInputElement;
const addOriginBtn = document.getElementById("addOriginBtn") as HTMLButtonElement;

// ─── Load saved token ─────────────────────────────────────────────────────────
chrome.storage.local.get([TOKEN_KEY], (result) => {
  const token = result[TOKEN_KEY] as string | undefined;
  if (token) tokenInput.value = token;
});

// ─── Save token & reconnect ───────────────────────────────────────────────────
saveBtn.addEventListener("click", () => {
  const token = tokenInput.value.trim();
  if (!token) return;
  chrome.storage.local.set({ [TOKEN_KEY]: token }, () => {
    savedMsg.style.display = "inline";
    setTimeout(() => { savedMsg.style.display = "none"; }, 2_000);
    chrome.runtime.sendMessage({ type: "reconnect" }).catch(() => {});
  });
});

// ─── Status polling ───────────────────────────────────────────────────────────
function updateStatus(): void {
  chrome.runtime.sendMessage(
    { type: "get_status" },
    (response: StatusResponse | undefined) => {
      if (chrome.runtime.lastError || !response) {
        setStatus(false);
        metricsEl.textContent = "";
        return;
      }
      setStatus(response.connected);
      metricsEl.textContent = [
        `Events: ${response.eventsPerSec.toFixed(1)}/s`,
      ].join("  ·  ");
    },
  );
}

function setStatus(connected: boolean): void {
  statusDot.className = `dot ${connected ? "connected" : "disconnected"}`;
  statusLabel.textContent = connected ? "Connected" : "Disconnected";
}

updateStatus();
setInterval(updateStatus, 1_000);

// ─── Confirm writes toggle ─────────────────────────────────────────────────────
chrome.storage.local.get([CONFIRM_WRITES_KEY], (result) => {
  confirmWritesToggle.checked = (result[CONFIRM_WRITES_KEY] as boolean | undefined) ?? false;
});

confirmWritesToggle.addEventListener("change", () => {
  chrome.storage.local.set({ [CONFIRM_WRITES_KEY]: confirmWritesToggle.checked });
});

// ─── Allowed origins ──────────────────────────────────────────────────────────
function renderOrigins(origins: string[]): void {
  originsList.innerHTML = "";
  if (origins.length === 0) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="empty-hint">All origins allowed</span>`;
    originsList.appendChild(li);
    return;
  }
  for (const origin of origins) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = origin;
    const btn = document.createElement("button");
    btn.className = "remove-btn";
    btn.textContent = "✕";
    btn.addEventListener("click", () => {
      const updated = origins.filter((o) => o !== origin);
      chrome.storage.local.set({ [ALLOWED_ORIGINS_KEY]: updated }, () => renderOrigins(updated));
    });
    li.appendChild(span);
    li.appendChild(btn);
    originsList.appendChild(li);
  }
}

chrome.storage.local.get([ALLOWED_ORIGINS_KEY], (result) => {
  renderOrigins((result[ALLOWED_ORIGINS_KEY] as string[] | undefined) ?? []);
});

addOriginBtn.addEventListener("click", () => {
  const raw = originInput.value.trim();
  if (!raw) return;
  let origin: string;
  try {
    origin = new URL(raw).origin;
  } catch {
    origin = raw; // allow plain origins like "https://example.com"
  }
  chrome.storage.local.get([ALLOWED_ORIGINS_KEY], (result) => {
    const current = (result[ALLOWED_ORIGINS_KEY] as string[] | undefined) ?? [];
    if (current.includes(origin)) return;
    const updated = [...current, origin];
    chrome.storage.local.set({ [ALLOWED_ORIGINS_KEY]: updated }, () => {
      renderOrigins(updated);
      originInput.value = "";
    });
  });
});
