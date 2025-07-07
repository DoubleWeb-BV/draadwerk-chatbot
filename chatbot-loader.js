(async function () {
    const timestamp = Date.now();

    const cssURL  = `https://cdn.jsdelivr.net/gh/DoubleWeb-BV/draadwerk-chatbot@v1.0.28/chat.css?ts=${timestamp}`;
    const htmlURL = `https://cdn.jsdelivr.net/gh/DoubleWeb-BV/draadwerk-chatbot@v1.0.28/chat.html?ts=${timestamp}`;
    const jsURL   = `https://cdn.jsdelivr.net/gh/DoubleWeb-BV/draadwerk-chatbot@v1.0.28/chat.js?ts=${timestamp}`;

    const sessionId = ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );

    // CSS
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = cssURL;
    document.head.appendChild(link);

    // HTML + JS (in volgorde!)
    try {
        const html = await fetch(htmlURL).then(r => r.text());
        const wrapper = document.createElement("div");
        wrapper.innerHTML = html;
        document.body.appendChild(wrapper);

        // JS na HTML toevoegen
        const script = document.createElement("script");
        script.src = jsURL;
        script.dataset.sessionId = sessionId;
        script.onload = () => console.log("[Chatbot] JS geladen");
        document.body.appendChild(script);
    } catch (err) {
        console.error("[Chatbot Loader] Fout bij laden:", err);
    }
})();
