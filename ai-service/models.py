from sqlalchemy import Column, Integer, String, Text, Boolean, ForeignKey, Enum, TIMESTAMP, DECIMAL
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


class Department(Base):
    __tablename__ = "departments"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False)
    created_at = Column(TIMESTAMP, server_default=func.current_timestamp())

    users = relationship("User", back_populates="department")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String(150), nullable=False)
    email = Column(String(150), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    user_type = Column(Enum("supervisor", "employee", name="user_type_enum"), nullable=False)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(TIMESTAMP, server_default=func.current_timestamp())

    department = relationship("Department", back_populates="users")
    created_trainings = relationship("Training", back_populates="creator")


class Training(Base):
    __tablename__ = "trainings"

    id = Column(Integer, primary_key=True, index=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    scenario_id = Column(String(100), nullable=False)
    scenario_title = Column(String(255), nullable=False)
    domain = Column(String(100), nullable=True)
    facility = Column(String(100), nullable=True)
    selected_role = Column(String(150), nullable=True)
    language = Column(String(20), nullable=False, default="en")
    difficulty = Column(String(50), nullable=True)
    n_scenarios = Column(Integer, nullable=False, default=1)
    q_per_scenario = Column(Integer, nullable=False, default=5)
    duration_minutes = Column(Integer, nullable=False, default=10)
    ai_payload = Column(Text, nullable=False)
    validator_report = Column(Text, nullable=True)
    status = Column(Enum("draft", "assigned", "completed", name="training_status_enum"), default="draft")
    created_at = Column(TIMESTAMP, server_default=func.current_timestamp())

    creator = relationship("User", back_populates="created_trainings")
    questions = relationship("TrainingQuestion", back_populates="training", cascade="all, delete-orphan")
    assignments = relationship("TrainingAssignment", back_populates="training", cascade="all, delete-orphan")
    attempts = relationship("Attempt", back_populates="training", cascade="all, delete-orphan")


class TrainingQuestion(Base):
    __tablename__ = "training_questions"

    id = Column(Integer, primary_key=True, index=True)
    training_id = Column(Integer, ForeignKey("trainings.id", ondelete="CASCADE"), nullable=False)
    question_text = Column(Text, nullable=False)
    option_1 = Column(Text, nullable=False)
    option_2 = Column(Text, nullable=False)
    option_3 = Column(Text, nullable=False)
    option_4 = Column(Text, nullable=False)
    correct_answer_index = Column(Integer, nullable=False)
    evidence_chunk_ids = Column(Text, nullable=True)
    question_order = Column(Integer, nullable=False)
    created_at = Column(TIMESTAMP, server_default=func.current_timestamp())

    training = relationship("Training", back_populates="questions")
    attempt_answers = relationship("AttemptAnswer", back_populates="question", cascade="all, delete-orphan")


class TrainingAssignment(Base):
    __tablename__ = "training_assignments"

    id = Column(Integer, primary_key=True, index=True)
    training_id = Column(Integer, ForeignKey("trainings.id", ondelete="CASCADE"), nullable=False)
    assignment_type = Column(Enum("employee", "department", "all", name="assignment_type_enum"), nullable=False)
    employee_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    assigned_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    assigned_at = Column(TIMESTAMP, server_default=func.current_timestamp())

    training = relationship("Training", back_populates="assignments")


class Attempt(Base):
    __tablename__ = "attempts"

    id = Column(Integer, primary_key=True, index=True)
    training_id = Column(Integer, ForeignKey("trainings.id", ondelete="CASCADE"), nullable=False)
    employee_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    started_at = Column(TIMESTAMP, nullable=True)
    submitted_at = Column(TIMESTAMP, nullable=True)
    score = Column(DECIMAL(5, 2), default=0)
    total_questions = Column(Integer, default=0)
    correct_answers = Column(Integer, default=0)
    status = Column(Enum("pending", "submitted", "graded", name="attempt_status_enum"), default="pending")
    created_at = Column(TIMESTAMP, server_default=func.current_timestamp())

    training = relationship("Training", back_populates="attempts")
    answers = relationship("AttemptAnswer", back_populates="attempt", cascade="all, delete-orphan")

    ai_feedback = Column(Text, nullable=True)


class AttemptAnswer(Base):
    __tablename__ = "attempt_answers"

    id = Column(Integer, primary_key=True, index=True)
    attempt_id = Column(Integer, ForeignKey("attempts.id", ondelete="CASCADE"), nullable=False)
    question_id = Column(Integer, ForeignKey("training_questions.id", ondelete="CASCADE"), nullable=False)
    selected_answer_index = Column(Integer, nullable=False)
    is_correct = Column(Boolean, default=False)
    answered_at = Column(TIMESTAMP, server_default=func.current_timestamp())

    attempt = relationship("Attempt", back_populates="answers")
    question = relationship("TrainingQuestion", back_populates="attempt_answers")

class SupervisorNote(Base):
    __tablename__ = "supervisor_notes"

    id = Column(Integer, primary_key=True, index=True)
    training_id = Column(Integer, ForeignKey("trainings.id", ondelete="CASCADE"), nullable=False)
    employee_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    supervisor_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    note_text = Column(Text, nullable=False)
    created_at = Column(TIMESTAMP, server_default=func.current_timestamp())