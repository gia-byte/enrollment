const form = document.getElementById("login-form"), err = document.getElementById("form-error"), btn = document.getElementById("submit-btn");
if (new URLSearchParams(location.search).get("expired")) { err.textContent = "Your session ended. Please log in again."; err.hidden = false; }
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  err.hidden = true;
  const username = form.username.value.trim(), password = form.password.value;
  if (!username || !password) { err.textContent = "Enter your username and password."; err.hidden = false; return; }
  btn.disabled = true; btn.textContent = "Signing in…";
  try {
    const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Login failed.");
    location.href = "/app";
  } catch (x) {
    err.textContent = x.message; err.hidden = false; btn.disabled = false; btn.textContent = "Log in";
  }
});
