(async function () {
    console.log("[Chatbot] Loading fresh CSS and HTML from GitHub");

    const repo = "DoubleWeb-BV/draadwerk-chatbot";
    const timestamp = Date.now();

    // 🔄 1. Haal laatste commit SHA van 'main' branch op
    let sha;
    try {
        const infoRes = await fetch(`https://api.github.com/repos/${repo}/branches/main`);
        const info = await infoRes.json();
        sha = info.commit.sha;
        console.log("[Chatbot] Latest SHA:", sha);
    } catch (err) {
        console.error("[Chatbot] Failed to fetch latest SHA, fallback to 'main':", err);
        sha = "main";
    }

    // ✅ 2. Laad chat.css via SHA
    try {
        const cssURL = `https://raw.githubusercontent.com/${repo}/${sha}/chat.css?ts=${timestamp}`;
        const cssRes = await fetch(cssURL);
        const css = await cssRes.text();
        const style = document.createElement("style");
        style.textContent = css;
        document.head.appendChild(style);
    } catch (err) {
        console.error("[Chatbot] Failed to load fresh CSS:", err);
    }

    // ✅ 3. Laad chat.html via SHA
    let html;
    try {
        const htmlURL = `https://raw.githubusercontent.com/${repo}/${sha}/chat.html?ts=${timestamp}`;
        const htmlRes = await fetch(htmlURL);
        html = await htmlRes.text();
    } catch (err) {
        console.error("[Chatbot] Failed to load HTML:", err);
        return;
    }

    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    document.body.appendChild(wrapper);

    // ✅ 4. Setup Chat gedrag
    const btn = document.getElementById("chatOpenButton");
    const box = document.getElementById("chatBox");
    const chat = document.getElementById("chatMessages");
    const form = document.getElementById("chatForm");
    const input = document.getElementById("chatInput");

    // 🔁 Bepaal juiste omgeving voor webhook
    const env = localStorage.getItem("chatbotEnv") === "test" ? "webhook-test" : "webhook";
    const webhookURL = `https://workflows.draadwerk.nl/${env}/draadwerk-chatbot`;
    console.log("[Chatbot] Using webhook:", webhookURL);

    btn?.addEventListener("click", () => {
        const vis = box.style.display === "flex";
        box.style.display = vis ? "none" : "flex";
        if (!vis && !chat.dataset.welcomeShown) {
            const welcome = document.createElement("div");
            welcome.className = "chat-bubble bot-message";
            welcome.innerHTML = `Hoi! Welkom bij DoubleWeb.<br> Stel gerust je vraag over websites, onderhoud, support of iets anders ik denk graag met je mee.`;
            chat.appendChild(welcome);
            chat.dataset.welcomeShown = "true";
        }
    });

    form?.addEventListener("submit", async e => {
        e.preventDefault();
        const msg = input.value.trim();
        if (!msg) return;

        const ub = document.createElement("div");
        ub.className = "chat-bubble user-message";
        ub.textContent = msg;
        chat.appendChild(ub);
        chat.scrollTop = chat.scrollHeight;
        input.value = "";

        try {
            const res = await fetch(webhookURL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question: msg }),
            });
            const { text } = await res.json();
            const bb = document.createElement("div");
            bb.className = "chat-bubble bot-message";
            bb.innerHTML = (text || "Geen antwoord ontvangen.").replace(/\n/g, "<br>");
            chat.appendChild(bb);
            chat.scrollTop = chat.scrollHeight;
        } catch {
            const err = document.createElement("div");
            err.className = "chat-bubble bot-message";
            err.textContent = "Er ging iets mis.";
            chat.appendChild(err);
        }
    });
})();
