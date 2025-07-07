// chatbot-loader.js
(async function () {
    const timestamp = Date.now();

    const cssURL  = `chat.css?ts=${timestamp}`;
    const htmlURL = `chat.html?ts=${timestamp}`;
    const jsURL   = `chat.js?ts=${timestamp}`;

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