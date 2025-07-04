    (async function () {
    console.log("[Chatbot] Loading fresh CSS and HTML from GitHub");

    const repo = "DoubleWeb-BV/draadwerk-chatbot";
    const timestamp = Date.now();
    const sessionId = ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );

    const currentScript = document.currentScript;
    const userId = currentScript?.getAttribute("data-user-id") || null;

    let sha;
    try {
    const infoRes = await fetch(`https://api.github.com/repos/${repo}/branches/main`);
    const info = await infoRes.json();
    sha = info.commit.sha;
} catch (err) {
    console.error("[Chatbot] Failed to fetch SHA, fallback to 'main'");
    sha = "main";
}

    try {
    const cssURL = `https://raw.githubusercontent.com/${repo}/${sha}/chat.css?ts=${timestamp}`;
    const cssRes = await fetch(cssURL);
    const css = await cssRes.text();
    const style = document.createElement("style");
    style.textContent = css + `
        .fade-in {
            animation: fadeIn 0.3s ease-in forwards;
            opacity: 0;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(5px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .loading {
            display: flex;
            align-items: center;
            gap: 6px;
            height: 30px;
        }
        .loading-dot {
            width: 8px;
            height: 8px;
            background-color: #F15F27;
            border-radius: 50%;
            display: inline-block;
            transform: translateY(5px);
        }
        .loading.active .loading-dot {
            animation: bounce 1s infinite ease-in-out;
        }
        .loading.active .loading-dot:nth-of-type(1) { animation-delay: 0s; }
        .loading.active .loading-dot:nth-of-type(2) { animation-delay: 0.2s; }
        .loading.active .loading-dot:nth-of-type(3) { animation-delay: 0.4s; }

        @keyframes bounce {
            0%, 80%, 100% { transform: translateY(5px); }
            40% { transform: translateY(-5px); }
        }`;
    document.head.appendChild(style);
} catch (err) {
    console.error("[Chatbot] Failed to load CSS:", err);
}

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

    const btn = document.getElementById("chatOpenButton");
    const box = document.getElementById("chatBox");
    const chat = document.getElementById("chatMessages");
    const form = document.getElementById("chatForm");
    const input = document.getElementById("chatInput");

    const env = localStorage.getItem("chatbotEnv") === "test" ? "webhook-test" : "webhook";
    const webhookURL = `https://workflows.draadwerk.nl/${env}/draadwerk-chatbot-v2`;

    btn?.addEventListener("click", () => {
    const vis = box.style.display === "flex";
    box.style.display = vis ? "none" : "flex";
    if (!vis && !chat.dataset.welcomeShown) {
    const welcome = document.createElement("div");
    welcome.className = "chat-bubble bot-message fade-in";
    welcome.innerHTML = `Hoi! Welkom bij DoubleWeb.<br>Stel gerust je vraag over websites, onderhoud, support of iets anders – ik denk graag met je mee.`;
    chat.appendChild(welcome);
    chat.dataset.welcomeShown = "true";
}
});

    form?.addEventListener("submit", async e => {
    e.preventDefault();
    const msg = input.value.trim();
    if (!msg) return;

    const ub = document.createElement("div");
    ub.className = "chat-bubble user-message fade-in";
    ub.textContent = msg;
    chat.appendChild(ub);
    chat.scrollTop = chat.scrollHeight;
    input.value = "";

    // Loading bubble
    const loading = document.createElement("div");
    loading.className = "chat-bubble bot-message fade-in";
    loading.innerHTML = `
            <div class="loading active">
                <span class="loading-dot"></span>
                <span class="loading-dot"></span>
                <span class="loading-dot"></span>
            </div>`;
    chat.appendChild(loading);
    chat.scrollTop = chat.scrollHeight;

    try {
    const res = await fetch(webhookURL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
    question: msg,
    sessionId,
    channel: "website",
    ...(userId && { userId })
}),
});

    const { text } = await res.json();
    loading.remove();

    const bb = document.createElement("div");
    bb.className = "chat-bubble bot-message fade-in";
    const span = document.createElement("span");
    bb.appendChild(span);
    chat.appendChild(bb);
    chat.scrollTop = chat.scrollHeight;

    await typeText(span, text || "Geen antwoord ontvangen.");
    chat.scrollTop = chat.scrollHeight;

} catch {
    loading.remove();
    const err = document.createElement("div");
    err.className = "chat-bubble bot-message fade-in";
    err.textContent = "Er ging iets mis.";
    chat.appendChild(err);
}
});

    // Typing-effect functie (typewriter)
    async function typeText(container, text, delay = 20) {
    for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
    container.innerHTML += "<br>";
} else {
    container.innerHTML += text[i];
}
    await new Promise(r => setTimeout(r, delay));
}
}
})();
