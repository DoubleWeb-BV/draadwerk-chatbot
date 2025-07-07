// chatbot-loader.js
(async function () {
    const timestamp = Date.now();

    const cssURL  = `https://cdn.jsdelivr.net/gh/DoubleWeb-BV/draadwerk-chatbot@v1.0.29/chat.css?ts=${timestamp}`;
    const htmlURL = `https://cdn.jsdelivr.net/gh/DoubleWeb-BV/draadwerk-chatbot@v1.0.29/chat.html?ts=${timestamp}`;
    const jsURL   = `https://cdn.jsdelivr.net/gh/DoubleWeb-BV/draadwerk-chatbot@v1.0.29/chat.js?ts=${timestamp}`;

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