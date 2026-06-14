from flask import Flask, jsonify, request, render_template
import database
import queue_ds

app = Flask(__name__)

# Initialize database tables
database.init_db()

# Create a global instance of our Queue data structure
patient_queue = queue_ds.PatientQueue()

@app.route('/')
def index():
    """Serves the Single Page Application frontend."""
    return render_template('index.html')

@app.route('/api/patients', methods=['GET'])
def get_patients():
    """Retrieve list of patients or search patients."""
    query = request.args.get('q', '')
    if query:
        patients = database.search_patients(query)
    else:
        patients = database.get_all_patients()
    return jsonify([dict(p) for p in patients])

@app.route('/api/patients', methods=['POST'])
def register_patient():
    """Registers a new patient profile."""
    data = request.json or {}
    name = data.get('name')
    age = data.get('age')
    gender = data.get('gender')
    phone = data.get('phone')
    email = data.get('email', '')
    medical_history = data.get('medical_history', '')
    
    if not (name and age and gender and phone):
        return jsonify({'error': 'Name, Age, Gender, and Phone Number are required.'}), 400
        
    try:
        age = int(age)
    except ValueError:
        return jsonify({'error': 'Age must be a valid number.'}), 400
        
    patient_id, error = database.add_patient(name, age, gender, phone, email, medical_history)
    if error:
        return jsonify({'error': error}), 400
        
    return jsonify({
        'message': 'Patient registered successfully!',
        'patient_id': patient_id,
        'patient_name': name
    })

@app.route('/api/appointments', methods=['POST'])
def book_appointment():
    """Books an appointment and enqueues the patient."""
    data = request.json or {}
    patient_id = data.get('patient_id')
    doctor_name = data.get('doctor_name')
    department = data.get('department')
    reason = data.get('reason', '')
    
    if not (patient_id and doctor_name and department):
        return jsonify({'error': 'Patient, Doctor, and Department are required.'}), 400
        
    # Create appointment record in DB
    appt_id = database.create_appointment(patient_id, doctor_name, department, reason)
    
    # Enqueue appointment using Queue Data Structure
    queue_pos = patient_queue.enqueue(appt_id)
    
    patient = database.get_patient(patient_id)
    return jsonify({
        'message': 'Appointment booked and patient enqueued successfully!',
        'appointment_id': appt_id,
        'queue_position': queue_pos,
        'patient_name': patient['name']
    })

@app.route('/api/queue', methods=['GET'])
def get_queue():
    """Retrieve queue status details: the waiting queue, front-of-queue, size, and in-consultation."""
    queue_list = patient_queue.display_queue()
    front_patient = patient_queue.front()
    
    # Fetch patient currently in consultation (if any)
    conn = database.get_db_connection()
    active = conn.execute('''
        SELECT a.*, p.name as patient_name, p.age, p.gender, p.phone
        FROM appointments a
        JOIN patients p ON a.patient_id = p.id
        WHERE a.status = 'In-Consultation'
        ORDER BY a.created_at ASC
        LIMIT 1
    ''').fetchone()
    conn.close()
    
    active_consultation = dict(active) if active else None
    
    return jsonify({
        'queue': queue_list,
        'front': front_patient,
        'size': patient_queue.size(),
        'in_consultation': active_consultation
    })

@app.route('/api/queue/dequeue', methods=['POST'])
def dequeue_patient():
    """Dequeues the next waiting patient and transitions them to consultation."""
    # 1. First, complete any current active consultation (auto-checkout)
    conn = database.get_db_connection()
    active = conn.execute("SELECT id FROM appointments WHERE status = 'In-Consultation'").fetchall()
    conn.close()
    
    for row in active:
        database.update_appointment_status(row['id'], 'Completed')
        database.log_queue_action(row['id'], 'Complete')
        
    # 2. Dequeue next patient from our Queue Data Structure
    if patient_queue.is_empty():
        return jsonify({
            'message': 'No patients waiting in queue.',
            'dequeued': None
        })
        
    appt_id = patient_queue.dequeue()
    
    # Fetch details of dequeued patient
    conn = database.get_db_connection()
    patient_details = conn.execute('''
        SELECT a.*, p.name as patient_name, p.phone as patient_phone, p.age, p.gender
        FROM appointments a
        JOIN patients p ON a.patient_id = p.id
        WHERE a.id = ?
    ''', (appt_id,)).fetchone()
    conn.close()
    
    return jsonify({
        'message': f'Called next patient: {patient_details["patient_name"]}.',
        'dequeued': dict(patient_details)
    })

@app.route('/api/queue/complete', methods=['POST'])
def complete_consultation():
    """Manually completes the current active consultation."""
    conn = database.get_db_connection()
    active = conn.execute("SELECT id FROM appointments WHERE status = 'In-Consultation'").fetchall()
    conn.close()
    
    if not active:
        return jsonify({'error': 'No patient is currently in consultation.'}), 400
        
    for row in active:
        database.update_appointment_status(row['id'], 'Completed')
        database.log_queue_action(row['id'], 'Complete')
        
    return jsonify({'message': 'Consultation marked as completed successfully.'})

@app.route('/api/queue/cancel/<int:appt_id>', methods=['POST'])
def cancel_appointment(appt_id):
    """Cancels an appointment and removes it from the queue."""
    database.update_appointment_status(appt_id, 'Cancelled')
    database.log_queue_action(appt_id, 'Cancel')
    
    # Sync in-memory queue from DB
    patient_queue._load_from_db()
    
    return jsonify({'message': 'Appointment cancelled and removed.'})

@app.route('/api/dashboard', methods=['GET'])
def get_dashboard():
    """Retrieve full dashboard statistics, department distributions, and recent queue activity logs."""
    stats = database.get_dashboard_stats()
    logs = database.get_queue_logs(15)
    stats['logs'] = [dict(log) for log in logs]
    return jsonify(stats)

if __name__ == '__main__':
    # Flask application listening on all network interfaces
    app.run(host='0.0.0.0', port=5000, debug=True)
