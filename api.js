// QuickNotes API client
// Talks to the JSONPlaceholder practice API using GET, POST and DELETE.

// ---------- Settings ----------
const API_URL = "https://jsonplaceholder.typicode.com/posts";
const NOTES_LIMIT = 10;

// ---------- Page elements ----------
const loadBtn = document.getElementById("load-btn");
const statusMessage = document.getElementById("status");
const notesList = document.getElementById("notes-list");

// ---------- State ----------
// Each note on the page is { key, id, title, body, isLocal }.
let notes = [];
let busy = false; // true while any request is running

// ---------- Status messages ----------
// type is "loading", "success" or "error". Each one has its own look in style.css.
function setStatus(message, type) {
  statusMessage.textContent = message;
  statusMessage.className = type ? `status ${type}` : "status";
}

// Turns every button off while a request runs, and back on afterwards,
// so the user cannot start a second request by clicking twice.
function setBusy(isBusy) {
  busy = isBusy;
  loadBtn.disabled = isBusy;
}

// ---------- The one reusable request function ----------
class HttpError extends Error {
  constructor(status) {
    super(`Request failed with status ${status}`);
    this.name = "HttpError";
    this.status = status;
  }
}

// Sends any request, throws if the server answers with an error status,
// and returns { status, data } when it works.
async function request(url, options = {}) {
  const response = await fetch(url, options);

  if (!response.ok) {
    throw new HttpError(response.status);
  }

  const data = response.status === 204 ? null : await response.json();
  return { status: response.status, data };
}

// ---------- The API calls ----------
// GET: the first 10 notes
async function getNotes() {
  const { data } = await request(`${API_URL}?_limit=${NOTES_LIMIT}`);
  return data;
}

// ---------- Drawing the list ----------
// User text only ever goes onto the page with textContent, so typed HTML stays plain text.
function createNoteElement(note) {
  const item = document.createElement("li");
  item.className = "note-card";

  const content = document.createElement("div");
  content.className = "note-content";

  const title = document.createElement("h3");
  title.className = "note-title";
  title.textContent = note.title;
  content.appendChild(title);

  if (note.body) {
    const body = document.createElement("p");
    body.className = "note-body";
    body.textContent = note.body;
    content.appendChild(body);
  }

  const meta = document.createElement("p");
  meta.className = "note-meta";
  meta.textContent = note.isLocal ? `Note #${note.id} (new)` : `Note #${note.id}`;
  content.appendChild(meta);
  item.append(content);
  return item;
}

// Rebuilds the whole list from the notes array.
function render() {
  notesList.replaceChildren();

  // Empty state
  if (notes.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-message";
    empty.textContent = "No notes to show yet. Click “Load notes” to get started.";
    notesList.appendChild(empty);
    return;
  }

  for (const note of notes) {
    notesList.appendChild(createNoteElement(note));
  }
}

function countText(count) {
  return `${count} ${count === 1 ? "note" : "notes"}`;
}

// ---------- GET: load notes ----------
async function loadNotes() {
  if (busy) {
    return;
  }
  setBusy(true);
  setStatus("Loading notes...", "loading");

  try {
    const loaded = await getNotes();
    notes = loaded.map((note) => ({
      key: `server-${note.id}`,
      id: note.id,
      title: note.title,
      body: note.body,
      isLocal: false,
    }));
    render();

    if (notes.length === 0) {
      setStatus("The server has no notes yet.", "success");
    } else {
      setStatus(`Loaded ${countText(notes.length)} from the server.`, "success");
    }
  } catch (error) {
    console.error(error);
    setStatus("Sorry, we could not load your notes. Please check your connection and try again.", "error");
  } finally {
    setBusy(false);
  }
}

// ---------- Start ----------
loadBtn.addEventListener("click", loadNotes);
render();
