import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Vercel Serverless environment check
const isVercel = process.env.VERCEL || process.env.VERCEL_ENV;

// On Vercel, use purely memory or ephemeral /tmp path
const DB_PATH = isVercel 
  ? '/tmp/pathwise.db' 
  : path.join(__dirname, 'pathwise.db');

// Top-level await for sql.js initialization (supported in Node 18+ and "type": "module")
let SQL;
try {
  SQL = await initSqlJs();
} catch (e) {
  console.error("Failed to initialize sql.js", e);
  throw e;
}

let db;

// Load from disk if it exists and we're not on Vercel starting fresh, otherwise create new
if (!isVercel && fs.existsSync(DB_PATH)) {
  const filebuffer = fs.readFileSync(DB_PATH);
  db = new SQL.Database(filebuffer);
} else {
  db = new SQL.Database();
}

// Function to safely persist DB to disk (noop on Vercel)
function saveToDisk() {
  if (isVercel) return;
  try {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (err) {
    console.error("Failed to save db to disk:", err);
  }
}

// --- CREATE TABLES ---
db.run(`
  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    age INTEGER DEFAULT 14,
    grade INTEGER DEFAULT 8,
    board TEXT DEFAULT 'CBSE',
    goals TEXT DEFAULT 'Math',
    level TEXT DEFAULT 'beginner',
    study_time TEXT DEFAULT '30 min',
    language TEXT DEFAULT 'en',
    device_type TEXT DEFAULT 'mobile',
    connectivity TEXT DEFAULT '3g',
    streak_count INTEGER DEFAULT 0,
    last_active DATETIME DEFAULT CURRENT_TIMESTAMP,
    progress_percent REAL DEFAULT 0,
    needs_reengagement INTEGER DEFAULT 0,
    username TEXT DEFAULT '',
    password TEXT DEFAULT '',
    class_code TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_active_date DATETIME
  );

  CREATE TABLE IF NOT EXISTS teachers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    pin TEXT DEFAULT '1234',
    username TEXT DEFAULT '',
    password TEXT DEFAULT '',
    class_code TEXT DEFAULT '',
    school TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS learning_paths (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    path_json TEXT NOT NULL,
    generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ai_powered INTEGER DEFAULT 0,
    update_reason TEXT DEFAULT '',
    FOREIGN KEY (student_id) REFERENCES students(id)
  );

  CREATE TABLE IF NOT EXISTS topic_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    path_id INTEGER,
    topic_name TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    quiz_score INTEGER,
    feedback TEXT,
    attempts INTEGER DEFAULT 0,
    last_attempt DATETIME,
    completed_at DATETIME,
    weak_concepts TEXT DEFAULT '',
    FOREIGN KEY (student_id) REFERENCES students(id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    action TEXT DEFAULT '',
    topic TEXT,
    score INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id)
  );

  CREATE TABLE IF NOT EXISTS teacher_assigned_paths (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    topics_json TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (teacher_id) REFERENCES teachers(id),
    FOREIGN KEY (student_id) REFERENCES students(id)
  );

  CREATE TABLE IF NOT EXISTS assigned_path_content (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path_id INTEGER NOT NULL,
    topic_index INTEGER NOT NULL,
    topic_name TEXT NOT NULL,
    content TEXT NOT NULL,
    generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (path_id) REFERENCES teacher_assigned_paths(id)
  );
`);

// Migration: add columns safely in sql.js
const addColumnSafe = (table, column, def) => {
  try { db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`); } catch(e) {}
};

addColumnSafe('students', 'username', "TEXT DEFAULT ''");
addColumnSafe('students', 'password', "TEXT DEFAULT ''");
addColumnSafe('students', 'board', "TEXT DEFAULT 'CBSE'");
addColumnSafe('students', 'class_code', "TEXT DEFAULT ''");
addColumnSafe('students', 'last_active_date', "DATETIME");
addColumnSafe('teachers', 'username', "TEXT DEFAULT ''");
addColumnSafe('teachers', 'password', "TEXT DEFAULT ''");
addColumnSafe('teachers', 'class_code', "TEXT DEFAULT ''");
addColumnSafe('teachers', 'school', "TEXT DEFAULT ''");
addColumnSafe('topic_progress', 'path_id', "INTEGER");
addColumnSafe('topic_progress', 'weak_concepts', "TEXT DEFAULT ''");
addColumnSafe('topic_progress', 'attempts', "INTEGER DEFAULT 0");
addColumnSafe('topic_progress', 'completed_at', "DATETIME");
addColumnSafe('learning_paths', 'update_reason', "TEXT DEFAULT ''");

// Create Indexes
db.run(`
  CREATE INDEX IF NOT EXISTS idx_students_username ON students(username);
  CREATE INDEX IF NOT EXISTS idx_students_class_code ON students(class_code);
  CREATE INDEX IF NOT EXISTS idx_students_grade ON students(grade);
  CREATE INDEX IF NOT EXISTS idx_students_board ON students(board);
  CREATE INDEX IF NOT EXISTS idx_teachers_username ON teachers(username);
  CREATE INDEX IF NOT EXISTS idx_teachers_class_code ON teachers(class_code);
  CREATE INDEX IF NOT EXISTS idx_learning_paths_student ON learning_paths(student_id);
  CREATE INDEX IF NOT EXISTS idx_topic_progress_student ON topic_progress(student_id);
  CREATE INDEX IF NOT EXISTS idx_topic_progress_topic ON topic_progress(topic_name);
  CREATE INDEX IF NOT EXISTS idx_topic_progress_compound ON topic_progress(student_id, topic_name);
  CREATE INDEX IF NOT EXISTS idx_topic_progress_status ON topic_progress(student_id, status);
  CREATE INDEX IF NOT EXISTS idx_sessions_student ON sessions(student_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_timestamp ON sessions(student_id, timestamp);
  CREATE INDEX IF NOT EXISTS idx_assigned_paths_student ON teacher_assigned_paths(student_id);
  CREATE INDEX IF NOT EXISTS idx_assigned_paths_teacher ON teacher_assigned_paths(teacher_id);
  CREATE INDEX IF NOT EXISTS idx_assigned_content_path ON assigned_path_content(path_id, topic_index);
`);

saveToDisk();

// Seed demo teacher if none
const teacherCount = getOne('SELECT COUNT(*) as count FROM teachers');
if (teacherCount && teacherCount.count === 0) {
  runSQL(`INSERT INTO teachers (name, pin, username, password, class_code, school) VALUES (?, ?, ?, ?, ?, ?)`,
    ['Demo Teacher', '1234', 'teacher1', '1234', 'CLASS-8A', 'Demo School']);
  console.log('👨‍🏫 Demo teacher seeded (teacher1/1234, class: CLASS-8A)');
}

console.log('✅ Database initialized (sql.js / WASM-based for Serverless compatibility)');

// ===== SQL.js Helper functions mapping to better-sqlite3 API =====

export function runSQL(sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    stmt.step();
    // In sql.js, there isn't a direct .changes or .lastInsertRowid.
    // We compute lastInsertRowid with an extra query:
    const lastInsertRes = db.exec('SELECT last_insert_rowid()');
    const lastId = lastInsertRes[0] ? lastInsertRes[0].values[0][0] : null;
    saveToDisk();
    return { changes: 1, lastInsertRowid: lastId };
  } finally {
    stmt.free();
  }
}

export function getOne(sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    if (stmt.step()) {
      return stmt.getAsObject();
    }
    return null;
  } finally {
    stmt.free();
  }
}

export function getAll(sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    return results;
  } finally {
    stmt.free();
  }
}

// Transaction helper for batch operations
export function runTransaction(fn) {
  return function(...args) {
    db.run("BEGIN TRANSACTION");
    try {
      const res = fn(...args);
      db.run("COMMIT");
      saveToDisk();
      return res;
    } catch (e) {
      db.run("ROLLBACK");
      throw e;
    }
  };
}

export default db;

