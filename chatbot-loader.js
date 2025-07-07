// chatbot-loader.js
(async function () {
    const timestamp = Date.now();

    // Stap 1: Bepaal het script dat zichzelf aanroept
    const currentScript = document.currentScript || [...document.scripts].pop();
    const scriptSrc = currentScript.src;

    // Stap 2: Haal de versie en basis-URL uit het scriptpad
    // Voorbeeld URL: https://cdn.jsdelivr.net/gh/DoubleWeb-BV/draadwerk-chatbot@v1.0.29/chatbot-loader.js
    const versionMatch = scriptSrc.match(/@([^/]+)\/chatbot-loader\.js/);
    const version = versionMatch ? versionMatch[1] : 'latest';

    const baseCDN = `https://cdn.jsdelivr.net/gh/DoubleWeb-BV/draadwerk-chatbot@${version}/`;

    // Stap 3: Bouw de URLs mét versie en timestamp
    const cssURL  = `${baseCDN}chat.css?ts=${timestamp}`;
    const htmlURL = `${baseCDN}chat.html?ts=${timestamp}`;
    const jsURL   = `${baseCDN}chat.js?ts=${timestamp}`;

    console.log(htmlURL);
    console.log(cssURL);
    console.log(jsURL);


    // CSS injecteren
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = cssURL;
    document.head.appendChild(link);

    try {
        // HTML injecteren
        const html = await fetch(htmlURL).then(r => r.text());
        const wrapper = document.createElement("div");
        wrapper.innerHTML = html;
        document.body.appendChild(wrapper);

        // JS injecteren NA HTML
        const script = document.createElement("script");
        script.src = jsURL;
        script.onload = () => {
            console.log("[Chatbot] JS geladen");
            if (window.initChat) {
                window.initChat();
            }
        };
        document.body.appendChild(script);

    } catch (err) {
        console.error("[Chatbot Loader] Fout bij laden:", err);
    }
})();