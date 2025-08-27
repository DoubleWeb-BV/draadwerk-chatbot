// chatbot-loader.js
(async function () {
    const t = Date.now();

    const currentScript = document.currentScript || [...document.scripts].pop();
    const src = currentScript?.src || "";
    const ver = (src.match(/@([^/]+)\/chatbot-loader\.js/) || [,"latest"])[1];
    const BASE = `https://cdn.jsdelivr.net/gh/DoubleWeb-BV/draadwerk-chatbot@${ver}/`;

    const cssURL  = `${BASE}chat.css?ts=${t}`;
    const htmlURL = `${BASE}chat.html?ts=${t}`;
    const jsURL   = `${BASE}chat.js?ts=${t}`;

    // IDs from attributes (back-compat: fall back to userId)
    const WEBSITE_ID = currentScript?.dataset?.websiteId || currentScript?.dataset?.userId || null;
    const USER_ID    = currentScript?.dataset?.userId || null;

    // ---- Endpoints ----
    // 1) Streaming webhook (NDJSON)
    const STREAM_WEBHOOK  = "https://workflows.draadwerk.nl/webhook/6d7815bf-da68-4e19-81c2-0575a091afba";
    // 2) Config webhook (set here in the loader)
    const CONFIG_WEBHOOK_DEFAULT = "https://workflows.draadwerk.nl/webhook-test/fdfc5f47-4bf7-4681-9d5e-ed91ae318526g";
    // optional override via data-config-webhook (keeps flexibility)
    const CONFIG_WEBHOOK = (currentScript?.dataset?.configWebhook?.trim()) || CONFIG_WEBHOOK_DEFAULT;

    // Typing defaults
    const TYPE_DELAY_MS  = Number.isFinite(Number(currentScript?.dataset?.typeDelay)) ? Number(currentScript.dataset.typeDelay) : 8;
    const CHARS_PER_TICK = Number.isFinite(Number(currentScript?.dataset?.charsPerTick)) ? Number(currentScript.dataset.charsPerTick) : 2;

    // Fresh session id (widget will persist/override if one already exists)
    const sessionId = ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );

    try {
        // Load CSS
        await new Promise((res, rej) => {
            const l = document.createElement("link");
            l.rel = "stylesheet";
            l.href = cssURL;
            l.onload = res; l.onerror = rej;
            document.head.appendChild(l);
        });

        // Inject HTML
        const html = await fetch(htmlURL).then(r => r.ok ? r.text() : Promise.reject("chat.html not found"));
        const wrap = document.createElement("div");
        wrap.innerHTML = html;
        document.body.appendChild(wrap);

        // Load chat.js
        await new Promise((res, rej) => {
            const s = document.createElement("script");
            s.src = jsURL;
            s.onload = res; s.onerror = rej;
            document.body.appendChild(s);
        });

        if (typeof ChatWidget !== "function") {
            console.error("[Chatbot Loader] ChatWidget niet gevonden.");
            return;
        }

        // Init widget
        new ChatWidget(
            STREAM_WEBHOOK,
            sessionId,
            USER_ID,      // optional
            WEBSITE_ID,   // REQUIRED for your flows
            {
                typeDelayMs:  TYPE_DELAY_MS,
                charsPerTick: CHARS_PER_TICK,
                configWebhookURL: CONFIG_WEBHOOK  // <— comes from loader
            }
        );

    } catch (e) {
        console.error("[Chatbot Loader] Fout bij laden:", e);
    }
})();
