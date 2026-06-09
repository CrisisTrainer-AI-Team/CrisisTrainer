/**
 * supervisor.js — Supervisor Dashboard logic
 * Handles scenario generation, editable preview, and assignment.
 */

let currentUser = null;
let generateResult = null;

document.addEventListener("DOMContentLoaded", () => {
  currentUser = requireAuth("supervisor");
  if (!currentUser) return;

  document.getElementById("userName").textContent = currentUser.full_name;
  document.getElementById("welcomeName").textContent = currentUser.full_name.split(" ")[0];

  loadScenarios();
  loadSupervisorDashboard();

  document.getElementById("openGenerateBtn").addEventListener("click", () => {
    openModal("generateModal");
  });

  document.querySelectorAll("[data-close-modal]").forEach(btn => {
    btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
  });

  document.getElementById("scenarioSelect").addEventListener("change", async (e) => {
    const scenarioId = e.target.value;
    if (scenarioId) await loadRoles(scenarioId);
  });

  document.getElementById("assignType").addEventListener("change", handleAssignTypeChange);
  document.getElementById("generateBtn").addEventListener("click", handleGenerate);
  document.getElementById("saveAssignBtn").addEventListener("click", handleSaveAssign);
  document.getElementById("logoutBtn").addEventListener("click", logout);
});

/* ── Scenario & Role Loading ── */

async function loadScenarios() {
  const select = document.getElementById("scenarioSelect");

  try {
    const data = await apiGetScenarios();
    const scenarios = Array.isArray(data) ? data : (data.scenarios || data.data || []);

    select.innerHTML = '<option value="">-- Select Scenario --</option>';

    scenarios.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.scenario_id || s.id;
      opt.textContent = `${s.scenario_id || s.id} — ${s.title || s.name || ""}`;
      select.appendChild(opt);
    });

  } catch (err) {
    showNotice(`Failed to load scenarios: ${err.message}`, "error");
  }
}

async function loadRoles(scenarioId) {
  const select = document.getElementById("roleSelect");
  select.innerHTML = '<option value="">Loading roles...</option>';

  try {
    const data = await apiGetRoles(scenarioId);
    const roles = Array.isArray(data) ? data : (data.roles || []);

    select.innerHTML = '<option value="">-- Select Role --</option>';

    roles.forEach(r => {
      const opt = document.createElement("option");
      const roleVal = typeof r === "string" ? r : r.name || r.role;

      opt.value = roleVal;
      opt.textContent = roleVal;

      select.appendChild(opt);
    });

  } catch (err) {
    select.innerHTML = '<option value="">Failed to load roles</option>';
  }
}

/* ── Assignment Type Toggle ── */

function handleAssignTypeChange() {
  const type = document.getElementById("assignType").value;
  const empRow = document.getElementById("employeeRow");
  const deptRow = document.getElementById("departmentRow");

  empRow.style.display = type === "employee" ? "block" : "none";
  deptRow.style.display = type === "department" ? "block" : "none";
}

/* ── Generate ── */

async function handleGenerate() {
  const scenarioId = document.getElementById("scenarioSelect").value;
  const role = document.getElementById("roleSelect").value;
  const difficulty = document.getElementById("difficultySelect").value;
  const language = document.getElementById("languageSelect").value;
  const nScenarios = 1;
  const qPerScenario = parseInt(document.getElementById("questionsInput").value) || 5;

  if (!scenarioId || !role) {
    showNotice("Please select a scenario and role first.", "error");
    return;
  }

  const btn = document.getElementById("generateBtn");

  setLoading(btn, true);
  document.getElementById("previewSection").style.display = "none";
  clearNotice();

  const payload = {
    scenario_id: scenarioId,
    role: role,
    n_scenarios: nScenarios,
    q_per_scenario: qPerScenario,
    difficulty: difficulty,
    language: language,
  };

  try {
    const data = await apiGenerate(payload);

    generateResult = data;

    renderPreview(data);

    document.getElementById("previewSection").style.display = "block";

  } catch (err) {
    showNotice(`Generation failed: ${err.message}`, "error");
  } finally {
    setLoading(btn, false);
  }
}

/* ── Editable Preview Rendering ── */

function renderPreview(data) {
  const container = document.getElementById("previewContent");
  container.innerHTML = "";

  const scenarios = data.payload?.generated_scenarios || [];

  if (scenarios.length === 0) {
    container.innerHTML = '<p class="text-muted text-center">No scenarios returned.</p>';
    return;
  }

  const validator = data.validator || {};

  if (validator.fails > 0) {
    const banner = document.createElement("div");
    banner.className = "alert alert-error";

    let issuesHTML = "";

    (validator.issues || []).forEach((issue) => {
      issuesHTML += `
        <div style="margin-top:6px;">
          • ${escHtml(issue.message || issue.msg || JSON.stringify(issue))}
        </div>
      `;
    });

    banner.innerHTML = `
      ⚠ Validator: ${validator.fails} issue(s) found.
      <div style="margin-top:8px; font-size:0.9rem;">
        ${issuesHTML}
      </div>
    `;

    container.appendChild(banner);
  }

  scenarios.forEach((sc, si) => {
    const card = document.createElement("div");
    card.className = "preview-scenario";

    let questionsHTML = "";

    (sc.questions || []).forEach((q, qi) => {
      const letters = ["A", "B", "C", "D", "E"];

      const choicesHTML = (q.choices || []).map((c, ci) => {
        const checked = ci === q.answer_index ? "checked" : "";

        return `
          <div class="editable-choice">
            <label class="choice-edit-row">

              <input type="radio"
                     name="correct_${si}_${qi}"
                     value="${ci}"
                     ${checked}
                     class="correct-answer-radio">

              <span class="choice-letter">
                ${letters[ci] || ci}.
              </span>

              <input type="text"
                     class="choice-input"
                     data-scenario="${si}"
                     data-question="${qi}"
                     data-choice="${ci}"
                     value="${escAttr(c)}">

            </label>
          </div>
        `;
      }).join("");

      const evidenceHTML = (q.evidence_chunk_ids || []).length > 0
        ? `
          <div style="margin-top:0.4rem;">
            ${q.evidence_chunk_ids.map(e => `<span class="chip">${escHtml(e)}</span>`).join(" ")}
          </div>
        `
        : "";

      questionsHTML += `
        <div class="question-card">

          <div class="q-label">
            Question ${qi + 1} · ${escHtml(q.item_id || "")}
          </div>

          <textarea class="question-editor"
                    data-scenario="${si}"
                    data-question="${qi}">${escHtml(q.question)}</textarea>

          <div class="correct-answer-label">
            Select the correct answer, then edit choices if needed:
          </div>

          <div class="choices-list">
            ${choicesHTML}
          </div>

          <div class="rationale-box">
            💡 ${escHtml(q.rationale || "")}
          </div>

          ${evidenceHTML}

        </div>
      `;
    });

    card.innerHTML = `
      <h4>📋 ${escHtml(sc.title || sc.scenario_id)}</h4>
      <textarea class="scenario-editor"
          data-scenario="${si}"
          style="width:100%;min-height:120px;margin:1rem 0;padding:1rem;border-radius:12px;border:1px solid #d6e3ef;resize:vertical;font-family:inherit;font-size:0.95rem;line-height:1.7;">
${escHtml(sc.narrative || "")}
</textarea>
      ${questionsHTML}
    `;

    container.appendChild(card);
  });
}

/* ── Apply Supervisor Edits Before Saving ── */

function applyQuestionEdits() {
  const scenarios = generateResult?.payload?.generated_scenarios || [];

  document.querySelectorAll(".question-editor").forEach(el => {
    const si = parseInt(el.dataset.scenario);
    const qi = parseInt(el.dataset.question);

    if (!scenarios[si]?.questions?.[qi]) return;

    scenarios[si].questions[qi].question = el.value.trim();
  });

  document.querySelectorAll(".choice-input").forEach(el => {
    const si = parseInt(el.dataset.scenario);
    const qi = parseInt(el.dataset.question);
    const ci = parseInt(el.dataset.choice);

    if (!scenarios[si]?.questions?.[qi]) return;

    scenarios[si].questions[qi].choices[ci] = el.value.trim();
  });
  document.querySelectorAll(".scenario-editor").forEach(el => {
  const si = parseInt(el.dataset.scenario);

  if (!scenarios[si]) return;

  scenarios[si].narrative = el.value.trim();
});
  scenarios.forEach((sc, si) => {
    (sc.questions || []).forEach((q, qi) => {
      const selected = document.querySelector(
        `input[name="correct_${si}_${qi}"]:checked`
      );

      if (selected) {
        q.answer_index = parseInt(selected.value);
      }
    });
  });

  console.log("✅ Updated AI payload after supervisor edits:", generateResult);
}

/* ── Save / Assign ── */

async function handleSaveAssign() {
  if (!generateResult) return;

  applyQuestionEdits();

  const assignType = document.getElementById("assignType").value;
  const employeeId = document.getElementById("employeeIdInput").value.trim();
  const departmentId = document.getElementById("deptSelect").value;
  const scenarioId = document.getElementById("scenarioSelect").value;
  const role = document.getElementById("roleSelect").value;
  const difficulty = document.getElementById("difficultySelect").value;
  const language = document.getElementById("languageSelect").value;
  const qPerScenario = parseInt(document.getElementById("questionsInput").value) || 5;
  const durationMinutes = parseInt(document.getElementById("durationInput").value) || 10;

  if (assignType === "employee" && !employeeId) {
    showNotice("Please enter the employee ID.", "error");
    return;
  }

  const trainingPayload = {
    created_by: currentUser.id,
    scenario_id: scenarioId,
    scenario_title: generateResult.payload?.generated_scenarios?.[0]?.title || "",
    selected_role: role,
    language: language,
    difficulty: difficulty,
    n_scenarios: 1,
    q_per_scenario: qPerScenario,
    duration_minutes: durationMinutes,
    ai_payload: generateResult.payload,
    validator_report: generateResult.validator,
    assignment_type: assignType,
    employee_id: assignType === "employee" ? parseInt(employeeId) || null : null,
    department_id: assignType === "department" ? parseInt(departmentId) || null : null,
  };

  console.log("📦 Training Payload:", trainingPayload);

  const saveBtn = document.getElementById("saveAssignBtn");

  try {
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    const result = await apiAssignTraining(trainingPayload);

    showNotice(`✅ Training assigned successfully! ID: ${result.training_id}`, "success");

    await loadSupervisorDashboard();

    saveBtn.textContent = "💾 Save & Assign Training";
    saveBtn.disabled = false;

  } catch (err) {
    showNotice(`Assignment failed: ${err.message}`, "error");

    saveBtn.textContent = "💾 Save & Assign Training";
    saveBtn.disabled = false;
  }
}

/* ── Modal Helpers ── */

function openModal(id) {
  document.getElementById(id).classList.add("active");
  document.body.style.overflow = "hidden";
}

function closeModal(id) {
  document.getElementById(id).classList.remove("active");
  document.body.style.overflow = "";
}

/* ── Notification ── */

function showNotice(msg, type = "info") {
  const el = document.getElementById("modalNotice");
  if (!el) return;

  el.className = `alert alert-${type}`;
  el.textContent = msg;
  el.style.display = "flex";
}

function clearNotice() {
  const el = document.getElementById("modalNotice");
  if (el) el.style.display = "none";
}

/* ── Utility ── */

function setLoading(btn, loading) {
  if (loading) {
    btn.dataset.original = btn.innerHTML;
    btn.innerHTML = '<span class="spinner"></span> Generating...';
    btn.disabled = true;
  } else {
    btn.innerHTML = btn.dataset.original || btn.innerHTML;
    btn.disabled = false;
  }
}

function escHtml(str) {
  const d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML;
}

function escAttr(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function loadSupervisorDashboard() {
  try {
    const data = await apiGetSupervisorDashboard(currentUser.id);
    const analytics = await apiGetSupervisorAnalytics(currentUser.id);

    const stats = data.stats || {};
    const aStats = analytics.stats || {};

    document.getElementById("supTotalAssignments").textContent = stats.total ?? 0;
    document.getElementById("supCompleted").textContent = aStats.completed_attempts ?? 0;
    document.getElementById("supPending").textContent = aStats.pending_attempts ?? 0;

    const atRisk = document.getElementById("supAtRisk");
    if (atRisk) atRisk.textContent = aStats.at_risk_count ?? 0;

    renderSupervisorRecent(data.assignments || []);

  } catch (err) {
    console.error("Failed to load supervisor dashboard:", err);
  }
}

function renderSupervisorRecent(assignments) {
  const tbody = document.getElementById("supervisorRecentTbody");
  if (!tbody) return;

  if (!assignments.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center;padding:1.5rem;">
          No assignments yet.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = "";

  assignments.slice(0, 8).forEach(a => {
    const isDone = ["graded", "completed", "submitted", "completed"].includes(a.status);
    const isProgress = a.status === "in progress";
    const statusClass = isDone
      ? "status-completed"
      : isProgress
        ? "status-progress"
        : "status-pending";
        
    const assignedTo =
      a.assigned_to ||
      a.employee ||
      "All Employees";

    const questions =
      a.q_per_scenario || a.total_questions || "-";

    const time =
      a.duration_minutes ? `${a.duration_minutes} min` : "-";

    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${escHtml(assignedTo)}</td>
      <td>${escHtml(a.department_name || "-")}</td>
      <td>${escHtml(a.scenario || "-")}</td>
      <td>${escHtml(capitalize(a.difficulty || "-"))}</td>
      <td>${questions}</td>
      <td>${time}</td>
      <td>
        <span class="status ${statusClass}">
          ${escHtml(capitalize(a.status || "pending"))}
        </span>
      </td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="deleteTraining(${a.training_id})">
          Delete
        </button>
      </td>
    `;

    tbody.appendChild(tr);
  });
}

async function deleteTraining(trainingId) {
  const ok = confirm("Delete this training? It will also disappear from employees.");
  if (!ok) return;

  try {
    await apiDeleteTraining(trainingId);
    await loadSupervisorDashboard();
    alert("Training deleted successfully.");
  } catch (err) {
    alert("Delete failed: " + err.message);
  }
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}
