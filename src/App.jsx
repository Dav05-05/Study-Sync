import React, { useState, useEffect, useRef } from 'react';
import { 
  Calendar, BookOpen, Layers, Plus, ChevronRight, ChevronLeft, 
  X, Loader2, Sparkles, ArrowLeft, Clock, BookMarked, 
  Trash2, CalendarDays, User, Lock, LogOut, FileText
} from 'lucide-react';
import { auth, db } from './firebase';
import { 
  signInWithEmailAndPassword, createUserWithEmailAndPassword, 
  signOut, onAuthStateChanged 
} from 'firebase/auth';
import { 
  collection, doc, getDocs, setDoc, deleteDoc
} from 'firebase/firestore';

// --- Gemini AI Configuration ---
const generateFlashcardsFromNote = async (title, content) => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Gemini API key is missing. Check your .env file for VITE_GEMINI_API_KEY.");
  }

  // Active, free-tier Flash models checked in order of preference
  const models = [
    "gemini-3.7-flash",
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash"
  ];
  let lastError = null;

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      const payload = {
        contents: [
          {
            parts: [
              {
                text: `You are an expert tutor. Create concise study flashcards based on the following lesson notes titled "${title}". 
                Extract the most important facts, definitions, and concepts.
                
                Return a valid JSON array where each object has exactly two keys: "front" (the question or concept) and "back" (the answer or definition). Example format:
                [
                  {"front": "What is X?", "back": "X is Y."}
                ]
                
                Notes content:
                ${content}`
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          responseMimeType: "application/json"
        }
      };

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || `Model ${model} failed.`);
      }

      const data = await response.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!rawText) {
        throw new Error(`Model ${model} returned an empty response text.`);
      }

      const cleanJson = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
      const parsedCards = JSON.parse(cleanJson);
      
      if (!Array.isArray(parsedCards) || parsedCards.length === 0) {
        throw new Error(`Parsed result from ${model} is not a valid flashcard array.`);
      }

      return parsedCards;

    } catch (err) {
      console.warn(`Model ${model} failed or was busy. Trying fallback...`, err.message);
      lastError = err;
    }
  }

  throw new Error(lastError?.message || "All current free Gemini models are currently unavailable.");
};

// --- Helpers ---
const generateId = () => Math.random().toString(36).substr(2, 9);

const formatDate = (isoString) => {
  if (!isoString) return 'Unknown date';
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', { 
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
};

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// --- Main Application Component ---
export default function App() {
  const [user, setUser] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [subjects, setSubjects] = useState([]);
  const [notes, setNotes] = useState([]);

  // Navigation State
  const [activeTab, setActiveTab] = useState('schedule'); 
  const [selectedDay, setSelectedDay] = useState('Monday');
  const [activeSubject, setActiveSubject] = useState(null); 
  const [activeNote, setActiveNote] = useState(null); 
  const [subjectToDelete, setSubjectToDelete] = useState(null);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setLoadingAuth(false);
      if (currentUser) await fetchUserData(currentUser.uid);
    });
    return () => unsubscribe();
  }, []);

  const fetchUserData = async (uid) => {
    try {
      const subSnapshot = await getDocs(collection(db, `users/${uid}/subjects`));
      setSubjects(subSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));

      const notesSnapshot = await getDocs(collection(db, `users/${uid}/notes`));
      setNotes(notesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch (err) {
      console.error("Error fetching data:", err);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setUser(null);
    setSubjects([]);
    setNotes([]);
    setActiveTab('schedule');
    setActiveSubject(null);
    setActiveNote(null);
  };

  const handleAddSubject = async (newSubjectData) => {
    if (!user) return;
    try {
      const newId = generateId();
      const subjectItem = { ...newSubjectData, id: newId, day: selectedDay };
      
      setSubjects((prevSubjects) => {
        const currentList = Array.isArray(prevSubjects) ? prevSubjects : [];
        return [...currentList, subjectItem];
      });

      await setDoc(doc(db, `users/${user.uid}/subjects`, newId), subjectItem); 
    } catch (err) {
      console.error("Crash prevented in handleAddSubject:", err);
      alert("Could not add class: " + err.message);
    }
  };

  const handleDeleteSubject = async (subjectId) => {
    if (!user) return;
    setSubjects(subjects.filter(s => s.id !== subjectId));
    setSubjectToDelete(null);
    try { await deleteDoc(doc(db, `users/${user.uid}/subjects`, subjectId)); } 
    catch (err) { console.error("Error deleting subject:", err); }
  };

  const handleSaveNote = async (updatedNote) => {
    if (!user) return;
    const existingIndex = notes.findIndex(n => n.id === updatedNote.id);
    let newNotes = [...notes];
    if (existingIndex >= 0) newNotes[existingIndex] = updatedNote;
    else newNotes.push(updatedNote);
    setNotes(newNotes);
    setActiveNote(null);
    try { await setDoc(doc(db, `users/${user.uid}/notes`, updatedNote.id), updatedNote); } 
    catch (err) { console.error("Error saving note:", err); }
  };

  const handleDeleteNote = async (noteId) => {
    if (!user) return;
    setNotes(notes.filter(n => n.id !== noteId));
    if (activeNote?.id === noteId) setActiveNote(null);
    try { await deleteDoc(doc(db, `users/${user.uid}/notes`, noteId)); } 
    catch (err) { console.error("Error deleting note:", err); }
  };

  if (loadingAuth) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (!user) return <AuthScreen />;

  const renderScheduleTab = () => {
    if (activeNote) {
      return <NoteEditor note={activeNote} subjects={subjects} onSave={handleSaveNote} onBack={() => setActiveNote(null)} />;
    }
    if (activeSubject) {
      return (
        <SubjectDetails 
          subject={activeSubject} notes={notes.filter(n => n.subjectId === activeSubject.id)}
          onBack={() => setActiveSubject(null)}
          onAddNote={() => setActiveNote({ id: generateId(), subjectId: activeSubject.id, title: '', content: '', flashcards: [] })}
          onViewNote={(note) => setActiveNote(note)} onDeleteNote={handleDeleteNote}
        />
      );
    }

    return (
      <div className="space-y-6">
        <div className="flex overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 hide-scrollbar space-x-2">
          {DAYS_OF_WEEK.map(day => (
            <button
              key={day} onClick={() => { setSelectedDay(day); setSubjectToDelete(null); }}
              className={`flex-shrink-0 px-5 py-2.5 rounded-full text-sm font-medium transition-all duration-200 ${
                selectedDay === day ? 'bg-indigo-600 text-white shadow-md' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
              }`}
            >
              {day}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
            <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-indigo-500" /> Classes for {selectedDay}
            </h2>
          </div>
          <div className="divide-y divide-gray-100">
            {subjects.filter(s => s.day === selectedDay).length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <BookOpen className="w-8 h-8 text-gray-300 mx-auto mb-3" />
                <p>No classes scheduled for this day.</p>
              </div>
            ) : (
              subjects.filter(s => s.day === selectedDay).map(subject => (
                <div key={subject.id} onClick={() => setActiveSubject(subject)} className="p-4 sm:px-6 hover:bg-indigo-50/50 cursor-pointer transition-colors group flex justify-between items-center">
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900 text-lg group-hover:text-indigo-700">{subject.name}</h3>
                    <p className="text-sm text-gray-500 flex items-center gap-1 mt-1"><Clock className="w-4 h-4" /> {subject.time}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    {subjectToDelete === subject.id ? (
                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => handleDeleteSubject(subject.id)} className="text-xs bg-red-600 text-white px-3 py-1.5 rounded-md hover:bg-red-700 font-medium">Confirm Delete</button>
                        <button onClick={() => setSubjectToDelete(null)} className="text-xs bg-gray-200 text-gray-700 px-3 py-1.5 rounded-md hover:bg-gray-300 font-medium">Cancel</button>
                      </div>
                    ) : (
                      <>
                        <button onClick={(e) => { e.stopPropagation(); setSubjectToDelete(subject.id); }} className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg" title="Remove Class">
                          <Trash2 className="w-5 h-5" />
                        </button>
                        <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-indigo-500 hidden sm:block" />
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <QuickAddSubject day={selectedDay} onAdd={handleAddSubject} />
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 text-indigo-600">
            <Layers className="w-7 h-7" /> <span className="text-xl font-bold tracking-tight">StudySync</span>
          </div>
          <nav className="flex space-x-1 bg-gray-100 p-1 rounded-lg">
            {['schedule', 'notes', 'flashcards'].map(tab => (
              <button
                key={tab}
                onClick={() => { setActiveTab(tab); setActiveSubject(null); setActiveNote(null); }}
                className={`px-3 sm:px-4 py-1.5 rounded-md text-xs sm:text-sm font-medium capitalize transition-colors ${
                  activeTab === tab ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {tab}
              </button>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-gray-700 hidden sm:inline">@{user.email?.split('@')[0]}</span>
            <button onClick={handleLogout} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'schedule' && renderScheduleTab()}
        {activeTab === 'notes' && (
          activeNote 
            ? <NoteEditor note={activeNote} subjects={subjects} onSave={handleSaveNote} onBack={() => setActiveNote(null)} />
            : <AllNotesView notes={notes} subjects={subjects} onViewNote={setActiveNote} onDeleteNote={handleDeleteNote} onCreateNew={() => setActiveNote({ id: generateId(), subjectId: subjects[0]?.id || '', title: '', content: '', flashcards: [] })} />
        )}
        {activeTab === 'flashcards' && <FlashcardsView subjects={subjects} notes={notes} />}
      </main>
    </div>
  );
}

// --- Authentication Screen ---
function AuthScreen() {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleAuth = async (e) => {
    e.preventDefault();
    setError('');
    const email = `${username.trim().toLowerCase()}@studysync.local`;
    try {
      if (isLogin) await signInWithEmailAndPassword(auth, email, password);
      else await createUserWithEmailAndPassword(auth, email, password);
    } catch (err) {
      setError(err.message.replace('Firebase: ', ''));
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-xl border border-gray-100 max-w-md w-full p-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="w-14 h-14 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-2"><Layers className="w-8 h-8" /></div>
          <h1 className="text-2xl font-bold text-gray-900">Welcome to StudySync</h1>
          <p className="text-sm text-gray-500">Your schedule & AI study assistant</p>
        </div>
        <div className="flex bg-gray-100 p-1 rounded-xl">
          <button type="button" onClick={() => { setIsLogin(true); setError(''); }} className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${isLogin ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>Log In</button>
          <button type="button" onClick={() => { setIsLogin(false); setError(''); }} className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${!isLogin ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>Create Account</button>
        </div>
        <form onSubmit={handleAuth} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Username</label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400"><User className="w-4 h-4" /></span>
              <input type="text" required autoFocus className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl outline-none text-sm focus:border-indigo-500" placeholder="Enter username..." value={username} onChange={e => setUsername(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Password</label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400"><Lock className="w-4 h-4" /></span>
              <input type="password" required className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl outline-none text-sm focus:border-indigo-500" placeholder="Enter password..." value={password} onChange={e => setPassword(e.target.value)} />
            </div>
          </div>
          {error && <div className="p-3 bg-red-50 text-red-600 text-xs rounded-xl font-medium text-center">{error}</div>}
          <button type="submit" className="w-full py-3.5 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 shadow-md">{isLogin ? 'Log In' : 'Create Account'}</button>
        </form>
      </div>
    </div>
  );
}

// --- Time Wheel & Add Subject Component ---
function ScrollWheel({ options, value, onChange }) {
  const containerRef = useRef(null);
  const itemHeight = 44; 

  useEffect(() => {
    if (containerRef.current) {
      const index = options.indexOf(value);
      if (index !== -1) containerRef.current.scrollTop = index * itemHeight;
    }
  }, [options, value]); 

  const handleScroll = (e) => {
    const scrollTop = e.target.scrollTop;
    const index = Math.round(scrollTop / itemHeight);
    if (options[index] && options[index] !== value) onChange(options[index]);
  };

  return (
    <div ref={containerRef} className="h-[132px] w-16 overflow-y-auto snap-y snap-mandatory hide-scrollbar relative" onScroll={handleScroll} style={{ scrollBehavior: 'smooth' }}>
      <div style={{ height: `${itemHeight}px` }}></div>
      {options.map((opt) => (
        <div key={opt} className={`h-[44px] flex items-center justify-center snap-center transition-all duration-200 ${value === opt ? 'text-2xl font-semibold text-indigo-600' : 'text-lg text-gray-400'}`} style={{ height: `${itemHeight}px` }}>{opt}</div>
      ))}
      <div style={{ height: `${itemHeight}px` }}></div>
    </div>
  );
}

function CustomTimePicker({ hour, setHour, minute, setMinute, period, setPeriod }) {
  const hours = Array.from({length: 12}, (_, i) => (i + 1).toString().padStart(2, '0'));
  const minutes = Array.from({length: 60}, (_, i) => i.toString().padStart(2, '0'));
  const periods = ['AM', 'PM'];
  const [showTimePicker, setShowTimePicker] = useState(false);

  const currentTime = `${hour}:${minute} ${period}`;

  return (
    <div className="mb-4 relative">
      <label className="block text-xs font-medium text-gray-500 mb-1">Start Time</label>
      
      {/* Clickable Button displaying the current time */}
      <div 
        onClick={() => setShowTimePicker(!showTimePicker)}
        className="w-full p-3 border border-gray-300 rounded-lg bg-white cursor-pointer flex justify-between items-center text-gray-800 shadow-sm hover:border-indigo-500 transition-colors"
      >
        <span className="font-medium text-sm">{currentTime}</span>
        <span className="text-gray-400 text-sm">{showTimePicker ? '▲' : '▼'}</span>
      </div>

      {/* Pop-up Time Wheel that matches app aesthetics */}
      {showTimePicker && (
        <div className="absolute z-20 mt-2 left-0 right-0 bg-white border border-gray-200 p-4 rounded-xl shadow-xl animate-in fade-in zoom-in-95 duration-200">
          <div className="flex justify-center items-center space-x-2 py-2 bg-gray-50/50 rounded-lg border border-gray-100">
            <ScrollWheel options={hours} value={hour} onChange={setHour} />
            <span className="text-2xl font-light text-gray-300 pb-1">:</span>
            <ScrollWheel options={minutes} value={minute} onChange={setMinute} />
            <span className="text-2xl font-light text-gray-300 pb-1">:</span>
            <ScrollWheel options={periods} value={period} onChange={setPeriod} />
          </div>
          
          <button 
            type="button"
            onClick={() => setShowTimePicker(false)}
            className="mt-4 w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-lg text-sm font-medium transition-colors shadow-sm"
          >
            Confirm Time
          </button>
        </div>
      )}
    </div>
  );
}

function QuickAddSubject({ day, onAdd }) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState('');
  const [hour, setHour] = useState('09');
  const [minute, setMinute] = useState('00');
  const [period, setPeriod] = useState('AM');

  const handleFormSubmit = (e) => {
    // 1. Stop default form reload
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }

    try {
      // 2. Validate input
      if (!name.trim()) {
        alert("Please enter a subject name.");
        return;
      }

      // 3. Create the data object safely
      const timeString = `${hour}:${minute} ${period}`;
      const newClassData = {
        name: name.trim(),
        time: timeString
      };

      // 4. Safely call the parent function
      if (typeof onAdd === 'function') {
        onAdd(newClassData);
      }

      // 5. Reset the form
      setName('');
      setIsOpen(false);
    } catch (err) {
      console.error("Crash prevented:", err);
      alert("An error occurred: " + err.message);
    }
  };

  if (!isOpen) return (
    <button onClick={() => setIsOpen(true)} className="w-full py-4 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 font-medium hover:border-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 flex items-center justify-center gap-2 transition-colors">
      <Plus className="w-5 h-5" /> Add Class to {day}
    </button>
  );

  return (
    <form onSubmit={handleFormSubmit} className="bg-white p-5 rounded-xl shadow-sm border border-indigo-100 space-y-5 animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-gray-800">Add New Class</h3>
        <button type="button" onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100 transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Subject Name</label>
        <input 
          type="text" 
          autoFocus 
          required 
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-shadow text-sm" 
          placeholder="e.g. Biology 101" 
          value={name} 
          onChange={e => setName(e.target.value)} 
        />
      </div>
      <div>
        <CustomTimePicker hour={hour} setHour={setHour} minute={minute} setMinute={setMinute} period={period} setPeriod={setPeriod} />
      </div>
      <div className="flex justify-end pt-2 border-t border-gray-100">
        <button type="submit" className="mt-3 px-5 py-2.5 w-full bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 shadow-sm transition-colors">
          Add Class
        </button>
      </div>
    </form>
  );
}

// --- Details & Editors ---
function SubjectDetails({ subject, notes, onBack, onAddNote, onViewNote, onDeleteNote }) {
  const [noteToDelete, setNoteToDelete] = useState(null);

  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
      <button onClick={onBack} className="flex items-center text-gray-500 hover:text-indigo-600 font-medium"><ArrowLeft className="w-4 h-4 mr-1" /> Back to Schedule</button>
      <div className="bg-indigo-600 rounded-2xl p-6 sm:p-8 text-white shadow-md">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-white/20 rounded-full text-xs font-semibold tracking-wide uppercase mb-4">{subject.day}</div>
        <h1 className="text-3xl font-bold mb-2">{subject.name}</h1>
        <p className="text-indigo-100 flex items-center gap-2"><Clock className="w-4 h-4" /> {subject.time}</p>
      </div>
      <div className="flex justify-between items-end">
        <h2 className="text-xl font-bold text-gray-900">Lesson Notes</h2>
        <button onClick={onAddNote} className="flex items-center gap-2 bg-white border border-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 hover:border-indigo-300 font-medium text-sm shadow-sm transition-colors"><Plus className="w-4 h-4" /> New Note</button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {notes.length === 0 ? (
          <div className="col-span-full py-12 text-center bg-white rounded-2xl border border-dashed border-gray-300">
            <BookMarked className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No notes yet for this subject.</p>
          </div>
        ) : (
          notes.map(note => (
            <div key={note.id} onClick={() => onViewNote(note)} className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm hover:shadow-md cursor-pointer group flex flex-col justify-between transition-shadow">
              <div>
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-semibold text-gray-900 text-lg group-hover:text-indigo-600 pr-4 transition-colors">{note.title || 'Untitled Note'}</h3>
                  {noteToDelete === note.id ? (
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => onDeleteNote(note.id)} className="text-xs bg-red-600 text-white px-2 py-1 rounded">Delete</button>
                      <button onClick={() => setNoteToDelete(null)} className="text-xs bg-gray-200 px-2 py-1 rounded">Cancel</button>
                    </div>
                  ) : <button onClick={(e) => { e.stopPropagation(); setNoteToDelete(note.id); }} className="text-gray-300 hover:text-red-500 p-1 rounded transition-colors"><Trash2 className="w-4 h-4" /></button>}
                </div>
                <p className="text-gray-500 text-sm line-clamp-3 mb-4">{note.content}</p>
              </div>
              <div className="flex items-center justify-between mt-2">
                <div className="flex items-center text-xs font-medium text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-md"><Layers className="w-3.5 h-3.5 mr-1.5" />{note.flashcards?.length || 0} Flashcards</div>
                {note.createdAt && <span className="text-xs text-gray-400 flex items-center"><CalendarDays className="w-3 h-3 mr-1" />{formatDate(note.createdAt).split(',')[0]}</span>}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function AllNotesView({ notes, subjects, onViewNote, onDeleteNote, onCreateNew }) {
  const [noteToDelete, setNoteToDelete] = useState(null);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div><h1 className="text-2xl font-bold text-gray-900 mb-1">All Lesson Notes</h1><p className="text-gray-500 text-sm">Manage and review notes across all subjects.</p></div>
        <button onClick={onCreateNew} className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-xl hover:bg-indigo-700 font-medium text-sm shadow-sm transition-colors"><Plus className="w-4 h-4" /> New Note</button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {notes.length === 0 ? (
          <div className="col-span-full py-16 text-center bg-white rounded-3xl border border-dashed border-gray-300">
            <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No notes created yet.</p>
          </div>
        ) : (
          notes.map(note => {
            const subject = subjects.find(s => s.id === note.subjectId) || { name: 'Archived / Removed Class' };
            return (
              <div key={note.id} onClick={() => onViewNote(note)} className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm hover:shadow-md cursor-pointer group flex flex-col justify-between transition-shadow">
                <div>
                  <div className="flex items-center gap-2 mb-2"><span className="text-xs font-semibold px-2.5 py-0.5 bg-indigo-50 text-indigo-600 rounded-md">{subject.name}</span></div>
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-semibold text-gray-900 text-lg group-hover:text-indigo-600 pr-4 transition-colors">{note.title || 'Untitled Note'}</h3>
                    {noteToDelete === note.id ? (
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => onDeleteNote(note.id)} className="text-xs bg-red-600 text-white px-2 py-1 rounded">Delete</button>
                        <button onClick={() => setNoteToDelete(null)} className="text-xs bg-gray-200 px-2 py-1 rounded">Cancel</button>
                      </div>
                    ) : <button onClick={(e) => { e.stopPropagation(); setNoteToDelete(note.id); }} className="text-gray-300 hover:text-red-500 p-1 rounded transition-colors"><Trash2 className="w-4 h-4" /></button>}
                  </div>
                  <p className="text-gray-500 text-sm line-clamp-3 mb-4">{note.content}</p>
                </div>
                <div className="flex items-center justify-between mt-2 pt-3 border-t border-gray-100">
                  <div className="flex items-center text-xs font-medium text-indigo-600"><Layers className="w-3.5 h-3.5 mr-1" />{note.flashcards?.length || 0} Flashcards</div>
                  {note.createdAt && <span className="text-xs text-gray-400">{formatDate(note.createdAt).split(',')[0]}</span>}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function NoteEditor({ note, subjects, onSave, onBack }) {
  const [title, setTitle] = useState(note.title || '');
  const [content, setContent] = useState(note.content || '');
  const [subjectId, setSubjectId] = useState(note.subjectId || (subjects[0]?.id || ''));
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState(null);

  const handleSaveAndGenerate = async () => {
    if (!title.trim() || !content.trim()) {
      alert("Title and content cannot be empty!");
      return;
    }

    setIsGenerating(true); 
    setError(null);

    try {
      console.log("Calling Gemini..."); 
      const generatedCards = await generateFlashcardsFromNote(title, content);

      if (!generatedCards || generatedCards.length === 0) {
        throw new Error("Gemini returned an empty list.");
      }

      onSave({ 
        ...note, 
        subjectId, 
        title, 
        content, 
        flashcards: generatedCards,
        createdAt: note.createdAt || new Date().toISOString()
      });

    } catch (err) {
      alert("Generation Failed: " + err.message);
      setIsGenerating(false);
    }
  };

  const handleQuickSave = () => onSave({ ...note, subjectId, title, content, createdAt: note.createdAt || new Date().toISOString() });

  return (
    <div className="space-y-4 max-w-3xl mx-auto animate-in slide-in-from-bottom-4 duration-300">
      <div className="flex items-center justify-between mb-2"><button onClick={onBack} className="flex items-center text-gray-500 hover:text-indigo-600 font-medium text-sm transition-colors"><ArrowLeft className="w-4 h-4 mr-1" /> Back</button></div>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 bg-gray-50/50 border-b border-gray-100 flex items-center justify-between">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Assign to Subject</label>
          <select className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white font-medium text-gray-800 outline-none focus:ring-2 focus:ring-indigo-500" value={subjectId} onChange={e => setSubjectId(e.target.value)}>
            {subjects.map(s => <option key={s.id} value={s.id}>{s.name} ({s.day})</option>)}
          </select>
        </div>
        <div className="p-1"><input type="text" placeholder="Lesson Title..." className="w-full text-2xl font-bold text-gray-900 px-5 py-4 outline-none border-b border-gray-100 placeholder-gray-300" value={title} onChange={e => setTitle(e.target.value)} /></div>
        <div className="p-1 relative">
          <textarea placeholder="Type your notes here..." className="w-full min-h-[300px] text-gray-700 px-5 py-4 outline-none resize-y pb-8 placeholder-gray-300" value={content} onChange={e => setContent(e.target.value)} />
          {note.createdAt && <div className="absolute bottom-4 right-5 text-xs text-gray-400 italic">Note created on: {formatDate(note.createdAt)}</div>}
        </div>
        {error && <div className="px-5 py-3 bg-red-50 text-red-600 text-sm border-t border-red-100 flex items-center"><span className="font-medium mr-2">Error:</span> {error}</div>}
        <div className="px-5 py-4 bg-gray-50 border-t border-gray-100 flex flex-wrap-reverse gap-3 justify-end items-center">
          <button onClick={handleQuickSave} disabled={isGenerating} className="px-4 py-2.5 text-gray-600 font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors">Save Without Generating</button>
          <button type="button" onClick={handleSaveAndGenerate} disabled={isGenerating || !title.trim() || !content.trim()} className="flex items-center px-6 py-2.5 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-70 transition-colors">
            {isGenerating ? <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Generating Cards...</> : <><Sparkles className="w-5 h-5 mr-2" /> Save & Generate Flashcards</>}
          </button>
        </div>
      </div>
      {note.flashcards && note.flashcards.length > 0 && !isGenerating && (
        <div className="mt-8 animate-in fade-in duration-500">
          <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4">Generated Flashcards ({note.flashcards.length})</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {note.flashcards.map((card, idx) => (
              <div key={idx} className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm text-sm">
                <div className="font-semibold text-gray-900 mb-2 pb-2 border-b border-gray-100">Q: {card.front}</div><div className="text-gray-600">A: {card.back}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Flashcards ---
function FlashcardsView({ subjects, notes }) {
  const [selectedNoteDeck, setSelectedNoteDeck] = useState(null);

  const groupedNotesMap = new Map();
  notes.forEach(note => {
    if (!note.flashcards || note.flashcards.length === 0) return;
    const subject = subjects.find(s => s.id === note.subjectId) || { id: 'archived_' + note.subjectId, name: 'Archived / Removed Class' };
    if (!groupedNotesMap.has(subject.id)) groupedNotesMap.set(subject.id, { subject, notes: [] });
    groupedNotesMap.get(subject.id).notes.push(note);
  });
  const groupedNotes = Array.from(groupedNotesMap.values());

  if (selectedNoteDeck) return <FlashcardPlayer note={selectedNoteDeck} subject={subjects.find(s => s.id === selectedNoteDeck.subjectId) || { name: 'Archived / Removed Class' }} onClose={() => setSelectedNoteDeck(null)} />;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div><h1 className="text-2xl font-bold text-gray-900 mb-2">Your Flashcard Decks</h1><p className="text-gray-500">Review your generated study materials grouped by subject.</p></div>
      {groupedNotes.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-gray-300">
          <Layers className="w-16 h-16 text-gray-300 mx-auto mb-4" /><h3 className="text-lg font-medium text-gray-900">No Flashcards Yet</h3>
          <p className="text-gray-500 mt-2 max-w-sm mx-auto">Create subjects and add notes in the Schedule tab to automatically generate AI flashcards.</p>
        </div>
      ) : (
        <div className="space-y-10">
          {groupedNotes.map(({ subject, notes: subjectNotes }) => (
            <div key={subject.id}>
              <div className="flex items-center gap-3 mb-4"><div className={`w-2 h-6 rounded-full ${subject.name.includes('Archived') ? 'bg-gray-400' : 'bg-indigo-500'}`}></div><h2 className={`text-xl font-bold ${subject.name.includes('Archived') ? 'text-gray-500 italic' : 'text-gray-800'}`}>{subject.name}</h2></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
                {subjectNotes.map(note => (
                  <button key={note.id} onClick={() => setSelectedNoteDeck(note)} className="flex flex-col text-left bg-white p-6 rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow group relative">
                    <div className="flex-1 mb-4 w-full">
                      <h3 className="font-bold text-gray-900 group-hover:text-indigo-600 transition-colors mb-2 line-clamp-2 pr-2">{note.title}</h3>
                      {note.createdAt && <p className="text-xs text-gray-400 flex items-center gap-1 mb-3"><CalendarDays className="w-3.5 h-3.5" /> Generated: {formatDate(note.createdAt)}</p>}
                      <p className="text-sm text-gray-500 line-clamp-2">{note.content}</p>
                    </div>
                    <div className="mt-auto flex items-center justify-between w-full pt-4 border-t border-gray-100">
                      <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-lg">{note.flashcards.length} Cards</span>
                      <span className="text-indigo-500 group-hover:translate-x-1 transition-transform font-medium text-sm flex items-center">Study <ChevronRight className="w-4 h-4 ml-1" /></span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FlashcardPlayer({ note, subject, onClose }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const cards = note.flashcards;

  const handleNext = () => { if (currentIndex < cards.length - 1) { setIsFlipped(false); setTimeout(() => setCurrentIndex(prev => prev + 1), 150); } };
  const handlePrev = () => { if (currentIndex > 0) { setIsFlipped(false); setTimeout(() => setCurrentIndex(prev => prev - 1), 150); } };

  return (
    <div className="max-w-2xl mx-auto animate-in zoom-in-95 duration-300">
      <div className="flex items-center justify-between mb-8">
        <div>
          <button onClick={onClose} className="text-gray-500 hover:text-indigo-600 transition-colors flex items-center text-sm font-medium mb-2"><ArrowLeft className="w-4 h-4 mr-1" /> Back to Decks</button>
          <h2 className="text-2xl font-bold text-gray-900">{note.title}</h2>
          <div className="flex items-center gap-3 text-sm mt-1"><p className="text-indigo-600 font-medium">{subject.name}</p><span className="text-gray-300">•</span><p className="text-gray-500">{formatDate(note.createdAt)}</p></div>
        </div>
        <div className="bg-white px-4 py-2 rounded-lg border border-gray-200 font-semibold text-indigo-600 shadow-sm">{currentIndex + 1} / {cards.length}</div>
      </div>
      <div className="relative w-full aspect-[4/3] sm:aspect-[3/2] cursor-pointer" style={{ perspective: '1000px' }} onClick={() => setIsFlipped(!isFlipped)}>
        <div className="w-full h-full relative transition-transform duration-500 shadow-lg rounded-3xl" style={{ transformStyle: 'preserve-3d', transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}>
          <div className="absolute inset-0 w-full h-full bg-white rounded-3xl border-2 border-indigo-50 p-8 sm:p-12 flex flex-col items-center justify-center text-center" style={{ backfaceVisibility: 'hidden' }}>
            <span className="absolute top-6 left-6 text-xs font-bold uppercase tracking-widest text-indigo-400">Question</span>
            <p className="text-2xl sm:text-3xl font-medium text-gray-800 leading-snug">{cards[currentIndex].front}</p><span className="absolute bottom-6 text-sm text-gray-400">Tap to flip</span>
          </div>
          <div className="absolute inset-0 w-full h-full bg-indigo-600 rounded-3xl shadow-xl p-8 sm:p-12 flex flex-col items-center justify-center text-center text-white" style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
            <span className="absolute top-6 left-6 text-xs font-bold uppercase tracking-widest text-indigo-200">Answer</span>
            <p className="text-xl sm:text-2xl font-medium leading-relaxed">{cards[currentIndex].back}</p>
          </div>
        </div>
      </div>
      <div className="flex justify-center items-center gap-6 mt-10">
        <button onClick={handlePrev} disabled={currentIndex === 0} className="p-4 rounded-full bg-white text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-30 shadow-sm border border-gray-100"><ChevronLeft className="w-6 h-6" /></button>
        <button onClick={() => setIsFlipped(!isFlipped)} className="px-8 py-3 rounded-xl bg-gray-900 text-white font-medium hover:bg-gray-800 transition-colors shadow-md">{isFlipped ? 'Show Question' : 'Show Answer'}</button>
        <button onClick={handleNext} disabled={currentIndex === cards.length - 1} className="p-4 rounded-full bg-white text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-30 shadow-sm border border-gray-100"><ChevronRight className="w-6 h-6" /></button>
      </div>
    </div>
  );
}

