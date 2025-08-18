class ChatWidget {
    constructor(webhookURL, sessionId = null, userId) {
        this.webhookURL = webhookURL;
        this.userId = userId;

        // ----- Constants / keys
        this.LS_PREFIX = "dwChat:";
        this.KEY_SESSION_ID = this.LS_PREFIX + "sessionId";
        this.KEY_HISTORY    = null; // depends on sessionId
        this.KEY_WELCOME    = null; // depends on sessionId
        this.KEY_OPEN       = null; // depends on sessionId
        this.KEY_TOOLTIP    = null; // depends on sessionId

        // New: tab fingerprint + last-seen heartbeat
        this.SS_TAB_ID      = this.LS_PREFIX + "tabId";         // sessionStorage
        this.KEY_LAST_SEEN  = this.LS_PREFIX + "lastSeen";      // localStorage
        this.RESET_MS       = 4000; // treat as "fresh browser start" if lastSeen is older than this AND no tabId

        // (Optional) keep for broadcast/history sync; no longer used for destructive cleanup
        this.KEY_TABS       = this.LS_PREFIX + "openTabs";

        // State
        this.isOpen = false;
        this.lastBotMessage = null;
        this.chatRestored = false;

        // Cross-tab channel
        this.channel = null;

        // STEP 1: Create/adopt per-tab fingerprint BEFORE anything else
        this.adoptOrCreateTabId();

        // STEP 2: Fresh-start detection (runs only when there is NO tabId — i.e., truly new tab/window)
        this.maybeResetForNewBrowser();

        // STEP 3: Create/adopt shared sessionId (per whole-site session)
        this.sessionId = this.loadOrCreateSessionId(sessionId);

        // Per-session keys
        this.KEY_HISTORY = `${this.LS_PREFIX}history:${this.sessionId}`;
        this.KEY_WELCOME = `${this.LS_PREFIX}welcome:${this.sessionId}`;
        this.KEY_OPEN    = `${this.LS_PREFIX}isOpen:${this.sessionId}`;
        this.KEY_TOOLTIP = `${this.LS_PREFIX}tooltipDismissed:${this.sessionId}`;

        // Init
        this.init();
    }

    // ---------- Storage helpers ----------
    lsGet(key) { return localStorage.getItem(key); }
    lsSet(key, val) { localStorage.setItem(key, val); }
    lsRemove(key) { localStorage.removeItem(key); }
    ssGet(key) { return sessionStorage.getItem(key); }
    ssSet(key, val) { sessionStorage.setItem(key, val); }
    ssRemove(key) { sessionStorage.removeItem(key); }

    // ---------- Tab fingerprint & browser-new detection ----------
    adoptOrCreateTabId() {
        // If a tabId already exists in sessionStorage, this is the SAME TAB (navigating/reloading).
        let tabId = this.ssGet(this.SS_TAB_ID);
        if (!tabId) {
            tabId = 'tab-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
            this.ssSet(this.SS_TAB_ID, tabId);
            // Mark this as a brand-new tab load (used in maybeResetForNewBrowser)
            this._isBrandNewTab = true;
        } else {
            this._isBrandNewTab = false;
        }
    }

    maybeResetForNewBrowser() {
        // If we are a brand-new tab/window (no sessionStorage previously),
        // and the site hasn't been "seen" for longer than RESET_MS, treat as fresh browser start.
        const lastSeen = parseInt(this.lsGet(this.KEY_LAST_SEEN) || "0", 10);
        const now = Date.now();

        if (this._isBrandNewTab && (now - lastSeen) > this.RESET_MS) {
            // Truly new session: wipe chat state (but NOT immediately removing our fresh tabId)
            const sid = this.lsGet(this.KEY_SESSION_ID);
            if (sid) {
                this.lsRemove(`${this.LS_PREFIX}history:${sid}`);
                this.lsRemove(`${this.LS_PREFIX}welcome:${sid}`);
                this.lsRemove(`${this.LS_PREFIX}isOpen:${sid}`);
                this.lsRemove(`${this.LS_PREFIX}tooltipDismissed:${sid}`);
            }
            this.lsRemove(this.KEY_SESSION_ID);
            // keep KEY_TABS untouched (no longer used for destructive logic)
        }

        // Update lastSeen right away on load
        this.lsSet(this.KEY_LAST_SEEN, String(now));

        // Keep lastSeen fresh while page is alive (covers idle tabs)
        this.installHeartbeat();
    }

    installHeartbeat() {
        // Update on visibility changes
        document.addEventListener('visibilitychange', () => {
            this.lsSet(this.KEY_LAST_SEEN, String(Date.now()));
        });

        // Update on pagehide/unload transitions
        window.addEventListener('pagehide', () => {
            this.lsSet(this.KEY_LAST_SEEN, String(Date.now()));
        });

        // Light heartbeat every 2s while visible
        this._heartbeat = setInterval(() => {
            if (!document.hidden) {
                this.lsSet(this.KEY_LAST_SEEN, String(Date.now()));
            }
        }, 2000);
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

    // ---------- Keys (compat) ----------
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

        // Keep lastSeen fresh on user activity too
        ['click','keydown','scroll','pointerdown'].forEach(evt =>
            window.addEventListener(evt, () => this.lsSet(this.KEY_LAST_SEEN, String(Date.now())), { passive: true })
        );
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

            // lastSeen changes are informational; nothing to do
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
