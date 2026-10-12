Auth.requireLogin();

const content = renderShell("students.html", "Students", "Roster, attendance and attention overview");

content.innerHTML = `
  <div class="section-head">
    <input id="searchBox" placeholder="Search by name or ID…" style="padding:10px 14px;border-radius:10px;border:1px solid var(--border);background:var(--surface);color:var(--text-primary);width:280px;" />
    <button class="btn btn-primary" id="addStudentBtn">+ Add student</button>
  </div>
  <div class="card">
    <table>
      <thead><tr><th>Student</th><th>Class</th><th>Attention Index</th><th>Events</th><th>Attendance</th><th></th></tr></thead>
      <tbody id="studentTableBody"><tr><td colspan="6" class="empty-state">Loading…</td></tr></tbody>
    </table>
  </div>
`;

let allStudents = [];
let classesById = {};

async function load() {
  const classes = await api("/api/classes");
  classesById = Object.fromEntries(classes.map(c => [c.id, c]));
  const lists = await Promise.all(classes.map(c => api(`/api/students?classroom_id=${c.id}`)));
  allStudents = lists.flat();
  await render(allStudents);
}

async function render(students) {
  const body = document.getElementById("studentTableBody");
  if (!students.length) { body.innerHTML = `<tr><td colspan="6" class="empty-state">No students found.</td></tr>`; return; }

  const rows = await Promise.all(students.map(async s => {
    let attention = null, events = 0;
    try {
      const profile = await api(`/api/students/${s.id}`);
      attention = profile.latest_attention_index;
      events = profile.total_events;
      var attendanceRate = profile.attendance_rate;
    } catch { attendanceRate = 0; }
    const cls = classesById[s.classroom_id];
    return `
      <tr>
        <td><a href="student-profile.html?id=${s.id}">${s.full_name}</a> <span class="mono muted" style="font-size:0.75rem;">${s.student_code}</span></td>
        <td>${cls ? cls.name : "—"}</td>
        <td>${attentionBadge(attention)}</td>
        <td>${events}</td>
        <td>${(attendanceRate * 100).toFixed(0)}%</td>
        <td><a href="student-profile.html?id=${s.id}" class="btn btn-ghost btn-sm">View</a></td>
      </tr>
    `;
  }));
  body.innerHTML = rows.join("");
}

document.getElementById("searchBox").addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase();
  const filtered = allStudents.filter(s => s.full_name.toLowerCase().includes(q) || s.student_code.toLowerCase().includes(q));
  render(filtered);
});

document.getElementById("addStudentBtn").addEventListener("click", async () => {
  const classes = await api("/api/classes");
  if (!classes.length) { toast("Create a class in Settings first"); return; }
  const full_name = prompt("Student full name:");
  if (!full_name) return;
  const student_code = prompt("Student ID (e.g. STU2001):");
  if (!student_code) return;
  try {
    await api("/api/students", { method: "POST", body: { full_name, student_code, classroom_id: classes[0].id } });
    toast("Student added");
    load();
  } catch (e) { toast(e.message, "error"); }
});

load();