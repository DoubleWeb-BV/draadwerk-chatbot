(function () {
    // Load CSS
    const style = document.createElement("link");
    style.rel = "stylesheet";
    style.href = "https://cdn.jsdelivr.net/gh/DoubleWeb-BV/draadwerk-chatbot@main/chat.css";
    document.head.appendChild(style);

    // Load HTML
    fetch("https://cdn.jsdelivr.net/gh/DoubleWeb-BV/draadwerk-chatbot@main/chat.html")
        .then(res => res.text())
        .then(html => {
            const wrapper = document.createElement("div");
            wrapper.innerHTML = html;
            document.body.appendChild(wrapper);

            // Setup logic
            document.getElementById("chatOpenButton").addEventListener("click", function () {
                const box = document.getElementById("chatBox");
                box.style.display = (box.style.display === "flex") ? "none" : "flex";
            });


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
                    const endpoint = window.chatbotEnv === "live"
                        ? "https://workflows.draadwerk.nl/webhook-test/draadwerk-chatbot"
                        : "https://workflows.draadwerk.nl/webhook/draadwerk-chatbot";

                    const response = await fetch(endpoint, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ question: message })
                    });

                    const data = await response.json();
                    const botBubble = document.createElement("div");
                    botBubble.className = "chat-bubble bot-message";
                    botBubble.innerHTML = data.text || "Geen antwoord ontvangen.";
                    chat.appendChild(botBubble);
                    chat.scrollTop = chat.scrollHeight;
                } catch {
                    const errBubble = document.createElement("div");
                    errBubble.className = "chat-bubble bot-message";
                    errBubble.textContent = "⚠️ Er ging iets mis.";
                    chat.appendChild(errBubble);
                }
            });
        });
})();
