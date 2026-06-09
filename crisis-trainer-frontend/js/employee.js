/**
 * employee.js — Employee Dashboard logic
 * Loads assignments from FastAPI and handles quiz flow.
 */

let currentUser = null;
let assignments = [];
let activeQuiz = null;

// ── Page Init ──
document.addEventListener("DOMContentLoaded", async () => {
  currentUser = requireAuth("employee");
  if (!currentUser) return;

  document.getElementById("userName").textContent = currentUser.full_name;
  document.getElementById("welcomeName").textContent = currentUser.full_name.split(" ")[0];

  document.getElementById("logoutBtn").addEventListener("click", logout);

  document.querySelectorAll("[data-close-modal]").forEach(btn => {
    btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
  });

  setupQuizButtons();
  await loadAssignmentsFromAPI();
});

// ── Load Assignments From Backend ──
async function loadAssignmentsFromAPI() {
  const grid = document.getElementById("assignmentsGrid");

  try {
    grid.innerHTML = `<div class="empty-state"><p>Loading assignments...</p></div>`;

    const res = await apiGetEmployeeAssignments(currentUser.id);

    assignments = (res.assignments || []).map(a => ({
      id: a.assignment_id,
      training_id: a.training_id,
      title: a.scenario_title || "Untitled Training",
      scenario_id: a.scenario_id || "",
      role: a.selected_role || "",
      difficulty: a.difficulty || "mixed",
      language: a.language || "en",
      status: a.status || "pending",
      score: a.score,
      total: a.total_questions,
      correct_answers: a.correct_answers,
      assigned_date: a.assigned_at || "",
      duration_minutes: a.duration_minutes || 10,
      supervisor_note: a.supervisor_note || null,
      ai_feedback: a.ai_feedback || null,
      questions: [] 
    }));

    renderAssignments();

  } catch (err) {
    console.error(err);
    grid.innerHTML = `
      <div class="empty-state">
        <div class="icon">⚠️</div>
        <p>Failed to load assignments.</p>
        <p class="text-muted">${escHtml(err.message)}</p>
      </div>
    `;
  }
}

window.aiFeedbackStore = {};

// ── Render Assignments ──
function renderAssignments() {
  const grid = document.getElementById("assignmentsGrid");

  const pending = assignments.filter(a => a.status === "pending");
  const completed = assignments.filter(a => a.status === "completed" || a.status === "graded" || a.status === "submitted");

  const pendingCount = document.getElementById("pendingCount");
  const completedCount = document.getElementById("completedCount");

  if (pendingCount) pendingCount.textContent = pending.length;
  if (completedCount) completedCount.textContent = completed.length;
  
  const totalCount = document.getElementById("totalCount");
  if (totalCount) totalCount.textContent = assignments.length;

  if (assignments.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="icon">📋</div>
        <p>No training assignments yet. Check back later.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = "";

  assignments.forEach(a => {
    const card = document.createElement("div");
    card.className = "assignment-card";

    const diffColor = {
      easy: "#1A7A4A",
      mixed: "#B7791F",
      hard: "#C0392B"
    }[a.difficulty] || "#2C7DA0";

    const isCompleted = a.status === "completed" || a.status === "graded" || a.status === "submitted";
    const ai = a.ai_feedback || null;

    const aiKey = `ai_${a.training_id}`;

    if (ai) {
      window.aiFeedbackStore[aiKey] = ai;
    }

    const aiButtonHTML = ai ? `
      <button class="btn btn-outline btn-sm"
        onclick="showAIFeedback(window.aiFeedbackStore['${aiKey}'])">
        View AI Feedback
      </button>
    ` : "";

    let feedbackHTML = "";

    if (isCompleted) {
      const score = a.score ?? 0;

      let strength = "";
      let weakness = "";

      if (score >= 80) {
        strength = "Strong understanding of procedures.";
        weakness = "No major weaknesses detected.";
      } else if (score >= 60) {
        strength = "Good basic understanding.";
        weakness = "Needs improvement in decision accuracy.";
      } else {
        strength = "Basic awareness only.";
        weakness = "Needs significant improvement.";
      }

      feedbackHTML = `
        <div style="margin-top:0.8rem;font-size:0.85rem;">
          <div><strong>💪 Strength:</strong> ${strength}</div>
          <div><strong>⚠️ Weakness:</strong> ${weakness}</div>
        </div>
      `;
    }

    const actionHTML = isCompleted
      ? `
        <span class="text-sm text-muted">
          Score: <strong>${a.score ?? "-"}%</strong>
        </span>
        <span class="status status-completed">Completed</span>
        ${aiButtonHTML}
      `
      : `
        <span class="status status-pending">Pending</span>
        <button class="btn btn-primary btn-sm" onclick="startQuiz(${a.training_id})">Start →</button>
      `;

    card.innerHTML = `
      <div class="assignment-card-top">
        <h4>${escHtml(a.title)}</h4>
        <div class="assignment-meta">
          <span>📁 ${escHtml(a.scenario_id)}</span>
          <span>👤 ${escHtml(a.role)}</span>
          <span style="color:${diffColor};font-weight:600;">⚡ ${capitalize(a.difficulty)}</span>
          <span>📅 ${escHtml(formatDate(a.assigned_date))}</span>
          <span>⏱️ ${a.duration_minutes} min</span>
        </div>
      </div>
        ${feedbackHTML}
      <div class="assignment-card-bottom">
        ${actionHTML}
      </div>
      ${a.supervisor_note ? `
        <div style="margin-top:0.8rem;padding:0.8rem;border-radius:10px;background:#fff7e6;border:1px solid #f0c36d;">
          <strong>📝 Supervisor Note:</strong><br>
          ${escHtml(a.supervisor_note)}
        </div>
      ` : ""}
    `;

    grid.appendChild(card);
  });
}

// ── Quiz Flow ──
async function startQuiz(trainingId) {
  const assignment = assignments.find(a => a.training_id === trainingId);

  if (!assignment) {
    alert("Assignment not found.");
    return;
  }

  try {
    const res = await apiGetTrainingQuestions(trainingId);
    const duration = res.training?.duration_minutes || assignment.duration_minutes || 10;

    activeQuiz = {
      assignment,
      questions: res.questions || [],
      duration_minutes: duration,
      timeLeft: duration * 60,
      timerInterval: null,
      currentIndex: 0,
      answers: [],
      submitted: false
    };

    if (activeQuiz.questions.length === 0) {
      alert("No questions available for this training.");
      return;
    }

document.getElementById("quizTitle").textContent = assignment.title;

const narrativeBox = document.getElementById("scenarioNarrative");

if (narrativeBox) {
  const scenarioText = res.training?.narrative || "";
  narrativeBox.textContent = scenarioText;
  narrativeBox.style.display = scenarioText ? "block" : "none";
}

renderQuestion();
openModal("quizModal");
startTimer();

  } catch (err) {
    alert("Failed to load questions: " + err.message);
  }
}

// ── Quiz Buttons Setup ──
function setupQuizButtons() {
  const nextBtn = document.getElementById("nextBtn");
  const prevBtn = document.getElementById("prevBtn");
  const submitBtn = document.getElementById("submitBtn");

  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      if (!activeQuiz) return;

      if (activeQuiz.answers[activeQuiz.currentIndex] === undefined) {
        showQuizAlert("Please select an answer before continuing.");
        return;
      }

      activeQuiz.currentIndex++;
      renderQuestion();
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      if (!activeQuiz) return;

      if (activeQuiz.currentIndex > 0) {
        activeQuiz.currentIndex--;
        renderQuestion();
      }
    });
  }

  if (submitBtn) {
    submitBtn.addEventListener("click", () => {
      if (!activeQuiz) return;

      if (activeQuiz.answers[activeQuiz.currentIndex] === undefined) {
        showQuizAlert("Please select an answer before submitting.");
        return;
      }

      submitQuiz();
    });
  }
}

function renderQuestion() {
  if (!activeQuiz) return;

  const quiz = activeQuiz;
  const q = quiz.questions[quiz.currentIndex];
  const total = quiz.questions.length;
  const idx = quiz.currentIndex;

  const pct = Math.round((idx / total) * 100);
  document.getElementById("progressFill").style.width = pct + "%";
  document.getElementById("progressLabel").textContent = `${idx + 1} / ${total}`;

  document.getElementById("questionText").textContent = q.question;

  const letters = ["A", "B", "C", "D"];
  const choicesEl = document.getElementById("quizChoices");
  choicesEl.innerHTML = "";

  q.choices.forEach((choice, ci) => {
    const btn = document.createElement("button");
    btn.className = "choice-btn";
    btn.innerHTML = `<span class="choice-letter">${letters[ci]}</span> ${escHtml(choice)}`;
    btn.addEventListener("click", () => selectChoice(ci));
    choicesEl.appendChild(btn);
  });

  const saved = quiz.answers[idx];
  if (saved !== undefined) highlightChoice(saved);

  const nextBtn = document.getElementById("nextBtn");
  const submitBtn = document.getElementById("submitBtn");
  const isLast = idx === total - 1;

  nextBtn.style.display = isLast ? "none" : "inline-flex";
  submitBtn.style.display = isLast ? "inline-flex" : "none";
  document.getElementById("prevBtn").disabled = idx === 0;
}

function selectChoice(choiceIndex) {
  if (!activeQuiz || activeQuiz.submitted) return;

  activeQuiz.answers[activeQuiz.currentIndex] = choiceIndex;
  highlightChoice(choiceIndex);
}

function highlightChoice(selectedIndex) {
  document.querySelectorAll(".choice-btn").forEach((btn, i) => {
    btn.classList.toggle("selected", i === selectedIndex);
  });
}

function submitQuiz(autoSubmit = false) {
  if (activeQuiz?.timerInterval) {
    clearInterval(activeQuiz.timerInterval);
    activeQuiz.timerInterval = null;
  }
  if (!activeQuiz) return;

  const quiz = activeQuiz;
  quiz.submitted = true;

  let correct = 0;
  quiz.questions.forEach((q, i) => {
    if (quiz.answers[i] === q.answer_index) correct++;
  });

  const pct = Math.round((correct / quiz.questions.length) * 100);
  console.log("pct:", pct);
  console.log("strength test is running");

  let strength = "";
  let weakness = "";

  if (pct >= 80) {
    strength = "Strong understanding of procedures and decision-making.";
    weakness = "No major weaknesses detected.";
  } else if (pct >= 60) {
    strength = "Good basic understanding of crisis handling.";
    weakness = "Needs improvement in decision accuracy under pressure.";
  } else {
    strength = "Basic awareness only.";
    weakness = "Needs significant improvement in crisis response skills.";
  }

  const submitPayload = {
    employee_id: currentUser.id,
    training_id: quiz.assignment.training_id,
    answers: quiz.questions.map((q, i) => ({
      question_id: Number(q.id),
      selected_answer_index: Number.isInteger(quiz.answers[i]) ? quiz.answers[i] : -1
    }))
  };
  console.log("Submit payload:", submitPayload);

    document.getElementById("quizBody").style.display = "none";
    document.getElementById("quizFooter").style.display = "none";

    const scoreScreen = document.getElementById("scoreScreen");
    scoreScreen.style.display = "block";
    scoreScreen.innerHTML = `
      <div class="score-screen">
        <p>Generating AI feedback...</p>
      </div>
    `;

    apiSubmitAttempt(submitPayload)
.then(res => {
  console.log("Saved to DB ✅");
  console.log("AI Feedback:", res.ai_feedback);

  let aiSummary = "";
  let aiRecommendations = "";
  let ai = null;

  if (res.ai_feedback) {
    ai = res.ai_feedback;

    const fb = res.ai_feedback;

    aiSummary = fb.summary || "";
    aiRecommendations = fb.recommendations?.join(", ") || "";

    strength = fb.strengths?.join(", ") || strength;
    weakness = fb.weaknesses?.join(", ") || weakness;
  }

  const grade = pct >= 80 ? "Excellent! 🎉" : pct >= 60 ? "Good effort 👍" : "Keep practicing 📚";

  scoreScreen.innerHTML = `
    <div class="score-screen">
      <div class="score-circle">
        <span class="score-number">${correct}</span>
        <span class="score-of">of ${quiz.questions.length}</span>
      </div>

      <div class="score-title">${grade}</div>

      <div class="score-sub">
        You scored <strong>${pct}%</strong> on this training module.
      </div>

      <div style="margin-top:1rem;text-align:left;">
        <p><strong>🤖 AI Feedback:</strong></p>
        <p><strong>🧠 Summary:</strong> ${aiSummary || "No summary available."}</p>
        <p><strong>💪 Strength:</strong> ${strength}</p>
        <p><strong>⚠️ Weakness:</strong> ${weakness}</p>
        <p><strong>✅ Recommendations:</strong> ${aiRecommendations || "Review the training material and try again."}</p>
      </div>

      <div style="margin-top:1.5rem;">
        <button class="btn btn-outline" onclick="closeModal('quizModal'); loadAssignmentsFromAPI();">
          Back to Assignments
        </button>
      </div>
    </div>
  `;

  loadAssignmentsFromAPI();
})
  .catch(err => {
    console.error("Save failed ❌", err);

    scoreScreen.innerHTML = `
      <div class="score-screen">
        <p style="color:red;">Failed to save your attempt.</p>
        <p>${escHtml(err.message)}</p>
      </div>
    `;
  });
}

// ── Helpers ──
function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;

  el.classList.add("active");
  document.body.style.overflow = "hidden";

  if (id === "quizModal") {
    const quizBody = document.getElementById("quizBody");
    const quizFooter = document.getElementById("quizFooter");
    const scoreScreen = document.getElementById("scoreScreen");

    if (quizBody) quizBody.style.display = "block";
    if (quizFooter) quizFooter.style.display = "flex";
    if (scoreScreen) scoreScreen.style.display = "none";
  }
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;

  if (id === "quizModal" && activeQuiz?.timerInterval) {
    clearInterval(activeQuiz.timerInterval);
    activeQuiz.timerInterval = null;
  }

  el.classList.remove("active");
  document.body.style.overflow = "";
}

function showQuizAlert(msg) {
  const el = document.getElementById("quizAlert");
  if (!el) return;

  el.textContent = msg;
  el.style.display = "flex";

  setTimeout(() => {
    el.style.display = "none";
  }, 2500);
}

function escHtml(str) {
  const d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML;
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

function formatDate(dateStr) {
  if (!dateStr) return "-";

  try {
    return new Date(dateStr).toLocaleString();
  } catch {
    return dateStr;
  }
}

function startTimer() {
  if (!activeQuiz) return;

  if (activeQuiz.timerInterval) {
    clearInterval(activeQuiz.timerInterval);
    activeQuiz.timerInterval = null;
  }

  updateTimerText();

  activeQuiz.timerInterval = setInterval(() => {
    activeQuiz.timeLeft--;

    updateTimerText();

    if (activeQuiz.timeLeft <= 0) {
      clearInterval(activeQuiz.timerInterval);
      activeQuiz.timerInterval = null;

      showQuizAlert("Time is up. Your answers will be submitted automatically.");
      submitQuiz(true);
    }
  }, 1000);
}

function updateTimerText() {
  const el = document.getElementById("timerText");
  if (!el || !activeQuiz) return;

  const minutes = Math.floor(activeQuiz.timeLeft / 60);
  const seconds = activeQuiz.timeLeft % 60;

  el.textContent =
    `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function showAIFeedback(feedback) {
  if (!feedback) return;

  const modal = document.getElementById("quizModal");
  const quizBody = document.getElementById("quizBody");
  const quizFooter = document.getElementById("quizFooter");
  const scoreScreen = document.getElementById("scoreScreen");

  document.getElementById("quizTitle").textContent = "AI Detailed Feedback";

  if (quizBody) quizBody.style.display = "none";
  if (quizFooter) quizFooter.style.display = "none";

  scoreScreen.style.display = "block";

  modal.classList.add("active");
  document.body.style.overflow = "hidden";

  scoreScreen.innerHTML = `
    <div class="score-screen" style="text-align:left;max-width:700px;margin:auto;">
      <h2 style="margin-bottom:1rem;">🤖 AI Detailed Feedback</h2>

      <div style="margin-bottom:1rem;">
        <strong>🧠 Summary</strong>
        <p>${escHtml(feedback.summary || "-")}</p>
      </div>

      <div style="margin-bottom:1rem;">
        <strong>💪 Strengths</strong>
        <ul>
          ${(feedback.strengths || []).map(s => `<li>${escHtml(s)}</li>`).join("")}
        </ul>
      </div>

      <div style="margin-bottom:1rem;">
        <strong>⚠️ Weaknesses</strong>
        <ul>
          ${(feedback.weaknesses || []).map(w => `<li>${escHtml(w)}</li>`).join("")}
        </ul>
      </div>

      <div style="margin-bottom:1rem;">
        <strong>✅ Recommendations</strong>
        <ul>
          ${(feedback.recommendations || []).map(r => `<li>${escHtml(r)}</li>`).join("")}
        </ul>
      </div>

      <button class="btn btn-outline" onclick="closeModal('quizModal');">
        Close
      </button>
    </div>
  `;
}

window.showAIFeedback = showAIFeedback;

