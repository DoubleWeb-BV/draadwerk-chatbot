// chatbot-loader.js
(async function () {
    const timestamp = Date.now();

    // 1) Bepaal verwijzende <script> element (met data-attributes)
    const currentScript = document.currentScript || [...document.scripts].pop();
    const scriptSrc = currentScript?.src || "";
    const versionMatch = scriptSrc.match(/@([^/]+)\/chatbot-loader\.js/);
    const version = versionMatch ? versionMatch[1] : "latest";
    const baseCDN = `https://cdn.jsdelivr.net/gh/DoubleWeb-BV/draadwerk-chatbot@${version}/`;

    const cssURL  = `${baseCDN}chat.css?ts=${timestamp}`;
    const htmlURL = `${baseCDN}chat.html?ts=${timestamp}`;
    const jsURL   = `${baseCDN}chat.js?ts=${timestamp}`;

    // 2) Lees instellingen uit data-attributes
    const userId        = currentScript?.dataset?.userId || null;
    let websiteId       = currentScript?.dataset?.websiteId || null; // <-- vereist voor jouw n8n
    const typeDelayAttr = currentScript?.dataset?.typeDelay;
    const cptAttr       = currentScript?.dataset?.charsPerTick;

    // Backwards-compat (optioneel): gebruik userId als websiteId indien websiteId ontbreekt
    if (!websiteId && userId) websiteId = userId;

    // Defaults zoals gevraagd: 8ms / 2 chars
    const typingOpts = {
        typeDelayMs:  Number.isFinite(Number(typeDelayAttr)) ? Number(typeDelayAttr) : 8,
        charsPerTick: Number.isFinite(Number(cptAttr))       ? Number(cptAttr)       : 2,
    };

    // 3) Streaming webhook (NDJSON) – dit is de endpoint voor de AI-antwoord-stream
    const STREAM_WEBHOOK = "https://workflows.draadwerk.nl/webhook/6d7815bf-da68-4e19-81c2-0575a091afba";

    // 4) Maak sessie-id (stabiel per page-load)
    const sessionId = ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );

    try {
        // CSS injecteren
        await new Promise((resolve, reject) => {
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.href = cssURL;
            link.onload = () => resolve();
            link.onerror = reject;
            document.head.appendChild(link);
        });

        // HTML injecteren
        const html = await fetch(htmlURL).then(r => {
            if (!r.ok) throw new Error("chat.html niet gevonden");
            return r.text();
        });
        const wrapper = document.createElement("div");
        wrapper.innerHTML = html;
        document.body.appendChild(wrapper);

        // JS laden
        await new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = jsURL;
            script.onload = () => resolve();
            script.onerror = reject;
            document.body.appendChild(script);
        });

        // Validatie websiteId
        if (!websiteId) {
            console.error("[Chatbot Loader] 'data-website-id' ontbreekt op het loader-script. Voeg deze toe aan de <script>-tag.");
        }

        // Initialiseer ChatWidget
        if (typeof ChatWidget !== "undefined") {
            // Constructor: (webhookURL, sessionId, userId, websiteId, typingOpts)
            new ChatWidget(
                STREAM_WEBHOOK,
                sessionId,
                userId,
                websiteId,
                typingOpts
            );
        } else {
            console.error("[Chatbot Loader] ChatWidget niet gevonden (chat.js laadde niet correct?).");
        }
    } catch (err) {
        console.error("[Chatbot Loader] Fout bij laden:", err);
    }
})();
