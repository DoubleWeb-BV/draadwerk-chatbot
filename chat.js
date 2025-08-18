class ChatWidget {
    constructor(webhookURL, sessionId = null, userId) {
        this.webhookURL = webhookURL;
        this.groupId = this.initGroupId();                 // ← session-scoped namespace
        this.sessionId = this.loadOrCreateSessionId(sessionId);
        this.userId = userId;
        this.isOpen = false;
        this.lastBotMessage = null;
        this.chatRestored = false;
        this.init();
    }

    // ----- Session "group" that lasts only while the browser is open -----
    initGroupId() {
        // One id per *browser session* (sessionStorage survives across tabs but
        // disappears when the browser (or all windows) close)
        let gid = sessionStorage.getItem('chatWidgetGroupId');
        if (!gid) {
            gid = 'grp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
            sessionStorage.setItem('chatWidgetGroupId', gid);
        }
        // Optional: publish current group for debugging/inspection
        localStorage.setItem('chatWidgetCurrentGroupId', gid);
        return gid;
    }

    // ----- Storage helpers (namespaced in localStorage by groupId) -----
    ns(key) {
        return `${this.groupId}:${key}`;
    }
    storageGet(key) {
        return localStorage.getItem(this.ns(key));
    }
    storageSet(key, value) {
        localStorage.setItem(this.ns(key), value);
    }
    storageRemove(key) {
        localStorage.removeItem(this.ns(key));
    }

    // ----- Keys -----
    getOpenStateKey() {
        return `chatWidgetIsOpen-${this.sessionId}`;
    }
    getTooltipDismissedKey() {
        return `chatWidgetTooltipDismissed-${this.sessionId}`;
    }

    // ---------- Init ----------
    init() {
        this.bindEvents();
        this.setupCrossTabSync();    // listen for other tabs in the same browser session
        this.restoreOpenState();     // restore open/closed BEFORE tooltip logic
        this.showTooltip();
        this.startPulseAnimation();
    }

    // ---------- Events ----------
    bindEvents() {
        const chatButton = document.getElementById('chatButton');
        const chatClose = document.getElementById('chatClose');
        const chatSend = document.getElementById('chatSend');
        const chatInput = document.getElementById('chatInput');
        const thumbsUp = document.getElementById('thumbsUp');
        const thumbsDown = document.getElementById('thumbsDown');
        const contactBtn = document.getElementById('contactBtn');
        const chatTooltip = document.getElementById('chatTooltip');

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
            if (chatSend) chatSend.disabled = e.target.value.trim().length === 0;
        });

        chatTooltip?.addEventListener('click', () => {
            this.openChat();
            this.dismissTooltip();
        });
        chatTooltip?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.openChat();
                this.dismissTooltip();
            }
        });
    }

    // ---------- Cross-tab sync (same browser session) ----------
    setupCrossTabSync() {
        window.addEventListener('storage', (e) => {
            if (!e.key) return;

            // Only react to keys in *our* current session group
            const prefix = `${this.groupId}:`;
            if (!e.key.startsWith(prefix)) return;

            const rawKey = e.key.slice(prefix.length);

            // Sync open/closed state
            if (rawKey === this.getOpenStateKey()) {
                const shouldBeOpen = this.storageGet(this.getOpenStateKey()) === 'true';
                if (shouldBeOpen && !this.isOpen) this.openChat();
                if (!shouldBeOpen && this.isOpen) this.closeChat();
                return;
            }

            // Sync messages when history changes
            if (rawKey === `chatWidgetHistory-${this.sessionId}`) {
                this.chatRestored = false;
                this.restoreChatHistory();
                return;
            }

            // Sync tooltip dismissal
            if (rawKey === this.getTooltipDismissedKey()) {
                const dismissed = this.storageGet(this.getTooltipDismissedKey()) === 'true';
                if (dismissed) this.hideTooltip();
            }
        });
    }

    // ---------- Tooltip control ----------
    showTooltip() {
        setTimeout(() => {
            const dismissed = this.storageGet(this.getTooltipDismissedKey());
            if (!this.isOpen && !dismissed) {
                document.getElementById('chatTooltip')?.classList.add('chat-widget__tooltip--visible');
            }
        }, 5000);
    }

    hideTooltip() {
        document.getElementById('chatTooltip')?.classList.remove('chat-widget__tooltip--visible');
    }

    dismissTooltip() {
        const el = document.getElementById('chatTooltip');
        if (el) {
            el.classList.remove('chat-widget__tooltip--visible');
            el.style.display = 'none';
        }
        this.storageSet(this.getTooltipDismissedKey(), 'true');
    }

    startPulseAnimation() {
        setTimeout(() => {
            document.getElementById('chatButton')?.classList.add('chat-widget__button--pulse');
        }, 10000);
    }

    // ---------- Open / Close ----------
    toggleChat() {
        this.isOpen ? this.closeChat() : this.openChat();
    }

    openChat() {
        const container = document.getElementById('chatContainer');
        container?.classList.add('chat-widget__container--open');
        this.isOpen = true;

        // persist open state (shared across tabs within this browser session)
        this.storageSet(this.getOpenStateKey(), 'true');

        this.hideTooltip();
        this.restoreChatHistory();
        this.maybeAddWelcomeMessage();

        setTimeout(() => document.getElementById('chatInput')?.focus(), 300);
    }

    closeChat() {
        document.getElementById('chatContainer')?.classList.remove('chat-widget__container--open');
        this.isOpen = false;

        // persist closed state (shared across tabs within this browser session)
        this.storageSet(this.getOpenStateKey(), 'false');
    }

    // restore open/closed state on load
    restoreOpenState() {
        const wasOpen = this.storageGet(this.getOpenStateKey());
        if (wasOpen === 'true') {
            // Defer slightly so DOM is ready if constructor runs early
            requestAnimationFrame(() => this.openChat());
        }
    }

    // ---------- Messaging ----------
    async sendMessage() {
        const input = document.getElementById('chatInput');
        const message = input?.value.trim();
        if (!message) return;

        this.addMessage('user', message);
        if (input) {
            input.value = '';
        }
        const sendBtn = document.getElementById('chatSend');
        if (sendBtn) sendBtn.disabled = true;

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

            // NOTE: you currently inject <br>. If you want to avoid <br>, replace with <p> blocks instead.
            const botHTML = (text || 'Geen antwoord ontvangen.').replace(/\n/g, '<br>');
            const botMessage = this.addMessage('bot', botHTML);
            this.lastBotMessage = botMessage;
        } catch (err) {
            this.hideTypingIndicator();
            const botMessage = this.addMessage('bot', 'Er ging iets mis.');
            this.lastBotMessage = botMessage;
            console.error(err);
        }
    }

    addMessage(type, htmlText, isRestoring = false) {
        const msg = document.createElement('div');
        msg.className = `chat-widget__message chat-widget__message--${type}`;

        const timestamp = new Date();
        const formattedTime = timestamp.toLocaleString('nl-NL', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        msg.innerHTML = `
      <div class="chat-widget__message-text">${htmlText}</div>
      <div class="chat-widget__timestamp">${formattedTime}</div>
    `;

        const container = document.getElementById('chatMessages');
        container?.appendChild(msg);
        if (container) container.scrollTop = container.scrollHeight;

        if (type === 'bot') {
            this.lastBotMessage = msg;
            document.getElementById('thumbsUp')?.removeAttribute('disabled');
            document.getElementById('thumbsDown')?.removeAttribute('disabled');
        }

        if (!isRestoring) {
            this.saveMessageToSession({ type, htmlText, timestamp: timestamp.toISOString() });
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
        const messages = document.getElementById('chatMessages');
        messages?.appendChild(indicator);
        if (messages) messages.scrollTop = messages.scrollHeight;
    }

    hideTypingIndicator() {
        document.getElementById('typingIndicator')?.remove();
    }

    handleFeedback(isUseful) {
        const thumbsUp = document.getElementById('thumbsUp');
        const thumbsDown = document.getElementById('thumbsDown');

        if (thumbsUp?.disabled || thumbsDown?.disabled) {
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
        this.addMessage('bot', `Perfect! Je kunt direct contact opnemen via:<br>📞 Telefoon: 0182 359 303<br>📧 Email: hallo@draadwerk.nl<br><br>Of ik kan zorgen dat iemand je terugbelt. Wat heeft jouw voorkeur?`);
    }

    // ---------- Session ----------
    loadOrCreateSessionId(providedSessionId) {
        // Single id per browser-session group
        let sessionId = this.storageGet('chatWidgetSessionId');
        if (!sessionId) {
            sessionId = providedSessionId || this.generateSessionId();
            this.storageSet('chatWidgetSessionId', sessionId);
        }
        return sessionId;
    }

    generateSessionId() {
        return 'session-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    }

    saveMessageToSession(message) {
        const key = `chatWidgetHistory-${this.sessionId}`;
        const history = JSON.parse(this.storageGet(key) || '[]');
        history.push(message);
        this.storageSet(key, JSON.stringify(history));
        // setItem triggers storage events in other tabs (same session group)
    }

    restoreChatHistory() {
        if (this.chatRestored) return;

        const key = `chatWidgetHistory-${this.sessionId}`;
        const history = JSON.parse(this.storageGet(key) || '[]');

        const messagesEl = document.getElementById('chatMessages');
        if (messagesEl) messagesEl.innerHTML = ''; // prevent duplicates

        history.forEach(entry => {
            this.addMessage(entry.type, entry.htmlText, true);
        });

        this.chatRestored = true;
    }

    clearChatHistory() {
        this.storageRemove(`chatWidgetHistory-${this.sessionId}`);
        this.storageRemove(`chatWidgetWelcome-${this.sessionId}`);
        this.storageRemove(this.getTooltipDismissedKey());
        this.storageRemove(this.getOpenStateKey());
        this.chatRestored = false;
    }

    maybeAddWelcomeMessage() {
        const welcomeKey = `chatWidgetWelcome-${this.sessionId}`;
        const alreadyWelcomed = this.storageGet(welcomeKey);
        if (!alreadyWelcomed) {
            this.addMessage(
                'bot',
                'Hallo! Ik ben Michael van Draadwerk. Als AI-assistent help ik je graag verder. Hoe kan ik je vandaag helpen? Stel je vraag hieronder.'
            );
            this.storageSet(welcomeKey, 'true');
        }
    }
}

