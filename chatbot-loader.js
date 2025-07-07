// chatbot-loader.js
(async function () {
    const repo = "DoubleWeb-BV/draadwerk-chatbot";
    const timestamp = Date.now();
    const sessionId = ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );

    let sha;
    try {
        const info = await fetch(`https://api.github.com/repos/${repo}/branches/main`).then(r => r.json());
        sha = info.commit.sha;
    } catch {
        sha = "main";
    }

    const cssURL = `https://cdn.jsdelivr.net/gh/DoubleWeb-BV/chat.css?ts=${timestamp}`;
    const htmlURL = `https://raw.githubusercontent.com/${repo}/${sha}/chat.html?ts=${timestamp}`;
    const jsURL = `https://raw.githubusercontent.com/${repo}/${sha}/chat.js?ts=${timestamp}`;

    // Inject CSS
    try {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = cssURL;
        document.head.appendChild(link);
    } catch (err) {
        console.error("[Chatbot] CSS injectie mislukt:", err);
    }

    // Inject HTML
    try {
        const html = await fetch(htmlURL).then(r => r.text());
        const wrapper = document.createElement("div");
        wrapper.innerHTML = html;
        document.body.appendChild(wrapper);
    } catch (err) {
        console.error("[Chatbot] HTML injectie mislukt:", err);
    }

    // Inject JS
    try {
        const script = document.createElement("script");
        script.src = jsURL;
        script.defer = true;
        script.dataset.sessionId = sessionId;
        document.body.appendChild(script);
    } catch (err) {
        console.error("[Chatbot] JS injectie mislukt:", err);
    }
})();