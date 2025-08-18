class ChatWidget {
    constructor(webhookURL, sessionId = null, userId) {
        this.webhookURL = webhookURL;
        this.userId = userId;

        // ----- Constants / keys
        this.LS_PREFIX = "dwChat:";
        this.KEY_TABS = this.LS_PREFIX + "openTabs"; // integer counter
        this.KEY_SESSION_ID = this.LS_PREFIX + "sessionId";
        this.KEY_HISTORY = null;     // depends on sessionId
        this.KEY_WELCOME = null;     // depends on sessionId
        this.KEY_OPEN = null;        // depends on sessionId
        this.KEY_TOOLTIP = null;     // depends on sessionId

        // Close marker + grace period
        this.KEY_MAYBE_CLOSED_AT = this.LS_PREFIX + "maybeClosedAt";
        this.GRACE_MS = 5000;

        // State
        this.isOpen = false;
        this.lastBotMessage = null;
        this.chatRestored = false;

        // Cross-tab channel
        this.channel = null;

        // Create/adopt shared sessionId
        this.sessionId = this.loadOrCreateSessionId(sessionId);

        // Per-session keys
        this.KEY_HISTORY = `${this.LS_PREFIX}history:${this.sessionId}`;
        this.KEY_WELCOME = `${this.LS_PREFIX}welcome:${this.sessionId}`;
        this.KEY_OPEN    = `${this.LS_PREFIX}isOpen:${this.sessionId}`;
        this.KEY_TOOLTIP = `${this.LS_PREFIX}tooltipDismissed:${this.sessionId}`;

        // IMPORTANT: finalize any previous "all tabs closed" state BEFORE we register this new tab
        this.finalizeCloseIfNeeded();

        // Register this tab and init
        this.registerTab();
        this.init();
    }

    // ---------- Storage helpers ----------
    lsGet(key) { return localStorage.getItem(key); }
    lsSet(key, val) { localStorage.setItem(key, val); }
    lsRemove(key) { localStorage.removeItem(key); }

    // ---------- Finalize previous close (runs on startup, before registerTab) ----------
    finalizeCloseIfNeeded() {
        const openTabs = parseInt(this.lsGet(this.KEY_TABS) || "0", 10);
        const mark = parseInt(this.lsGet(this.KEY_MAYBE_CLOSED_AT) || "0", 10);

        if (openTabs === 0 && mark) {
            const age = Date.now() - mark;
            if (age >= this.GRACE_MS) {
                // Truly closed previously → wipe now
                this.clearAllPersistentState();
                this.lsRemove(this.KEY_MAYBE_CLOSED_AT);
            } else {
                // Likely a same-tab navigation → keep state, remove marker
                this.lsRemove(this.KEY_MAYBE_CLOSED_AT);
            }
        }
    }

    // ---------- Tab lifecycle ----------
    registerTab() {
        const count = parseInt(this.lsGet(this.KEY_TABS) || "0", 10);
        this.lsSet(this.KEY_TABS, String(count + 1));

        // On tab/window closing: decrement and set a "maybe closed" marker if last one
        window.addEventListener("beforeunload", () => {
            const current = parseInt(this.lsGet(this.KEY_TABS) || "0", 10);
            const next = Math.max(0, current - 1);

            this.lsSet(this.KEY_TABS, String(next));
            if (next === 0) {
                // Don’t clear now (no JS will be running) — just mark the time.
                this.lsSet(this.KEY_MAYBE_CLOSED_AT, String(Date.now()));
            }

            this.postChannel({ type: "tabCountChanged", openTabs: next });
        }, { capture: true });
    }

    clearAllPersistentState() {
        // Remove everything related to the chat so a fresh session starts next time the site opens
        const sessionId = this.lsGet(this.KEY_SESSION_ID);
        if (sessionId) {
            this.lsRemove(`${this.LS_PREFIX}history:${sessionId}`);
            this.lsRemove(`${this.LS_PREFIX}welcome:${sessionId}`);
            this.lsRemove(`${this.LS_PREFIX}isOpen:${sessionId}`);
            this.lsRemove(`${this.LS_PREFIX}tooltipDismissed:${sessionId}`);
        }
        this.lsRemove(this.KEY_SESSION_ID);
        this.lsRemove(this.KEY_TABS);
        this.lsRemove(this.KEY_MAYBE_CLOSED_AT);
    }

    // ---------- Session ID ----------
    loadOrCreateSessionId(providedSessionId) {
        let sid = this.lsGet(this.KEY_SESSION_ID);
        if (!sid) {
            sid = providedSessionId || this.generateSessionId();
            this.lsSet(this.KEY_SESSION_ID, sid);
        }
        return sid;
    }

    generateSessionId() {
        return 'session-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    }

    // ---------- Keys (for compatibility with your earlier getters) ----------
    getOpenStateKey() { return this.KEY_OPEN; }
    getTooltipDismissedKey() { return this.KEY_TOOLTIP; }

    // ---------- Init ----------
    init() {
        this.bindEvents();
        this.setupBroadcastChannel();
        this.setupStorageSync();
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

    // ---------- Cross-tab sync (fast channel) ----------
    setupBroadcastChannel() {
        if ("BroadcastChannel" in window) {
            this.channel = new BroadcastChannel("dw-chat");
            this.channel.onmessage = (evt) => {
                const msg = evt.data || {};
                if (msg.type === "openState") {
                    if (msg.value === true && !this.isOpen) this.openChat();
                    if (msg.value === false && this.isOpen) this.closeChat();
                }
                if (msg.type === "historyChanged") {
                    this.chatRestored = false;
                    this.restoreChatHistory();
                }
                if (msg.type === "tooltipDismissed") {
                    this.hideTooltip();
                }
            };
        }
    }

    postChannel(payload) {
        if (this.channel) {
            try { this.channel.postMessage(payload); } catch {}
        }
    }

    // ---------- Cross-tab sync (reliable fallback) ----------
    setupStorageSync() {
        window.addEventListener('storage', (e) => {
            if (!e.key) return;

            // Open/closed state
            if (e.key === this.KEY_OPEN) {
                const shouldBeOpen = this.lsGet(this.KEY_OPEN) === 'true';
                if (shouldBeOpen && !this.isOpen) this.openChat();
                if (!shouldBeOpen && this.isOpen) this.closeChat();
                return;
            }

            // Messages history
            if (e.key === this.KEY_HISTORY) {
                this.chatRestored = false;
                this.restoreChatHistory();
                return;
            }

            // Tooltip dismissed
            if (e.key === this.KEY_TOOLTIP) {
                const dismissed = this.lsGet(this.KEY_TOOLTIP) === 'true';
                if (dismissed) this.hideTooltip();
                return;
            }
        });
    }

    // ---------- Tooltip control ----------
    showTooltip() {
        setTimeout(() => {
            const dismissed = this.lsGet(this.KEY_TOOLTIP);
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
        this.lsSet(this.KEY_TOOLTIP, 'true');
        this.postChannel({ type: "tooltipDismissed" });
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

        this.lsSet(this.KEY_OPEN, 'true');
        this.postChannel({ type: "openState", value: true });

        this.hideTooltip();
        this.restoreChatHistory();
        this.maybeAddWelcomeMessage();

        setTimeout(() => document.getElementById('chatInput')?.focus(), 300);
    }

    closeChat() {
        document.getElementById('chatContainer')?.classList.remove('chat-widget__container--open');
        this.isOpen = false;

        this.lsSet(this.KEY_OPEN, 'false');
        this.postChannel({ type: "openState", value: false });
    }

    // restore open/closed state on load
    restoreOpenState() {
        const wasOpen = this.lsGet(this.KEY_OPEN);
        if (wasOpen === 'true') {
            requestAnimationFrame(() => this.openChat());
        }
    }

    // ---------- Messaging ----------
    async sendMessage() {
        const input = document.getElementById('chatInput');
        const message = input?.value.trim();
        if (!message) return;

        this.addMessage('user', message);
        if (input) input.value = '';
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

    // ---------- Persisted chat ----------
    saveMessageToSession(message) {
        const history = JSON.parse(this.lsGet(this.KEY_HISTORY) || '[]');
        history.push(message);
        this.lsSet(this.KEY_HISTORY, JSON.stringify(history));

        // Notify siblings
        this.postChannel({ type: "historyChanged" });
        // storage event will also fire in other tabs
        this.lsSet(this.KEY_HISTORY, JSON.stringify(history)); // set again to ensure storage event triggers
    }

    restoreChatHistory() {
        if (this.chatRestored) return;

        const history = JSON.parse(this.lsGet(this.KEY_HISTORY) || '[]');

        const messagesEl = document.getElementById('chatMessages');
        if (messagesEl) messagesEl.innerHTML = ''; // prevent duplicates

        history.forEach(entry => {
            this.addMessage(entry.type, entry.htmlText, true);
        });

        this.chatRestored = true;
    }

    clearChatHistory() {
        this.lsRemove(this.KEY_HISTORY);
        this.lsRemove(this.KEY_WELCOME);
        this.lsRemove(this.KEY_TOOLTIP);
        this.lsRemove(this.KEY_OPEN);
        this.chatRestored = false;
    }

    maybeAddWelcomeMessage() {
        const alreadyWelcomed = this.lsGet(this.KEY_WELCOME);
        if (!alreadyWelcomed) {
            this.addMessage(
                'bot',
                'Hallo! Ik ben Lotte van Draadwerk. Als AI-assistente help ik je graag verder. Hoe kan ik je vandaag helpen? Stel je vraag hieronder.'
            );
            this.lsSet(this.KEY_WELCOME, 'true');
        }
    }
}
