(async function () {
    const env = localStorage.getItem("chatbotEnv") || "live";
    const timestamp = Date.now();

    // Define the webhook URL per environment
    const webhookBase =
        env === "test"
            ? "https://workflows.draadwerk.nl/webhook-test/draadwerk-chatbot"
            : "https://workflows.draadwerk.nl/webhook/draadwerk-chatbot";

    console.log(`[Chatbot] Environment: ${env}`);
    console.log(`[Chatbot] Using webhook: ${webhookBase}`);

    // Optional: Load CSS (comment this out if already included)
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = `https://cdn.jsdelivr.net/gh/DoubleWeb-BV/draadwerk-chatbot@main/chat.css?ts=${timestamp}`;
    document.head.appendChild(css);

    // Load HTML (chatbox layout)
    let html;
    try {
        const res = await fetch(`https://cdn.jsdelivr.net/gh/DoubleWeb-BV/draadwerk-chatbot@main/chat.html?ts=${timestamp}`);
        html = await res.text();
    } catch (err) {
        console.error("[Chatbot] Failed to load HTML:", err);
        return;
    }

    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    document.body.appendChild(wrapper);

    // Setup Chat behavior
    const btn = document.getElementById("chatOpenButton");
    const box = document.getElementById("chatBox");
    const chat = document.getElementById("chatMessages");
    const form = document.getElementById("chatForm");
    const input = document.getElementById("chatInput");

    btn?.addEventListener("click", () => {
        const visible = box.style.display === "flex";
        box.style.display = visible ? "none" : "flex";
        if (!visible && !chat.dataset.welcomeShown) {
            const welcome = document.createElement("div");
            welcome.className = "chat-bubble bot-message";
            welcome.innerHTML = `Hoi! Welkom bij DoubleWeb.<br>Stel gerust je vraag over websites, onderhoud, support of iets anders — ik denk graag met je mee.`;
            chat.appendChild(welcome);
            chat.dataset.welcomeShown = "true";
        }
    });

    form?.addEventListener("submit", async e => {
        e.preventDefault();
        const msg = input.value.trim();
        if (!msg) return;

        const userBubble = document.createElement("div");
        userBubble.className = "chat-bubble user-message";
        userBubble.textContent = msg;
        chat.appendChild(userBubble);
        chat.scrollTop = chat.scrollHeight;
        input.value = "";

        try {
            const res = await fetch(webhookBase, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question: msg }),
            });

            const { text } = await res.json();
            const botBubble = document.createElement("div");
            botBubble.className = "chat-bubble bot-message";
            botBubble.innerHTML = (text || "Geen antwoord ontvangen.").replace(/\n/g, "<br>");
            chat.appendChild(botBubble);
            chat.scrollTop = chat.scrollHeight;
        } catch (err) {
            const errorBubble = document.createElement("div");
            errorBubble.className = "chat-bubble bot-message";
            errorBubble.textContent = "Er ging iets mis.";
            chat.appendChild(errorBubble);
        }
    });
})();
