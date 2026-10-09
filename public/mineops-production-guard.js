// Safety bridge for the static prototype.
// The prototype's bundled Production tab renders a very large demo list on some devices.
// In the production deployment, route operational actions into the D1-backed field workflow.
(function () {
  const routes = [
    { match: /^PRODUCTION$/, url: "/field?tab=shifts" },
    { match: /^Production Log\b/i, url: "/field?tab=shifts" },
    { match: /^Report Hazard\b/i, url: "/field?tab=hazards" },
    { match: /^Workplace Exam\b/i, url: "/field?tab=exams" },
    { match: /^SAFETY\b/i, url: "/field?tab=hazards" }
  ];

  function normalizedText(node) {
    return (node && node.textContent ? node.textContent : "").replace(/\s+/g, " ").trim();
  }

  document.addEventListener("click", function (event) {
    const button = event.target && event.target.closest ? event.target.closest("button") : null;
    if (!button) return;
    const text = normalizedText(button);
    const route = routes.find((item) => item.match.test(text));
    if (!route) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    window.location.href = route.url;
  }, true);

  function addBridgeNotice() {
    if (document.getElementById("mineops-production-bridge")) return;
    const root = document.getElementById("root") || document.body;
    if (!root) return;
    const notice = document.createElement("a");
    notice.id = "mineops-production-bridge";
    notice.href = "/field";
    notice.textContent = "D1 Production Field App";
    notice.style.cssText = "position:fixed;right:14px;top:14px;z-index:2147483647;background:#ff6a00;color:#111827;border-radius:999px;padding:10px 13px;font:800 12px/1 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;text-decoration:none;box-shadow:0 10px 28px rgba(0,0,0,.28);letter-spacing:.02em";
    root.appendChild(notice);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addBridgeNotice);
  else addBridgeNotice();
})();
