/**
 * api.js — CrisisTrainer API helpers
 * All API calls go through this file.
 * Base URL is defined here for easy reconfiguration.
 */

const API_BASE = "http://127.0.0.1:8000";

/**
 * Generic fetch wrapper with error handling.
 * @param {string} path  - e.g. "/auth/login"
 * @param {object} opts  - standard fetch options
 * @returns {Promise<any>} parsed JSON response
 */
async function apiFetch(path, opts = {}) {
  const url = API_BASE + path;
  const defaults = {
    headers: { "Content-Type": "application/json" },
  };
  const options = { ...defaults, ...opts };
  if (opts.headers) options.headers = { ...defaults.headers, ...opts.headers };

  const res = await fetch(url, options);
  const data = await res.json();

  if (!res.ok) {
    // Prefer backend detail message if available
    let msg = data?.detail || data?.message || `HTTP ${res.status}`;

    if (Array.isArray(msg) || typeof msg === "object") {
      msg = JSON.stringify(msg, null, 2);
    }

    throw new Error(msg);
  }
  return data;
}

/* ── Auth ── */

async function apiRegister(payload) {
  return apiFetch("/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function apiLogin(email, password) {
  return apiFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

async function apiResetPassword(email, newPassword) {
  return apiFetch("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({
      email: email,
      new_password: newPassword,
    }),
  });
}

/* ── Scenarios ── */

async function apiGetScenarios() {
  return apiFetch("/scenarios");
}

async function apiGetRoles(scenarioId) {
  return apiFetch(`/scenarios/${encodeURIComponent(scenarioId)}/roles`);
}

/* ── Generate ── */

async function apiGenerate(payload) {
  return apiFetch("/generate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/* ── Trainings (placeholder — endpoint not yet connected) ── */

async function apiAssignTraining(payload) {
  // TODO: connect when POST /trainings/assign is available
  return apiFetch("/trainings/assign", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/* ── LocalStorage helpers ── */

function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem("currentUser"));
  } catch {
    return null;
  }
}

function setCurrentUser(user) {
  localStorage.setItem("currentUser", JSON.stringify(user));
}

function clearCurrentUser() {
  localStorage.removeItem("currentUser");
}

/**
 * Guard: redirect to login if not logged in.
 * Optionally restrict to a specific user_type.
 */
function requireAuth(requiredType = null) {
  const user = getCurrentUser();
  if (!user) {
    window.location.href = "login.html";
    return null;
  }
  if (requiredType && user.user_type !== requiredType) {
    window.location.href = "login.html";
    return null;
  }
  return user;
}

function logout() {
  clearCurrentUser();
  window.location.href = "login.html";
}

async function apiGetEmployeeAssignments(employeeId) {
  return apiFetch(`/employee/${employeeId}/assignments`);
}

async function apiGetTrainingQuestions(trainingId) {
  return apiFetch(`/trainings/${trainingId}/questions`);
}

async function apiSubmitAttempt(payload) {
  return apiFetch("/employee/submit-attempt", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function apiGetSupervisorDashboard(supervisorId) {
  return apiFetch(`/supervisor/${supervisorId}/dashboard`);
}

async function apiDeleteTraining(trainingId) {
  return apiFetch(`/trainings/${trainingId}`, {
    method: "DELETE"
  });
}

async function apiGetDepartmentEmployeesPerformance(supervisorId, departmentId) {
  return apiFetch(`/supervisor/${supervisorId}/department/${departmentId}/employees-performance`);
}

async function apiCreateSupervisorNote(payload) {
  return apiFetch("/supervisor/notes", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function apiGetSupervisorAnalytics(supervisorId) {
  return apiFetch(`/supervisor/${supervisorId}/analytics`);
}