(async function () {
    const timestamp = Date.now();

    const currentScript = document.currentScript || [...document.scripts].pop();
    const scriptSrc = currentScript.src;
    const versionMatch = scriptSrc.match(/@([^/]+)\/chatbot-loader\.js/);
    const version = versionMatch ? versionMatch[1] : 'latest';
    const baseCDN = `https://cdn.jsdelivr.net/gh/DoubleWeb-BV/draadwerk-chatbot@${version}/`;

    const cssURL  = `${baseCDN}chat.css?ts=${timestamp}`;
    const htmlURL = `${baseCDN}chat.html?ts=${timestamp}`;
    const jsURL   = `${baseCDN}chat.js?ts=${timestamp}`;
    // HTML
    const html = await fetch(htmlURL).then(r => r.text());
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    document.body.appendChild(wrapper);

// Profielfoto instellen
    const profileImage = document.getElementById('js-profile-image');
    if (profileImage) {
        profileImage.src = `${baseCDN}profile.jpg?ts=${timestamp}`;
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

        // JS + INIT
        await new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = jsURL;
            script.onload = () => {
                console.log("[Chatbot Loader] JS geladen");

                const sessionId = ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
                    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
                );

                const userId = null;
                const webhookURL = 'https://workflows.draadwerk.nl/webhook/draadwerk-chatbot-v2';

                // ✅ Initialiseer pas hier
                if (typeof ChatWidget !== 'undefined') {
                    new ChatWidget(webhookURL, sessionId, userId);
                }

                resolve();
            };
            script.onerror = reject;
            document.body.appendChild(script);
        });

    } catch (err) {
        console.error("[Chatbot Loader] Fout bij laden:", err);
    }
})();
