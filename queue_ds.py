import database

class PatientQueue:
    def __init__(self):
        self.items = []
        self._load_from_db()

    def _load_from_db(self):
        """Loads all active waiting appointments from the database in FIFO order."""
        conn = database.get_db_connection()
        cursor = conn.cursor()
        rows = cursor.execute('''
            SELECT id FROM appointments 
            WHERE status = 'Waiting' 
            ORDER BY created_at ASC
        ''').fetchall()
        self.items = [row['id'] for row in rows]
        conn.close()

    def enqueue(self, appointment_id):
        """Adds an appointment to the end of the queue (FIFO enqueue)."""
        self.items.append(appointment_id)
        # Update database status and log action
        database.update_appointment_status(appointment_id, 'Waiting')
        database.log_queue_action(appointment_id, 'Enqueue')
        return len(self.items)

    def dequeue(self):
        """Removes and returns the front appointment from the queue (FIFO dequeue)."""
        if self.is_empty():
            return None
        appointment_id = self.items.pop(0)
        # Move status to 'In-Consultation' for the doctor to see the patient
        database.update_appointment_status(appointment_id, 'In-Consultation')
        database.log_queue_action(appointment_id, 'Dequeue')
        return appointment_id

    def front(self):
        """Peeks at the front of the queue without removing it."""
        if self.is_empty():
            return None
        front_id = self.items[0]
        conn = database.get_db_connection()
        front_appointment = conn.execute('''
            SELECT a.*, p.name as patient_name, p.age, p.gender, p.phone
            FROM appointments a
            JOIN patients p ON a.patient_id = p.id
            WHERE a.id = ?
        ''', (front_id,)).fetchone()
        conn.close()
        return dict(front_appointment) if front_appointment else None

    def display_queue(self):
        """Returns the full list of appointments currently in the queue in FIFO order."""
        # Refresh from DB to handle external updates if any
        self._load_from_db()
        if self.is_empty():
            return []
        
        conn = database.get_db_connection()
        placeholders = ','.join(['?'] * len(self.items))
        query = f'''
            SELECT a.*, p.name as patient_name, p.age, p.gender, p.phone
            FROM appointments a
            JOIN patients p ON a.patient_id = p.id
            WHERE a.id IN ({placeholders})
        '''
        rows = conn.execute(query, self.items).fetchall()
        conn.close()
        
        # Map rows by ID to keep the correct FIFO sequence
        rows_dict = {row['id']: dict(row) for row in rows}
        return [rows_dict[appt_id] for appt_id in self.items if appt_id in rows_dict]

    def is_empty(self):
        """Checks if the queue is empty."""
        return len(self.items) == 0

    def size(self):
        """Returns the size of the queue."""
        return len(self.items)
