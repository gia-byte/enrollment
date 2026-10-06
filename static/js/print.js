document.getElementById("print-btn").addEventListener("click", () => window.print());
document.getElementById("close-btn").addEventListener("click", () => { window.close(); if (!window.closed) history.back(); });
if (new URLSearchParams(location.search).get("autoprint") === "1") window.addEventListener("load", () => setTimeout(() => window.print(), 300));
