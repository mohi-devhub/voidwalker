import { TOKEN_KEY } from "../shared/constants";

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
