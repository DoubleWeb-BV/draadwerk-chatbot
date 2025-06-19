(function () {
    console.log("[Chatbot] Loading assets from raw.githubusercontent.com (no caching)");

    const cacheBuster = "?ts=" + Date.now();
    const cdnBase = "https://raw.githubusercontent.com/DoubleWeb-BV/draadwerk-chatbot/main/";

    // Load CSS (no caching)
    const style = document.createElement("link");
    style.rel = "stylesheet";
    style.href = cdnBase + "chat.css" + cacheBuster;
    document.head.appendChild(style);

    // Load HTML (no caching)
    fetch(cdnBase + "chat.html" + cacheBuster)
        .then(res => {
            if (!res.ok) throw new Error("Failed to load chatbot HTML");
            return res.text();
        })
        .then(html => {
            const wrapper = document.createElement("div");
            wrapper.innerHTML = html;
            document.body.appendChild(wrapper);

            // Open/close logic
            document.getElementById("chatOpenButton").addEventListener("click", function () {
                const box = document.getElementById("chatBox");
                const chat = document.getElementById("chatMessages");

                const isVisible = box.style.display === "flex";
                box.style.display = isVisible ? "none" : "flex";

                if (!isVisible && !chat.dataset.welcomeShown) {
                    const welcome = document.createElement("div");
                    welcome.className = "chat-bubble bot-message";
                    welcome.innerHTML = `Hoi! 👋 Welkom bij DoubleWeb.<br>
                        Stel gerust je vraag over websites, onderhoud, support of iets anders — ik denk graag met je mee.`;
                    chat.appendChild(welcome);
                    chat.dataset.welcomeShown = "true";
                }
            });

            // Chat form logic
            const form = document.getElementById("chatForm");
            const chat = document.getElementById("chatMessages");
            const input = document.getElementById("chatInput");

            form.addEventListener("submit", async function (e) {
                e.preventDefault();
                const message = input.value.trim();
                if (!message) return;

                const userBubble = document.createElement("div");
                userBubble.className = "chat-bubble user-message";
                userBubble.textContent = message;
                chat.appendChild(userBubble);
                chat.scrollTop = chat.scrollHeight;
                input.value = "";

                try {
                    const endpoint = "https://workflows.draadwerk.nl/webhook/draadwerk-chatbot";
                    const response = await fetch(endpoint, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ question: message })
                    });

                    const raw = await response.json();
                    const text = raw?.text || "Geen antwoord ontvangen.";

                    const botBubble = document.createElement("div");
                    botBubble.className = "chat-bubble bot-message";
                    botBubble.innerHTML = text.replace(/\n/g, "<br>");
                    chat.appendChild(botBubble);
                    chat.scrollTop = chat.scrollHeight;
                } catch {
                    const errBubble = document.createElement("div");
                    errBubble.className = "chat-bubble bot-message";
                    errBubble.textContent = "⚠️ Er ging iets mis.";
                    chat.appendChild(errBubble);
                }
            });
        })
        .catch(err => {
            console.error("[Chatbot] Error loading HTML:", err);
        });
})();
