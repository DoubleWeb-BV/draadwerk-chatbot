class ChatWidget {
    constructor(webhookURL, sessionId, userId) {
        this.webhookURL = webhookURL;
        this.sessionId = sessionId;
        this.userId = userId;
        this.isOpen = false;
        this.lastBotMessage = null;
        this.init();
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
        thumbsUp?.addEventListener('click', () => this.handleFeedback(true));
        thumbsDown?.addEventListener('click', () => this.handleFeedback(false));
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

    openChat() {
        const container = document.getElementById('chatContainer');
        container?.classList.add('chat-widget__container--open');
        this.isOpen = true;
        setTimeout(() => document.getElementById('chatInput')?.focus(), 300);
    }

    closeChat() {
        document.getElementById('chatContainer')?.classList.remove('chat-widget__container--open');
        this.isOpen = false;
    }

    showTooltip() {
        setTimeout(() => {
            document.getElementById('chatTooltip')?.classList.add('chat-widget__tooltip--visible');
        }, 5000);
    }

    startPulseAnimation() {
        setTimeout(() => {
            document.getElementById('chatButton')?.classList.add('chat-widget__button--pulse');
        }, 10000);
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
                    type: 'message',
                    question: message,
                    sessionId: this.sessionId,
                    channel: "website",
                    ...(this.userId && { userId: this.userId })
                })
            });

            const { text } = await res.json();
            this.hideTypingIndicator();
            const botMessage = this.addMessage('bot', (text || 'Geen antwoord ontvangen.').replace(/\n/g, '<br>'));
            this.lastBotMessage = botMessage;
        } catch (err) {
            this.hideTypingIndicator();
            const botMessage = this.addMessage('bot', 'Er ging iets mis.');
            this.lastBotMessage = botMessage;
        }
    }

    addMessage(type, htmlText) {
        const msg = document.createElement('div');
        msg.className = `chat-widget__message chat-widget__message--${type}`;
        msg.innerHTML = htmlText;
        const container = document.getElementById('chatMessages');
        container.appendChild(msg);
        container.scrollTop = container.scrollHeight;

        if (type === 'bot') {
            this.lastBotMessage = msg;
        }

        return msg;
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
        document.getElementById('chatMessages')?.appendChild(indicator);
        document.getElementById('chatMessages').scrollTop = document.getElementById('chatMessages').scrollHeight;
    }

    hideTypingIndicator() {
        document.getElementById('typingIndicator')?.remove();
    }

    handleFeedback(isUseful) {
        const thumbsUp = document.getElementById('thumbsUp');
        const thumbsDown = document.getElementById('thumbsDown');

        if (thumbsUp.disabled || thumbsDown.disabled) {
            this.addMessage('bot', 'Stel eerst een vraag zodat ik je kan helpen voordat je feedback geeft. 🙂');
            return;
        }

        thumbsUp.classList.remove('chat-widget__feedback-btn--active');
        thumbsDown.classList.remove('chat-widget__feedback-btn--active');

        if (isUseful) {
            thumbsUp.classList.add('chat-widget__feedback-btn--active');
            this.addMessage('bot', 'Dank je! Fijn dat ik je kon helpen. 😊');
        } else {
            thumbsDown.classList.add('chat-widget__feedback-btn--active');
            this.addMessage('bot', 'Sorry dat dit niet nuttig was. Kan ik je op een andere manier helpen?');
        }

        // Disable feedback buttons after use
        thumbsUp.setAttribute('disabled', true);
        thumbsDown.setAttribute('disabled', true);

        const feedbackLabel = isUseful ? 'successful' : 'unsuccessful';

        fetch(this.webhookURL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'feedback',
                feedback: feedbackLabel,
                sessionId: this.sessionId,
                ...(this.userId && { userId: this.userId })
            })
        }).catch(err => {
            console.error('Feedback verzenden mislukt:', err);
        });
    }



    handleContact() {
        this.addMessage('bot', `Perfect! Je kunt direct contact opnemen via:<br>📞 Telefoon: 010-123-4567<br>📧 Email: info@draadwerk.nl<br><br>Of ik kan zorgen dat iemand je terugbelt. Wat heeft jouw voorkeur?`);
    }
}
