Auth.requireLogin();

const content = renderShell("sessions.html", "Sessions", "Every monitored class period, past and present");

content.innerHTML = `
  <div class="card">
    <table>
      <thead><tr><th>Session</th><th>Class</th><th>Status</th><th>Started</th><th>Ended</th><th>Type</th><th></th></tr></thead>
      <tbody id="sessionsBody"><tr><td colspan="7" class="empty-state">Loading…</td></tr></tbody>
    </table>
  </div>
`;

async function load() {
  const classes = await api("/api/classes");
  const classesById = Object.fromEntries(classes.map(c => [c.id, c]));
  const lists = await Promise.all(classes.map(c => api(`/api/sessions?classroom_id=${c.id}`)));
  const sessions = lists.flat().sort((a, b) => new Date(b.started_at || 0) - new Date(a.started_at || 0));

  const body = document.getElementById("sessionsBody");
  if (!sessions.length) { body.innerHTML = `<tr><td colspan="7" class="empty-state">No sessions recorded yet.</td></tr>`; return; }

  body.innerHTML = sessions.map(s => {
    const cls = classesById[s.classroom_id];
    const statusBadge = s.status === "live"
      ? `<span class="badge badge-live"><span class="badge-dot"></span>LIVE</span>`
      : s.status === "ended"
        ? `<span class="badge badge-info"><span class="badge-dot"></span>Ended</span>`
        : `<span class="badge badge-warning"><span class="badge-dot"></span>Scheduled</span>`;
    return `
      <tr>
        <td>${s.title || "Untitled session"}</td>
        <td>${cls ? cls.name : "—"}</td>
        <td>${statusBadge}</td>
        <td>${s.started_at ? new Date(s.started_at).toLocaleString() : "—"}</td>
        <td>${s.ended_at ? new Date(s.ended_at).toLocaleString() : "—"}</td>
        <td>${s.is_demo ? "Demo" : "Live camera"}</td>
        <td><a class="btn btn-ghost btn-sm" href="reports.html?session_id=${s.id}">Report</a></td>
      </tr>
    `;
  }).join("");
}

load();