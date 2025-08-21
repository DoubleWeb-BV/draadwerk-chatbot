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

        // State
        this.isOpen = false;
        this.lastBotMessage = null;
        this.chatRestored = false;
        this.chatConfig = null; // filled by preloadChatData()
        this.texts = {
            success: "Dank je! Fijn dat ik je kon helpen. 😊",
            notUseful: "Sorry dat dit niet nuttig was. Kan ik je op een andere manier helpen?",
            cta: "Neem direct contact met ons op via: <br><br>📞 Telefoon: 0000 - 000 000 <br>📧 E-mail: info@example.com",
        };

        // ----- Neutrale defaults als fallback -----
        this.DEFAULTS = {
            avatar_url: "profile.png",
            chatbot_name: "AI Assistent",
            name_subtitle: "Virtuele assistent",
            tooltip: "Kan ik je helpen?",
            opening_message:
                "Hallo! 👋 Ik ben je AI-assistent. Hoe kan ik je vandaag helpen?",
            placeholder_message: "Typ je bericht...",
            cta_button_text: "Contact opnemen",
            cta_text:
                "Neem direct contact met ons op via: <br><br>📞 Telefoon: 0000 - 000 000 <br>📧 E-mail: info@example.com",
            success_text: "Dank je! Fijn dat ik je kon helpen. 😊",
            not_useful_text: "Sorry dat dit niet nuttig was. Kan ik je op een andere manier helpen?",
            primary_color: "#022d1f",
            secondary_color: "#ff7b61",
        };

        // Cross-tab channel
        this.channel = null;

        // STEP 1: tab fingerprint
        this.adoptOrCreateTabId();

        // STEP 2: fresh-start detection
        this.maybeResetForNewBrowser();

        // STEP 3: shared sessionId
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
        let tabId = this.ssGet(this.SS_TAB_ID);
        if (!tabId) {
            tabId = 'tab-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
            this.ssSet(this.SS_TAB_ID, tabId);
            this._isBrandNewTab = true;
        } else {
            this._isBrandNewTab = false;
        }
    }

    maybeResetForNewBrowser() {
        const lastSeen = parseInt(this.lsGet(this.KEY_LAST_SEEN) || "0", 10);
        const now = Date.now();

        if (this._isBrandNewTab && (now - lastSeen) > this.RESET_MS) {
            const sid = this.lsGet(this.KEY_SESSION_ID);
            if (sid) {
                this.lsRemove(`${this.LS_PREFIX}history:${sid}`);
                this.lsRemove(`${this.LS_PREFIX}welcome:${sid}`);
                this.lsRemove(`${this.LS_PREFIX}isOpen:${sid}`);
                this.lsRemove(`${this.LS_PREFIX}tooltipDismissed:${sid}`);
            }
            this.lsRemove(this.KEY_SESSION_ID);
        }

        this.lsSet(this.KEY_LAST_SEEN, String(now));
        this.installHeartbeat();
    }

    installHeartbeat() {
        document.addEventListener('visibilitychange', () => {
            this.lsSet(this.KEY_LAST_SEEN, String(Date.now()));
        });

        window.addEventListener('pagehide', () => {
            this.lsSet(this.KEY_LAST_SEEN, String(Date.now()));
        });

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

            if (e.key === this.KEY_OPEN) {
                const shouldBeOpen = this.lsGet(this.KEY_OPEN) === 'true';
                if (shouldBeOpen && !this.isOpen) this.openChat();
                if (!shouldBeOpen && this.isOpen) this.closeChat();
                return;
            }

            if (e.key === this.KEY_HISTORY) {
                this.chatRestored = false;
                this.restoreChatHistory();
                return;
            }

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

    // ---------- Theme (CSS-variabelen) ----------
    applyTheme(primary, secondary) {
        const root = document.querySelector('#chat-widget') || document.documentElement;
        root.style.setProperty('--primary-color', primary || this.DEFAULTS.primary_color);
        root.style.setProperty('--secondary-color', secondary || this.DEFAULTS.secondary_color);
    }

    // ---------- Normalization helper for remote data ----------
    _normalize(value, fallback) {
        if (Array.isArray(value)) value = value[0];
        if (typeof value !== "string") return fallback;
        const trimmed = value.trim();
        return trimmed.length ? trimmed : fallback;
    }

    // ---------- Apply remote config (with fallbacks) ----------
    applyRemoteConfig(raw) {
        const cfg = {
            avatar_url: this._normalize(raw?.avatar_url, this.DEFAULTS.avatar_url),
            chatbot_name: this._normalize(raw?.chatbot_name, this.DEFAULTS.chatbot_name),
            name_subtitle: this._normalize(raw?.name_subtitle, this.DEFAULTS.name_subtitle),
            tooltip: this._normalize(raw?.tooltip, this.DEFAULTS.tooltip),
            opening_message: this._normalize(raw?.opening_message, this.DEFAULTS.opening_message),
            placeholder_message: this._normalize(raw?.placeholder_message, this.DEFAULTS.placeholder_message),
            cta_button_text: this._normalize(raw?.cta_button_text, this.DEFAULTS.cta_button_text),
            cta_text: this._normalize(raw?.cta_text, this.DEFAULTS.cta_text),
            success_text: this._normalize(raw?.success_text, this.DEFAULTS.success_text),
            not_useful_text: this._normalize(raw?.not_useful_text, this.DEFAULTS.not_useful_text),
            primary_color: this._normalize(raw?.primary_color, this.DEFAULTS.primary_color),
            secondary_color: this._normalize(raw?.secondary_color, this.DEFAULTS.secondary_color),
        };

        // Store texts for later usage
        this.texts = {
            success: cfg.success_text,
            notUseful: cfg.not_useful_text,
            cta: cfg.cta_text,
        };

        // Save whole config
        this.chatConfig = cfg;

        // Apply theme colors
        this.applyTheme(cfg.primary_color, cfg.secondary_color);

        const $ = (sel) => document.querySelector(sel);

        // Avatars
        const avatar1 = $("#js-profile-image");
        const avatar2 = $("#js-profile-image-2");
        if (avatar1) avatar1.src = cfg.avatar_url;
        if (avatar2) avatar2.src = cfg.avatar_url;

        // Header name and subtitle (keep Online • )
        const headerTitle = $(".chat-widget__header-title");
        if (headerTitle) headerTitle.textContent = cfg.chatbot_name;

        const headerSubtitle = $(".chat-widget__header-subtitle");
        if (headerSubtitle) headerSubtitle.textContent = `Online • ${cfg.name_subtitle}`;

        // Tooltip
        const tooltipEl = $("#chatTooltip");
        if (tooltipEl) {
            tooltipEl.textContent = cfg.tooltip;
            tooltipEl.setAttribute("aria-label", "Open chat");
        }

        // CTA button label
        const contactBtn = $("#contactBtn");
        if (contactBtn) contactBtn.textContent = cfg.cta_button_text;

        // Placeholder
        const input = $("#chatInput");
        if (input) input.setAttribute("placeholder", cfg.placeholder_message);

        // Initial welcome (only if not welcomed and no history)
        const alreadyWelcomed = this.lsGet(this.KEY_WELCOME) === "true";
        const hasHistory = (this.lsGet(this.KEY_HISTORY) || "[]") !== "[]";

        if (!alreadyWelcomed && !hasHistory && cfg.opening_message) {
            const html = cfg.opening_message.replace(/\n/g, "<br>");
            this.addMessage("bot", html);
            this.lsSet(this.KEY_WELCOME, "true");
        }
    }

    // ---------- Preload from n8n (POST) ----------
    async preloadChatData() {
        try {
            const res = await fetch("https://workflows.draadwerk.nl/webhook/fdfc5f47-4bf7-4681-9d5e-ed91ae318526", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    userId: this.userId || null,
                    sessionId: this.sessionId || null
                })
            });

            if (!res.ok) throw new Error(`Webhook error: ${res.status}`);

            const data = await res.json();
            this.applyRemoteConfig(data);
        } catch (err) {
            // Fallback: zet theme op defaults en toon neutrale welcome als nog niet gedaan
            this.applyTheme(this.DEFAULTS.primary_color, this.DEFAULTS.secondary_color);
            const alreadyWelcomed = this.lsGet(this.KEY_WELCOME) === "true";
            const hasHistory = (this.lsGet(this.KEY_HISTORY) || "[]") !== "[]";
            if (!alreadyWelcomed && !hasHistory) {
                this.addMessage("bot", this.DEFAULTS.opening_message);
                this.lsSet(this.KEY_WELCOME, "true");
            }
        }
    }

    // ---------- Open / Close ----------
    toggleChat() {
        this.isOpen ? this.closeChat() : this.openChat();
    }

    async openChat() {
        const container = document.getElementById('chatContainer');
        container?.classList.add('chat-widget__container--open');
        this.isOpen = true;

        this.lsSet(this.KEY_OPEN, 'true');
        this.postChannel({ type: "openState", value: true });

        this.hideTooltip();
        this.restoreChatHistory();

        // Fetch dynamic data from n8n before default welcome (only once per session)
        if (!this.chatConfig) {
            await this.preloadChatData();
        }

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
            this.addMessage('bot', this?.texts?.success || this.DEFAULTS.success_text);
        } else {
            thumbsDown.classList.add('chat-widget__feedback-btn--active');
            this.addMessage('bot', this?.texts?.notUseful || this.DEFAULTS.not_useful_text);
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
        }).catch(() => {});
    }

    handleContact() {
        const html = (this?.texts?.cta || this.DEFAULTS.cta_text).replace(/\n/g, "<br>");
        this.addMessage('bot', html);
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
            this.addMessage('bot', this.DEFAULTS.opening_message);
            this.lsSet(this.KEY_WELCOME, 'true');
        }
    }
}
