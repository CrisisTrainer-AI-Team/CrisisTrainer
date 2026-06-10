/**
 * monitor.js — Live Monitor page logic
 * Connected to real Supervisor Dashboard API.
 */

let currentUser = null;
let allAssignments = [];

let analyticsData = null;
let charts = {};

document.addEventListener("DOMContentLoaded", () => {
  currentUser = requireAuth("supervisor");
  if (!currentUser) return;

  document.getElementById("userName").textContent = currentUser.full_name;

loadAnalytics();

  document.getElementById("filterDept").addEventListener("change", applyFilters);
  document.getElementById("searchInput").addEventListener("input", applyFilters);

  document.getElementById("refreshBtn").addEventListener("click", async () => {
    await loadAnalytics();
    showToast("Data refreshed.");
  });

  document.getElementById("logoutBtn").addEventListener("click", logout);
});

/* ── Load Data From API ── */

async function loadMonitorData() {
  try {
    const data = await apiGetSupervisorDashboard(currentUser.id);

    const stats = data.stats || {};
    allAssignments = data.assignments || [];

    document.getElementById("statTotal").textContent = stats.total ?? 0;
    document.getElementById("statCompleted").textContent = stats.completed ?? 0;
    document.getElementById("statPending").textContent = stats.pending ?? 0;
    document.getElementById("statAvgScore").textContent = `${stats.avg_score ?? 0}%`;

    const completed = stats.completed ?? 0;
    const total = stats.total ?? 0;
    const pct = total ? Math.round((completed / total) * 100) : 0;

    const bar = document.getElementById("completionBar");
    if (bar) bar.style.width = pct + "%";

    const label = document.querySelector(".completion-bar-wrap .bar-label span:last-child");
    if (label) label.textContent = `${completed} of ${total} assignments completed`;

    renderTable(allAssignments);
    renderDepartmentStats();
    calculateInsights();

  } catch (err) {
    console.error("Monitor load failed:", err);

    const tbody = document.getElementById("monitorTbody");
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center;padding:2rem;color:red;">
          Failed to load monitor data: ${escHtml(err.message)}
        </td>
      </tr>
    `;
  }
}

/* ── Table ── */

function renderTable(data) {
  const tbody = document.getElementById("monitorTbody");
  tbody.innerHTML = "";

  if (!data.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center;padding:2rem;color:var(--text-muted);">
          No records match your filters.
        </td>
      </tr>
    `;
    return;
  }

  data.forEach(row => {
    const scoreDisplay = row.score !== null && row.score !== undefined
      ? `<strong>${row.score}%</strong>`
      : `<span class="text-muted">—</span>`;

    const isDone = ["completed", "graded", "submitted"].includes(row.status);
    const statusClass = isDone ? "status-completed" : "status-pending";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="font-weight:500;">${escHtml(row.employee || "-")}</td>
      <td data-label="Department">${escHtml(row.department_name || "-")}</td>
      <td data-label="Scenario">${escHtml(row.scenario || "-")}</td>
      <td data-label="Difficulty">${escHtml(capitalize(row.difficulty || "-"))}</td>
      <td data-label="Status">
        <span class="status ${statusClass}">
          ${escHtml(capitalize(row.status || "pending"))}
        </span>
      </td>
      <td data-label="Score">${scoreDisplay}</td>
      <td data-label="Date" style="color:var(--text-muted);font-size:0.85rem;">
        ${formatDate(row.created_at)}
      </td>
      <td data-label="Actions">
        <button class="btn btn-ghost btn-sm" onclick="showDetails(${row.training_id})">
          View
        </button>
      </td>
    `;

    tbody.appendChild(tr);
  });
}

/* ── Filters ── */

function applyFilters() {
  if (!analyticsData) return;

  const dept = document.getElementById("filterDept").value;
  const search = document.getElementById("searchInput").value.toLowerCase();

  const filtered = (analyticsData.employees || []).filter(emp => {
    const details = emp.details || [];

    const matchSearch =
      !search ||
      emp.employee_name.toLowerCase().includes(search) ||
      emp.department_name.toLowerCase().includes(search) ||
      details.some(d => (d.scenario || "").toLowerCase().includes(search));

    const matchDept =
      !dept || emp.department_name === dept;

    return matchSearch && matchDept;
  });

  renderEmployees(filtered);
}

/* ── Detail View ── */

function showDetails(id) {
  const row = allAssignments.find(r => r.training_id === id);
  if (!row) return;

  const scoreStr = row.score !== null && row.score !== undefined
    ? `${row.score}%`
    : "Not completed";

  const content = document.getElementById("detailsContent");

  content.innerHTML = `
    <div class="stats-grid" style="grid-template-columns: repeat(2, 1fr);">
      <div class="stat-card blue">
        <div class="stat-value">${scoreStr}</div>
        <div class="stat-label">Score</div>
      </div>

      <div class="stat-card green">
        <div class="stat-value">${escHtml(capitalize(row.status || "pending"))}</div>
        <div class="stat-label">Status</div>
      </div>
    </div>

    <div class="table-wrap" style="margin-top:1rem;">
      <table>
        <tbody>
          <tr>
            <th>Employee / Target</th>
            <td>${escHtml(row.employee || "-")}</td>
          </tr>
          <tr>
            <th>Department</th>
            <td>${escHtml(row.department_name || "-")}</td>
          </tr>
          <tr>
            <th>Scenario</th>
            <td>${escHtml(row.scenario || "-")}</td>
          </tr>
          <tr>
            <th>Scenario ID</th>
            <td>${escHtml(row.scenario_id || "-")}</td>
          </tr>
          <tr>
            <th>Difficulty</th>
            <td>${escHtml(capitalize(row.difficulty || "-"))}</td>
          </tr>
          <tr>
            <th>Assignment Type</th>
            <td>${escHtml(capitalize(row.assignment_type || "-"))}</td>
          </tr>
          <tr>
            <th>Questions</th>
            <td>${row.q_per_scenario ?? "-"}</td>
          </tr>
          <tr>
            <th>Date Assigned</th>
            <td>${formatDate(row.created_at)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  document.getElementById("detailsModal").classList.add("active");
  document.body.style.overflow = "hidden";
}

function closeDetailsModal() {
  document.getElementById("detailsModal").classList.remove("active");
  document.body.style.overflow = "";
}

/* ── Toast ── */

function showToast(msg) {
  let toast = document.getElementById("toast");

  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.style.cssText = `
      position:fixed; bottom:1.5rem; right:1.5rem; z-index:999;
      background:var(--c-dark); color:white;
      padding:0.7rem 1.3rem; border-radius:8px;
      font-size:0.875rem; font-weight:500;
      box-shadow:0 4px 16px rgba(0,0,0,0.3);
      transition:opacity 0.3s;
    `;
    document.body.appendChild(toast);
  }

  toast.textContent = msg;
  toast.style.opacity = "1";

  setTimeout(() => {
    toast.style.opacity = "0";
  }, 2500);
}

/* ── Helpers ── */

function escHtml(str) {
  const d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML;
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

function formatDate(dateValue) {
  if (!dateValue) return "-";

  try {
    return String(dateValue).split("T")[0];
  } catch {
    return "-";
  }
}

function calculateInsights() {
  if (!allAssignments.length) return;

  // فقط اللي عندهم سكورات
  const scored = allAssignments.filter(a => a.score !== null);

  // Top Performer
  if (scored.length) {
    const top = scored.reduce((max, cur) => cur.score > max.score ? cur : max);
    document.getElementById("topPerformer").textContent =
      `${top.employee} (${top.score}%)`;
  }

  // Worst Performer
  if (scored.length) {
    const low = scored.reduce((min, cur) => cur.score < min.score ? cur : min);
    document.getElementById("lowPerformer").textContent =
      `${low.employee} (${low.score}%)`;
  }

  // Completion Rate
  const completed = allAssignments.filter(a =>
    ["graded", "completed", "submitted"].includes(a.status)
  ).length;

  const rate = Math.round((completed / allAssignments.length) * 100);

  document.getElementById("completionRate").textContent = rate + "%";
}

function renderDepartmentStats() {
  const tbody = document.getElementById("deptTable");
  if (!tbody) return;

  const map = {};

  allAssignments.forEach(a => {
    const dept = a.department_name || "Unknown";

    if (!map[dept]) {
      map[dept] = {
        department_id: a.department_id,
        total: 0,
        completed: 0,
        scores: []
      };
    }

    map[dept].total++;

    if (["graded", "completed", "submitted"].includes(a.status)) {
      map[dept].completed++;
    }

    if (a.score !== null) {
      map[dept].scores.push(a.score);
    }
  });

  tbody.innerHTML = "";

  Object.keys(map).forEach(dept => {
    const d = map[dept];

    const avg = d.scores.length
      ? Math.round(d.scores.reduce((a, b) => a + b, 0) / d.scores.length)
      : 0;

    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td><strong>${escHtml(dept)}</strong></td>
      <td data-label="Total">${d.total}</td>
      <td data-label="Completed">${d.completed}</td>
      <td data-label="Avg Score">${avg}%</td>
      <td data-label="Actions">
        <button class="btn btn-ghost btn-sm" onclick="showDeptDetails('${encodeURIComponent(dept)}', ${d.department_id})">
          View Employees
        </button>
      </td>
    `;

    tbody.appendChild(tr);
  });
}

async function showDeptDetails(encodedDept, departmentId) {
  const dept = decodeURIComponent(encodedDept);

  document.getElementById("deptDetailsTitle").textContent =
    `Department Details — ${dept}`;

  const content = document.getElementById("deptDetailsContent");
  content.innerHTML = `<p class="text-muted">Loading employees performance...</p>`;

  document.getElementById("deptDetailsModal").classList.add("active");
  document.body.style.overflow = "hidden";

  try {
    const res = await apiGetDepartmentEmployeesPerformance(currentUser.id, departmentId);
    const employees = res.employees || [];

    if (!employees.length) {
      content.innerHTML = `
        <div class="empty-state">
          <p>No employees found in this department.</p>
        </div>
      `;
      return;
    }

    content.innerHTML = employees.map(emp => `
      <div class="table-wrap" style="margin-bottom:1rem;">
        <div class="table-header">
          <div>
            <h3 class="section-title" style="margin:0;">
              👤 ${escHtml(emp.employee_name)}
            </h3>
            <p class="text-muted" style="margin:0.3rem 0 0;">
              Total: ${emp.total_assigned} |
              Completed: ${emp.completed} |
              Pending: ${emp.pending}
            </p>
          </div>
          <div style="text-align:right;">
            <strong style="font-size:1.4rem;">${emp.avg_score}%</strong>
            <div class="text-muted">Avg Score</div>
          </div>
        </div>

        <div class="stats-grid" style="grid-template-columns: repeat(3, 1fr); margin:1rem;">
          <div class="stat-card green">
            <div class="stat-value">${emp.highest_score !== null ? emp.highest_score + "%" : "—"}</div>
            <div class="stat-label">Highest Score</div>
          </div>

          <div class="stat-card orange">
            <div class="stat-value">${emp.lowest_score !== null ? emp.lowest_score + "%" : "—"}</div>
            <div class="stat-label">Lowest Score</div>
          </div>

          <div class="stat-card teal">
            <div class="stat-value">${emp.completed}/${emp.total_assigned}</div>
            <div class="stat-label">Completion</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Scenario</th>
              <th>Role</th>
              <th>Difficulty</th>
              <th>Status</th>
              <th>Score</th>
              <th>Date</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            ${emp.details.map(d => `
              <tr>
                <td>${escHtml(d.scenario || "-")}</td>
                <td data-label="Role">${escHtml(d.role || "-")}</td>
                <td data-label="Difficulty">${escHtml(capitalize(d.difficulty || "-"))}</td>
                <td data-label="Status">${escHtml(capitalize(d.status || "pending"))}</td>
                <td data-label="Score"><strong>${d.score !== null && d.score !== undefined ? d.score + "%" : "—"}</strong></td>
                <td data-label="Date">${formatDate(d.assigned_at)}</td>
                <td data-label="Notes">
                  <button class="btn btn-ghost btn-sm"
                    onclick="openNoteBox('${escHtml(emp.employee_name)}', ${d.training_id}, ${emp.employee_id})">
                    Add Note
                  </button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `).join("");

  } catch (err) {
    content.innerHTML = `
      <div class="empty-state">
        <div class="icon">⚠️</div>
        <p>Failed to load department details.</p>
        <p class="text-muted">${escHtml(err.message)}</p>
      </div>
    `;
  }
}

function closeDeptDetails() {
  document.getElementById("deptDetailsModal").classList.remove("active");
  document.body.style.overflow = "";
}

async function openNoteBox(employeeName, trainingId, employeeId) {
  const note = prompt(`Write a note for ${employeeName}:`);
  if (!note) return;

  try {
    await apiCreateSupervisorNote({
      training_id: trainingId,
      employee_id: employeeId,
      supervisor_id: currentUser.id,
      note_text: note
    });

    alert("Note sent to employee successfully.");
  } catch (err) {
    alert("Failed to save note: " + err.message);
  }
}

async function loadAnalytics() {
  try {
    analyticsData = await apiGetSupervisorAnalytics(currentUser.id);

    renderDepartmentTable(analyticsData.departments || []);
    renderEmployees(analyticsData.employees || []);
    renderCharts(analyticsData);

  } catch (err) {
    console.error("Analytics load failed:", err);
  }
}

function renderStats(stats){

document.getElementById("statTotal")
.textContent =
stats.total_trainings;

document.getElementById("statCompleted")
.textContent =
stats.completed_attempts;

document.getElementById("statPending")
.textContent =
stats.total_trainings -
stats.completed_attempts;

document.getElementById("statAvgScore")
.textContent =
(stats.avg_score || 0) + "%";

document.getElementById("lowPerformer")
.textContent =
stats.at_risk_count;

const completion =
stats.total_trainings
? Math.round(
(stats.completed_attempts /
stats.total_trainings)*100
)
:0;

document.getElementById("completionRate")
.textContent =
completion + "%";

document.getElementById("completionBar")
.style.width =
completion + "%";

}

function renderDepartmentTable(departments) {
  const tbody = document.getElementById("departmentRows");
  tbody.innerHTML = "";

  departments.forEach(d => {
    tbody.innerHTML += `
      <tr>
        <td><strong>${escHtml(d.department_name)}</strong></td>
        <td data-label="Assignments">${d.assigned}</td>
        <td data-label="Completed">${d.completed}</td>
        <td data-label="Avg Score">${d.avg_score}%</td>
        <td data-label="Actions">
          <button class="btn btn-outline btn-sm"
            onclick="showDeptDetails('${encodeURIComponent(d.department_name)}', ${d.department_id})">
            View Employees
          </button>
        </td>
      </tr>
    `;
  });
}

function renderEmployees(employees) {
  const tbody = document.getElementById("employeeRows");
  tbody.innerHTML = "";

  if (!employees.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center;padding:1.5rem;">
          No employees match your filters.
        </td>
      </tr>
    `;
    return;
  }

  employees.forEach(e => {
    const lastDate = getLastActivityDate(e.details || []);

    tbody.innerHTML += `
      <tr>
        <td>${escHtml(e.employee_name)}</td>
        <td data-label="Department">${escHtml(e.department_name)}</td>
        <td data-label="Assigned Trainings">${e.assigned}</td>
        <td data-label="Completed">${e.completed}</td>
        <td data-label="Avg Score">${e.avg_score}%</td>
        <td data-label="Risk Level">${riskBadge(e.risk_level)}</td>
        <td data-label="Last Activity">${formatDate(lastDate)}</td>
        <td data-label="Actions">
          <button type="button" class="btn btn-outline btn-sm"
            onclick="showEmployeeProfile(${e.employee_id})">
            View
          </button>
        </td>
      </tr>
    `;
  });
}

function getLastActivityDate(details) {
  if (!details.length) return null;

  const sorted = [...details].sort((a, b) => {
    return new Date(b.assigned_at) - new Date(a.assigned_at);
  });

  return sorted[0].assigned_at;
}

function riskBadge(risk) {
  if (risk === "At Risk") {
    return `<span class="status status-pending">At Risk</span>`;
  }

  if (risk === "Good") {
    return `<span class="status status-completed">Good</span>`;
  }

  return `<span class="text-muted">No Data</span>`;
}

function showEmployeeProfile(employeeId) {
  const emp = analyticsData.employees.find(e => e.employee_id === employeeId);
  if (!emp) return;

  const content = document.getElementById("detailsContent");

  content.innerHTML = `
    <h3>👤 ${escHtml(emp.employee_name)}</h3>
    <p class="text-muted">${escHtml(emp.department_name)}</p>

    <div class="stats-grid" style="grid-template-columns: repeat(3, 1fr);">
      <div class="stat-card blue">
        <div class="stat-value">${emp.assigned}</div>
        <div class="stat-label">Assigned</div>
      </div>
      <div class="stat-card green">
        <div class="stat-value">${emp.completed}</div>
        <div class="stat-label">Completed</div>
      </div>
      <div class="stat-card orange">
        <div class="stat-value">${emp.avg_score}%</div>
        <div class="stat-label">${emp.risk_level}</div>
      </div>
    </div>

    <div class="table-wrap" style="margin-top:1rem;">
      <table>
        <thead>
          <tr>
            <th>Scenario</th>
            <th>Role</th>
            <th>Status</th>
            <th>Score</th>
            <th>AI Feedback</th>
          </tr>
        </thead>
        <tbody>
          ${emp.details.map(d => `
            <tr>
              <td>${escHtml(d.scenario)}</td>
              <td data-label="Role">${escHtml(d.role || "-")}</td>
              <td data-label="Status">${escHtml(d.status)}</td>
              <td data-label="Score">${d.score !== null ? d.score + "%" : "—"}</td>
              <td data-label="AI Feedback">${d.ai_feedback ? escHtml(d.ai_feedback.summary || "-") : "—"}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById("detailsModal").classList.add("active");
  document.body.style.overflow = "hidden";
}

function renderCharts(data) {
  const departments = data.departments || [];
  const scenarios = data.scenarios || [];

  const deptNames = departments.map(d => d.department_name);
  const deptScores = departments.map(d => d.avg_score);
  const deptCompletion = departments.map(d => d.completion_rate);

  const weakScenarios = [...scenarios]
    .sort((a, b) => b.weakness_count - a.weakness_count)
    .slice(0, 6);

  createChart("deptScoreChart", "bar", deptNames, deptScores, "Avg Score %");
  createChart("deptCompletionChart", "bar", deptNames, deptCompletion, "Completion %");
  createChart(
    "scenarioChart",
    "bar",
    weakScenarios.map(s => s.scenario),
    weakScenarios.map(s => s.weakness_count),
    "Weak Attempts"
  );
}

function createChart(canvasId, type, labels, values, label) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  if (charts[canvasId]) {
    charts[canvasId].destroy();
  }

  charts[canvasId] = new Chart(ctx, {
    type,
    data: {
      labels,
      datasets: [{
        label,
        data: values
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: { beginAtZero: true }
      }
    }
  });
}

window.showEmployeeProfile = showEmployeeProfile;
