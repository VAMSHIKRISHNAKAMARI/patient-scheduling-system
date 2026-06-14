// -------------------------------------------------------------
// MedQueue client logic (Single Page Application manager)
// -------------------------------------------------------------

// Active Doctors Data Mapping
const DOCTORS_BY_DEPT = {
    "General Medicine": ["Dr. Richard Alpert", "Dr. John Dorian"],
    "Pediatrics": ["Dr. Sarah Connor", "Dr. Perry Cox"],
    "Cardiology": ["Dr. Julius Hibbert", "Dr. Preston Burke"],
    "Orthopedics": ["Dr. Gregory House", "Dr. Callie Torres"],
    "Dermatology": ["Dr. Robert Chase", "Dr. Allison Cameron"],
    "ENT": ["Dr. Derek Shepherd", "Dr. Mark Sloan"]
};

// State Variables
let currentView = 'home';
let selectedPatientId = null;
let deptChartInstance = null;
let pollingInterval = null;

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    // Setup routing and nav buttons
    setupRouting();
    
    // Start Ticker Clock
    startHeaderClock();
    
    // Load initial data
    loadHomeData();
    
    // Setup Patients Roster view listener
    setupPatientsView();
    
    // Setup Booking Form patient autocompletion
    setupBookingView();
    
    // Load lucide icons
    lucide.createIcons();
    
    // Start live queue polling (every 5 seconds)
    startQueuePolling();
});

// SPA View Routing Setup
function setupRouting() {
    const navItems = document.querySelectorAll('.sidebar-nav .nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetView = item.getAttribute('data-view');
            switchView(targetView);
        });
    });
    
    // Check URL hash if exists
    const hash = window.location.hash.replace('#', '');
    if (hash && ['home', 'patients', 'booking', 'queue', 'dashboard'].includes(hash)) {
        switchView(hash);
    }
}

function switchView(viewName) {
    if (currentView === viewName) return;
    
    // Hide old section and show new section
    document.getElementById(`view-${currentView}`).classList.remove('active');
    document.getElementById(`view-${viewName}`).classList.add('active');
    
    // Update sidebar navigation highlights
    document.querySelector(`.sidebar-nav .nav-item[data-view="${currentView}"]`).classList.remove('active');
    document.querySelector(`.sidebar-nav .nav-item[data-view="${viewName}"]`).classList.add('active');
    
    // Update header headers
    updateHeaderTitles(viewName);
    
    currentView = viewName;
    window.location.hash = viewName;
    
    // View specific actions
    if (viewName === 'home') {
        loadHomeData();
    } else if (viewName === 'patients') {
        loadPatientsList();
    } else if (viewName === 'booking') {
        resetBookingForm();
    } else if (viewName === 'queue') {
        loadQueueData();
    } else if (viewName === 'dashboard') {
        loadDashboardData();
    }
}

function updateHeaderTitles(view) {
    const title = document.getElementById('page-title');
    const subtitle = document.getElementById('page-subtitle');
    
    const titles = {
        'home': { t: 'Welcome Back', s: "Here is what's happening at your clinic today." },
        'patients': { t: 'Patients Directory', s: 'Register new patient profiles and manage existing records.' },
        'booking': { t: 'Appointment Desk', s: 'Book consultation slots and dispatch patients into the active queue.' },
        'queue': { t: 'Live Clinic Queue', s: 'Monitor and transition patient visits (FIFO Queue Operations).' },
        'dashboard': { t: 'Analytics Dashboard', s: 'Operational reports, metrics logs, and speciality loads.' }
    };
    
    title.textContent = titles[view].t;
    subtitle.textContent = titles[view].s;
}

// Clock Ticker
function startHeaderClock() {
    const timeSpan = document.getElementById('live-time');
    const dateSpan = document.getElementById('live-date');
    
    function tick() {
        const now = new Date();
        timeSpan.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        dateSpan.textContent = now.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
    }
    
    tick();
    setInterval(tick, 1000);
}

// Background Queue Status Polling
function startQueuePolling() {
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(() => {
        // Poll backend queue size for badge updates and live queue highlights
        fetch('/api/queue')
            .then(res => res.json())
            .then(data => {
                // Update badge count
                document.getElementById('sidebar-queue-badge').textContent = data.size;
                
                // If on Queue status or Home views, do live updates silently
                if (currentView === 'queue') {
                    renderQueueTrack(data);
                } else if (currentView === 'home') {
                    updateHomeQueueTable(data.queue);
                }
            })
            .catch(err => console.error("Queue polling error", err));
    }, 5000);
}

// -------------------------------------------------------------
// View Action & Data Fetch Logic
// -------------------------------------------------------------

// 1. HOME VIEW
function loadHomeData() {
    // Load dashboard summary statistics
    fetch('/api/dashboard')
        .then(res => res.json())
        .then(data => {
            document.getElementById('metric-patients').textContent = data.total_patients;
            document.getElementById('metric-waiting').textContent = data.waiting_count;
            document.getElementById('metric-consulting').textContent = data.consultation_count;
            document.getElementById('metric-completed').textContent = data.completed_today;
        });
        
    // Load queue preview list
    fetch('/api/queue')
        .then(res => res.json())
        .then(data => {
            document.getElementById('sidebar-queue-badge').textContent = data.size;
            updateHomeQueueTable(data.queue);
        });
}

function updateHomeQueueTable(queue) {
    const tbody = document.querySelector('#table-home-queue tbody');
    if (!queue || queue.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No patients currently in the queue.</td></tr>`;
        return;
    }
    
    tbody.innerHTML = queue.slice(0, 5).map((appt, idx) => `
        <tr>
            <td><strong>#${idx + 1}</strong></td>
            <td>P-${String(appt.patient_id).padStart(4, '0')}</td>
            <td>${appt.patient_name}</td>
            <td>${appt.phone}</td>
            <td><span class="queue-card-dept">${appt.department}</span></td>
            <td>${appt.doctor_name}</td>
            <td><span class="status-pill waiting">Waiting</span></td>
        </tr>
    `).join('');
    
    if (queue.length > 5) {
        tbody.innerHTML += `
            <tr>
                <td colspan="7" style="text-align: center; color: var(--text-secondary); font-size: 0.85rem;">
                    Showing 5 of ${queue.length} waiting patients. <a href="#queue" onclick="switchView('queue')" style="color: var(--primary); text-decoration: none;">View all &rarr;</a>
                </td>
            </tr>
        `;
    }
}

// 2. PATIENTS VIEW
function setupPatientsView() {
    // Form registration listener
    const regForm = document.getElementById('form-register-patient');
    regForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const payload = {
            name: document.getElementById('reg-name').value.trim(),
            age: document.getElementById('reg-age').value.trim(),
            gender: document.getElementById('reg-gender').value,
            phone: document.getElementById('reg-phone').value.trim(),
            email: document.getElementById('reg-email').value.trim(),
            medical_history: document.getElementById('reg-history').value.trim()
        };
        
        fetch('/api/patients', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(res => res.json())
        .then(data => {
            if (data.error) {
                showToast("Registration Failed", data.error, "error");
            } else {
                showToast("Success", `${payload.name} registered with Patient ID P-${String(data.patient_id).padStart(4, '0')}`, "success");
                regForm.reset();
                loadPatientsList();
            }
        })
        .catch(err => {
            showToast("System Error", "Failed to communicate with Flask server", "error");
            console.error(err);
        });
    });
    
    // Dynamic search filter listener
    const searchInput = document.getElementById('search-patient-input');
    searchInput.addEventListener('input', () => {
        loadPatientsList(searchInput.value.trim());
    });
}

function loadPatientsList(searchQuery = '') {
    const tbody = document.querySelector('#table-patients-list tbody');
    
    fetch(`/api/patients?q=${encodeURIComponent(searchQuery)}`)
        .then(res => res.json())
        .then(patients => {
            if (patients.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No matching patient profiles found.</td></tr>`;
                return;
            }
            
            tbody.innerHTML = patients.map(p => {
                const date = new Date(p.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
                return `
                    <tr>
                        <td><strong>P-${String(p.id).padStart(4, '0')}</strong></td>
                        <td>${p.name}</td>
                        <td>${p.age} yrs / ${p.gender}</td>
                        <td>${p.phone}</td>
                        <td>${date}</td>
                        <td>
                            <button class="btn btn-secondary btn-sm" onclick="bookFromDirectory(${p.id}, '${p.name.replace(/'/g, "\\'")}')">
                                <i data-lucide="plus-circle" style="width: 14px; height: 14px; display: inline-block; vertical-align: middle;"></i> Queue Up
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');
            
            lucide.createIcons();
        })
        .catch(err => {
            tbody.innerHTML = `<tr><td colspan="6" class="empty-state text-danger">Error loading patient roster.</td></tr>`;
            console.error(err);
        });
}

function bookFromDirectory(patientId, name) {
    selectedPatientId = patientId;
    switchView('booking');
    
    // Pre-populate patient select fields in Booking View
    document.getElementById('book-patient-id').value = patientId;
    document.getElementById('book-patient-search').value = name;
    
    const badge = document.getElementById('selected-patient-badge');
    badge.textContent = `Selected: ${name} (ID: P-${String(patientId).padStart(4, '0')})`;
    badge.style.color = "var(--success)";
    badge.style.backgroundColor = "var(--success-glow)";
    badge.style.borderStyle = "solid";
}

// 3. APPOINTMENT BOOKING VIEW
function setupBookingView() {
    const searchInput = document.getElementById('book-patient-search');
    const dropdown = document.getElementById('patient-search-results');
    const deptSelect = document.getElementById('book-dept');
    const docSelect = document.getElementById('book-doctor');
    const bookingForm = document.getElementById('form-book-appointment');
    
    // Autocomplete Search inputs
    searchInput.addEventListener('input', () => {
        const query = searchInput.value.trim();
        if (query.length < 2) {
            dropdown.classList.add('hidden');
            return;
        }
        
        fetch(`/api/patients?q=${encodeURIComponent(query)}`)
            .then(res => res.json())
            .then(patients => {
                if (patients.length === 0) {
                    dropdown.innerHTML = `<div class="dropdown-item text-muted">No results found. Please register patient first.</div>`;
                } else {
                    dropdown.innerHTML = patients.map(p => `
                        <div class="dropdown-item" data-id="${p.id}" data-name="${p.name}">
                            ${p.name} (Phone: ${p.phone})
                        </div>
                    `).join('');
                }
                dropdown.classList.remove('hidden');
            });
    });
    
    // Dropdown selection click
    dropdown.addEventListener('click', (e) => {
        const item = e.target.closest('.dropdown-item');
        if (!item || item.classList.contains('text-muted')) return;
        
        const id = item.getAttribute('data-id');
        const name = item.getAttribute('data-name');
        
        selectedPatientId = id;
        document.getElementById('book-patient-id').value = id;
        searchInput.value = name;
        dropdown.classList.add('hidden');
        
        const badge = document.getElementById('selected-patient-badge');
        badge.textContent = `Selected: ${name} (ID: P-${String(id).padStart(4, '0')})`;
        badge.style.color = "var(--success)";
        badge.style.backgroundColor = "var(--success-glow)";
        badge.style.borderStyle = "solid";
    });
    
    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.add('hidden');
        }
    });
    
    // Department selection change -> populate Doctors list
    deptSelect.addEventListener('change', () => {
        const dept = deptSelect.value;
        docSelect.innerHTML = '';
        
        if (!dept) {
            docSelect.innerHTML = `<option value="">Select Speciality First</option>`;
            docSelect.disabled = true;
            return;
        }
        
        const doctors = DOCTORS_BY_DEPT[dept] || [];
        docSelect.innerHTML = doctors.map(doc => `<option value="${doc}">${doc}</option>`).join('');
        docSelect.disabled = false;
    });
    
    // Form submission (Enqueue operation)
    bookingForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const patientId = document.getElementById('book-patient-id').value;
        const doctor = docSelect.value;
        const dept = deptSelect.value;
        const reason = document.getElementById('book-reason').value.trim();
        
        if (!patientId) {
            showToast("Booking Refused", "Please select a registered patient profile.", "error");
            return;
        }
        
        const payload = {
            patient_id: patientId,
            doctor_name: doctor,
            department: dept,
            reason: reason
        };
        
        fetch('/api/appointments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(res => res.json())
        .then(data => {
            if (data.error) {
                showToast("Booking Failed", data.error, "error");
            } else {
                showToast("Enqueued Successfully", `${data.patient_name} placed in Queue at Position #${data.queue_position}`, "success");
                bookingForm.reset();
                resetBookingForm();
                switchView('queue');
            }
        })
        .catch(err => {
            showToast("System Error", "Could not complete scheduling queue push.", "error");
            console.error(err);
        });
    });
}

function resetBookingForm() {
    selectedPatientId = null;
    document.getElementById('book-patient-id').value = '';
    document.getElementById('book-patient-search').value = '';
    document.getElementById('book-doctor').innerHTML = `<option value="">Select Speciality First</option>`;
    document.getElementById('book-doctor').disabled = true;
    
    const badge = document.getElementById('selected-patient-badge');
    badge.textContent = "No patient selected yet. Search and click a profile.";
    badge.style.color = "var(--text-muted)";
    badge.style.backgroundColor = "rgba(0, 242, 254, 0.06)";
    badge.style.borderStyle = "dashed";
}

// 4. QUEUE STATUS VIEW
function loadQueueData() {
    fetch('/api/queue')
        .then(res => res.json())
        .then(data => {
            renderQueueTrack(data);
        })
        .catch(err => {
            showToast("Network Error", "Could not fetch queue details.", "error");
            console.error(err);
        });
}

function renderQueueTrack(data) {
    const servingCard = document.getElementById('serving-patient-card');
    const frontCardContainer = document.getElementById('queue-front-card-container');
    const queueSeqList = document.getElementById('queue-sequence-list');
    document.getElementById('queue-size-label').textContent = data.size;
    
    // A. Render Currently Serving (In Consultation)
    if (data.in_consultation) {
        servingCard.innerHTML = `
            <h2 class="serving-patient-name" style="color: var(--success);">${data.in_consultation.patient_name}</h2>
            <div class="serving-patient-meta">
                <span>P-${String(data.in_consultation.patient_id).padStart(4, '0')}</span>
                <span>•</span>
                <span>${data.in_consultation.age} yrs / ${data.in_consultation.gender}</span>
                <span>•</span>
                <span>${data.in_consultation.phone}</span>
            </div>
            <div class="serving-details-row">
                <div class="serving-details-box">
                    <h4>Department</h4>
                    <p>${data.in_consultation.department}</p>
                </div>
                <div class="serving-details-box">
                    <h4>Consulting Physician</h4>
                    <p>${data.in_consultation.doctor_name}</p>
                </div>
            </div>
            <div class="serving-details-box mt-2">
                <h4>Reason for Visit</h4>
                <p>${data.in_consultation.reason || 'Not specified'}</p>
            </div>
        `;
    } else {
        servingCard.innerHTML = `
            <div class="empty-state" style="padding: 60px 0;">
                <i data-lucide="coffee" style="width: 48px; height: 48px; color: var(--text-muted); margin-bottom: 12px;"></i>
                <p>No Patient in Consultation</p>
                <span style="font-size: 0.82rem; color: var(--text-muted);">Ready to call the next waiting patient.</span>
            </div>
        `;
    }

    // B. Render Front of Queue (First waiting ticket)
    if (data.front) {
        frontCardContainer.innerHTML = `
            <div class="queue-card" style="border: 1.5px solid rgba(0, 242, 254, 0.4); box-shadow: 0 4px 15px rgba(0, 242, 254, 0.1);">
                <div class="queue-card-position" style="background: var(--gradient-accent);">1</div>
                <div class="queue-card-details">
                    <h4>${data.front.patient_name}</h4>
                    <p>ID: P-${String(data.front.patient_id).padStart(4, '0')} | Phone: ${data.front.phone}</p>
                </div>
                <div class="queue-card-meta">
                    <span class="queue-card-dept" style="background-color: var(--primary-glow); color: var(--primary);">${data.front.department}</span>
                    <span class="queue-card-time">${data.front.doctor_name}</span>
                </div>
                <button class="btn btn-danger btn-sm ml-2" onclick="cancelAppointment(${data.front.id})">
                    <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
                </button>
            </div>
        `;
    } else {
        frontCardContainer.innerHTML = `<div class="empty-queue-msg">Queue is currently empty.</div>`;
    }

    // C. Render Subsequent waiting list
    if (data.queue && data.queue.length > 1) {
        const nextPatients = data.queue.slice(1);
        queueSeqList.innerHTML = nextPatients.map((appt, index) => `
            <div class="queue-card">
                <div class="queue-card-position" style="background-color: rgba(255, 255, 255, 0.05); color: var(--text-secondary);">${index + 2}</div>
                <div class="queue-card-details">
                    <h4>${appt.patient_name}</h4>
                    <p>ID: P-${String(appt.patient_id).padStart(4, '0')} | Phone: ${appt.phone}</p>
                </div>
                <div class="queue-card-meta">
                    <span class="queue-card-dept">${appt.department}</span>
                    <span class="queue-card-time">${appt.doctor_name}</span>
                </div>
                <button class="btn btn-secondary btn-sm ml-2" onclick="cancelAppointment(${appt.id})">
                    <i data-lucide="trash-2" style="width: 14px; height: 14px; color: var(--danger);"></i>
                </button>
            </div>
        `).join('');
    } else {
        queueSeqList.innerHTML = `<div class="empty-queue-msg">No subsequent patients in line.</div>`;
    }
    
    lucide.createIcons();
}

// Dequeue next patient (Doctor button)
function dequeueNextPatient() {
    fetch('/api/queue/dequeue', {
        method: 'POST'
    })
    .then(res => res.json())
    .then(data => {
        if (data.dequeued) {
            showToast("Patient Called", `Called patient ${data.dequeued.patient_name} to doctor cabin.`, "success");
        } else {
            showToast("Queue Empty", "No patients are waiting in the queue.", "warning");
        }
        loadQueueData();
    })
    .catch(err => {
        showToast("Error", "Could not complete dequeue operation.", "error");
        console.error(err);
    });
}

// Complete current consultation
function completeConsultation() {
    fetch('/api/queue/complete', {
        method: 'POST'
    })
    .then(res => {
        if (!res.ok) {
            return res.json().then(d => { throw new Error(d.error || 'Failed') });
        }
        return res.json();
    })
    .then(data => {
        showToast("Success", "Consultation checkout complete.", "success");
        loadQueueData();
    })
    .catch(err => {
        showToast("Failed", err.message || "No active patient in consultation.", "warning");
    });
}

// Cancel booking / remove from queue
function cancelAppointment(apptId) {
    if (!confirm("Are you sure you want to cancel this appointment and remove the patient from the queue?")) return;
    
    fetch(`/api/queue/cancel/${apptId}`, {
        method: 'POST'
    })
    .then(res => res.json())
    .then(data => {
        showToast("Cancelled", "Appointment removed from the schedule.", "success");
        loadQueueData();
    })
    .catch(err => {
        showToast("Error", "Could not cancel appointment.", "error");
        console.error(err);
    });
}

// 5. DASHBOARD VIEW
function loadDashboardData() {
    fetch('/api/dashboard')
        .then(res => res.json())
        .then(data => {
            renderDepartmentChart(data.dept_breakdown);
            renderDepartmentStatsTable(data.dept_breakdown);
            renderAuditTrailTable(data.logs);
        });
}

function renderDepartmentChart(breakdown) {
    const ctx = document.getElementById('deptChart').getContext('2d');
    
    // Destroy previous instance to avoid canvas redraw glitch
    if (deptChartInstance) {
        deptChartInstance.destroy();
    }
    
    const labels = Object.keys(breakdown);
    const counts = Object.values(breakdown);
    
    if (labels.length === 0) {
        labels.push("No Data");
        counts.push(1);
    }
    
    const colors = [
        'rgba(6, 182, 212, 0.75)', // Cyan
        'rgba(79, 172, 254, 0.75)', // Blue
        'rgba(139, 92, 246, 0.75)', // Purple
        'rgba(16, 185, 129, 0.75)', // Green
        'rgba(245, 158, 11, 0.75)',  // Yellow/Orange
        'rgba(239, 68, 68, 0.75)'   // Red
    ];
    
    const borders = [
        '#00f2fe',
        '#4facfe',
        '#8b5cf6',
        '#10b981',
        '#f59e0b',
        '#ef4444'
    ];

    deptChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: counts,
                backgroundColor: colors.slice(0, labels.length),
                borderColor: borders.slice(0, labels.length),
                borderWidth: 1.5,
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#94a3b8',
                        font: {
                            family: 'Plus Jakarta Sans',
                            size: 11
                        },
                        padding: 15
                    }
                }
            },
            cutout: '65%'
        }
    });
}

function renderDepartmentStatsTable(breakdown) {
    const tbody = document.querySelector('#table-dept-stats tbody');
    const keys = Object.keys(breakdown);
    
    if (keys.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" class="empty-state">No appointment records registered today.</td></tr>`;
        return;
    }
    
    const total = keys.reduce((sum, key) => sum + breakdown[key], 0);
    
    tbody.innerHTML = keys.map(dept => {
        const count = breakdown[dept];
        const pct = ((count / total) * 100).toFixed(1);
        return `
            <tr>
                <td><strong>${dept}</strong></td>
                <td>${count} patient(s)</td>
                <td>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="width: 45px; text-align: right;">${pct}%</span>
                        <div style="flex-grow: 1; height: 6px; background-color: rgba(255,255,255,0.05); border-radius: 4px; overflow: hidden;">
                            <div style="height: 100%; width: ${pct}%; background: var(--gradient-accent); border-radius: 4px;"></div>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function renderAuditTrailTable(logs) {
    const tbody = document.querySelector('#table-audit-logs tbody');
    
    if (!logs || logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No audit logs logged in current database session.</td></tr>`;
        return;
    }
    
    tbody.innerHTML = logs.map(log => {
        const time = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        
        let actionBadge = '';
        if (log.action === 'Enqueue') {
            actionBadge = '<span class="status-pill waiting" style="font-size:0.65rem;">Enqueued</span>';
        } else if (log.action === 'Dequeue') {
            actionBadge = '<span class="status-pill consultation" style="font-size:0.65rem;">Called</span>';
        } else if (log.action === 'Complete') {
            actionBadge = '<span class="status-pill completed" style="font-size:0.65rem;">Completed</span>';
        } else if (log.action === 'Cancel') {
            actionBadge = '<span class="status-pill cancelled" style="font-size:0.65rem;">Cancelled</span>';
        }
        
        return `
            <tr>
                <td style="color: var(--text-muted);">${time}</td>
                <td><strong>${log.patient_name}</strong></td>
                <td>${actionBadge}</td>
                <td><span class="queue-card-dept">${log.department}</span></td>
                <td>${log.doctor_name}</td>
            </tr>
        `;
    }).join('');
}

// -------------------------------------------------------------
// Toast Alerts Helper
// -------------------------------------------------------------
function showToast(title, desc, type = 'success') {
    const toast = document.getElementById('toast');
    const toastIcon = document.getElementById('toast-icon');
    const toastTitle = document.getElementById('toast-title');
    const toastDesc = document.getElementById('toast-desc');
    
    toastTitle.textContent = title;
    toastDesc.textContent = desc;
    
    // Set type styling class
    toastIcon.className = `toast-icon ${type}`;
    
    if (type === 'success') {
        toastIcon.innerHTML = `<i data-lucide="check"></i>`;
    } else if (type === 'error') {
        toastIcon.innerHTML = `<i data-lucide="alert-octagon"></i>`;
    } else if (type === 'warning') {
        toastIcon.innerHTML = `<i data-lucide="alert-circle"></i>`;
    }
    
    lucide.createIcons();
    
    // Show toast
    toast.classList.remove('hidden');
    
    // Auto-close after 4 seconds
    setTimeout(closeToast, 4000);
}

function closeToast() {
    const toast = document.getElementById('toast');
    toast.classList.add('hidden');
}
