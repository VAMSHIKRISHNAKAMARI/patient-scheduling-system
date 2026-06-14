import os
import sqlite3
from datetime import datetime

# Check if we are running in production with PostgreSQL
DATABASE_URL = os.environ.get('DATABASE_URL')
IS_POSTGRES = DATABASE_URL is not None

if IS_POSTGRES:
    import psycopg2
    from psycopg2.extras import RealDictCursor

def get_db_connection():
    if IS_POSTGRES:
        conn = psycopg2.connect(DATABASE_URL)
        return conn
    else:
        conn = sqlite3.connect('scheduler.db')
        conn.row_factory = sqlite3.Row
        return conn

def get_cursor(conn):
    if IS_POSTGRES:
        return conn.cursor(cursor_factory=RealDictCursor)
    else:
        return conn.cursor()

def format_query(query):
    """Replaces PostgreSQL style %s placeholders with SQLite style ? placeholders if running SQLite."""
    if not IS_POSTGRES:
        return query.replace('%s', '?')
    return query

def row_to_dict(row):
    """Converts a database row to a standard Python dictionary."""
    if row is None:
        return None
    if IS_POSTGRES:
        return dict(row)
    else:
        return dict(row)

def init_db():
    conn = get_db_connection()
    cursor = get_cursor(conn)
    
    if IS_POSTGRES:
        # PostgreSQL schema
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS patients (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                age INTEGER NOT NULL,
                gender VARCHAR(20) NOT NULL,
                phone VARCHAR(20) NOT NULL UNIQUE,
                email VARCHAR(100),
                medical_history TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS appointments (
                id SERIAL PRIMARY KEY,
                patient_id INTEGER NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
                doctor_name VARCHAR(100) NOT NULL,
                department VARCHAR(100) NOT NULL,
                reason TEXT,
                status VARCHAR(50) NOT NULL, -- 'Waiting', 'In-Consultation', 'Completed', 'Cancelled'
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS queue_log (
                id SERIAL PRIMARY KEY,
                appointment_id INTEGER NOT NULL REFERENCES appointments (id) ON DELETE CASCADE,
                action VARCHAR(50) NOT NULL, -- 'Enqueue', 'Dequeue', 'Complete', 'Cancel'
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
    else:
        # SQLite schema
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS patients (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                age INTEGER NOT NULL,
                gender TEXT NOT NULL,
                phone TEXT NOT NULL UNIQUE,
                email TEXT,
                medical_history TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS appointments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                patient_id INTEGER NOT NULL,
                doctor_name TEXT NOT NULL,
                department TEXT NOT NULL,
                reason TEXT,
                status TEXT NOT NULL, -- 'Waiting', 'In-Consultation', 'Completed', 'Cancelled'
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (patient_id) REFERENCES patients (id)
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS queue_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                appointment_id INTEGER NOT NULL,
                action TEXT NOT NULL, -- 'Enqueue', 'Dequeue', 'Complete', 'Cancel'
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (appointment_id) REFERENCES appointments (id)
            )
        ''')
        
    conn.commit()
    cursor.close()
    conn.close()

def add_patient(name, age, gender, phone, email, medical_history):
    conn = get_db_connection()
    cursor = get_cursor(conn)
    
    if IS_POSTGRES:
        query = '''
            INSERT INTO patients (name, age, gender, phone, email, medical_history)
            VALUES (%s, %s, %s, %s, %s, %s) RETURNING id
        '''
        try:
            cursor.execute(query, (name, age, gender, phone, email, medical_history))
            patient_id = cursor.fetchone()['id']
            conn.commit()
            return patient_id, None
        except Exception as e:
            conn.rollback()
            return None, "A patient with this phone number already exists."
        finally:
            cursor.close()
            conn.close()
    else:
        query = format_query('''
            INSERT INTO patients (name, age, gender, phone, email, medical_history)
            VALUES (%s, %s, %s, %s, %s, %s)
        ''')
        try:
            cursor.execute(query, (name, age, gender, phone, email, medical_history))
            conn.commit()
            patient_id = cursor.lastrowid
            return patient_id, None
        except sqlite3.IntegrityError:
            return None, "A patient with this phone number already exists."
        finally:
            cursor.close()
            conn.close()

def get_patient(patient_id):
    conn = get_db_connection()
    cursor = get_cursor(conn)
    query = format_query('SELECT * FROM patients WHERE id = %s')
    cursor.execute(query, (patient_id,))
    patient = cursor.fetchone()
    result = row_to_dict(patient)
    cursor.close()
    conn.close()
    return result

def get_all_patients():
    conn = get_db_connection()
    cursor = get_cursor(conn)
    query = 'SELECT * FROM patients ORDER BY name ASC'
    cursor.execute(query)
    rows = cursor.fetchall()
    result = [row_to_dict(row) for row in rows]
    cursor.close()
    conn.close()
    return result

def search_patients(query):
    conn = get_db_connection()
    cursor = get_cursor(conn)
    search_term = f"%{query}%"
    sql = format_query('''
        SELECT * FROM patients 
        WHERE name LIKE %s OR phone LIKE %s OR email LIKE %s OR id = %s
        ORDER BY name ASC
    ''')
    # Use standard int conversion for ID parameter if numeric, else -1
    id_param = int(query) if query.isdigit() else -1
    cursor.execute(sql, (search_term, search_term, search_term, id_param))
    rows = cursor.fetchall()
    result = [row_to_dict(row) for row in rows]
    cursor.close()
    conn.close()
    return result

def create_appointment(patient_id, doctor_name, department, reason):
    conn = get_db_connection()
    cursor = get_cursor(conn)
    
    if IS_POSTGRES:
        query = '''
            INSERT INTO appointments (patient_id, doctor_name, department, reason, status)
            VALUES (%s, %s, %s, %s, 'Waiting') RETURNING id
        '''
        cursor.execute(query, (patient_id, doctor_name, department, reason))
        appointment_id = cursor.fetchone()['id']
        conn.commit()
    else:
        query = format_query('''
            INSERT INTO appointments (patient_id, doctor_name, department, reason, status)
            VALUES (%s, %s, %s, %s, 'Waiting')
        ''')
        cursor.execute(query, (patient_id, doctor_name, department, reason))
        conn.commit()
        appointment_id = cursor.lastrowid
        
    cursor.close()
    conn.close()
    return appointment_id

def update_appointment_status(appointment_id, status):
    conn = get_db_connection()
    cursor = get_cursor(conn)
    query = format_query('UPDATE appointments SET status = %s WHERE id = %s')
    cursor.execute(query, (status, appointment_id))
    conn.commit()
    cursor.close()
    conn.close()

def log_queue_action(appointment_id, action):
    conn = get_db_connection()
    cursor = get_cursor(conn)
    query = format_query('INSERT INTO queue_log (appointment_id, action) VALUES (%s, %s)')
    cursor.execute(query, (appointment_id, action))
    conn.commit()
    cursor.close()
    conn.close()

def get_queue_logs(limit=10):
    conn = get_db_connection()
    cursor = get_cursor(conn)
    query = format_query('''
        SELECT ql.*, p.name as patient_name, a.department, a.doctor_name
        FROM queue_log ql
        JOIN appointments a ON ql.appointment_id = a.id
        JOIN patients p ON a.patient_id = p.id
        ORDER BY ql.timestamp DESC
        LIMIT %s
    ''')
    cursor.execute(query, (limit,))
    rows = cursor.fetchall()
    result = [row_to_dict(row) for row in rows]
    cursor.close()
    conn.close()
    return result

def get_dashboard_stats():
    conn = get_db_connection()
    cursor = get_cursor(conn)
    
    # Total patients
    cursor.execute('SELECT COUNT(*) FROM patients')
    total_patients = cursor.fetchone()
    total_patients = list(total_patients.values())[0] if IS_POSTGRES else total_patients[0]
    
    # Total appointments today
    today_str = datetime.now().strftime('%Y-%m-%d')
    query_today = format_query('''
        SELECT COUNT(*) FROM appointments 
        WHERE DATE(created_at) = %s
    ''')
    cursor.execute(query_today, (today_str,))
    total_today = cursor.fetchone()
    total_today = list(total_today.values())[0] if IS_POSTGRES else total_today[0]
    
    # Queue statuses counts
    cursor.execute(format_query("SELECT COUNT(*) FROM appointments WHERE status = %s"), ('Waiting',))
    waiting_count = cursor.fetchone()
    waiting_count = list(waiting_count.values())[0] if IS_POSTGRES else waiting_count[0]
    
    cursor.execute(format_query("SELECT COUNT(*) FROM appointments WHERE status = %s"), ('In-Consultation',))
    consultation_count = cursor.fetchone()
    consultation_count = list(consultation_count.values())[0] if IS_POSTGRES else consultation_count[0]
    
    query_completed = format_query('''
        SELECT COUNT(*) FROM appointments 
        WHERE status = %s AND DATE(created_at) = %s
    ''')
    cursor.execute(query_completed, ('Completed', today_str))
    completed_today = cursor.fetchone()
    completed_today = list(completed_today.values())[0] if IS_POSTGRES else completed_today[0]
    
    # Department breakdown
    cursor.execute('''
        SELECT department, COUNT(*) as count 
        FROM appointments 
        GROUP BY department
    ''')
    dept_rows = cursor.fetchall()
    dept_breakdown = {}
    for row in dept_rows:
        d_row = row_to_dict(row)
        dept_breakdown[d_row['department']] = d_row['count']
        
    # Recent appointments
    cursor.execute('''
        SELECT a.*, p.name as patient_name, p.phone as patient_phone
        FROM appointments a
        JOIN patients p ON a.patient_id = p.id
        ORDER BY a.created_at DESC
        LIMIT 5
    ''')
    recent_rows = cursor.fetchall()
    recent_appointments = [row_to_dict(row) for row in recent_rows]
    
    cursor.close()
    conn.close()
    
    return {
        'total_patients': total_patients,
        'total_today': total_today,
        'waiting_count': waiting_count,
        'consultation_count': consultation_count,
        'completed_today': completed_today,
        'dept_breakdown': dept_breakdown,
        'recent_appointments': recent_appointments
    }
