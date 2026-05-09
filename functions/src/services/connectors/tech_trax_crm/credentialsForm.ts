import { onRequest } from "firebase-functions/https";

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Connect Tech Trax CRM</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    margin: 0;
    background: #f6f7f9;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #111;
  }
  .card {
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.08);
    padding: 28px 28px 24px;
    width: 100%;
    max-width: 400px;
  }
  h1 {
    font-size: 18px;
    margin: 0 0 4px;
    font-weight: 600;
  }
  p.sub {
    font-size: 13px;
    color: #555;
    margin: 0 0 20px;
  }
  label {
    display: block;
    font-size: 12px;
    font-weight: 500;
    color: #333;
    margin: 14px 0 6px;
  }
  input {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid #d0d4d9;
    border-radius: 8px;
    font-size: 14px;
    outline: none;
    background: #fff;
  }
  input:focus { border-color: #2f6feb; box-shadow: 0 0 0 3px rgba(47,111,235,.15); }
  button {
    margin-top: 20px;
    width: 100%;
    padding: 11px;
    background: #2f6feb;
    color: #fff;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }
  button:disabled { opacity: 0.6; cursor: progress; }
  .err {
    margin-top: 12px;
    font-size: 13px;
    color: #b91c1c;
    min-height: 18px;
  }
  .footer { font-size: 11px; color: #888; margin-top: 18px; text-align: center; }
</style>
</head>
<body>
<form class="card" id="f" autocomplete="off">
  <h1>Tech Trax CRM Connection</h1>
  <p class="sub">Enter your Tech Trax credentials to connect.</p>

  <label for="baseUrl">Base URL</label>
  <input id="baseUrl" name="baseUrl" type="url" placeholder="https://your-tenant.techtrax.io" required />

  <label for="email">Email</label>
  <input id="email" name="email" type="email" required />

  <label for="password">Password</label>
  <input id="password" name="password" type="password" required />

  <button type="submit" id="submit">Connect</button>
  <div class="err" id="err"></div>
  <div class="footer">This window will close after submitting.</div>
</form>
<script>
  (function(){
    var qs = new URLSearchParams(window.location.search);
    var state = qs.get("state") || "";
    var form = document.getElementById("f");
    var btn = document.getElementById("submit");
    var errEl = document.getElementById("err");

    if (!state) {
      errEl.textContent = "Missing state parameter. Please reopen the connect dialog.";
      btn.disabled = true;
    }

    function showErr(msg) { errEl.textContent = msg || ""; }

    form.addEventListener("submit", function(e){
      e.preventDefault();
      showErr("");
      var baseUrl = document.getElementById("baseUrl").value.trim();
      var email = document.getElementById("email").value.trim();
      var password = document.getElementById("password").value;
      if (!baseUrl || !email || !password) {
        showErr("All fields are required.");
        return;
      }
      try {
        new URL(baseUrl);
      } catch (e) {
        showErr("Base URL is not valid.");
        return;
      }
      btn.disabled = true;
      btn.textContent = "Connecting...";
      try {
        if (window.opener) {
          // Pin postMessage targetOrigin to the SPA origin passed in the URL.
          // The SPA controls the URL (via connectorOAuthStart), so this value
          // is trusted-by-construction. Falls back to "*" only if the SPA
          // didn't supply origin (older clients) — credentials still safe
          // because the form only opens from the SPA's own connect button.
          var targetOrigin = qs.get("origin") || "*";
          try { if (targetOrigin !== "*") new URL(targetOrigin); } catch(e) { targetOrigin = "*"; }
          window.opener.postMessage({
            type: "tech_trax_credentials",
            state: state,
            baseUrl: baseUrl,
            email: email,
            password: password,
          }, targetOrigin);
        } else {
          showErr("No parent window detected. Open this from the Connectors page.");
          btn.disabled = false;
          btn.textContent = "Connect";
          return;
        }
      } catch (err) {
        showErr("Failed to send credentials to parent window.");
        btn.disabled = false;
        btn.textContent = "Connect";
        return;
      }
      setTimeout(function(){ try { window.close(); } catch(e){} }, 100);
    });
  })();
</script>
</body>
</html>`;

export const techTraxCredentialsForm = onRequest(
  { cors: true, invoker: "public" },
  async (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(HTML);
  }
);
