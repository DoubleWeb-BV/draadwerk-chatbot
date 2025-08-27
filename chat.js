// chat.js
class ChatWidget {
    /**
     * @param {string} webhookURL - streaming message webhook (NDJSON line per chunk)
     * @param {string|null} sessionId
     * @param {string|undefined} userId
     * @param {string} websiteId - REQUIRED for your n8n flow
     * @param {{typeDelayMs?:number, charsPerTick?:number}} typingOpts
     */
    constructor(webhookURL, sessionId = null, userId, websiteId, typingOpts = {}) {
        // Endpoints
        this.webhookURL = webhookURL; // streaming webhook
        this.CONFIG_WEBHOOK = "https://workflows.draadwerk.nl/webhook/fdfc5f47-4bf7-4681-9d5e-ed91ae318526g";

        // Identity
        this.userId = userId;       // niet nodig voor config webhook
        this.websiteId = websiteId; // WEL nodig
        if (!this.websiteId) {
            console.warn("[ChatWidget] websiteId is leeg; config webhook krijgt null.");
        }

        // Typing FX – iets langzamer standaard
        this.typeDelayMs  = Number.isFinite(typingOpts.typeDelayMs)  ? typingOpts.typeDelayMs  : 250; // was 8
        this.charsPerTick = Number.isFinite(typingOpts.charsPerTick) ? typingOpts.charsPerTick : 1;  // was 2

        // Internal typing state
        this._typingQueue = "";
        this._typingLoopRunning = false;
        this._currentAbort = null;
        this._lastFullText = "";

        // Storage keys
        this.LS_PREFIX = "dwChat:";
        this.KEY_SESSION_ID = this.LS_PREFIX + "sessionId";
        this.KEY_HISTORY    = null;
        this.KEY_WELCOME    = null;
        this.KEY_OPEN       = null;
        this.KEY_TOOLTIP    = null;
        this.KEY_CONFIG     = `${this.LS_PREFIX}config:${this.websiteId || "default"}`;

        // Tab + last seen
        this.SS_TAB_ID     = this.LS_PREFIX + "tabId";
        this.KEY_LAST_SEEN = this.LS_PREFIX + "lastSeen";
        this.RESET_MS      = 4000;

        // State
        this.isOpen = false;
        this.lastBotMessage = null;
        this.chatRestored = false;
        this.chatConfig = null;
        this.configLoaded = false;
        this.configReady = null;
        this._sessionJustCreated = false; // wordt gezet in loadOrCreateSessionId

        this.texts = {
            success: "Dank je! Fijn dat ik je kon helpen. 😊",
            notUseful: "Sorry dat dit niet nuttig was. Kan ik je op een andere manier helpen?",
            cta: "Neem direct contact met ons op via: <br><br>📞 Telefoon: 0000 - 000 000 <br>📧 E-mail: info@example.com",
        };

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

        this.channel = null;

        // 1) tab fingerprint
        this.adoptOrCreateTabId();
        // 2) fresh-start detection
        this.maybeResetForNewBrowser();
        // 3) session id (zet ook _sessionJustCreated)
        this.sessionId = this.loadOrCreateSessionId(sessionId);

        // per-session keys
        this.KEY_HISTORY = `${this.LS_PREFIX}history:${this.sessionId}`;
        this.KEY_WELCOME = `${this.LS_PREFIX}welcome:${this.sessionId}`;
        this.KEY_OPEN    = `${this.LS_PREFIX}isOpen:${this.sessionId}`;
        this.KEY_TOOLTIP = `${this.LS_PREFIX}tooltipDismissed:${this.sessionId}`;

        // Init
        this.init();
    }

    // ---------- Storage helpers ----------
    lsGet(k){ return localStorage.getItem(k); }
    lsSet(k,v){ localStorage.setItem(k,v); }
    lsRemove(k){ localStorage.removeItem(k); }
    ssGet(k){ return sessionStorage.getItem(k); }
    ssSet(k,v){ sessionStorage.setItem(k,v); }

    // ---------- Hide/Reveal ----------
    ensureHidden(){
        const root=document.getElementById('chat-widget');
        if(root){ root.setAttribute('data-ready','0'); root.style.visibility='hidden'; root.style.opacity='0'; }
    }
    revealWidget(){
        const root=document.getElementById('chat-widget');
        if(root){ root.setAttribute('data-ready','1'); root.style.visibility='visible'; root.style.opacity='1'; }
    }

    // ---------- Tab fingerprint & browser-new detection ----------
    adoptOrCreateTabId(){
        let tabId=this.ssGet(this.SS_TAB_ID);
        if(!tabId){
            tabId='tab-'+Date.now()+'-'+Math.random().toString(36).slice(2,9);
            this.ssSet(this.SS_TAB_ID,tabId);
            this._isBrandNewTab=true;
        } else {
            this._isBrandNewTab=false;
        }
    }
    maybeResetForNewBrowser(){
        const lastSeen=parseInt(this.lsGet(this.KEY_LAST_SEEN)||"0",10);
        const now=Date.now();
        if(this._isBrandNewTab && (now-lastSeen)>this.RESET_MS){
            const sid=this.lsGet(this.KEY_SESSION_ID);
            if(sid){
                this.lsRemove(`${this.LS_PREFIX}history:${sid}`);
                this.lsRemove(`${this.LS_PREFIX}welcome:${sid}`);
                this.lsRemove(`${this.LS_PREFIX}isOpen:${sid}`);
                this.lsRemove(`${this.LS_PREFIX}tooltipDismissed:${sid}`);
            }
            this.lsRemove(this.KEY_SESSION_ID);
        }
        this.lsSet(this.KEY_LAST_SEEN,String(now));
        this.installHeartbeat();
    }
    installHeartbeat(){
        document.addEventListener('visibilitychange',()=>this.lsSet(this.KEY_LAST_SEEN,String(Date.now())));
        window.addEventListener('pagehide',()=>this.lsSet(this.KEY_LAST_SEEN,String(Date.now())));
        this._heartbeat=setInterval(()=>{ if(!document.hidden) this.lsSet(this.KEY_LAST_SEEN,String(Date.now())); },2000);
    }

    // ---------- Session ID ----------
    loadOrCreateSessionId(provided){
        let sid=this.lsGet(this.KEY_SESSION_ID);
        if(!sid){
            sid=provided || ('session-'+Date.now()+'-'+Math.random().toString(36).substr(2,9));
            this.lsSet(this.KEY_SESSION_ID,sid);
            this._sessionJustCreated = true;
        } else {
            this._sessionJustCreated = false;
        }
        return sid;
    }

    // ---------- Init ----------
    init(){
        this.ensureHidden();
        this.bindEvents();
        this.setupBroadcastChannel();
        this.setupStorageSync();

        // Config slechts één keer per sessie ophalen; anders uit cache
        this.configReady=this.preloadChatData().catch(()=>{});
        this.configReady.finally(()=>{
            this.restoreOpenState();
            this.showTooltip();
            this.startPulseAnimation();
        });
    }

    // ---------- Events ----------
    bindEvents(){
        const chatButton=document.getElementById('chatButton');
        const chatClose=document.getElementById('chatClose');
        const chatSend=document.getElementById('chatSend');
        const chatInput=document.getElementById('chatInput');
        const thumbsUp=document.getElementById('thumbsUp');
        const thumbsDown=document.getElementById('thumbsDown');
        const contactBtn=document.getElementById('contactBtn');
        const chatTooltip=document.getElementById('chatTooltip');

        chatButton?.addEventListener('click',()=>this.toggleChat());
        chatClose?.addEventListener('click',()=>this.closeChat());
        chatSend?.addEventListener('click',()=>this.sendMessage());
        thumbsUp?.addEventListener('click',()=>this.handleFeedback(true));
        thumbsDown?.addEventListener('click',()=>this.handleFeedback(false));
        contactBtn?.addEventListener('click',()=>this.handleContact());

        chatInput?.addEventListener('keydown',(e)=>{
            if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); this.sendMessage(); }
        });
        chatInput?.addEventListener('input',(e)=>{
            if (chatSend) chatSend.disabled = e.target.value.trim().length===0;
        });

        chatTooltip?.addEventListener('click', async()=>{
            await this.toggleChat(); this.dismissTooltip();
        });
        chatTooltip?.addEventListener('keydown', async(e)=>{
            if(e.key==='Enter' || e.key===' '){ e.preventDefault(); await this.toggleChat(); this.dismissTooltip(); }
        });

        ['click','keydown','scroll','pointerdown'].forEach(evt =>
            window.addEventListener(evt, () => this.lsSet(this.KEY_LAST_SEEN,String(Date.now())), {passive:true})
        );
    }

    // ---------- Cross-tab sync ----------
    setupBroadcastChannel(){
        if("BroadcastChannel" in window){
            this.channel=new BroadcastChannel("dw-chat");
            this.channel.onmessage=(evt)=>{
                const msg=evt.data||{};
                if(msg.type==="openState"){
                    if(msg.value===true && !this.isOpen) this.openChat();
                    if(msg.value===false && this.isOpen) this.closeChat();
                }
                if(msg.type==="historyChanged"){ this.chatRestored=false; this.restoreChatHistory(); }
                if(msg.type==="tooltipDismissed"){ this.hideTooltip(); }
            };
        }
    }
    postChannel(payload){ if(this.channel){ try{ this.channel.postMessage(payload); }catch{} } }

    setupStorageSync(){
        window.addEventListener('storage', async (e)=>{
            if(!e.key) return;
            if(e.key===this.KEY_OPEN){
                const shouldBeOpen=this.lsGet(this.KEY_OPEN)==='true';
                if(shouldBeOpen && !this.isOpen) await this.openChat();
                if(!shouldBeOpen && this.isOpen) this.closeChat();
                return;
            }
            if(e.key===this.KEY_HISTORY){ this.chatRestored=false; this.restoreChatHistory(); return; }
            if(e.key===this.KEY_TOOLTIP){ const dismissed=this.lsGet(this.KEY_TOOLTIP)==='true'; if(dismissed) this.hideTooltip(); return; }
        });
    }

    // ---------- Tooltip ----------
    showTooltip(){
        setTimeout(()=>{
            if(!this.configLoaded) return;
            const dismissed=this.lsGet(this.KEY_TOOLTIP);
            if(!this.isOpen && !dismissed){
                document.getElementById('chatTooltip')?.classList.add('chat-widget__tooltip--visible');
            }
        }, 5000);
    }
    hideTooltip(){ document.getElementById('chatTooltip')?.classList.remove('chat-widget__tooltip--visible'); }
    dismissTooltip(){
        const el=document.getElementById('chatTooltip');
        if(el){ el.classList.remove('chat-widget__tooltip--visible'); el.style.display='none'; }
        this.lsSet(this.KEY_TOOLTIP,'true');
        this.postChannel({ type: "tooltipDismissed" });
    }
    startPulseAnimation(){ setTimeout(()=>{ document.getElementById('chatButton')?.classList.add('chat-widget__button--pulse'); }, 10000); }

    // ---------- Theme (CSS vars) ----------
    applyTheme(primary, secondary){
        const root=document.querySelector('#chat-widget') || document.documentElement;
        root.style.setProperty('--primary-color', primary || this.DEFAULTS.primary_color);
        root.style.setProperty('--secondary-color', secondary || this.DEFAULTS.secondary_color);
    }

    // ---------- Helpers ----------
    _normalize(value, fallback){
        if(Array.isArray(value)) value=value[0];
        if(typeof value!=="string") return fallback;
        const trimmed=value.trim();
        return trimmed.length ? trimmed : fallback;
    }

    // ---------- Apply remote config ----------
    applyRemoteConfig(raw){
        const cfg={
            avatar_url:         this._normalize(raw?.avatar_url,         this.DEFAULTS.avatar_url),
            chatbot_name:       this._normalize(raw?.chatbot_name,       this.DEFAULTS.chatbot_name),
            name_subtitle:      this._normalize(raw?.name_subtitle,      this.DEFAULTS.name_subtitle),
            tooltip:            this._normalize(raw?.tooltip,            this.DEFAULTS.tooltip),
            opening_message:    this._normalize(raw?.opening_message,    this.DEFAULTS.opening_message),
            placeholder_message:this._normalize(raw?.placeholder_message,this.DEFAULTS.placeholder_message),
            cta_button_text:    this._normalize(raw?.cta_button_text,    this.DEFAULTS.cta_button_text),
            cta_text:           this._normalize(raw?.cta_text,           this.DEFAULTS.cta_text),
            success_text:       this._normalize(raw?.success_text,       this.DEFAULTS.success_text),
            not_useful_text:    this._normalize(raw?.not_useful_text,    this.DEFAULTS.not_useful_text),
            primary_color:      this._normalize(raw?.primary_color,      this.DEFAULTS.primary_color),
            secondary_color:    this._normalize(raw?.secondary_color,    this.DEFAULTS.secondary_color),
        };

        this.texts = {
            success:  cfg.success_text,
            notUseful:cfg.not_useful_text,
            cta:      cfg.cta_text,
        };
        this.chatConfig = cfg;

        this.applyTheme(cfg.primary_color, cfg.secondary_color);

        const $ = (sel)=>document.querySelector(sel);

        const avatar1=$("#js-profile-image");
        const avatar2=$("#js-profile-image-2");
        if(cfg.avatar_url){
            if(avatar1) avatar1.src=cfg.avatar_url;
            if(avatar2) avatar2.src=cfg.avatar_url;
        }

        const headerTitle=$(".chat-widget__header-title");
        if(headerTitle) headerTitle.textContent=cfg.chatbot_name;

        const headerSubtitle=$(".chat-widget__header-subtitle");
        if(headerSubtitle) headerSubtitle.textContent=`Online • ${cfg.name_subtitle}`;

        const tooltipEl=$("#chatTooltip");
        if(tooltipEl){ tooltipEl.textContent=cfg.tooltip; tooltipEl.setAttribute("aria-label","Open chat"); }

        const contactBtn=$("#contactBtn");
        if(contactBtn) contactBtn.textContent=cfg.cta_button_text;

        const input=$("#chatInput");
        if(input) input.setAttribute("placeholder", cfg.placeholder_message);

        this.configLoaded=true;
        this.revealWidget();

        const alreadyWelcomed=this.lsGet(this.KEY_WELCOME)==="true";
        const hasHistory=(this.lsGet(this.KEY_HISTORY)||"[]")!=="[]";
        if(!alreadyWelcomed && !hasHistory && cfg.opening_message){
            const html = cfg.opening_message.replace(/\n/g,"<br>");
            this.addMessage("bot", html);
            this.lsSet(this.KEY_WELCOME,"true");
        }
    }

    // ---------- Preload from n8n (POST) ----------
    async preloadChatData(){
        try{
            // Gebruik cache als de sessie niet net is aangemaakt
            if (!this._sessionJustCreated) {
                const cached = this.lsGet(this.KEY_CONFIG);
                if (cached) {
                    try {
                        const cfg = JSON.parse(cached);
                        this.applyRemoteConfig(cfg);
                        return; // geen netwerk-call
                    } catch {}
                }
            }

            // Anders (nieuwe sessie of geen cache): één call naar de webhook
            const res = await fetch(this.CONFIG_WEBHOOK, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    websiteId: this.websiteId || null,
                    sessionId: this.sessionId || null
                })
            });
            if(!res.ok) throw new Error(`Webhook error: ${res.status}`);

            const data = await res.json();
            // cache config voor deze websiteId
            try { this.lsSet(this.KEY_CONFIG, JSON.stringify(data)); } catch {}
            this.applyRemoteConfig(data);

        } catch (_err){
            // Fallback: defaults
            this.applyTheme(this.DEFAULTS.primary_color, this.DEFAULTS.secondary_color);
            this.configLoaded = true;
            this.revealWidget();

            const alreadyWelcomed=this.lsGet(this.KEY_WELCOME)==="true";
            const hasHistory=(this.lsGet(this.KEY_HISTORY)||"[]")!=="[]";
            if(!alreadyWelcomed && !hasHistory){
                this.addMessage('bot', this.DEFAULTS.opening_message);
                this.lsSet(this.KEY_WELCOME,'true');
            }
        }
    }

    // ---------- Open / Close ----------
    async toggleChat(){ return this.isOpen ? this.closeChat() : this.openChat(); }

    async openChat(){
        if(!this.configLoaded && this.configReady){ await this.configReady; }
        const container=document.getElementById('chatContainer');
        container?.classList.add('chat-widget__container--open');
        this.isOpen = true;

        this.lsSet(this.KEY_OPEN,'true');
        this.postChannel({ type:"openState", value:true });

        this.hideTooltip();
        this.restoreChatHistory();

        setTimeout(()=> document.getElementById('chatInput')?.focus(), 300);
    }

    closeChat(){
        document.getElementById('chatContainer')?.classList.remove('chat-widget__container--open');
        this.isOpen = false;

        this.lsSet(this.KEY_OPEN,'false');
        this.postChannel({ type:"openState", value:false });
    }

    restoreOpenState(){
        const wasOpen=this.lsGet(this.KEY_OPEN);
        if(wasOpen==='true'){
            if(this.configReady){ this.configReady.then(()=>this.openChat()); }
            else { this.openChat(); }
        }
    }

    // ---------- Typing engine ----------
    async _startTypingLoop() {
        if (this._typingLoopRunning) return;
        this._typingLoopRunning = true;

        let liveBubble = this.lastBotMessage;

        while (this._typingQueue.length > 0) {
            // wacht tot sendMessage de eerste bubble maakt
            if (!liveBubble) {
                await new Promise(r => setTimeout(r, 10));
                liveBubble = this.lastBotMessage;
                continue;
            }

            const n = Math.max(1, this.charsPerTick | 0);
            const delay = Math.max(0, this.typeDelayMs | 0);

            const chunk = this._typingQueue.slice(0, n);
            this._typingQueue = this._typingQueue.slice(n);

            // raw buffer opbouwen en meteen HTML renderen
            liveBubble._rawStream = (liveBubble._rawStream || "") + chunk;
            this._renderStreamInto(liveBubble, liveBubble._rawStream);

            const outContainer = document.getElementById('chatMessages');
            if (outContainer) outContainer.scrollTop = outContainer.scrollHeight;

            if (delay > 0) { await new Promise(r => setTimeout(r, delay)); }
            else { await new Promise(requestAnimationFrame); }
        }

        this._typingLoopRunning = false;
    }

    async _waitForTypingToDrain(){
        while(this._typingQueue.length>0 || this._typingLoopRunning){
            await new Promise(r => setTimeout(r, 10));
        }
    }

    _appendToLiveBubble(bubble, text){
        if(!bubble) return;
        bubble._rawStream = (bubble._rawStream || "") + text;
        this._renderStreamInto(bubble, bubble._rawStream);
    }

    _renderStreamInto(bubble, rawText) {
        const textEl = bubble.querySelector('.chat-widget__message-text');
        if (!textEl) return;
        textEl.innerHTML = this._renderMarkup(rawText);
        const messages = document.getElementById('chatMessages');
        if (messages) messages.scrollTop = messages.scrollHeight;
    }

    // ---- Live renderer: lijsten + markdown links + autolink + sanitizen ----
    _renderMarkup(text) {
        // 1) Markdown-achtige lijsten -> echte <ul>/<ol>
        let htmlish = this._convertMarkdownLists(text);

        // 2) Markdown links [tekst](url) -> <a>
        htmlish = htmlish.replace(
            /\[([^[\]]+)\]\(((?:https?:\/\/|www\.)[^\s)]+)\)/gi,
            (m, label, url) => `<a href="${url}">${label}</a>`
        );

        // 3) Sanitize + autolink + linebreaks
        return this._sanitizeAndAutolink(htmlish);
    }

    _convertMarkdownLists(text) {
        const lines = text.split('\n');
        let out = '';
        let inUL = false;
        let inOL = false;

        const flushUL = () => { if (inUL) { out += '</ul>'; inUL = false; } };
        const flushOL = () => { if (inOL) { out += '</ol>'; inOL = false; } };

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            const ulMatch = /^\s*[-*•]\s+(.+)$/.exec(line);
            const olMatch = /^\s*\d+\.\s+(.+)$/.exec(line);

            if (ulMatch) {
                if (inOL) flushOL();
                if (!inUL) { out += '<ul>'; inUL = true; }
                out += `<li>${ulMatch[1]}</li>`;
                continue;
            }
            if (olMatch) {
                if (inUL) flushUL();
                if (!inOL) { out += '<ol>'; inOL = true; }
                out += `<li>${olMatch[1]}</li>`;
                continue;
            }

            // lege regel sluit lopende lijsten
            if (!line.trim()) {
                flushUL(); flushOL();
                out += '\n';
                continue;
            }

            // normale tekstregel
            flushUL(); flushOL();
            out += line + '\n';
        }

        flushUL(); flushOL();
        return out;
    }

    _sanitizeAndAutolink(htmlish) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlish, 'text/html');

        const allowed = new Set(['A','UL','OL','LI','BR','B','STRONG','I','EM','CODE','PRE']);

        const urlRegex = /((?:https?:\/\/|www\.)[^\s<]+)/gi;

        const sanitizeHref = (href) => {
            let u = (href || '').trim();
            if (!u) return '';
            if (/^www\./i.test(u)) u = 'https://' + u;
            if (!/^https?:\/\//i.test(u) && !/^mailto:/i.test(u) && !/^tel:/i.test(u)) return '';
            try {
                const parsed = new URL(u, window.location.origin);
                if (['http:','https:','mailto:','tel:'].includes(parsed.protocol)) return parsed.href;
            } catch {}
            return '';
        };

        const appendTextWithBreaks = (frag, text) => {
            const parts = String(text).split('\n');
            for (let i = 0; i < parts.length; i++) {
                if (parts[i]) frag.appendChild(doc.createTextNode(parts[i]));
                if (i < parts.length - 1) frag.appendChild(doc.createElement('br'));
            }
        };

        const autolinkTextNode = (node) => {
            const txt = node.nodeValue;
            let last = 0;
            const frag = doc.createDocumentFragment();

            txt.replace(urlRegex, (m, _u, idx) => {
                const before = txt.slice(last, idx);
                if (before) appendTextWithBreaks(frag, before);

                const a = doc.createElement('a');
                const safe = sanitizeHref(m);
                if (safe) {
                    a.setAttribute('href', safe);
                    a.setAttribute('target', '_blank');
                    a.setAttribute('rel', 'noopener noreferrer');
                    a.textContent = m;
                    frag.appendChild(a);
                } else {
                    appendTextWithBreaks(frag, m);
                }
                last = idx + m.length;
                return m;
            });

            const rest = txt.slice(last);
            if (rest) appendTextWithBreaks(frag, rest);

            node.parentNode.replaceChild(frag, node);
        };

        const walk = (node) => {
            for (const child of [...node.childNodes]) {
                if (child.nodeType === 3) { // text
                    autolinkTextNode(child);
                } else if (child.nodeType === 1) { // element
                    const tag = child.tagName;

                    if (!allowed.has(tag)) {
                        // unwrap: behoud inhoud, verwijder element
                        const frag = doc.createDocumentFragment();
                        while (child.firstChild) frag.appendChild(child.firstChild);
                        node.replaceChild(frag, child);
                        continue; // process moved children in next iteration
                    }

                    if (tag === 'A') {
                        const safe = sanitizeHref(child.getAttribute('href') || '');
                        if (!safe) {
                            const frag = doc.createDocumentFragment();
                            while (child.firstChild) frag.appendChild(child.firstChild);
                            node.replaceChild(frag, child);
                            continue;
                        }
                        child.setAttribute('href', safe);
                        child.setAttribute('target', '_blank');
                        child.setAttribute('rel', 'noopener noreferrer');
                        // verwijder overige attrs
                        for (const attr of [...child.attributes]) {
                            const name = attr.name.toLowerCase();
                            if (!['href','target','rel'].includes(name)) child.removeAttribute(attr.name);
                        }
                    } else {
                        // geen attrs op andere tags
                        for (const attr of [...child.attributes]) child.removeAttribute(attr.name);
                    }

                    walk(child);
                } else if (child.nodeType === 8) {
                    node.removeChild(child); // comments weg
                }
            }
        };

        walk(doc.body);
        return doc.body.innerHTML;
    }

    // ---------- Messaging (STREAMING NDJSON) ----------
    async sendMessage(){
        const input=document.getElementById('chatInput');
        const message=input?.value.trim();
        if(!message) return;

        // Save user message
        this.addMessage('user', message);
        if(input) input.value='';
        const sendBtn=document.getElementById('chatSend');
        if(sendBtn) sendBtn.disabled=true;

        // Cancel any in-flight stream
        if(this._currentAbort){ try{ this._currentAbort.abort(); }catch{} this._currentAbort=null; }

        // Eerst dots; bubble maken we pas bij eerste chunk
        this.showTypingIndicator();
        let liveBubble = null;

        const ac = new AbortController();
        this._currentAbort = ac;
        this._lastFullText = "";

        try{
            const res = await fetch(this.webhookURL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message,
                    sessionId: this.sessionId,
                    websiteId: this.websiteId
                }),
                signal: ac.signal
            });

            if(!res.ok || !res.body){
                throw new Error(`Netwerkfout of geen stream body (status ${res.status})`);
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            while(true){
                const { done, value } = await reader.read();
                if (done) break;

                const chunkText = decoder.decode(value, { stream: true });
                buffer += chunkText;

                const lines = buffer.split("\n");
                buffer = lines.pop() ?? "";

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    try {
                        const obj = JSON.parse(trimmed);
                        if (obj.type === "item" && obj.content) {
                            if (!liveBubble) {
                                this.hideTypingIndicator();
                                liveBubble = this.addMessage('bot', '', true);
                                this.lastBotMessage = liveBubble;
                            }
                            this._typingQueue += obj.content;
                            this._lastFullText += obj.content;
                            this._startTypingLoop();
                        }
                    } catch (e) {
                        console.warn("Kon NDJSON niet parsen:", line, e);
                    }
                }
            }

            // Flush last partial line if any
            if (buffer.trim()) {
                try {
                    const lastObj = JSON.parse(buffer);
                    if (lastObj.type === "item" && lastObj.content) {
                        if (!liveBubble) {
                            this.hideTypingIndicator();
                            liveBubble = this.addMessage('bot','',true);
                            this.lastBotMessage = liveBubble;
                        }
                        this._typingQueue += lastObj.content;
                        this._lastFullText += lastObj.content;
                        this._startTypingLoop();
                    }
                } catch {}
            }

            if (!liveBubble) {
                this.hideTypingIndicator();
                liveBubble = this.addMessage('bot', 'Geen antwoord ontvangen.', true);
            }

            await this._waitForTypingToDrain();

            // Stream-rendering heeft HTML al gezet; toch nog 1x final clean
            const textEl = liveBubble.querySelector('.chat-widget__message-text');
            if (textEl && liveBubble._rawStream) {
                textEl.innerHTML = this._renderMarkup(liveBubble._rawStream);
            }

            this.saveMessageToSession({
                type: 'bot',
                htmlText: liveBubble.querySelector('.chat-widget__message-text')?.innerHTML || '',
                timestamp: new Date().toISOString()
            });

            this.lastBotMessage = liveBubble;
            document.getElementById('thumbsUp')?.removeAttribute('disabled');
            document.getElementById('thumbsDown')?.removeAttribute('disabled');

        } catch (err) {
            if (!liveBubble) {
                this.hideTypingIndicator();
                liveBubble = this.addMessage('bot', '', true);
            }

            if (err?.name === "AbortError") {
                this._appendToLiveBubble(liveBubble, "\n\n⏹️ Verzoek afgebroken.");
            } else {
                console.error(err);
                this._appendToLiveBubble(liveBubble, "Er ging iets mis.");
            }

            await this._waitForTypingToDrain();
            const textEl = liveBubble.querySelector('.chat-widget__message-text');
            if (textEl) textEl.innerHTML = this._renderMarkup(liveBubble._rawStream || textEl.textContent || "");
            this.saveMessageToSession({
                type: 'bot',
                htmlText: liveBubble.querySelector('.chat-widget__message-text')?.innerHTML || '',
                timestamp: new Date().toISOString()
            });

        } finally {
            if(sendBtn) sendBtn.disabled=false;
            this._currentAbort = null;
        }
    }

    // ---------- UI helpers ----------
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

    showTypingIndicator(){
        const indicator=document.createElement('div');
        indicator.id='typingIndicator';
        indicator.className='chat-widget__typing chat-widget__typing--visible';
        indicator.innerHTML=`
      <div class="chat-widget__typing-dot"></div>
      <div class="chat-widget__typing-dot"></div>
      <div class="chat-widget__typing-dot"></div>
    `;
        const messages=document.getElementById('chatMessages');
        messages?.appendChild(indicator);
        if(messages) messages.scrollTop = messages.scrollHeight;
    }

    hideTypingIndicator(){
        document.getElementById('typingIndicator')?.remove();
    }

    handleFeedback(isUseful){
        const thumbsUp=document.getElementById('thumbsUp');
        const thumbsDown=document.getElementById('thumbsDown');

        if (thumbsUp?.disabled || thumbsDown?.disabled) {
            this.addMessage('bot','Stel eerst een vraag zodat ik je kan helpen voordat je feedback geeft. 🙂');
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
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                type:'feedback',
                feedback:feedbackLabel,
                sessionId:this.sessionId,
                websiteId:this.websiteId,
                ...(this.userId && { userId: this.userId })
            })
        }).catch(()=>{});
    }

    handleContact(){
        const html=(this?.texts?.cta || this.DEFAULTS.cta_text).replace(/\n/g,"<br>");
        this.addMessage('bot',html);
    }

    // ---------- Persistence ----------
    saveMessageToSession(message){
        const history = JSON.parse(this.lsGet(this.KEY_HISTORY) || '[]');
        history.push(message);
        this.lsSet(this.KEY_HISTORY, JSON.stringify(history));
        this.postChannel({ type:"historyChanged" });
        this.lsSet(this.KEY_HISTORY, JSON.stringify(history)); // Safari quirk
    }

    restoreChatHistory(){
        if (this.chatRestored) return;
        const history = JSON.parse(this.lsGet(this.KEY_HISTORY) || '[]');

        const messagesEl = document.getElementById('chatMessages');
        if (messagesEl) messagesEl.innerHTML = '';

        history.forEach(entry => {
            this.addMessage(entry.type, entry.htmlText, true);
        });

        this.chatRestored = true;
    }

    clearChatHistory(){
        this.lsRemove(this.KEY_HISTORY);
        this.lsRemove(this.KEY_WELCOME);
        this.lsRemove(this.KEY_TOOLTIP);
        this.lsRemove(this.KEY_OPEN);
        this.chatRestored=false;
    }

    maybeAddWelcomeMessage(){
        const alreadyWelcomed=this.lsGet(this.KEY_WELCOME);
        if(!alreadyWelcomed){
            this.addMessage('bot', this.DEFAULTS.opening_message);
            this.lsSet(this.KEY_WELCOME,'true');
        }
    }
}
