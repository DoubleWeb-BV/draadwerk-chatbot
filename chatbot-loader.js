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

    try {
        // Assets ophalen
        const [html, css] = await Promise.all([
            fetch(htmlURL).then(r => r.text()),
            fetch(cssURL).then(r => r.text()),
        ]);

        // Iframe hosten
        const frame = document.createElement("iframe");
        frame.id = "dw-chatbot-frame";
        frame.title = "Chatbot";
        Object.assign(frame.style, {
            position: "fixed",
            bottom: "16px",
            right: "16px",
            width: "380px",   // pas aan naar wens
            height: "620px",  // pas aan naar wens
            border: "0",
            zIndex: "2147483647",
            background: "transparent",
        });
        document.body.appendChild(frame);

        const doc = frame.contentDocument || frame.contentWindow.document;
        doc.open();
        doc.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>${css}</style>
</head>
<body>
  <!-- Chat HTML -->
  <div id="dw-chatbot-root">${html}</div>

  <script>
    (function () {
      // Profielfoto's instellen binnen het iframe
      var imgURL = ${JSON.stringify(imgURL)};
      var profileImage1 = document.getElementById('js-profile-image');
      if (profileImage1) {
        profileImage1.src = imgURL;
        profileImage1.onerror = function () {
          profileImage1.src = 'https://via.placeholder.com/40?text=?';
        };
      }
      var profileImage2 = document.getElementById('js-profile-image-2');
      if (profileImage2) {
        profileImage2.src = imgURL;
        profileImage2.onerror = function () {
          profileImage2.src = 'https://via.placeholder.com/40?text=?';
        };
      }

      // Config beschikbaar maken voor chat.js
      window.__DW_CONFIG__ = {
        webhookURL: ${JSON.stringify(webhookURL)},
        sessionId: ${JSON.stringify(sessionId)},
        userId: ${JSON.stringify(userId)}
      };
    })();
  </script>

  <script src="${jsURL}"></script>
  <script>
    // Initialiseren in het iframe-document
    if (typeof ChatWidget !== 'undefined') {
      new ChatWidget(
        window.__DW_CONFIG__.webhookURL,
        window.__DW_CONFIG__.sessionId,
        window.__DW_CONFIG__.userId
      );
    } else {
      console.error("[Chatbot Loader] ChatWidget niet gevonden in iframe.");
    }
  </script>
</body>
</html>`);
        doc.close();
    } catch (err) {
        console.error("[Chatbot Loader] Fout bij laden:", err);
    }
})();
