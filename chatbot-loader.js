// chatbot-loader.js  (no iframe)
(async function () {
    const ts = Date.now();
    const currentScript = document.currentScript || [...document.scripts].pop();
    const scriptSrc = currentScript?.src || "";
    const versionMatch = scriptSrc.match(/@([^/]+)\/chatbot-loader\.js/);
    const version = versionMatch ? versionMatch[1] : "latest";
    const base = `https://cdn.jsdelivr.net/gh/DoubleWeb-BV/draadwerk-chatbot@${version}/`;

    const cssURL  = `${base}chat.css?ts=${ts}`;
    const htmlURL = `${base}chat.html?ts=${ts}`;
    const jsURL   = `${base}chat.js?ts=${ts}`;
    const imgURL  = `${base}profile.jpg?ts=${ts}`;

    const webhookURL = "https://workflows.draadwerk.nl/webhook/draadwerk-chatbot-v2";
    const userId = currentScript.dataset.userId || null;

    // Unieke sessie-ID
    const sessionId = ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );

    // Fetch assets
    const [html, css] = await Promise.all([
        fetch(htmlURL).then(r => r.text()),
        fetch(cssURL).then(r => r.text()),
    ]);

    // Host container (position fixed lives on the light DOM host)
    const host = document.createElement("div");
    host.id = "dw-chatbot-host";
    Object.assign(host.style, {
        position: "fixed",
        bottom: "16px",
        right: "16px",
        width: "380px",
        height: "620px",
        zIndex: "2147483647",
    });
    document.body.appendChild(host);

    // Shadow DOM (isolates CSS from the page)
    const shadow = host.attachShadow({ mode: "open" });

    // Optional: base reset inside shadow (keeps things predictable)
    const reset = `
    :host, :host * { box-sizing: border-box; }
    :host { all: initial; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"; }
  `;

    // Add CSS to shadow (prefer Constructable Stylesheets for perf)
    if ("adoptedStyleSheets" in Document.prototype && "replace" in CSSStyleSheet.prototype) {
        const sheet = new CSSStyleSheet();
        await sheet.replace(`${reset}\n${css}`);
        shadow.adoptedStyleSheets = [sheet];
    } else {
        const style = document.createElement("style");
        style.textContent = `${reset}\n${css}`;
        shadow.appendChild(style);
    }

    // Insert HTML
    const root = document.createElement("div");
    root.id = "dw-chatbot-root";
    root.innerHTML = html;
    shadow.appendChild(root);

    // Profile images inside shadow
    const setImg = (id) => {
        const el = root.querySelector(`#${id}`);
        if (el) {
            el.src = imgURL;
            el.onerror = () => { el.src = 'https://via.placeholder.com/40?text=?'; };
        }
    };
    setImg('js-profile-image');
    setImg('js-profile-image-2');

    // Smart link handling: same-origin -> same tab; external -> new tab
    root.addEventListener('click', (e) => {
        const a = e.target.closest('a');
        if (!a) return;
        // If link lacks href, ignore
        const href = a.getAttribute('href');
        if (!href) return;

        // Normalize absolute URL
        const url = new URL(href, window.location.href);
        const isSameOrigin = url.origin === window.location.origin;

        // Never let it be handled by default inside the shadow
        e.preventDefault();

        if (isSameOrigin) {
            // Same site: same tab
            window.location.assign(url.href);
        } else {
            // External: new tab, safe features
            window.open(url.href, "_blank", "noopener,noreferrer");
        }
    });

    // Make config available
    const CONFIG = { webhookURL, sessionId, userId };
    window.__DW_CONFIG__ = CONFIG;

    // Load widget JS once, then mount into shadow root
    await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = jsURL;
        s.async = true;
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
    });

    // Instantiate/mount. Requires chat.js to accept a `root` option (see patch below).
    if (typeof window.ChatWidget === "function") {
        // Prefer: new ChatWidget(CONFIG).mount(root)
        // Fallback: pass root via options if constructor supports it
        try {
            if ("mount" in window.ChatWidget.prototype) {
                const w = new window.ChatWidget(CONFIG);
                w.mount(root);
            } else {
                // Constructor(root) variant, backward-compatible path if you implement it
                new window.ChatWidget(CONFIG, { root });
            }
        } catch (err) {
            console.error("[Chatbot Loader] Kon de ChatWidget niet mounten:", err);
        }
    } else {
        console.error("[Chatbot Loader] ChatWidget niet gevonden.");
    }
})();
