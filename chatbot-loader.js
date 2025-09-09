// chatbot-loader.js (compact + centralized URLs via data-attributes)
(async function () {
    const ts = Date.now();

    // 1) Current script
    const currentScript = document.currentScript || [...document.scripts].pop();

    // 2) Version from jsDelivr URL (falls back to "latest")
    const src = currentScript.src || "";
    const m = src.match(/@([^/]+)\/chatbot-loader\.js/);
    const version = m ? m[1] : "latest";
    const base = `https://cdn.jsdelivr.net/gh/DoubleWeb-BV/draadwerk-chatbot@${version}/`;

    // 3) Assets
    const cssURL  = `${base}chat.css?ts=${ts}`;
    const htmlURL = `${base}chat.html?ts=${ts}`;
    const jsURL   = `${base}chat.js?ts=${ts}`;

    // 4) Read data-attributes (both webhooks can be overridden from HTML)
    const streamWebhook =
        currentScript.dataset.streamWebhook ||
        "https://workflows.draadwerk.nl/webhook/6d7815bf-da68-4e19-81c2-0575a091afba";

    const configWebhook =
        currentScript.dataset.configWebhook ||
        "https://workflows.draadwerk.nl/webhook/fdfc5f47-4bf7-4681-9d5e-ed91ae318526g";

    const userId       = currentScript.dataset.userId || null;
    const websiteId    = currentScript.dataset.websiteId || null; // required by your backend
    const typeDelayMs  = Number(currentScript.dataset.typeDelayMs)  || 8;
    const charsPerTick = Number(currentScript.dataset.charsPerTick) || 2;

    if (!websiteId) {
        console.warn("[Chatbot Loader] 'data-website-id' ontbreekt. chat.js zal null posten.");
    }

    // 5) Persistent session UUID (one per browser)
    const LS_KEY = "dwChat:sessionId";
    let sessionId = localStorage.getItem(LS_KEY);
    if (!sessionId) {
        sessionId = (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
            ? crypto.randomUUID()
            : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                const r = Math.random() * 16 | 0;
                const v = c === 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        localStorage.setItem(LS_KEY, sessionId);
    }

    try {
        // CSS
        await new Promise((resolve, reject) => {
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.href = cssURL;
            link.onload = resolve;
            link.onerror = reject;
            document.head.appendChild(link);
        });

        // HTML
        const html = await fetch(htmlURL).then(r => r.text());
        const wrapper = document.createElement("div");
        wrapper.innerHTML = html;
        document.body.appendChild(wrapper);

        // JS (chat.js)
        await new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = jsURL;
            s.onload = resolve;
            s.onerror = reject;
            document.body.appendChild(s);
        });

        // 6) Boot ChatWidget
        if (typeof ChatWidget !== "undefined") {
            new ChatWidget(
                streamWebhook,           // 1: streaming webhook (NDJSON)
                sessionId,               // 2: sessionId (UUID)
                userId,                  // 3: userId (optional)
                websiteId,               // 4: websiteId (required by your config flow)
                { typeDelayMs, charsPerTick, configWebhook } // 5: options incl. centralized config webhook
            );
        } else {
            console.error("[Chatbot Loader] ChatWidget niet gevonden.");
        }
    } catch (err) {
        console.error("[Chatbot Loader] Fout bij laden:", err);
    }
})();
