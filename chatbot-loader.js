// chatbot-loader.js (compact, alleen doorgeven van websiteId + typing opties)
(async function () {
    const ts = Date.now();

    // 1) Vind het <script> dat dit loader-bestand laadt
    const currentScript = document.currentScript || [...document.scripts].pop();

    // 2) Versie uit de URL halen (jsdelivr @vX.Y.Z), val terug op 'latest'
    const src = currentScript.src || "";
    const m = src.match(/@([^/]+)\/chatbot-loader\.js/);
    const version = m ? m[1] : "latest";
    const base = `https://cdn.jsdelivr.net/gh/DoubleWeb-BV/draadwerk-chatbot@${version}/`;

    // 3) Bestanden
    const cssURL  = `${base}chat.css?ts=${ts}`;
    const htmlURL = `${base}chat.html?ts=${ts}`;
    const jsURL   = `${base}chat.js?ts=${ts}`;

    // 4) Lees data-attributen (websiteId is VERPLICHT voor jouw flow)
    const streamWebhook = currentScript.dataset.streamWebhook
        || "https://workflows.draadwerk.nl/webhook/6d7815bf-da68-4e19-81c2-0575a091afba";

    const userId    = currentScript.dataset.userId || null;
    const websiteId = currentScript.dataset.websiteId || null; // <- MOET gevuld zijn
    const typeDelayMs  = Number(currentScript.dataset.typeDelayMs)  || 8;
    const charsPerTick = Number(currentScript.dataset.charsPerTick) || 2;

    if (!websiteId) {
        console.warn("[Chatbot Loader] 'data-website-id' ontbreekt. chat.js zal null posten.");
    }

    // 5) Unieke sessie-id (1x per browser)
    const LS_KEY = "dwChat:sessionId";
    let sessionId = localStorage.getItem(LS_KEY);
    if (!sessionId) {
        sessionId = "session-" + Date.now() + "-" + Math.random().toString(36).slice(2, 11);
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

        // 6) Start ChatWidget met websiteId als 4e argument
        if (typeof ChatWidget !== "undefined") {
            new ChatWidget(
                streamWebhook,           // 1: streaming webhook (NDJSON)
                sessionId,               // 2: sessionId
                userId,                  // 3: userId (optioneel, chat.js stuurt dit NIET naar config)
                websiteId,               // 4: websiteId  ✅ BELANGRIJK
                { typeDelayMs, charsPerTick } // 5: typing FX
            );
        } else {
            console.error("[Chatbot Loader] ChatWidget niet gevonden.");
        }
    } catch (err) {
        console.error("[Chatbot Loader] Fout bij laden:", err);
    }
})();
