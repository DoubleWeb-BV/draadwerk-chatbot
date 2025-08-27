class ChatWidget {
    /**
     * @param {string} webhookURL - streaming message webhook (NDJSON line per chunk)
     * @param {string|null} sessionId
     * @param {string|undefined} userId
     * @param {string} websiteId - REQUIRED for your n8n flow
     * @param {{typeDelayMs?:number, charsPerTick?:number}} typingOpts
     */
    constructor(webhookURL, sessionId = null, userId, websiteId, typingOpts = {}) {
        this.webhookURL = webhookURL;   // message webhook (NDJSON streaming)
        this.userId = userId;
        this.websiteId = websiteId;

        // ---- Typing config (defaults as requested) ----
        this.typeDelayMs  = Number.isFinite(typingOpts.typeDelayMs) ? typingOpts.typeDelayMs : 8; // ms
        this.charsPerTick = Number.isFinite(typingOpts.charsPerTick) ? typingOpts.charsPerTick : 2;

        // ---- Internal typing state ----
        this._typingQueue = "";
        this._typingLoopRunning = false;
        this._currentAbort = null;      // AbortController for in-flight stream
        this._lastFullText = "";        // For optional replay if you want later

        // ----- Constants / keys
        this.LS_PREFIX = "dwChat:";
        this.KEY_SESSION_ID = this.LS_PREFIX + "sessionId";
        this.KEY_HISTORY    = null; // depends on sessionId
        this.KEY_WELCOME    = null; // depends on sessionId
        this.KEY_OPEN       = null; // depends on sessionId
        this.KEY_TOOLTIP    = null; // depends on sessionId

        // Tab fingerprint + last-seen
        this.SS_TAB_ID      = this.LS_PREFIX + "tabId";
        this.KEY_LAST_SEEN  = this.LS_PREFIX + "lastSeen";
        this.RESET_MS       = 4000;

        // State
        this.isOpen = false;
        this.lastBotMessage = null;
        this.chatRestored = false;
        this.chatConfig = null;
        this.configLoaded = false;
        this.configReady = null;

        this.texts = {
            success: "Dank je! Fijn dat ik je kon helpen. 😊",
            notUseful: "Sorry dat dit niet nuttig was. Kan ik je op een andere manier helpen?",
            cta: "Neem direct contact met ons op via: <br><br>📞 Telefoon: 0000 - 000 000 <br>📧 E-mail: info@example.com",
        };

        // Neutral fallbacks
        this.DEFAULTS = {
            avatar_url: "",
            chatbot_name: "AI Assistent",
            name_subtitle: "Virtuele assistent",
            tooltip: "Kan ik je helpen?",
            opening_message: "Hallo! 👋 Ik ben je AI-assistent. Hoe kan ik je vandaag helpen?",
            placeholder_message: "Typ je bericht...",
            cta_button_text: "Contact opnemen",
            cta_text: "Neem direct contact met ons op via: <br><br>📞 Telefoon: 0000 - 000 000 <br>📧 E-mail: info@example.com",
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

    // ---------- Hide/Reveal ----------
    ensureHidden() {
        const root = document.getElementById('chat-widget');
        if (root) {
            root.setAttribute('data-ready', '0');
            root.style.visibility = 'hidden';
            root.style.opacity = '0';
        }
    }
    revealWidget() {
        const root = document.getElementById('chat-widget');
        if (root) {
            root.setAttribute('data-ready', '1');
            root.style.visibility = 'visible';
            root.style.opacity = '1';
        }
    }

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

    // ---------- Init ----------
    init() {
        this.ensureHidden(); // keep hidden until config is ready

        this.bindEvents();
        this.setupBroadcastChannel();
        this.setupStorageSync();

        // Load remote config and only then show UI/tooltip/restore state
        this.configReady = this.preloadChatData().catch(() => {});
        this.configReady.finally(() => {
            this.restoreOpenState();
            this.showTooltip();
            this.startPulseAnimation();
        });
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

        chatTooltip?.addEventListener('click', async () => {
            await this.toggleChat();
            this.dismissTooltip();
        });
        chatTooltip?.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                await this.toggleChat();
                this.dismissTooltip();
            }
        });

        ['click','keydown','scroll','pointerdown'].forEach(evt =>
            window.addEventListener(evt, () => this.lsSet(this.KEY_LAST_SEEN, String(Date.now())), { passive: true })
        );
    }

    // ---------- Cross-tab sync ----------
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

    setupStorageSync() {
        window.addEventListener('storage', async (e) => {
            if (!e.key) return;

            if (e.key === this.KEY_OPEN) {
                const shouldBeOpen = this.lsGet(this.KEY_OPEN) === 'true';
                if (shouldBeOpen && !this.isOpen) await this.openChat();
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

    // ---------- Tooltip ----------
    showTooltip() {
        setTimeout(() => {
            if (!this.configLoaded) return;
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

    // ---------- Theme (CSS vars) ----------
    applyTheme(primary, secondary) {
        const root = document.querySelector('#chat-widget') || document.documentElement;
        root.style.setProperty('--primary-color', primary || this.DEFAULTS.primary_color);
        root.style.setProperty('--secondary-color', secondary || this.DEFAULTS.secondary_color);
    }

    // ---------- Helpers ----------
    _normalize(value, fallback) {
        if (Array.isArray(value)) value = value[0];
        if (typeof value !== "string") return fallback;
        const trimmed = value.trim();
        return trimmed.length ? trimmed : fallback;
    }

    // ---------- Apply remote config ----------
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

        this.texts = {
            success: cfg.success_text,
            notUseful: cfg.not_useful_text,
            cta: cfg.cta_text,
        };
        this.chatConfig = cfg;

        // Apply colors
        this.applyTheme(cfg.primary_color, cfg.secondary_color);

        const $ = (sel) => document.querySelector(sel);

        // Avatars
        const avatar1 = $("#js-profile-image");
        const avatar2 = $("#js-profile-image-2");
        if (cfg.avatar_url) {
            if (avatar1) avatar1.src = cfg.avatar_url;
            if (avatar2) avatar2.src = cfg.avatar_url;
        }

        // Header
        const headerTitle = $(".chat-widget__header-title");
        if (headerTitle) headerTitle.textContent = cfg.chatbot_name;

        const headerSubtitle = $(".chat-widget__header-subtitle");
        if (headerSubtitle) headerSubtitle.textContent = `Online • ${cfg.name_subtitle}`;

        // Tooltip text
        const tooltipEl = $("#chatTooltip");
        if (tooltipEl) {
            tooltipEl.textContent = cfg.tooltip;
            tooltipEl.setAttribute("aria-label", "Open chat");
        }

        // CTA label
        const contactBtn = $("#contactBtn");
        if (contactBtn) contactBtn.textContent = cfg.cta_button_text;

        // Placeholder
        const input = $("#chatInput");
        if (input) input.setAttribute("placeholder", cfg.placeholder_message);

        // Mark loaded and reveal
        this.configLoaded = true;
        this.revealWidget();

        // Initial welcome (only once and only if no history)
        const alreadyWelcomed = this.lsGet(this.KEY_WELCOME) === "true";
        const hasHistory = (this.lsGet(this.KEY_HISTORY) || "[]") !== "[]";
        if (!alreadyWelcomed && !hasHistory && cfg.opening_message) {
            const html = cfg.opening_message.replace(/\n/g, "<br>");
            this.addMessage("bot", html);
            this.lsSet(this.KEY_WELCOME, "true");
        }
    }

    // ---------- Preload from n8n (POST) ----------
    a// ---------- Preload from n8n (POST) ----------
    async preloadChatData() {
        try {
            // ✅ Gebruik de juiste URL (haal 'g' weg als dat per ongeluk was)
            const res = await fetch("https://workflows.draadwerk.nl/webhook-test/fdfc5f47-4bf7-4681-9d5e-ed91ae318526g", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    // ✅ Stuur websiteId i.p.v. userId
                    websiteId: this.websiteId || null,
                    sessionId: this.sessionId || null,
                    // (optioneel) als je tóch ook userId wilt meesturen, doe dit expliciet:
                    // userId: this.userId || null
                })
            });
            if (!res.ok) throw new Error(`Webhook error: ${res.status}`);

            const data = await res.json();
            this.applyRemoteConfig(data);
        } catch (_err) {
            // Fallback: defaults
            this.applyTheme(this.DEFAULTS.primary_color, this.DEFAULTS.secondary_color);
            this.configLoaded = true;
            this.revealWidget();

            const alreadyWelcomed = this.lsGet(this.KEY_WELCOME) === "true";
            const hasHistory = (this.lsGet(this.KEY_HISTORY) || "[]") !== "[]";
            if (!alreadyWelcomed && !hasHistory) {
                this.addMessage('bot', this.DEFAULTS.opening_message);
                this.lsSet(this.KEY_WELCOME, 'true');
            }
        }
    }


    // ---------- Open / Close ----------
    async toggleChat() {
        return this.isOpen ? this.closeChat() : this.openChat();
    }

    async openChat() {
        // Wait until config is ready (no flash of default texts)
        if (!this.configLoaded && this.configReady) {
            await this.configReady;
        }

        const container = document.getElementById('chatContainer');
        container?.classList.add('chat-widget__container--open');
        this.isOpen = true;

        this.lsSet(this.KEY_OPEN, 'true');
        this.postChannel({ type: "openState", value: true });

        this.hideTooltip();
        this.restoreChatHistory();

        setTimeout(() => document.getElementById('chatInput')?.focus(), 300);
    }

    closeChat() {
        document.getElementById('chatContainer')?.classList.remove('chat-widget__container--open');
        this.isOpen = false;

        this.lsSet(this.KEY_OPEN, 'false');
        this.postChannel({ type: "openState", value: false });
    }

    // restore open state after config load
    restoreOpenState() {
        const wasOpen = this.lsGet(this.KEY_OPEN);
        if (wasOpen === 'true') {
            if (this.configReady) {
                this.configReady.then(() => this.openChat());
            } else {
                this.openChat();
            }
        }
    }

    // ---------- Typing engine ----------
    async _startTypingLoop() {
        if (this._typingLoopRunning) return;
        this._typingLoopRunning = true;

        const outContainer = document.getElementById('chatMessages');
        // Ensure we always append into the last bot bubble being streamed
        let liveBubble = this.lastBotMessage;

        while (this._typingQueue.length > 0) {
            const n = Math.max(1, this.charsPerTick | 0);
            const delay = Math.max(0, this.typeDelayMs | 0);

            const chunk = this._typingQueue.slice(0, n);
            this._typingQueue = this._typingQueue.slice(n);

            // If there is no live bubble yet, create one
            if (!liveBubble) {
                liveBubble = this.addMessage('bot', '', true /* restoring to avoid double-save during stream */);
                this.lastBotMessage = liveBubble;
            }

            const textEl = liveBubble.querySelector('.chat-widget__message-text');
            if (textEl) {
                // We keep the text as plain text while streaming, convert \n to <br> at the end
                textEl.textContent += chunk;
            }

            if (outContainer) outContainer.scrollTop = outContainer.scrollHeight;

            if (delay > 0) {
                await new Promise(r => setTimeout(r, delay));
            } else {
                await new Promise(requestAnimationFrame);
            }
        }

        this._typingLoopRunning = false;
    }

    // ---------- Messaging (STREAMING NDJSON) ----------
    async sendMessage() {
        const input = document.getElementById('chatInput');
        const message = input?.value.trim();
        if (!message) return;

        // Save user message
        this.addMessage('user', message);
        if (input) input.value = '';
        const sendBtn = document.getElementById('chatSend');
        if (sendBtn) sendBtn.disabled = true;

        // If a previous stream is active, abort it
        if (this._currentAbort) {
            try { this._currentAbort.abort(); } catch {}
            this._currentAbort = null;
        }

        this.showTypingIndicator();

        // Prepare a fresh live bubble for streaming
        const liveBubble = this.addMessage('bot', '', true /* avoid saving partial */);
        this.lastBotMessage = liveBubble;

        const ac = new AbortController();
        this._currentAbort = ac;

        // Reset replay/full text buffer
        this._lastFullText = "";

        try {
            const res = await fetch(this.webhookURL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // EXACT body your streaming webhook expects:
                body: JSON.stringify({
                    message,                  // "Wat zijn de kernwaarden van draadwerk?" etc.
                    sessionId: this.sessionId,
                    websiteId: this.websiteId
                }),
                signal: ac.signal
            });

            if (!res.ok || !res.body) {
                throw new Error(`Netwerkfout of geen stream body (status ${res.status})`);
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            // Hide the typing dots since we render our own typed text now
            this.hideTypingIndicator();

            // Stream loop
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunkText = decoder.decode(value, { stream: true });
                buffer += chunkText;

                // NDJSON: split on newlines; keep trailing partial line in buffer
                const lines = buffer.split("\n");
                buffer = lines.pop() ?? "";

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    try {
                        const obj = JSON.parse(trimmed);
                        if (obj.type === "item" && obj.content) {
                            // append to queue and type it
                            this._typingQueue += obj.content;
                            this._lastFullText += obj.content;
                            this._startTypingLoop();
                        }
                    } catch (e) {
                        // ignore malformed line
                        console.warn("Kon NDJSON niet parsen:", line, e);
                    }
                }
            }

            // Flush last (possibly partial) line
            if (buffer.trim()) {
                try {
                    const lastObj = JSON.parse(buffer);
                    if (lastObj.type === "item" && lastObj.content) {
                        this._typingQueue += lastObj.content;
                        this._lastFullText += lastObj.content;
                        this._startTypingLoop();
                    }
                } catch {}
            }

            // Ensure typing queue is fully rendered before we finalize the bubble
            await this._waitForTypingToDrain();

            // Convert the live bubble's textContent into HTML (respect \n)
            const textEl = liveBubble.querySelector('.chat-widget__message-text');
            if (textEl && textEl.textContent) {
                const html = textEl.textContent.replace(/\n/g, "<br>");
                textEl.innerHTML = html;
            }

            // Persist the final bot message to history
            this.saveMessageToSession({
                type: 'bot',
                htmlText: liveBubble.querySelector('.chat-widget__message-text')?.innerHTML || '',
                timestamp: new Date().toISOString()
            });

            // Enable feedback buttons
            this.lastBotMessage = liveBubble;
            document.getElementById('thumbsUp')?.removeAttribute('disabled');
            document.getElementById('thumbsDown')?.removeAttribute('disabled');

        } catch (err) {
            this.hideTypingIndicator();
            if (err?.name === "AbortError") {
                this._appendToLiveBubble(liveBubble, "\n\n⏹️ Verzoek afgebroken.");
            } else {
                console.error(err);
                this._appendToLiveBubble(liveBubble, "Er ging iets mis.");
            }

            // finalize + save error bubble
            await this._waitForTypingToDrain();
            const textEl = liveBubble.querySelector('.chat-widget__message-text');
            if (textEl) textEl.innerHTML = (textEl.textContent || "").replace(/\n/g, "<br>");
            this.saveMessageToSession({
                type: 'bot',
                htmlText: liveBubble.querySelector('.chat-widget__message-text')?.innerHTML || '',
                timestamp: new Date().toISOString()
            });
        } finally {
            if (sendBtn) sendBtn.disabled = false;
            this._currentAbort = null;
        }
    }

    _appendToLiveBubble(bubble, text) {
        if (!bubble) return;
        const textEl = bubble.querySelector('.chat-widget__message-text');
        if (textEl) {
            textEl.textContent += text;
            const messages = document.getElementById('chatMessages');
            if (messages) messages.scrollTop = messages.scrollHeight;
        }
    }

    async _waitForTypingToDrain() {
        // wait until queue empties and loop stops
        while (this._typingQueue.length > 0 || this._typingLoopRunning) {
            await new Promise(r => setTimeout(r, 10));
        }
    }

    addMessage(type, htmlText, isRestoring = false) {
        const msg = document.createElement('div');
        msg.className = `chat-widget__message chat-widget__message--${type}`;

        const timestamp = new Date();
        const formattedTime = timestamp.toLocaleString('nl-NL', {
            day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
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

        // Optional: your streaming webhook likely ignores this; keep for parity
        fetch(this.webhookURL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'feedback',
                feedback: feedbackLabel,
                sessionId: this.sessionId,
                websiteId: this.websiteId,
                ...(this.userId && { userId: this.userId })
            })
        }).catch(() => {});
    }

    handleContact() {
        const html = (this?.texts?.cta || this.DEFAULTS.cta_text).replace(/\n/g, "<br>");
        this.addMessage('bot', html);
    }

    // ---------- Persistence ----------
    saveMessageToSession(message) {
        const history = JSON.parse(this.lsGet(this.KEY_HISTORY) || '[]');
        history.push(message);
        this.lsSet(this.KEY_HISTORY, JSON.stringify(history));

        this.postChannel({ type: "historyChanged" });
        this.lsSet(this.KEY_HISTORY, JSON.stringify(history)); // ensure storage event triggers
    }

    restoreChatHistory() {
        if (this.chatRestored) return;

        const history = JSON.parse(this.lsGet(this.KEY_HISTORY) || '[]');

        const messagesEl = document.getElementById('chatMessages');
        if (messagesEl) messagesEl.innerHTML = '';

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

    // Kept for compatibility (not used if welcome already added on config load)
    maybeAddWelcomeMessage() {
        const alreadyWelcomed = this.lsGet(this.KEY_WELCOME);
        if (!alreadyWelcomed) {
            this.addMessage('bot', this.DEFAULTS.opening_message);
            this.lsSet(this.KEY_WELCOME, 'true');
        }
    }
}
