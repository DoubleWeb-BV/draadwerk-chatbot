class ChatWidget {
    constructor(webhookURL, sessionId = null, userId = null) {
        this.webhookURL = webhookURL;
        this.userId = userId;
        this.isOpen = false;

        // ✅ Sessie ID ophalen of aanmaken
        const storedId = localStorage.getItem('chatSessionId');
        if (storedId) {
            this.sessionId = storedId;
            this.sessionWasActive = true;
        } else {
            this.sessionId = sessionId || this.generateSessionId();
            this.sessionWasActive = false;
            localStorage.setItem('chatSessionId', this.sessionId);
        }

        this.previousSessionMessageShown = false;
        this.init();
    }

    generateSessionId() {
        return 'session_' + Math.random().toString(36).substr(2, 9);
    }

    init() {
        this.bindEvents();
        this.showTooltip();
        this.startPulseAnimation();
    }

    bindEvents() {
        const chatButton = document.getElementById('chatButton');
        const chatClose = document.getElementById('chatClose');
        const chatSend = document.getElementById('chatSend');
        const chatInput = document.getElementById('chatInput');
        const thumbsUp = document.getElementById('thumbsUp');
        const thumbsDown = document.getElementById('thumbsDown');
        const contactBtn = document.getElementById('contactBtn');

        chatButton?.addEventListener('click', () => this.toggleChat());
        chatClose?.addEventListener('click', () => this.closeChat());
        chatSend?.addEventListener('click', () => this.sendMessage());
        thumbsUp?.addEventListener('click', () => this.handleFeedback('up'));
        thumbsDown?.addEventListener('click', () => this.handleFeedback('down'));
        contactBtn?.addEventListener('click', () => this.handleContact());

        chatInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        chatInput?.addEventListener('input', (e) => {
            e.target.style.height = 'auto';
            e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px';
            chatSend.disabled = e.target.value.trim().length === 0;
        });
    }

    toggleChat() {
        this.isOpen ? this.closeChat() : this.openChat();
    }

    async openChat() {
        const container = document.getElementById('chatContainer');
        container?.classList.add('chat-widget__container--open');
        this.isOpen = true;

        setTimeout(() => document.getElementById('chatInput')?.focus(), 300);

        // Welkomstbericht tonen
        let welcomeMessage = `Hallo! 👋 Ik ben Michael van Draadwerk. Als AI-assistent help ik je graag verder. Hoe kan ik je vandaag helpen?`;

        if (this.sessionWasActive && !this.previousSessionMessageShown) {
            welcomeMessage += `<br><br><a href="#" id="restoreChatLink">👉 Vorige chat openen</a>`;
            this.previousSessionMessageShown = true;
        }

        this.addMessage('bot', welcomeMessage);

        // Event listener voor herstel-link
        setTimeout(() => {
            const restoreLink = document.getElementById('restoreChatLink');
            if (restoreLink) {
                restoreLink.addEventListener('click', async (e) => {
                    e.preventDefault();
                    restoreLink.remove();
                    this.addMessage('bot', '📂 Vorige chat wordt geladen...');
                    await this.fetchPreviousMessages();
                });
            }
        }, 100);
    }

    closeChat() {
        document.getElementById('chatContainer')?.classList.remove('chat-widget__container--open');
        this.isOpen = false;
    }

    async sendMessage() {
        const input = document.getElementById('chatInput');
        const message = input.value.trim();
        if (!message) return;

        this.addMessage('user', message);
        input.value = '';
        input.style.height = 'auto';
        document.getElementById('chatSend').disabled = true;

        this.showTypingIndicator();

        try {
            const res = await fetch(this.webhookURL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question: message,
                    sessionId: this.sessionId,
                    channel: "website",
                    ...(this.userId && { userId: this.userId })
                })
            });

            const { text } = await res.json();
            this.hideTypingIndicator();
            this.addMessage('bot', (text || 'Geen antwoord ontvangen.').replace(/\n/g, '<br>'));
        } catch (err) {
            this.hideTypingIndicator();
            this.addMessage('bot', 'Er ging iets mis.');
        }
    }

    async fetchPreviousMessages() {
        try {
            const res = await fetch(`${this.webhookURL}/history?sessionId=${this.sessionId}`);
            if (!res.ok) return;

            const { messages } = await res.json();
            if (Array.isArray(messages)) {
                for (const msg of messages) {
                    this.addMessage(msg.type, msg.text.replace(/\n/g, '<br>'));
                }
            }
        } catch (err) {
            console.warn('Geen eerdere berichten opgehaald:', err);
        }
    }

    addMessage(type, htmlText) {
        const msg = document.createElement('div');
        msg.className = `chat-widget__message chat-widget__message--${type}`;
        msg.innerHTML = htmlText;
        const container = document.getElementById('chatMessages');
        container.appendChild(msg);
        container.scrollTop = container.scrollHeight;
    }

    showTypingIndicator() {
        const indicator = document.createElement('div');
        indicator.id = 'typingIndicator';
        indicator.className = 'chat-widget__typing chat-widget__typing--visible';
        indicator.innerHTML = `
            <div class="chat-widget__typing-dot"></div>
            <div class="chat-widget__typing-dot"></div>
            <div class="chat-widget__typing-dot"></div>
        `;
        const container = document.getElementById('chatMessages');
        container.appendChild(indicator);
        container.scrollTop = container.scrollHeight;
    }

    hideTypingIndicator() {
        document.getElementById('typingIndicator')?.remove();
    }

    handleFeedback(type) {
        const thumbsUp = document.getElementById('thumbsUp');
        const thumbsDown = document.getElementById('thumbsDown');
        thumbsUp.classList.remove('chat-widget__feedback-btn--active');
        thumbsDown.classList.remove('chat-widget__feedback-btn--active');

        if (type === 'up') {
            thumbsUp.classList.add('chat-widget__feedback-btn--active');
            this.addMessage('bot', 'Dank je! Fijn dat ik je kon helpen. 😊');
        } else {
            thumbsDown.classList.add('chat-widget__feedback-btn--active');
            this.addMessage('bot', 'Sorry dat dit niet nuttig was. Kan ik je op een andere manier helpen?');
        }
    }

    handleContact() {
        this.addMessage('bot', `Perfect! Je kunt direct contact opnemen via:<br>📞 Telefoon: 010-123-4567<br>📧 Email: info@draadwerk.nl<br><br>Of ik kan zorgen dat iemand je terugbelt. Wat heeft jouw voorkeur?`);
    }
}
