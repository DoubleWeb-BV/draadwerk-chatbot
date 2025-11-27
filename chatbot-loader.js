// chatbot-loader.js
(async function () {
    const ts = Date.now();

    const currentScript = document.currentScript || [...document.scripts].pop();

    const src = currentScript.src || "";
    const m = src.match(/@([^/]+)\/chatbot-loader\.js/);
    const version = m ? m[1] : "latest";
    const base = `https://cdn.jsdelivr.net/gh/DoubleWeb-BV/draadwerk-chatbot@${version}/`;

    const cssURL  = `${base}chat.css?ts=${ts}`;
    const htmlURL = `${base}chat.html?ts=${ts}`;
    const jsURL   = `${base}chat.js?ts=${ts}`;

    // ---- Config ----
    const streamWebhook =
        currentScript.dataset.streamWebhook ||
        "https://n8n.draadwerk.nl/webhook/6d7815bf-da68-4e19-81c2-0575a091afba";

    const configWebhook =
        currentScript.dataset.configWebhook ||
        "https://n8n.draadwerk.nl/webhook/504ddb9d-465f-4d0a-9252-1547b851e5a8";

    const userId       = currentScript.dataset.userId || null;
    const websiteId    = currentScript.dataset.websiteId || null;
    const typeDelayMs  = Number(currentScript.dataset.typeDelayMs)  || 8;
    const charsPerTick = Number(currentScript.dataset.charsPerTick) || 2;

    // ---- NEW: detect language ----
    const lang =
        currentScript.dataset.lang ||
        document.documentElement.lang ||
        "nl";

    // ---- Session UUID ----
    const LS_KEY = "dwChat:sessionId";
    let sessionId = localStorage.getItem(LS_KEY);

    if (!sessionId) {
        sessionId = (crypto?.randomUUID?.()) ||
            'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
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

        // JS
        await new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = jsURL;
            s.onload = resolve;
            s.onerror = reject;
            document.body.appendChild(s);
        });


        // Boot ChatWidget
        if (typeof ChatWidget !== "undefined") {

            new ChatWidget(
                streamWebhook,
                sessionId,
                userId,
                websiteId,
                {
                    typeDelayMs,
                    charsPerTick,
                    configWebhook,
                    lang
                }
            );

        } else {
            console.error("[Chatbot Loader] ChatWidget niet gevonden.");
        }

    } catch (err) {
        console.error("[Chatbot Loader] Fout bij laden:", err);
    }
})();
