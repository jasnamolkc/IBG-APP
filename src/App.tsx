import { useState, useEffect } from 'react';
import { LocalNotifications } from '@capacitor/local-notifications';

// Meeting Definition
interface Meeting {
  id: string;
  title: string;
  description: string;
  date: string; // User-typed date text (e.g. "Today", "Tomorrow", "July 16")
  time: string; // User-typed time text (e.g. "10:00 AM", "02:30 PM")
  actualDate: string; // Parsed ISO date (YYYY-MM-DD) for sorting and reminders
  actualTime: string; // Parsed 24-hour military time (HH:MM) for notifications
  notified: boolean;
}

// Toast Alert Definition
interface Toast {
  id: string;
  text: string;
  type: 'info' | 'success' | 'warning';
}

// Local date string helper (prevents UTC timezone offset shifts)
const getLocalDateString = (d: Date): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Smart date parser
const parseDateText = (text: string): string => {
  const clean = text.toLowerCase().trim();
  const today = new Date();
  
  if (clean.includes('tomorrow')) {
    const tomorrow = new Date(today.getTime() + 86400000);
    return getLocalDateString(tomorrow);
  }
  
  if (clean.includes('today')) {
    return getLocalDateString(today);
  }
  
  // If user typed just a day number (e.g. "16")
  const matchOnlyNumber = clean.match(/^(\d+)$/);
  if (matchOnlyNumber) {
    const dayNum = parseInt(matchOnlyNumber[1], 10);
    const target = new Date(today.getFullYear(), today.getMonth(), dayNum);
    return getLocalDateString(target);
  }
  
  // Try standard javascript Date parsing
  const parsed = Date.parse(text);
  if (!isNaN(parsed)) {
    return getLocalDateString(new Date(parsed));
  }
  
  // Default fallback is today
  return getLocalDateString(today);
};

// Smart time parser (returns 24h format HH:MM)
const parseTimeText = (timeStr: string, ampm: string): string => {
  const clean = timeStr.trim();
  const match = clean.match(/^(\d+)(?:[:.](\d+))?$/);
  let hours = 9;
  let minutes = 0;
  
  if (match) {
    hours = parseInt(match[1], 10);
    minutes = match[2] ? parseInt(match[2], 10) : 0;
  }
  
  if (ampm === 'PM' && hours < 12) {
    hours += 12;
  }
  if (ampm === 'AM' && hours === 12) {
    hours = 0;
  }
  
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

const INITIAL_MEETINGS = (): Meeting[] => [
  {
    id: 'demo-1',
    title: 'Daily Project Sync',
    description: 'Quick check-in on yesterday\'s tasks and today\'s goals.',
    date: 'Today',
    time: '10:00 AM',
    actualDate: getLocalDateString(new Date()),
    actualTime: '10:00',
    notified: false
  },
  {
    id: 'demo-2',
    title: 'Client Review Meeting',
    description: 'Walkthrough of the prototype design with stakeholders.',
    date: 'Today',
    time: '02:30 PM',
    actualDate: getLocalDateString(new Date()),
    actualTime: '14:30',
    notified: false
  },
  {
    id: 'demo-3',
    title: 'Code Alignment Session',
    description: 'Refactoring session for mobile layout improvements.',
    date: 'Tomorrow',
    time: '11:00 AM',
    actualDate: getLocalDateString(new Date(Date.now() + 86400000)),
    actualTime: '11:00',
    notified: false
  }
];

function App() {
  // Authentication State
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(() => {
    return localStorage.getItem('meeting_app_is_logged_in') === 'true';
  });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  // Meetings State
  const [meetings, setMeetings] = useState<Meeting[]>(() => {
    const saved = localStorage.getItem('meeting_app_meetings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        
        // Database Schema Migration (Migrate from old category/time structure to new format)
        return parsed.map((m: any) => {
          if (m.startTime && !m.time) {
            const [hours, minutes] = m.startTime.split(':').map(Number);
            const ampm = hours >= 12 ? 'PM' : 'AM';
            const dispHours = hours % 12 || 12;
            const dispMins = String(minutes).padStart(2, '0');
            const formattedTime = `${dispHours}:${dispMins} ${ampm}`;
            
            return {
              id: m.id,
              title: m.title,
              description: m.description,
              date: m.date,
              time: formattedTime,
              actualDate: m.date,
              actualTime: m.startTime,
              notified: m.notified
            };
          }
          return m;
        });
      } catch (e) {
        return INITIAL_MEETINGS();
      }
    }
    localStorage.setItem('meeting_app_meetings', JSON.stringify(INITIAL_MEETINGS()));
    return INITIAL_MEETINGS();
  });

  // Filters State
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'today' | 'upcoming' | 'all'>('today');

  // Modal State (Add/Edit)
  const [showModal, setShowModal] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState<Meeting | null>(null);

  // Form State
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formDate, setFormDate] = useState('Today');
  const [formTime, setFormTime] = useState('10:00');
  const [formAmPm, setFormAmPm] = useState<'AM' | 'PM'>('AM');

  // Notification Permission State
  const [notiPermission, setNotiPermission] = useState<string>('default');

  // Toasts Alert State
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Show Toast Helper
  const showToast = (text: string, type: Toast['type'] = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, text, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  // Sync to LocalStorage
  useEffect(() => {
    localStorage.setItem('meeting_app_meetings', JSON.stringify(meetings));
  }, [meetings]);

  // Read notification permissions on mount
  useEffect(() => {
    const checkPermission = async () => {
      try {
        const capStatus = await LocalNotifications.checkPermissions();
        setNotiPermission(capStatus.display);
      } catch (e) {
        if ('Notification' in window) {
          setNotiPermission(Notification.permission);
        }
      }
    };
    checkPermission();
  }, []);

  // Request Notification Permission
  const requestNotificationPermission = async () => {
    try {
      const capStatus = await LocalNotifications.requestPermissions();
      setNotiPermission(capStatus.display);
      if (capStatus.display === 'granted') {
        showToast('Native notifications enabled!', 'success');
        return;
      }
    } catch (e) {
      if ('Notification' in window) {
        const perm = await Notification.requestPermission();
        setNotiPermission(perm);
        if (perm === 'granted') {
          showToast('Web notifications enabled!', 'success');
        } else if (perm === 'denied') {
          showToast('Notifications blocked in browser settings.', 'warning');
        }
      } else {
        showToast('Notifications not supported by this browser.', 'warning');
      }
    }
  };

  // Trigger Notification
  const triggerNativeNotification = async (meeting: Meeting) => {
    const title = `Upcoming Meeting: ${meeting.title}`;
    const body = `Starts at ${meeting.time}\n${meeting.description}`;

    showToast(`Meeting "${meeting.title}" is starting soon at ${meeting.time}!`, 'warning');

    try {
      await LocalNotifications.schedule({
        notifications: [
          {
            title,
            body,
            id: Math.floor(Math.random() * 100000),
            schedule: { at: new Date(Date.now() + 1000) }, // Trigger in 1 second
            sound: undefined,
            attachments: undefined,
            actionTypeId: "",
            extra: null
          }
        ]
      });
    } catch (e) {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, {
          body,
          icon: '/favicon.svg'
        });
      }
    }
  };

  // Background Notification scheduler loop
  useEffect(() => {
    if (!isLoggedIn) return;

    const interval = setInterval(() => {
      const now = new Date();
      const todayStr = getLocalDateString(now);
      
      const currentHours = now.getHours();
      const currentMinutes = now.getMinutes();
      const currentTimeInMinutes = currentHours * 60 + currentMinutes;

      let hasUpdates = false;

      const updatedMeetings = meetings.map((meeting) => {
        // Trigger alerts for meetings today that haven't been notified yet
        if (meeting.actualDate === todayStr && !meeting.notified) {
          const [mHours, mMinutes] = meeting.actualTime.split(':').map(Number);
          const meetingTimeInMinutes = mHours * 60 + mMinutes;
          const diffMinutes = meetingTimeInMinutes - currentTimeInMinutes;

          // Trigger alert if meeting starts in 0 to 10 minutes
          if (diffMinutes >= 0 && diffMinutes <= 10) {
            triggerNativeNotification(meeting);
            hasUpdates = true;
            return { ...meeting, notified: true };
          }
          
          // Auto-mark as notified if it's already in the past, to prevent retro-alerts
          if (diffMinutes < 0) {
            return { ...meeting, notified: true };
          }
        }
        return meeting;
      });

      if (hasUpdates) {
        setMeetings(updatedMeetings);
      }
    }, 12000); // Check every 12 seconds

    return () => clearInterval(interval);
  }, [meetings, isLoggedIn]);

  // Handle User Login
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim().toLowerCase() === 'admin' && password === 'admin123') {
      setIsLoggedIn(true);
      localStorage.setItem('meeting_app_is_logged_in', 'true');
      setLoginError('');
      showToast('Welcome back, Admin!', 'success');
      
      // Request permission on login
      requestNotificationPermission();
    } else {
      setLoginError('Invalid username or password.');
      showToast('Login failed', 'warning');
    }
  };

  // Handle User Logout (Stops modals and fully clears state)
  const handleLogout = () => {
    setIsLoggedIn(false);
    localStorage.removeItem('meeting_app_is_logged_in');
    setUsername('');
    setPassword('');
    setShowModal(false);
    setEditingMeeting(null);
    showToast('Logged out successfully.', 'info');
  };

  // Open Form Modal to Create a New Meeting
  const handleOpenAddModal = () => {
    setEditingMeeting(null);
    setFormTitle('');
    setFormDesc('');
    setFormDate('Today');
    setFormTime('10:00');
    setFormAmPm('AM');
    setShowModal(true);
  };

  // Open Form Modal to Edit an Existing Meeting
  const handleOpenEditModal = (meeting: Meeting) => {
    setEditingMeeting(meeting);
    setFormTitle(meeting.title);
    setFormDesc(meeting.description);
    setFormDate(meeting.date);
    
    // Extract time and AM/PM
    const timeParts = meeting.time.split(' ');
    const rawTimeText = timeParts[0] || '10:00';
    const rawAmPm = (timeParts[1] || 'AM') as 'AM' | 'PM';
    
    setFormTime(rawTimeText);
    setFormAmPm(rawAmPm);
    setShowModal(true);
  };

  // Save (Create or Update) Meeting
  const handleSaveMeeting = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formTitle.trim()) {
      showToast('Meeting title is required.', 'warning');
      return;
    }
    if (!formDate.trim()) {
      showToast('Meeting date text is required.', 'warning');
      return;
    }
    if (!formTime.trim()) {
      showToast('Meeting time is required.', 'warning');
      return;
    }

    // Parse the typed text date and time inputs
    const parsedDate = parseDateText(formDate);
    const parsedTime = parseTimeText(formTime, formAmPm);
    
    const displayTime = `${formTime.trim()} ${formAmPm}`;

    if (editingMeeting) {
      // Update existing meeting
      setMeetings((prev) =>
        prev.map((meeting) =>
          meeting.id === editingMeeting.id
            ? {
                ...meeting,
                title: formTitle,
                description: formDesc,
                date: formDate,
                time: displayTime,
                actualDate: parsedDate,
                actualTime: parsedTime,
                // Reset notified flag if time/date fields were changed
                notified:
                  meeting.actualDate !== parsedDate || meeting.actualTime !== parsedTime
                    ? false
                    : meeting.notified,
              }
            : meeting
        )
      );
      showToast('Meeting updated successfully!', 'success');
    } else {
      // Create new meeting
      const newMeeting: Meeting = {
        id: Math.random().toString(36).substring(2, 9),
        title: formTitle,
        description: formDesc,
        date: formDate,
        time: displayTime,
        actualDate: parsedDate,
        actualTime: parsedTime,
        notified: false,
      };
      setMeetings((prev) => [...prev, newMeeting]);
      showToast('Meeting scheduled successfully!', 'success');
    }

    setShowModal(false);
    setEditingMeeting(null);
  };

  // Delete a Meeting
  const handleDeleteMeeting = (id: string) => {
    if (window.confirm('Are you sure you want to delete this meeting?')) {
      setMeetings((prev) => prev.filter((m) => m.id !== id));
      showToast('Meeting deleted.', 'info');
    }
  };

  // Filter & Search computation
  const filteredMeetings = meetings
    .filter((meeting) => {
      // Search matching title or description
      const matchesSearch =
        meeting.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        meeting.description.toLowerCase().includes(searchTerm.toLowerCase());
      
      if (!matchesSearch) return false;

      // Local date computation (no timezone shifts)
      const todayStr = getLocalDateString(new Date());

      if (activeTab === 'today') {
        return meeting.actualDate === todayStr;
      } else if (activeTab === 'upcoming') {
        return meeting.actualDate > todayStr;
      }
      return true; // 'all' tab shows everything
    })
    .sort((a, b) => {
      if (a.actualDate !== b.actualDate) {
        return a.actualDate.localeCompare(b.actualDate);
      }
      return a.actualTime.localeCompare(b.actualTime);
    });

  // Calculate dynamic dashboard stats using local date
  const todayStr = getLocalDateString(new Date());
  const meetingsTodayCount = meetings.filter((m) => m.actualDate === todayStr).length;
  const upcomingCount = meetings.filter((m) => m.actualDate > todayStr).length;

  // Group filtered meetings by date string
  const groupedMeetings: { [date: string]: Meeting[] } = {};
  filteredMeetings.forEach((meeting) => {
    if (!groupedMeetings[meeting.date]) {
      groupedMeetings[meeting.date] = [];
    }
    groupedMeetings[meeting.date].push(meeting);
  });

  // Render Login Layout
  if (!isLoggedIn) {
    return (
      <div className="auth-container">
        <div className="auth-header">
          <div className="auth-logo">MeetFlow</div>
          <p className="auth-subtitle">Optimized for Daily Meeting Management</p>
        </div>

        <div className="glass-card auth-card">
          <form onSubmit={handleLogin}>
            <div className="auth-form-group">
              <label htmlFor="username">Username</label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter admin username"
                required
                autoComplete="username"
              />
            </div>

            <div className="auth-form-group">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                required
                autoComplete="current-password"
              />
            </div>

            {loginError && <div className="auth-error">{loginError}</div>}

            <button type="submit" className="btn-primary" style={{ width: '100%' }}>
              Log In
            </button>
          </form>
        </div>

        <div className="auth-credentials-hint">
          <strong>Single-User Demo Settings:</strong><br />
          Username: <code>admin</code> &nbsp;&bull;&nbsp; Password: <code>admin123</code>
        </div>

        {/* Toast Alerts Overlay */}
        <div className="toast-container">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast ${toast.type}`}>
              <span>{toast.text}</span>
              <button
                className="toast-close"
                onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Render Main PWA Layout
  return (
    <>
      {/* Header Bar */}
      <header className="app-header">
        <div className="app-title-group">
          <h1>MeetFlow</h1>
          <p>{new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</p>
        </div>

        <div className="header-actions">
          {/* Notification status toggle */}
          <button
            className={`icon-btn ${
              notiPermission === 'granted'
                ? 'active'
                : notiPermission === 'denied'
                ? 'blocked'
                : ''
            }`}
            onClick={requestNotificationPermission}
            title={`Notifications: ${notiPermission}`}
            aria-label="Toggle notifications status"
          >
            {notiPermission === 'granted' ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                {notiPermission === 'denied' && <line x1="1" y1="1" x2="23" y2="23" stroke="#ef4444" strokeWidth="2.5"></line>}
              </svg>
            )}
          </button>

          {/* Logout button */}
          <button className="icon-btn" onClick={handleLogout} title="Log Out" aria-label="Log Out">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
              <polyline points="16 17 21 12 16 7"></polyline>
              <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
          </button>
        </div>
      </header>

      {/* Main Layout Area */}
      <main className="dashboard-content">
        {/* KPI Counts Section */}
        <section className="stats-banner">
          <div className="glass-card stat-item" style={{ borderLeft: '4px solid #10b981' }}>
            <div className="stat-label">Today</div>
            <div className="stat-value">{meetingsTodayCount}</div>
          </div>
          <div className="glass-card stat-item" style={{ borderLeft: '4px solid #818cf8' }}>
            <div className="stat-label">Upcoming</div>
            <div className="stat-value">{upcomingCount}</div>
          </div>
        </section>

        {/* Dashboard Filters controls */}
        <section className="controls-container">
          <div className="search-wrapper">
            <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input
              type="text"
              className="search-input"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search meetings..."
              aria-label="Search meetings"
            />
          </div>

          {/* Timeframe selector tabs */}
          <div className="tabs-container">
            <button
              className={`tab-btn ${activeTab === 'today' ? 'active' : ''}`}
              onClick={() => setActiveTab('today')}
            >
              Today
            </button>
            <button
              className={`tab-btn ${activeTab === 'upcoming' ? 'active' : ''}`}
              onClick={() => setActiveTab('upcoming')}
            >
              Upcoming
            </button>
            <button
              className={`tab-btn ${activeTab === 'all' ? 'active' : ''}`}
              onClick={() => setActiveTab('all')}
            >
              All
            </button>
          </div>
        </section>

        {/* Grouped Meetings Render list */}
        <section className="meetings-list">
          {Object.keys(groupedMeetings).length === 0 ? (
            <div className="glass-card empty-state">
              <div className="empty-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="16" y1="2" x2="16" y2="6"></line>
                  <line x1="8" y1="2" x2="8" y2="6"></line>
                  <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
              </div>
              <p>No meetings found.</p>
              <button className="btn-secondary" onClick={handleOpenAddModal} style={{ marginTop: '8px' }}>
                Add First Meeting
              </button>
            </div>
          ) : (
            Object.keys(groupedMeetings).map((date) => (
              <div key={date}>
                <div className="date-group-header">
                  {date}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '8px' }}>
                  {groupedMeetings[date].map((meeting) => (
                    <article key={meeting.id} className="meeting-card">
                      <div className="meeting-card-header">
                        <h2 className="meeting-title">{meeting.title}</h2>
                      </div>

                      <div className="meeting-time">
                        <svg className="meeting-time-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10"></circle>
                          <polyline points="12 6 12 12 16 14"></polyline>
                        </svg>
                        <span>
                          {meeting.time}
                        </span>
                      </div>

                      {meeting.description && (
                        <p className="meeting-desc">{meeting.description}</p>
                      )}

                      <div className="meeting-footer">
                        <div className="meeting-actions">
                          <button
                            className="action-btn"
                            onClick={() => handleOpenEditModal(meeting)}
                            title="Edit meeting details"
                            aria-label="Edit meeting"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                              <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                            </svg>
                          </button>
                          <button
                            className="action-btn delete"
                            onClick={() => handleDeleteMeeting(meeting.id)}
                            title="Delete meeting"
                            aria-label="Delete meeting"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6"></polyline>
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ))
          )}
        </section>
      </main>

      {/* Floating Action Button */}
      <button
        className="fab"
        onClick={handleOpenAddModal}
        aria-label="Add new meeting"
        title="Schedule new meeting"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </button>

      {/* Add / Edit Slide-over Bottom Sheet */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">
                {editingMeeting ? 'Edit Meeting' : 'New Meeting'}
              </h2>
              <button className="modal-close" onClick={() => setShowModal(false)} aria-label="Close modal">
                &times;
              </button>
            </div>

            <form onSubmit={handleSaveMeeting}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label htmlFor="form-title">Meeting Title</label>
                  <input
                    id="form-title"
                    type="text"
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    placeholder="e.g. Project Sync"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="form-date">Date</label>
                  <input
                    id="form-date"
                    type="text"
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    placeholder="e.g. Today, Tomorrow, July 16"
                    required
                  />
                </div>

                <div className="form-grid">
                  <div>
                    <label htmlFor="form-time">Time</label>
                    <input
                      id="form-time"
                      type="text"
                      value={formTime}
                      onChange={(e) => setFormTime(e.target.value)}
                      placeholder="e.g. 10:30, 9:00"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="form-ampm">AM / PM</label>
                    <select
                      id="form-ampm"
                      value={formAmPm}
                      onChange={(e) => setFormAmPm(e.target.value as 'AM' | 'PM')}
                      required
                    >
                      <option value="AM">AM</option>
                      <option value="PM">PM</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label htmlFor="form-desc">Notes / Description</label>
                  <textarea
                    id="form-desc"
                    value={formDesc}
                    onChange={(e) => setFormDesc(e.target.value)}
                    placeholder="Enter meeting notes, link details, or agenda..."
                    rows={3}
                  />
                </div>

                <div className="form-actions">
                  <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary">
                    {editingMeeting ? 'Save Changes' : 'Schedule'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast Alerts Overlay */}
      <div className="toast-container">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.type}`}>
            <span>{toast.text}</span>
            <button
              className="toast-close"
              onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
            >
              &times;
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

export default App;
