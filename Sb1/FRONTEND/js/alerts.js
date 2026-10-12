Auth.requireLogin();

const content = renderShell("alerts.html", "Alerts", "Review flagged observations - nothing here takes action automatically");

content.innerHTML = `
  <div class="section-head">
    <div class="pill-toggle" id="statusFilter">
      <button data-status="" class="active">All</button>
      <button data-status="new">New</button>
      <button data-status="acknowledged">Acknowledged</button>
      <button data-status="resolved">Resolved</button>
    </div>
  </div>
  <div id="alertsList"></div>
`;

async function load(status = "") {
  const alerts = await api(`/api/alerts${status ? `?status=${status}` : ""}`);
  const list = document.getElementById("alertsList");
  if (!alerts.length) { list.innerHTML = `<div class="empty-state">No alerts to review.</div>`; return; }

  const severityBadge = { info: "badge-info", warning: "badge-warning", critical: "badge-critical" };

  list.innerHTML = alerts.map(a => `
    <div class="card" style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:16px;">
      <div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
          <span class="badge ${severityBadge[a.severity]}"><span class="badge-dot"></span>${a.severity}</span>
          <strong>${a.title}</strong>
        </div>
        <div class="muted" style="font-size:0.85rem;">${a.description || ""}</div>
        <div class="muted" style="font-size:0.75rem;margin-top:4px;">${timeAgo(a.created_at)} · <a href="student-profile.html?id=${a.student_id}">View student</a></div>
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0;">
        ${a.status === "new" ? `
          <button class="btn btn-ghost btn-sm" data-act="acknowledged" data-id="${a.id}">Acknowledge</button>
          <button class="btn btn-ghost btn-sm" data-act="ignored" data-id="${a.id}">Ignore</button>
          <button class="btn btn-primary btn-sm" data-act="resolved" data-id="${a.id}">Resolve</button>
        ` : `<span class="badge badge-info">${a.status}</span>`}
      </div>
    </div>
  `).join("");

  list.querySelectorAll("button[data-act]").forEach(btn => {
    btn.addEventListener("click", async () => {
      await api(`/api/alerts/${btn.dataset.id}`, { method: "PATCH", body: { status: btn.dataset.act } });
      toast(`Alert marked as ${btn.dataset.act}`);
      const active = document.querySelector("#statusFilter button.active");
      load(active.dataset.status);
    });
  });
}

document.getElementById("statusFilter").querySelectorAll("button").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#statusFilter button").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    load(btn.dataset.status);
  });
});

load();