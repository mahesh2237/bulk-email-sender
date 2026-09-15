import type { PlasmoCSConfig } from "plasmo";

export const config: PlasmoCSConfig = {
  matches: ["https://mail.google.com/*"],
  all_frames: false
};

console.log("[BulkEmail] Gmail Automator content script active on", window.location.href);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface ComposeElements {
  dialog: HTMLElement;
  subjectInput: HTMLInputElement;
  bodyElement: HTMLElement;
}

/**
 * Locate or open Gmail compose window
 */
async function getOrOpenCompose(): Promise<ComposeElements> {
  // Check if a compose dialog is already open and visible
  let subjectInput = document.querySelector<HTMLInputElement>('input[name="subjectbox"]');
  if (subjectInput && subjectInput.offsetParent !== null) {
    const dialog = (subjectInput.closest('div[role="dialog"]') || subjectInput.closest('div.M9') || document.body) as HTMLElement;
    const bodyElement = dialog.querySelector<HTMLElement>('div[role="textbox"], div[g_editable="true"], div.Am.Al.editable');
    if (bodyElement) {
      return { dialog, subjectInput, bodyElement };
    }
  }

  // Click Compose button
  const composeSelectors = [
    'div[role="button"][gh="cm"]',
    'div.T-I.T-I-KE.L3',
    'div[role="button"][data-tooltip*="Compose"]',
    'div[role="button"][aria-label*="Compose"]',
    'div[aria-label*="compose" i]'
  ];

  let clicked = false;
  for (const sel of composeSelectors) {
    const btn = document.querySelector<HTMLElement>(sel);
    if (btn && btn.offsetParent !== null) {
      btn.click();
      clicked = true;
      break;
    }
  }

  if (!clicked) {
    // Fallback: update hash
    window.location.hash = "#inbox?compose=new";
  }

  // Wait for compose elements to render
  const start = Date.now();
  while (Date.now() - start < 12000) {
    subjectInput = document.querySelector<HTMLInputElement>('input[name="subjectbox"]');
    if (subjectInput && subjectInput.offsetParent !== null) {
      const dialog = (subjectInput.closest('div[role="dialog"]') || subjectInput.closest('div.M9') || document.body) as HTMLElement;
      const bodyElement = dialog.querySelector<HTMLElement>('div[role="textbox"], div[g_editable="true"], div.Am.Al.editable');
      if (bodyElement) {
        await sleep(350);
        return { dialog, subjectInput, bodyElement };
      }
    }
    await sleep(250);
  }

  throw new Error("Could not open Gmail Compose window. Make sure you are in Gmail inbox.");
}

/**
 * Set the recipient email address
 */
async function setRecipient(dialog: HTMLElement, email: string): Promise<void> {
  // Try finding To input directly
  let toInput = dialog.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    'input[peoplekit-id], input.agP, input[role="combobox"], textarea[name="to"], input[name="to"]'
  );

  if (!toInput) {
    // If To area is collapsed, click the recipient container
    const toLabel = dialog.querySelector<HTMLElement>(
      'div[name="to"], div.aoD, td.eV, span[data-tooltip*="To"], div[aria-label*="To"]'
    );
    if (toLabel) {
      toLabel.click();
      await sleep(250);
      toInput = dialog.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        'input[peoplekit-id], input.agP, input[role="combobox"], input[name="to"]'
      );
    }
  }

  if (!toInput) {
    // Fallback: Any input that is not subjectbox
    const allInputs = Array.from(dialog.querySelectorAll<HTMLInputElement>('input'));
    toInput = allInputs.find((i) => i.name !== "subjectbox" && !i.getAttribute("aria-label")?.includes("Subject")) || null;
  }

  if (!toInput) {
    throw new Error("Could not locate 'To' recipient input field in Gmail Compose.");
  }

  toInput.focus();
  toInput.value = email;
  toInput.dispatchEvent(new Event("input", { bubbles: true }));
  toInput.dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(150);

  // Press Enter & Comma to create email chip
  toInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
  toInput.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
  await sleep(100);
  toInput.dispatchEvent(new KeyboardEvent("keydown", { key: ",", code: "Comma", keyCode: 188, which: 188, bubbles: true }));
  await sleep(200);
}

/**
 * Set Subject
 */
async function setSubject(subjectInput: HTMLInputElement, subject: string): Promise<void> {
  subjectInput.focus();
  subjectInput.value = subject;
  subjectInput.dispatchEvent(new Event("input", { bubbles: true }));
  subjectInput.dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(150);
}

/**
 * Set Message Body
 */
async function setBody(bodyElement: HTMLElement, body: string, bodyHTML?: string): Promise<void> {
  bodyElement.focus();
  if (bodyHTML) {
    bodyElement.innerHTML = bodyHTML;
  } else {
    const formatted = body
      .split(/\n/)
      .map((line) => (line.trim() ? `<div>${line}</div>` : `<div><br></div>`))
      .join("");
    bodyElement.innerHTML = formatted;
  }
  bodyElement.dispatchEvent(new Event("input", { bubbles: true }));
  await sleep(250);
}

/**
 * Send email and wait for completion
 */
async function clickSend(dialog: HTMLElement): Promise<void> {
  const sendSelectors = [
    'div[role="button"][data-tooltip*="Send"]',
    'div[role="button"][aria-label*="Send"]',
    'div[aria-label*="send" i]',
    'div.T-I.J-J5-Ji.aoO.v7.T-I-atl.L3'
  ];

  let sendBtn: HTMLElement | null = null;
  for (const sel of sendSelectors) {
    sendBtn = dialog.querySelector<HTMLElement>(sel);
    if (sendBtn && sendBtn.offsetParent !== null) break;
  }

  if (sendBtn) {
    sendBtn.click();
  } else {
    // Keyboard shortcut Ctrl+Enter / Cmd+Enter
    const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
    dialog.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      ctrlKey: !isMac,
      metaKey: isMac,
      bubbles: true
    }));
  }

  // Wait for dialog or subjectbox to disappear
  const start = Date.now();
  while (Date.now() - start < 9000) {
    const subjectbox = dialog.querySelector('input[name="subjectbox"]');
    if (!subjectbox || !document.contains(dialog) || dialog.offsetParent === null) {
      await sleep(500);
      return;
    }

    const toasts = document.querySelectorAll('div.b8.UC, div[role="alert"], span.bAq');
    for (const t of Array.from(toasts)) {
      const text = t.textContent?.toLowerCase() || "";
      if (text.includes("message sent") || text.includes("sending")) {
        await sleep(500);
        return;
      }
    }

    await sleep(250);
  }
}

/**
 * Handle incoming message requests from extension background
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CHECK_GMAIL_STATUS") {
    sendResponse({
      isGmail: true,
      ready: true,
      url: window.location.href
    });
    return true;
  }

  if (message.type === "SEND_SINGLE_EMAIL") {
    const { recipient, subject, body, bodyHTML } = message.payload;

    (async () => {
      try {
        console.log(`[BulkEmail] Preparing compose for ${recipient}...`);
        const { dialog, subjectInput, bodyElement } = await getOrOpenCompose();
        await setRecipient(dialog, recipient);
        await setSubject(subjectInput, subject);
        await setBody(bodyElement, body, bodyHTML);
        await sleep(350);
        await clickSend(dialog);
        console.log(`[BulkEmail] Successfully sent to ${recipient}`);
        sendResponse({ success: true });
      } catch (err: any) {
        console.error(`[BulkEmail] Error sending to ${recipient}:`, err);
        sendResponse({ success: false, error: err?.message || String(err) });
      }
    })();

    return true;
  }

  if (message.type === "DISCARD_ACTIVE_COMPOSE") {
    (async () => {
      try {
        const discardBtns = document.querySelectorAll<HTMLElement>(
          'div[data-tooltip*="Discard draft"], div[aria-label*="Discard draft"]'
        );
        for (const btn of Array.from(discardBtns)) {
          btn.click();
        }
        sendResponse({ success: true });
      } catch (e: any) {
        sendResponse({ success: false, error: e?.message });
      }
    })();
    return true;
  }
});
