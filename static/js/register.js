const form = document.getElementById("reg-form"), err = document.getElementById("form-error"), btn = document.getElementById("submit-btn");
function showErrors(fields) {
  form.querySelectorAll(".field").forEach(f => f.classList.remove("invalid"));
  form.querySelectorAll("[data-for]").forEach(p => { p.textContent = ""; });
  Object.entries(fields || {}).forEach(([k, msg]) => {
    const p = form.querySelector(`[data-for="${k}"]`);
    if (p) { p.textContent = msg; p.closest(".field").classList.add("invalid"); }
  });
}
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  err.hidden = true; showErrors({});
  const d = Object.fromEntries(new FormData(form).entries());
  const local = {};   // quick client-side checks; the server validates everything again
  if (d.full_name.trim().length < 2) local.full_name = "Enter your full name.";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(d.email)) local.email = "Enter a valid email address.";
  ["branch_id", "program_id", "year_level"].forEach(k => { if (!d[k]) local[k] = "Please choose one."; });
  if (d.password.length < 8 || !/[A-Za-z]/.test(d.password) || !/\d/.test(d.password)) local.password = "At least 8 characters with a letter and a number.";
  if (Object.keys(local).length) { showErrors(local); return; }
  btn.disabled = true; btn.textContent = "Creating…";
  try {
    const r = await fetch("/api/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) });
    const j = await r.json();
    if (!r.ok) { showErrors(j.fields); throw new Error(j.error); }
    form.hidden = true; document.getElementById("sno").textContent = j.student_no; document.getElementById("success").hidden = false;
  } catch (x) {
    err.textContent = x.message || "Could not create the account."; err.hidden = false; btn.disabled = false; btn.textContent = "Create account";
  }
});
