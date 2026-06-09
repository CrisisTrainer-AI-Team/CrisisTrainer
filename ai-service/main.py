import os, json, glob
from pathlib import Path
from typing import List, Dict, Any

import numpy as np
import faiss
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from openai import OpenAI

from sqlalchemy.orm import Session
from sqlalchemy import or_, and_
from sqlalchemy import func
from fastapi import Depends, HTTPException
from database import get_db
from models import User, Training, TrainingQuestion, TrainingAssignment, Attempt, AttemptAnswer, Department, SupervisorNote
from schemas import LoginRequest, UserCreate, AssignTrainingRequest, SubmitAttemptRequest, SupervisorNoteCreate, ResetPasswordRequest
from passlib.context import CryptContext
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime

# =========================
# CONFIG
# =========================
DATA_ROOT = Path("crisis_trainer_full_pack")
EMBED_MODEL = "text-embedding-3-small"
GEN_MODEL = "gpt-4.1-mini"
MAX_FIX_ROUNDS = 3
TOP_K = 6

client = OpenAI()  # يقرأ OPENAI_API_KEY من البيئة (PowerShell)

app = FastAPI(title="CrisisTrainer", version="1.0")
# --- اضفي هذين السطرين هنا لإنشاء الجداول تلقائياً في SQLite عند الرفع ---
from database import Base, engine
Base.metadata.create_all(bind=engine)
# -----------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)
# =========================
# HELPERS
# =========================
def find_scenario_files() -> List[Path]:
    return [Path(p) for p in glob.glob(str(DATA_ROOT / "**" / "*.scenario.json"), recursive=True)]

def load_json(p: Path) -> Dict[str, Any]:
    return json.loads(p.read_text(encoding="utf-8"))

def load_jsonl(p: Path) -> List[Dict[str, Any]]:
    rows = []
    with open(p, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows

def scenario_assets_path(scenario_id: str) -> Dict[str, Path]:
    for sp in find_scenario_files():
        obj = load_json(sp)
        if obj.get("scenario_id") == scenario_id:
            folder = sp.parent
            return {
                "scenario": sp,
                "questions": folder / f"{scenario_id}.questions.json",
                "tree": folder / f"{scenario_id}.tree.json",
                "rag": folder / f"{scenario_id}.rag_chunks.jsonl",
            }
    raise FileNotFoundError(f"Scenario ID not found: {scenario_id}")


# =========================
# RAG Index Cache
# =========================
INDEX_CACHE: Dict[str, Dict[str, Any]] = {}

def build_index_for_scenario(scenario_id: str):
    paths = scenario_assets_path(scenario_id)
    rag_path = paths["rag"]
    if not rag_path.exists():
        raise FileNotFoundError(f"Missing rag_chunks for {scenario_id}: {rag_path}")

    chunks = load_jsonl(rag_path)
    texts = [c.get("text", "") for c in chunks]

    emb = client.embeddings.create(model=EMBED_MODEL, input=texts)
    X = np.array([d.embedding for d in emb.data], dtype="float32")
    faiss.normalize_L2(X)

    index = faiss.IndexFlatIP(X.shape[1])
    index.add(X)

    INDEX_CACHE[scenario_id] = {"chunks": chunks, "index": index}

def retrieve(scenario_id: str, query: str, k: int = TOP_K) -> List[Dict[str, Any]]:
    if scenario_id not in INDEX_CACHE:
        build_index_for_scenario(scenario_id)

    chunks = INDEX_CACHE[scenario_id]["chunks"]
    index = INDEX_CACHE[scenario_id]["index"]

    q_emb = client.embeddings.create(model=EMBED_MODEL, input=query).data[0].embedding
    q = np.array(q_emb, dtype="float32").reshape(1, -1)
    faiss.normalize_L2(q)

    scores, ids = index.search(q, k)
    out = []
    for idx, sc in zip(ids[0], scores[0]):
        item = chunks[int(idx)]
        out.append({
            "score": float(sc),
            "chunk_id": item.get("chunk_id"),
            "title": item.get("title"),
            "text": item.get("text"),
            "source": item.get("source"),
            "sub_standard": item.get("sub_standard"),
        })
    return out


# =========================
# Schemas
# =========================
class GenerateRequest(BaseModel):
    scenario_id: str
    role: str
    n_scenarios: int = Field(1, ge=1, le=5)
    q_per_scenario: int = Field(5, ge=1, le=12)
    difficulty: str = Field("mixed")
    language: str = Field("en")

class ValidateReport(BaseModel):
    fails: int
    issues: List[Dict[str, Any]]

class GenerateResponse(BaseModel):
    scenario_id: str
    role: str
    validator: ValidateReport
    payload: Dict[str, Any]


# =========================
# Prompts + Validator
# =========================
def build_generation_prompt(req: GenerateRequest, base_scenario: Dict[str, Any], evidence: List[Dict[str, Any]]) -> str:
    ev_text = "\n\n".join([f"[{e['chunk_id']}] {e['text']}" for e in evidence])
    return f"""
You are generating training content for a hospital crisis-training system.

STRICT RULES:
- Use ONLY the evidence provided. Do NOT invent departments, extensions, steps, or claims.
- Every question MUST cite evidence_chunk_ids that directly support the correct choice.
- Output MUST be valid JSON ONLY (no markdown).
- Produce ONE JSON object with keys: generated_scenarios (list).
- Each element in generated_scenarios must have:
  - scenario_id
  - title
  - role
  - narrative
  - questions: list of multiple-choice items
    - item_id
    - role
    - question
    - choices (4 strings)
    - answer_index (0..3)
    - rationale
    - evidence_chunk_ids (list of chunk ids)

CONTEXT:
Base scenario_id: {base_scenario.get('scenario_id')}
Base title: {base_scenario.get('title')}
Requested role: {req.role}
n_scenarios: {req.n_scenarios}
q_per_scenario: {req.q_per_scenario}
difficulty: {req.difficulty}
language: {req.language}

EVIDENCE:
{ev_text}
""".strip()

def build_fix_prompt(draft: Dict[str, Any], report: Dict[str, Any], evidence: List[Dict[str, Any]]) -> str:
    ev_text = "\n\n".join([f"[{e['chunk_id']}] {e['text']}" for e in evidence])
    return f"""
You must FIX the generated JSON to satisfy validation.

RULES:
- Only modify what is necessary.
- Do NOT add unsupported claims.
- Ensure each failed item is corrected so the correct answer is fully supported by cited evidence_chunk_ids.
- Output valid JSON ONLY (no markdown).
- Keep same overall structure.

EVIDENCE:
{ev_text}

VALIDATION REPORT:
{json.dumps(report, ensure_ascii=False, indent=2)}

CURRENT DRAFT:
{json.dumps(draft, ensure_ascii=False)}
""".strip()

def validate_payload(draft: Dict[str, Any], evidence_map: Dict[str, str]) -> Dict[str, Any]:
    issues = []
    fails = 0

    if "generated_scenarios" not in draft or not isinstance(draft["generated_scenarios"], list):
        return {"fails": 1, "issues": [{"type":"FORMAT", "msg":"Missing generated_scenarios list"}]}

    for si, sc in enumerate(draft["generated_scenarios"]):
        qs = sc.get("questions", [])
        if not isinstance(qs, list) or len(qs) == 0:
            fails += 1
            issues.append({"type":"FORMAT", "where": f"generated_scenarios[{si}]", "msg":"No questions list"})
            continue

        for q in qs:
            evid_ids = q.get("evidence_chunk_ids", [])
            if not evid_ids:
                fails += 1
                issues.append({"type":"EVIDENCE", "item": q.get("item_id"), "msg":"Missing evidence_chunk_ids"})
                continue

            ev_text = " ".join([evidence_map.get(eid, "") for eid in evid_ids]).strip()
            if not ev_text:
                fails += 1
                issues.append({"type":"EVIDENCE", "item": q.get("item_id"), "msg":"Evidence ids not found"})
                continue

            choices = q.get("choices") or q.get("options") or []
            ans = q.get("answer_index", None)
            if not isinstance(choices, list) or len(choices) != 4 or not isinstance(ans, int) or ans < 0 or ans > 3:
                fails += 1
                issues.append({"type":"FORMAT", "item": q.get("item_id"), "msg":"Bad MCQ format"})
                continue

            correct_choice = choices[ans].lower().strip()
            ev_low = ev_text.lower()
            tokens = [t for t in correct_choice.replace("(", " ").replace(")", " ").replace("/", " ").split() if len(t) >= 4]
            token_hits = sum(1 for t in tokens if t in ev_low)

            if (correct_choice not in ev_low) and (token_hits == 0):
                fails += 1
                issues.append({
                    "type":"UNSUPPORTED",
                    "item": q.get("item_id"),
                    "msg":"Correct answer not supported by cited evidence",
                    "correct_choice": choices[ans],
                    "evidence_used": evid_ids
                })

    return {"fails": fails, "issues": issues}


# =========================
# LLM Calls
# =========================
def llm_json(prompt: str) -> Dict[str, Any]:
    r = client.responses.create(
        model=GEN_MODEL,
        input=prompt,
        temperature=0.2
    )

    text = r.output_text.strip()

    # Remove markdown code fences if model returns ```json ... ```
    if text.startswith("```"):
        text = text.replace("```json", "").replace("```", "").strip()

    # Try direct JSON parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        print("RAW NON-JSON AI OUTPUT:")
        print(text)

        # Try extracting first JSON object only
        start = text.find("{")
        end = text.rfind("}")

        if start != -1 and end != -1 and end > start:
            return json.loads(text[start:end + 1])

        raise

def generate_with_autofix(req: GenerateRequest) -> Dict[str, Any]:
    paths = scenario_assets_path(req.scenario_id)
    base_scenario = load_json(paths["scenario"])

    evidence = retrieve(req.scenario_id, query=f"{base_scenario.get('title')} procedures for role {req.role}", k=TOP_K)
    evidence_map = {e["chunk_id"]: e["text"] for e in evidence}

    draft = llm_json(build_generation_prompt(req, base_scenario, evidence))
    report = validate_payload(draft, evidence_map)

    round_i = 0
    while report["fails"] > 0 and round_i < MAX_FIX_ROUNDS:
        draft = llm_json(build_fix_prompt(draft, report, evidence))
        report = validate_payload(draft, evidence_map)
        round_i += 1

    return {"draft": draft, "report": report}


# =========================
# API Endpoints
# =========================
@app.get("/scenarios")
def list_scenarios():
    out = []
    for sp in find_scenario_files():
        obj = load_json(sp)
        out.append({
            "scenario_id": obj.get("scenario_id"),
            "title": obj.get("title"),
            "utility_type": obj.get("utility_type"),
        })
    return out

@app.get("/scenarios/{scenario_id}/roles")
def list_roles(scenario_id: str):
    try:
        sc = load_json(scenario_assets_path(scenario_id)["scenario"])
        return {"scenario_id": scenario_id, "roles": sc.get("roles_involved", [])}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Scenario not found")

@app.post("/generate", response_model=GenerateResponse)
def generate(req: GenerateRequest):
    try:
        _ = scenario_assets_path(req.scenario_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Scenario not found")

    result = generate_with_autofix(req)
    return {
        "scenario_id": req.scenario_id,
        "role": req.role,
        "validator": result["report"],
        "payload": result["draft"],
    }
@app.post("/auth/register")
def register_user(payload: UserCreate, db: Session = Depends(get_db)):
    existing_user = db.query(User).filter(User.email == payload.email).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already exists")

    if payload.user_type not in ["supervisor", "employee"]:
        raise HTTPException(status_code=400, detail="Invalid user_type")

    new_user = User(
        full_name=payload.full_name,
        email=payload.email,
        password_hash=hash_password(payload.password),
        user_type=payload.user_type,
        department_id=payload.department_id,
        is_active=True
    )

    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    return {
        "message": "User created successfully",
        "user": {
            "id": new_user.id,
            "full_name": new_user.full_name,
            "email": new_user.email,
            "user_type": new_user.user_type,
            "department_id": new_user.department_id
        }
    }
@app.post("/auth/login")
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()

    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if not user.is_active:
        raise HTTPException(status_code=403, detail="User is inactive")

    return {
        "message": "Login successful",
        "user": {
            "id": user.id,
            "full_name": user.full_name,
            "email": user.email,
            "user_type": user.user_type,
            "department_id": user.department_id
        }
    }
@app.post("/auth/reset-password")
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()

    if not user:
        raise HTTPException(status_code=404, detail="Email not found")

    if len(payload.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    user.password_hash = hash_password(payload.new_password)

    db.commit()
    db.refresh(user)

    return {
        "message": "Password reset successfully"
    }
@app.post("/trainings/assign")
def assign_training(payload: AssignTrainingRequest, db: Session = Depends(get_db)):
    if payload.assignment_type not in ["employee", "department", "all"]:
        raise HTTPException(status_code=400, detail="Invalid assignment_type")

    if payload.assignment_type == "employee" and not payload.employee_id:
        raise HTTPException(status_code=400, detail="employee_id is required")

    if payload.assignment_type == "department" and not payload.department_id:
        raise HTTPException(status_code=400, detail="department_id is required")

    supervisor = db.query(User).filter(User.id == payload.created_by).first()
    if not supervisor:
        raise HTTPException(status_code=404, detail="Supervisor not found")

    if supervisor.user_type != "supervisor":
        raise HTTPException(status_code=403, detail="Only supervisors can assign training")

    try:
        training = Training(
            created_by=payload.created_by,
            scenario_id=payload.scenario_id,
            scenario_title=payload.scenario_title,
            domain=payload.domain,
            facility=payload.facility,
            selected_role=payload.selected_role,
            language=payload.language,
            difficulty=payload.difficulty,
            n_scenarios=payload.n_scenarios,
            q_per_scenario=payload.q_per_scenario,
            duration_minutes=payload.duration_minutes,
            ai_payload=json.dumps(payload.ai_payload, ensure_ascii=False),
            validator_report=json.dumps(payload.validator_report, ensure_ascii=False) if payload.validator_report else None,
            status="assigned"
        )

        db.add(training)
        db.commit()
        db.refresh(training)

        generated_scenarios = payload.ai_payload.get("generated_scenarios", [])

        question_counter = 1
        for scenario in generated_scenarios:
            questions = scenario.get("questions", [])
            for q in questions:
                choices = q.get("choices") or q.get("options") or []

                question = TrainingQuestion(
                    training_id=training.id,
                    question_text=q.get("question", ""),
                    option_1=choices[0] if len(choices) > 0 else "",
                    option_2=choices[1] if len(choices) > 1 else "",
                    option_3=choices[2] if len(choices) > 2 else "",
                    option_4=choices[3] if len(choices) > 3 else "",
                    correct_answer_index=q.get("answer_index", 0),
                    evidence_chunk_ids=json.dumps(q.get("evidence_chunk_ids", []), ensure_ascii=False),
                    question_order=question_counter
                )
                db.add(question)
                question_counter += 1

        db.commit()

        assignment = TrainingAssignment(
            training_id=training.id,
            assignment_type=payload.assignment_type,
            employee_id=payload.employee_id,
            department_id=payload.department_id,
            assigned_by=payload.created_by
        )

        db.add(assignment)
        db.commit()
        db.refresh(assignment)

        return {
            "message": "Training assigned successfully",
            "training_id": training.id,
            "assignment_id": assignment.id,
            "assignment_type": assignment.assignment_type
        }

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    
@app.get("/employee/{employee_id}/assignments")
def get_employee_assignments(employee_id: int, db: Session = Depends(get_db)):
    employee = db.query(User).filter(User.id == employee_id).first()

    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    if employee.user_type != "employee":
        raise HTTPException(status_code=403, detail="User is not an employee")

    assignments = (
        db.query(TrainingAssignment, Training)
        .join(Training, TrainingAssignment.training_id == Training.id)
        .filter(
            or_(
                TrainingAssignment.assignment_type == "all",
                and_(
                    TrainingAssignment.assignment_type == "employee",
                    TrainingAssignment.employee_id == employee.id
                ),
                and_(
                    TrainingAssignment.assignment_type == "department",
                    TrainingAssignment.department_id == employee.department_id
                )
            )
        )
        .order_by(TrainingAssignment.assigned_at.desc())
        .all()
    )

    result = []

    for assignment, training in assignments:
        attempt = (
            db.query(Attempt)
            .filter(
                Attempt.training_id == training.id,
                Attempt.employee_id == employee.id
            )
            .first()
        )

        latest_note = (
            db.query(SupervisorNote)
            .filter(
                SupervisorNote.training_id == training.id,
                SupervisorNote.employee_id == employee.id
            )
            .order_by(SupervisorNote.created_at.desc())
            .first()
        )
        result.append({
            "assignment_id": assignment.id,
            "training_id": training.id,
            "scenario_id": training.scenario_id,
            "scenario_title": training.scenario_title,
            "selected_role": training.selected_role,
            "difficulty": training.difficulty,
            "language": training.language,
            "assignment_type": assignment.assignment_type,
            "assigned_at": str(assignment.assigned_at),
            "status": attempt.status if attempt else "pending",
            "score": float(attempt.score) if attempt else None,
            "total_questions": attempt.total_questions if attempt else None,
            "correct_answers": attempt.correct_answers if attempt else None,
            "duration_minutes": training.duration_minutes,
            "supervisor_note": latest_note.note_text if latest_note else None,
            "ai_feedback": json.loads(attempt.ai_feedback) if attempt and attempt.ai_feedback else None
        })

        completed_count = len([
            a for a in result
            if a["status"] in ["graded", "completed", "submitted"]
        ])

        pending_count = len([
            a for a in result
            if a["status"] == "pending"
        ])

        total_assigned = len(result)

    return {
        "employee": {
            "id": employee.id,
            "full_name": employee.full_name,
            "department_id": employee.department_id
        },
        "stats": {
            "completed": completed_count,
            "pending": pending_count,
            "total": total_assigned
        },
        "assignments": result
    }

@app.get("/trainings/{training_id}/questions")
def get_training_questions(training_id: int, db: Session = Depends(get_db)):
    training = db.query(Training).filter(Training.id == training_id).first()

    if not training:
        raise HTTPException(status_code=404, detail="Training not found")

    questions = (
        db.query(TrainingQuestion)
        .filter(TrainingQuestion.training_id == training_id)
        .order_by(TrainingQuestion.question_order.asc())
        .all()
    )
    ai_payload = json.loads(training.ai_payload) if training.ai_payload else {}
    generated_scenarios = ai_payload.get("generated_scenarios", [])
    scenario_narrative = ""

    if generated_scenarios:
        scenario_narrative = generated_scenarios[0].get("narrative", "")
    return {
        "training": {
            "id": training.id,
            "title": training.scenario_title,
            "scenario_id": training.scenario_id,
            "role": training.selected_role,
            "difficulty": training.difficulty,
            "language": training.language,
            "duration_minutes": training.duration_minutes,
            "narrative": scenario_narrative
        },
        "questions": [
            {
                "id": q.id,
                "question": q.question_text,
                "choices": [q.option_1, q.option_2, q.option_3, q.option_4],
                "answer_index": q.correct_answer_index
            }
            for q in questions
        ]
    }
def generate_ai_feedback_for_attempt(training, questions, payload_answers, score):
    answer_map = {a.question_id: a.selected_answer_index for a in payload_answers}

    items = []
    for q in questions:
        selected = answer_map.get(q.id, -1)

        choices = [q.option_1, q.option_2, q.option_3, q.option_4]

        items.append({
            "question": q.question_text,
            "choices": choices,
            "selected_answer": choices[selected] if selected in [0, 1, 2, 3] else "Not answered",
            "correct_answer": choices[q.correct_answer_index],
            "is_correct": selected == q.correct_answer_index
        })

    prompt = f"""
You are an AI training evaluator for a hospital crisis training system.

Return ONLY valid JSON.
Do not use markdown.
Do not use ```json.
Do not add explanations outside JSON.

The JSON format must be:
{{
  "summary": "short summary",
  "strengths": ["strength 1"],
  "weaknesses": ["weakness 1"],
  "recommendations": ["recommendation 1"]
}}

Training:
Scenario: {training.scenario_title}
Role: {training.selected_role}
Difficulty: {training.difficulty}
Score: {score}%

Answers:
{json.dumps(items, ensure_ascii=False, indent=2)}
"""

    try:
        feedback = llm_json(prompt)
        print("RAW AI FEEDBACK:", feedback)
        return json.dumps(feedback, ensure_ascii=False)

    except Exception as e:
        import traceback
        print("========== AI FEEDBACK ERROR ==========")
        traceback.print_exc()
        print("=======================================")

        return json.dumps({
            "summary": "AI feedback could not be generated.",
            "strengths": [],
            "weaknesses": [],
            "recommendations": ["Review the training procedure and try again."]
        }, ensure_ascii=False)

@app.post("/employee/submit-attempt")
def submit_attempt(payload: SubmitAttemptRequest, db: Session = Depends(get_db)):
    employee = db.query(User).filter(User.id == payload.employee_id).first()
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    training = db.query(Training).filter(Training.id == payload.training_id).first()
    if not training:
        raise HTTPException(status_code=404, detail="Training not found")

    questions = (
        db.query(TrainingQuestion)
        .filter(TrainingQuestion.training_id == payload.training_id)
        .all()
    )

    question_map = {q.id: q for q in questions}

    correct = 0
    total = len(payload.answers)

    attempt = Attempt(
        training_id=payload.training_id,
        employee_id=payload.employee_id,
        started_at=datetime.now(),
        submitted_at=datetime.now(),
        total_questions=total,
        correct_answers=0,
        score=0,
        status="graded"
    )

    db.add(attempt)
    db.commit()
    db.refresh(attempt)

    for ans in payload.answers:
        question = question_map.get(ans.question_id)
        if not question:
            continue

        is_correct = ans.selected_answer_index == question.correct_answer_index

        if is_correct:
            correct += 1

        attempt_answer = AttemptAnswer(
            attempt_id=attempt.id,
            question_id=ans.question_id,
            selected_answer_index=ans.selected_answer_index,
            is_correct=is_correct
        )

        db.add(attempt_answer)

    score = round((correct / total) * 100, 2) if total > 0 else 0

    attempt.correct_answers = correct
    attempt.score = score
    attempt.status = "graded"

    attempt.ai_feedback = generate_ai_feedback_for_attempt(
        training=training,
        questions=questions,
        payload_answers=payload.answers,
        score=score
    )

    db.commit()

    return {
        "message": "Attempt submitted successfully",
        "attempt_id": attempt.id,
        "training_id": payload.training_id,
        "employee_id": payload.employee_id,
        "correct_answers": correct,
        "total_questions": total,
        "score": score,
        "status": "graded",
        "ai_feedback": json.loads(attempt.ai_feedback) if attempt.ai_feedback else None
    }

@app.get("/supervisor/{supervisor_id}/dashboard")
def supervisor_dashboard(supervisor_id: int, db: Session = Depends(get_db)):
    supervisor = db.query(User).filter(User.id == supervisor_id).first()
    if not supervisor:
        raise HTTPException(status_code=404, detail="Supervisor not found")

    if supervisor.user_type != "supervisor":
        raise HTTPException(status_code=403, detail="User is not a supervisor")

    rows = (
        db.query(TrainingAssignment, Training, User, Attempt)
        .join(Training, TrainingAssignment.training_id == Training.id)
        .outerjoin(User, TrainingAssignment.employee_id == User.id)
        .outerjoin(
            Attempt,
            (Attempt.training_id == Training.id) &
            (Attempt.employee_id == TrainingAssignment.employee_id)
        )
        .filter(Training.created_by == supervisor_id)
        .order_by(TrainingAssignment.assigned_at.desc())
        .all()
    )

    total = len(rows)
    completed = 0
    pending = 0
    scores = []
    assignments = []

    for assignment, training, employee, attempt in rows:
        department_name = None

        if assignment.department_id:
            dept = db.query(Department).filter(Department.id == assignment.department_id).first()
            department_name = dept.name if dept else None

        elif employee and employee.department_id:
            dept = db.query(Department).filter(Department.id == employee.department_id).first()
            department_name = dept.name if dept else None

        target_employees = []

        if assignment.assignment_type == "all":
            target_employees = db.query(User).filter(User.user_type == "employee").all()

        elif assignment.assignment_type == "department":
            target_employees = db.query(User).filter(
                User.user_type == "employee",
                User.department_id == assignment.department_id
            ).all()

        elif assignment.assignment_type == "employee" and assignment.employee_id:
            emp = db.query(User).filter(User.id == assignment.employee_id).first()
            target_employees = [emp] if emp else []

        target_count = len(target_employees)

        completed_count = 0

        for emp in target_employees:
            emp_attempt = db.query(Attempt).filter(
                Attempt.training_id == training.id,
                Attempt.employee_id == emp.id
            ).first()

            if emp_attempt and emp_attempt.status in ["graded", "completed", "submitted"]:
                completed_count += 1

        if target_count == 0:
            status = "pending"
        elif completed_count == 0:
            status = "pending"
        elif completed_count < target_count:
            status = "in progress"
        else:
            status = "completed"


        if status in ["graded", "completed", "submitted"]:
            completed += 1
        else:
            pending += 1

        if attempt and attempt.score is not None:
            scores.append(float(attempt.score))

        assignments.append({
            "assignment_id": assignment.id,
            "training_id": training.id,
            "employee": (
                employee.full_name if employee
                else f"Dept #{assignment.department_id}"
            ),
            "department_id": assignment.department_id or (employee.department_id if employee else None),
            "department_name": (
                "All" if assignment.assignment_type == "all"
                else department_name or "-"),
            "scenario": training.scenario_title,
            "scenario_id": training.scenario_id,
            "difficulty": training.difficulty,
            "status": status,
            "score": float(attempt.score) if attempt and attempt.score is not None else None,
            "total_questions": attempt.total_questions if attempt else None,
            "created_at": str(assignment.assigned_at),
            "q_per_scenario": training.q_per_scenario,
            "assignment_type": assignment.assignment_type,
            "assigned_to": (
                "All Employees" if assignment.assignment_type == "all"
                else department_name if assignment.assignment_type == "department"
                else employee.full_name if employee
                else "-"),
            "duration_minutes": training.duration_minutes,
            "target_count": target_count,
            "completed_count": completed_count
        })

    avg_score = round(sum(scores) / len(scores), 2) if scores else 0

    return {
        "stats": {
            "total": total,
            "completed": completed,
            "pending": pending,
            "avg_score": avg_score
        },
        "assignments": assignments
    }

@app.get("/supervisor/{supervisor_id}/analytics")
def supervisor_analytics(supervisor_id: int, db: Session = Depends(get_db)):
    supervisor = db.query(User).filter(User.id == supervisor_id).first()

    if not supervisor:
        raise HTTPException(status_code=404, detail="Supervisor not found")

    if supervisor.user_type != "supervisor":
        raise HTTPException(status_code=403, detail="User is not a supervisor")

    employees = db.query(User).filter(User.user_type == "employee").all()
    departments = db.query(Department).all()

    if not departments:
        for name in ["Nursing", "Security", "Maintenance", "Administration", "Medical Staff"]:
            db.add(Department(name=name))

        db.commit()
        departments = db.query(Department).all()

    trainings = (
        db.query(Training)
        .filter(Training.created_by == supervisor_id)
        .all()
    )

    attempts = (
        db.query(Attempt, Training, User, Department)
        .join(Training, Attempt.training_id == Training.id)
        .join(User, Attempt.employee_id == User.id)
        .outerjoin(Department, User.department_id == Department.id)
        .filter(Training.created_by == supervisor_id)
        .all()
    )

    total_trainings = len(trainings)
    total_employees = len(employees)
    completed_attempts = len([
    attempt
    for attempt, training, employee, dept in attempts
    if attempt.status in ["graded", "completed", "submitted"]
   ])

    scores = [
        float(attempt.score)
        for attempt, training, employee, dept in attempts
        if attempt.score is not None
    ]

    avg_score = round(sum(scores) / len(scores), 2) if scores else 0

    employee_map = {}

    for emp in employees:
        dept = db.query(Department).filter(Department.id == emp.department_id).first()

        employee_map[emp.id] = {
            "employee_id": emp.id,
            "employee_name": emp.full_name,
            "department_id": emp.department_id,
            "department_name": dept.name if dept else "-",
            "assigned": 0,
            "completed": 0,
            "scores": [],
            "avg_score": 0,
            "risk_level": "No Data",
            "details": []
        }

    assignments = (
        db.query(TrainingAssignment, Training)
        .join(Training, TrainingAssignment.training_id == Training.id)
        .filter(Training.created_by == supervisor_id)
        .all()
    )

    for assignment, training in assignments:
        target_employees = []

        if assignment.assignment_type == "all":
            target_employees = employees

        elif assignment.assignment_type == "department":
            target_employees = [
                e for e in employees
                if e.department_id == assignment.department_id
            ]

        elif assignment.assignment_type == "employee":
            target_employees = [
                e for e in employees
                if e.id == assignment.employee_id
            ]

        for emp in target_employees:
            if emp.id not in employee_map:
                continue

            attempt = (
                db.query(Attempt)
                .filter(
                    Attempt.training_id == training.id,
                    Attempt.employee_id == emp.id
                )
                .first()
            )

            status = attempt.status if attempt else "pending"
            score = float(attempt.score) if attempt and attempt.score is not None else None

            employee_map[emp.id]["assigned"] += 1

            if status in ["graded", "completed", "submitted"]:
                employee_map[emp.id]["completed"] += 1

            if score is not None:
                employee_map[emp.id]["scores"].append(score)

            employee_map[emp.id]["details"].append({
                "training_id": training.id,
                "scenario": training.scenario_title,
                "scenario_id": training.scenario_id,
                "role": training.selected_role,
                "difficulty": training.difficulty,
                "status": status,
                "score": score,
                "assigned_at": str(assignment.assigned_at),
                "ai_feedback": json.loads(attempt.ai_feedback) if attempt and attempt.ai_feedback else None
            })

    employees_analytics = []

    for emp_data in employee_map.values():
        emp_scores = emp_data["scores"]

        emp_data["avg_score"] = round(sum(emp_scores) / len(emp_scores), 2) if emp_scores else 0

        if not emp_scores:
            emp_data["risk_level"] = "No Data"
        elif emp_data["avg_score"] < 60:
            emp_data["risk_level"] = "At Risk"
        else:
            emp_data["risk_level"] = "Good"

        employees_analytics.append(emp_data)

    departments_analytics = []

    for dept in departments:
        dept_employees = [
            e for e in employees_analytics
            if e["department_id"] == dept.id
        ]

        dept_scores = []
        dept_assigned = 0
        dept_completed = 0

        for e in dept_employees:
            dept_scores.extend(e["scores"])
            dept_assigned += e["assigned"]
            dept_completed += e["completed"]

        dept_avg = round(sum(dept_scores) / len(dept_scores), 2) if dept_scores else 0

        departments_analytics.append({
            "department_id": dept.id,
            "department_name": dept.name,
            "employees_count": len(dept_employees),
            "assigned": dept_assigned,
            "completed": dept_completed,
            "avg_score": dept_avg,
            "completion_rate": round((dept_completed / dept_assigned) * 100, 2) if dept_assigned else 0
        })

    scenario_map = {}

    for attempt, training, employee, dept in attempts:
        if attempt.status not in ["graded", "completed", "submitted"]:
           continue
        key = training.scenario_title

        if key not in scenario_map:
            scenario_map[key] = {
                "scenario": training.scenario_title,
                "scenario_id": training.scenario_id,
                "attempts": 0,
                "scores": [],
                "avg_score": 0,
                "weakness_count": 0
            }

        scenario_map[key]["attempts"] += 1

        if attempt.score is not None:
            score = float(attempt.score)
            scenario_map[key]["scores"].append(score)

            if score < 60:
                scenario_map[key]["weakness_count"] += 1

    scenarios_analytics = []

    for sc in scenario_map.values():
        sc["avg_score"] = round(sum(sc["scores"]) / len(sc["scores"]), 2) if sc["scores"] else 0
        scenarios_analytics.append(sc)

    at_risk_employees = [
        e for e in employees_analytics
        if e["risk_level"] == "At Risk"
    ]

    recent_activity = []

    for attempt, training, employee, dept in sorted(
        attempts,
        key=lambda x: x[0].submitted_at or x[0].created_at,
        reverse=True
    )[:10]:
        if attempt.status not in ["graded", "completed", "submitted"]:
           continue
        recent_activity.append({
            "employee_name": employee.full_name,
            "department_name": dept.name if dept else "-",
            "scenario": training.scenario_title,
            "score": float(attempt.score) if attempt.score is not None else None,
            "status": attempt.status,
            "submitted_at": str(attempt.submitted_at or attempt.created_at)
        })

    total_assigned_attempts = sum(
        e["assigned"] for e in employees_analytics
    )

    completed_attempts_for_assigned = sum(
        e["completed"] for e in employees_analytics
    )

    pending_attempts = max(
        total_assigned_attempts - completed_attempts_for_assigned,
        0
    )

    return {
        "stats": {
            "total_employees": total_employees,
            "total_trainings": total_trainings,
            "completed_attempts": completed_attempts,
            "pending_attempts": pending_attempts,
            "avg_score": avg_score,
            "at_risk_count": len(at_risk_employees)
        },
        "departments": departments_analytics,
        "employees": employees_analytics,
        "scenarios": scenarios_analytics,
        "at_risk_employees": at_risk_employees,
        "recent_activity": recent_activity
    }

@app.delete("/trainings/{training_id}")
def delete_training(training_id: int, db: Session = Depends(get_db)):
    training = db.query(Training).filter(Training.id == training_id).first()

    if not training:
        raise HTTPException(status_code=404, detail="Training not found")

    db.delete(training)
    db.commit()

    return {
        "message": "Training deleted successfully",
        "training_id": training_id
    }

@app.get("/supervisor/{supervisor_id}/department/{department_id}/employees-performance")
def department_employees_performance(supervisor_id: int, department_id: int, db: Session = Depends(get_db)):
    employees = (
        db.query(User)
        .filter(User.department_id == department_id, User.user_type == "employee")
        .all()
    )

    training_rows = (
        db.query(TrainingAssignment, Training)
        .join(Training, TrainingAssignment.training_id == Training.id)
        .filter(
            Training.created_by == supervisor_id,
            or_(
                TrainingAssignment.assignment_type == "all",
                and_(
                    TrainingAssignment.assignment_type == "department",
                    TrainingAssignment.department_id == department_id
                ),
                TrainingAssignment.assignment_type == "employee"
            )
        )
        .all()
    )

    result = []

    for emp in employees:
        details = []
        scores = []
        completed = 0
        pending = 0

        for assignment, training in training_rows:
            if assignment.assignment_type == "employee" and assignment.employee_id != emp.id:
                continue

            attempt = (
                db.query(Attempt)
                .filter(
                    Attempt.training_id == training.id,
                    Attempt.employee_id == emp.id
                )
                .first()
            )

            status = attempt.status if attempt else "pending"

            if status in ["graded", "completed", "submitted"]:
                completed += 1
            else:
                pending += 1

            if attempt and attempt.score is not None:
                scores.append(float(attempt.score))

            details.append({
                "employee_id": emp.id,
                "training_id": training.id,
                "scenario": training.scenario_title,
                "role": training.selected_role,
                "difficulty": training.difficulty,
                "status": status,
                "score": float(attempt.score) if attempt and attempt.score is not None else None,
                "assigned_at": str(assignment.assigned_at)
            })

        avg_score = round(sum(scores) / len(scores), 2) if scores else 0
        highest_score = max(scores) if scores else None
        lowest_score = min(scores) if scores else None

        result.append({
            "employee_id": emp.id,
            "employee_name": emp.full_name,
            "total_assigned": len(details),
            "completed": completed,
            "pending": pending,
            "avg_score": avg_score,
            "highest_score": highest_score,
            "lowest_score": lowest_score,
            "details": details
        })

    return {
        "department_id": department_id,
        "employees": result
    }

@app.post("/supervisor/notes")
def create_supervisor_note(payload: SupervisorNoteCreate, db: Session = Depends(get_db)):
    employee = db.query(User).filter(User.id == payload.employee_id).first()
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    note = SupervisorNote(
        training_id=payload.training_id,
        employee_id=payload.employee_id,
        supervisor_id=payload.supervisor_id,
        note_text=payload.note_text
    )

    db.add(note)
    db.commit()
    db.refresh(note)

    return {
        "message": "Note saved successfully",
        "note_id": note.id
    }
# اذهبي لآخر الملف وأضيفي هذا السطر في النهاية تماماً:
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port)
