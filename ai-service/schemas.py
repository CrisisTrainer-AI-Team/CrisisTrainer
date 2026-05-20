from pydantic import BaseModel, EmailStr
from typing import Optional, Any, Dict, List


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    new_password: str


class UserCreate(BaseModel):
    full_name: str
    email: EmailStr
    password: str
    user_type: str
    department_id: Optional[int] = None


class UserResponse(BaseModel):
    id: int
    full_name: str
    email: EmailStr
    user_type: str
    department_id: Optional[int]

    class Config:
        from_attributes = True
        

class AssignTrainingRequest(BaseModel):
    created_by: int
    scenario_id: str
    scenario_title: str
    domain: Optional[str] = None
    facility: Optional[str] = None
    selected_role: Optional[str] = None
    language: str = "en"
    difficulty: Optional[str] = None
    n_scenarios: int = 1
    q_per_scenario: int = 5
    duration_minutes: int = 10
    ai_payload: Dict[str, Any]
    validator_report: Optional[Dict[str, Any]] = None

    assignment_type: str   # employee / department / all
    employee_id: Optional[int] = None
    department_id: Optional[int] = None


class AnswerSubmit(BaseModel):
    question_id: int
    selected_answer_index: int


class SubmitAttemptRequest(BaseModel):
    employee_id: int
    training_id: int
    answers: List[AnswerSubmit]


class SupervisorNoteCreate(BaseModel):
    training_id: int
    employee_id: int
    supervisor_id: int
    note_text: str