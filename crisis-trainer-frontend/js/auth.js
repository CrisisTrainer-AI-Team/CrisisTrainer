/**
 * auth.js — Login & Register page logic
 */

document.addEventListener("DOMContentLoaded", () => {

  // ── Tab Switching ──
  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabPanes = document.querySelectorAll(".tab-pane");

  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {

      const target = btn.dataset.tab;

      tabBtns.forEach(b => b.classList.remove("active"));
      tabPanes.forEach(p => p.classList.remove("active"));

      btn.classList.add("active");
      document.getElementById(target).classList.add("active");

      clearAlerts();
    });
  });

  // ── Login Form ──
  const loginForm = document.getElementById("loginForm");

  loginForm.addEventListener("submit", async (e) => {

    e.preventDefault();

    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;
    const btn = document.getElementById("loginBtn");

    clearAlerts("loginAlert");

    setLoading(btn, true);

    try {

      const data = await apiLogin(email, password);

      setCurrentUser(data.user);

      // Redirect based on role
      if (data.user.user_type === "supervisor") {
        window.location.href = "supervisor-dashboard.html";
      } else {
        window.location.href = "employee-dashboard.html";
      }

    } catch (err) {

      showAlert("loginAlert", err.message, "error");

    } finally {

      setLoading(btn, false);

    }

  });

  // ── Register Form ──
  const registerForm = document.getElementById("registerForm");

  registerForm.addEventListener("submit", async (e) => {

    e.preventDefault();

    const payload = {
      full_name: document.getElementById("regName").value.trim(),
      email: document.getElementById("regEmail").value.trim(),
      password: document.getElementById("regPassword").value,
      user_type: document.getElementById("regType").value,
      department_id: parseInt(document.getElementById("regDept").value),
    };

    const btn = document.getElementById("registerBtn");

    clearAlerts("registerAlert");

    if (!payload.full_name || !payload.email || !payload.password) {

      showAlert(
        "registerAlert",
        "Please fill in all required fields.",
        "error"
      );

      return;
    }

    setLoading(btn, true);

    try {

      await apiRegister(payload);

      showAlert(
        "registerAlert",
        "Account created! You can now log in.",
        "success"
      );

      registerForm.reset();

      setTimeout(() => {

        document.querySelector('[data-tab="loginTab"]').click();

        document.getElementById("loginEmail").value = payload.email;

      }, 1200);

    } catch (err) {

      showAlert("registerAlert", err.message, "error");

    } finally {

      setLoading(btn, false);

    }

  });

});

/* ── Helpers ── */

function showAlert(id, msg, type = "error") {

  const el = document.getElementById(id);

  if (!el) return;

  el.className = `alert alert-${type}`;
  el.textContent = msg;
  el.style.display = "flex";
}

function clearAlerts(id = null) {

  if (id) {

    const el = document.getElementById(id);

    if (el) el.style.display = "none";

  } else {

    document.querySelectorAll(".alert").forEach(el => {
      el.style.display = "none";
    });

  }

}

function setLoading(btn, loading) {

  if (loading) {

    btn.dataset.original = btn.innerHTML;

    btn.innerHTML =
      '<span class="spinner"></span> Please wait...';

    btn.disabled = true;

  } else {

    btn.innerHTML = btn.dataset.original || btn.innerHTML;

    btn.disabled = false;

  }

}