import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# 1. نتحقق هل الكود يعمل على سيرفر Render أم لوكالي
if os.environ.get("RENDER"):
    # إذا كان على السيرفر، ننشئ قاعدة بيانات SQLite تلقائياً كملف محلي
    DATABASE_URL = "sqlite:///./crisis_trainer.db"
    # شرط connect_args مطلوب فقط مع SQLite لمنع مشاكل تعدد الخيوط (Threads)
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False}, echo=True)
else:
    # 2. إذا كان على لابتوبكِ، يشتغل الـ MySQL الخاص بـ XAMPP كالمعتاد
    DB_USER = "root"
    DB_PASSWORD = ""
    DB_HOST = "127.0.0.1"
    DB_PORT = "3306"
    DB_NAME = "crisis_trainer"
    DATABASE_URL = f"mysql+pymysql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
    engine = create_engine(DATABASE_URL, echo=True)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
