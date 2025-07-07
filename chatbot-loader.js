(async function () {
    const timestamp = Date.now();

    // Stap 1: Bepaal het script dat zichzelf aanroept
    const currentScript = document.currentScript || [...document.scripts].pop();
    const scriptSrc = currentScript.src;
    const versionMatch = scriptSrc.match(/@([^/]+)\/chatbot-loader\.js/);
    const version = versionMatch ? versionMatch[1] : 'latest';
    const baseCDN = `https://cdn.jsdelivr.net/gh/DoubleWeb-BV/draadwerk-chatbot@${version}/`;

    const cssURL  = `${baseCDN}chat.css?ts=${timestamp}`;
    const htmlURL = `${baseCDN}chat.html?ts=${timestamp}`;
    const jsURL   = `${baseCDN}chat.js?ts=${timestamp}`;
    const imgURL  = `${baseCDN}profile.jpg?ts=${timestamp}`;

    try {
        // CSS injecteren en wachten tot geladen
        await new Promise((resolve, reject) => {
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.href = cssURL;
            link.onload = () => {
                console.log("[Chatbot Loader] CSS geladen");
                resolve();
            };
            link.onerror = reject;
            document.head.appendChild(link);
        });

        // HTML injecteren
        const html = await fetch(htmlURL).then(r => r.text());
        const wrapper = document.createElement("div");
        wrapper.innerHTML = html;
        document.body.appendChild(wrapper);
        console.log("[Chatbot Loader] HTML geïnjecteerd");

        // Profielfoto instellen
        const profileImage = document.getElementById('js-profile-image');
        if (profileImage) {
            profileImage.src = imgURL;
            profileImage.onerror = () => {
                console.warn("[Chatbot Loader] Profielfoto niet gevonden, gebruik fallback.");
                profileImage.src = 'https://via.placeholder.com/40?text=?';
            };
        }

        const profileImage_2 = document.getElementById('js-profile-image-2');
        if (profileImage_2) {
            profileImage_2.src = imgURL;
            profileImage_2.onerror = () => {
                console.warn("[Chatbot Loader] Profielfoto niet gevonden, gebruik fallback.");
                profileImage_2.src = 'https://via.placeholder.com/40?text=?';
            };
        }

        // JS laden en pas daarna initialiseren
        await new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = jsURL;
            script.onload = () => {
                console.log("[Chatbot Loader] JS geladen");

                // ChatWidget initialiseren
                const sessionId = ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
                    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
                );
                const userId = null;
                const webhookURL = 'https://workflows.draadwerk.nl/webhook/draadwerk-chatbot-v2';

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
