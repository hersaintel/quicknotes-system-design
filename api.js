// QuickNotes API client
// Talks to the JSONPlaceholder practice API using GET, POST and DELETE.

// ---------- Settings ----------
const API_URL = "https://jsonplaceholder.typicode.com/posts";
const NOTES_LIMIT = 10;
const MAX_TITLE_LENGTH = 100;

// ---------- Page elements ----------
const loadBtn = document.getElementById("load-btn");
const statusMessage = document.getElementById("status");
const notesList = document.getElementById("notes-list");
const noteForm = document.getElementById("note-form");
const titleInput = document.getElementById("title-input");
const bodyInput = document.getElementById("body-input");
const submitBtn = document.getElementById("submit-btn");

// ---------- State ----------
// Each note on the page is { key, id, title, body, isLocal }.
let notes = [];
let busy = false; // true while any request is running
// "key" is unique on this page. "id" is the server's id. The practice server
// gives EVERY new note the same id (101), so the id alone cannot tell two
// new notes apart. That is why the page keeps its own key for each note.
let localCounter = 0;

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
  submitBtn.disabled = isBusy;
  for (const button of notesList.querySelectorAll(".delete-btn")) {
    button.disabled = isBusy;
  }
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

// POST: create a note
function createNote(note) {
  return request(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(note),
  });
}

// DELETE: remove one note by its server id
function deleteNote(id) {
  return request(`${API_URL}/${id}`, { method: "DELETE" });
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

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "delete-btn";
  deleteBtn.textContent = "Delete";
  deleteBtn.setAttribute("aria-label", `Delete note: ${note.title}`);
  deleteBtn.disabled = busy;
  deleteBtn.addEventListener("click", () => handleDelete(note));

  item.append(content, deleteBtn);
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

// ---------- POST: create a note ----------
// Returns an error message, or an empty string when the title is fine.
function validateTitle(title) {
  if (title === "") {
    return "Please enter a title for your note.";
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return `The title must be ${MAX_TITLE_LENGTH} characters or fewer (yours has ${title.length}).`;
  }
  return "";
}

async function handleSubmit(event) {
  event.preventDefault();
  if (busy) {
    return;
  }

  const title = titleInput.value.trim();
  const body = bodyInput.value.trim();

  const problem = validateTitle(title);
  if (problem !== "") {
    setStatus(problem, "error");
    titleInput.focus();
    return;
  }

  setBusy(true);
  setStatus("Creating note...", "loading");

  try {
    const { status, data } = await createNote({ title, body, userId: 1 });

    localCounter += 1;
    notes.unshift({
      key: `local-${localCounter}`,
      id: data.id,
      title: data.title,
      body: data.body,
      isLocal: true,
    });
    render();

    noteForm.reset();
    setStatus(`Note created (status ${status}, id ${data.id}).`, "success");
    titleInput.focus();
  } catch (error) {
    console.error(error);
    // The form is left as it was, so the user can simply try again.
    setStatus("Sorry, we could not create your note. Please try again.", "error");
  } finally {
    setBusy(false);
  }
}

// ---------- DELETE: remove a note ----------
// JSONPlaceholder is a practice server: it ACCEPTS new notes but never stores
// them. So a note we just created does not really exist on the server, and a
// DELETE for it may come back as 404 (not found).
// Our approach:
//   - Always send the DELETE request, so the page behaves like a real client.
//   - Only remove the note from the page when the server confirms it (any 2xx).
//   - For a note created on this page, treat a 404 as success too. Deleting
//     something that is already gone leaves the same end result, which is what
//     DELETE is meant to achieve, and we tell the user what happened.
//   - Any other error keeps the note on the page and shows an error message.
async function handleDelete(note) {
  if (busy) {
    return;
  }
  setBusy(true);
  setStatus(`Deleting note ${note.id}...`, "loading");

  try {
    let message;

    try {
      const { status } = await deleteNote(note.id);
      message = `Note ${note.id} deleted (status ${status}).`;
    } catch (error) {
      if (note.isLocal && error.status === 404) {
        message = `Note ${note.id} removed. The practice server never stored it, so there was nothing to delete there.`;
      } else {
        throw error;
      }
    }

    notes = notes.filter((item) => item.key !== note.key);
    render();
    setStatus(message, "success");
  } catch (error) {
    console.error(error);
    setStatus("Sorry, we could not delete that note. Please try again.", "error");
  } finally {
    setBusy(false);
  }
}

// ---------- Start ----------
loadBtn.addEventListener("click", loadNotes);
noteForm.addEventListener("submit", handleSubmit);
render();
