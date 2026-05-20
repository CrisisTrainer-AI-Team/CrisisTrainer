# CrisisTrainer
CrisisTrainer is an AI-powered crisis training and employee performance monitoring system developed to support employee preparedness during emergency and crisis situations.

The project integrates a web interface, backend services, structured crisis datasets, and a MySQL database to simulate training scenarios and monitor performance.

# Project Overview
The purpose of this project is to provide employees with realistic crisis training scenarios while enabling supervisors to assign tasks, monitor progress, and evaluate performance.

The system combines:

- Crisis training scenarios
- Employee dashboards
- Supervisor dashboards
- Live monitoring
- Database-based performance tracking
- AI-supported structured training content

---

# Features

## Employee Features
- User login
- Training participation
- Crisis scenario interaction
- Performance tracking
- Employee dashboard

## Supervisor Features
- Supervisor dashboard
- Monitor employee activity
- Assign training tasks
- View employee performance

## System Features
- Structured crisis datasets
- Multiple crisis categories
- Database integration
- Real-time monitoring interface

---

# Technologies Used

## Frontend
- HTML5
- CSS3
- JavaScript

## Backend
- Python
- FastAPI
- SQLAlchemy

## Database
- MySQL
- phpMyAdmin

## Dataset
- JSON-based crisis scenario files

## AI Technologies
- OpenAI GPT API
- Structured crisis datasets
- JSON scenario files

## AI Integration
The system integrates OpenAI GPT models to support crisis scenario generation, response evaluation, and intelligent interaction within training activities.

AI features may require an OpenAI API key during runtime configuration.

For security reasons, API keys are not included in this repository and should be provided locally by the user when running the system.

Example environment variable:

```text
OPENAI_API_KEY=your_api_key_here
```

The API key should never be uploaded to GitHub or shared publicly.

---

# Project Structure

```text
CrisisTrainer
│
├── ai-service/
│   ├── main.py
│   ├── database.py
│   ├── models.py
│   ├── schemas.py
│   ├── requirements.txt
│   └── crisis_trainer_full_pack/
│
├── crisis-trainer-frontend/
│   ├── css/
│   ├── js/
│   ├── login.html
│   ├── employee-dashboard.html
│   ├── supervisor-dashboard.html
│   └── live-monitor.html
│
├── database/
│   └── crisis_trainer.sql
│
└── README.md
```

---

# Installation Guide

## 1. Clone the repository

```bash
git clone https://github.com/CrisisTrainer-AI-Team/CrisisTrainer.git
```

Open the project folder.

---

## 2. Database Setup

Open phpMyAdmin and create a database named:

```text
crisis_trainer
```

Import:

```text
database/crisis_trainer.sql
```

---

## 3. Backend Setup

Navigate to:

```text
ai-service/
```

Create virtual environment:

```bash
python -m venv .venv
```

Activate environment:

```bash
.venv\Scripts\activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Run backend:

```bash
python main.py
```

---

## 4. Frontend Setup

Open:

```text
crisis-trainer-frontend/login.html
```

Start using the system.

---

# Team Members

- Shahad Turki Alhoory
- Ghala Bander Alsuna Allah
- Hala Abdulmohsen Al-Shammari
- Jawaher Khalifah Al-Shammari
- Ghadah Mansour Al-Shammari

---

# Academic Purpose

This project was developed as an academic team project for crisis preparedness, employee training, and performance monitoring.

---

# License

Licensed under the MIT License.
