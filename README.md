# QuickNotes System Design

QuickNotes is a note-taking app that is moving from a browser-only app to a real online service for 1 million users. This repository has two halves. The first is a small **API client**, a web page that proves a front end can talk to an API by loading, creating and deleting notes on the JSONPlaceholder practice API. The second is a set of **design documents** that tell the backend team what to build: the REST API, the database tables, and the architecture that lets the service handle 1 million users reliably.

## What the API client does

- **Load notes (GET):** shows the first 10 notes from `https://jsonplaceholder.typicode.com/posts?_limit=10`.
- **Create a note (POST):** sends a new note to the server and adds the returned note to the top of the list. The title is required and can be at most 100 characters; the body is optional.
- **Delete a note (DELETE):** removes a note from the server and from the list.
- **Four clear states:** "Loading notes...", a success message, a friendly error message, and an empty-state message when there are no notes. Success and error messages have different colours.
- **Safe and tidy:** all buttons are disabled while a request is running, user text is shown with `textContent` only, and one reusable `request()` function checks `response.ok` and throws on errors.

> **A note about JSONPlaceholder:** it is a practice server, so it *pretends* to save changes. A note you create is never really stored (and every new note gets the id 101), and loading the notes again brings back the server's original 10. The comment above `handleDelete()` in `api.js` explains how the client handles this.

## How to run the API client

1. Download or clone this repository so that `index.html`, `api.js` and `style.css` are in the same folder.
2. Open the folder in VS Code and start the page with the **Live Server** extension (right-click `index.html` and choose **Open with Live Server**). You can also just double-click `index.html` to open it in a browser.
3. Make sure you are online, because the page talks to a server on the internet. There is nothing to install and no build step.
4. Try it: click **Load notes**, create a note with the form, delete a note, and try an empty or very long title to see the validation message.

## The design documents

- [API design](docs/api-design.md): the REST endpoints for the real QuickNotes service, with request and response examples and error codes.
- [Data model](docs/data-model.md): the `users`, `notes`, `tags` and `note_tags` tables, their relationships, the SQL, example queries, indexes, and the SQL versus NoSQL decision.
- [Architecture](docs/architecture.md): requirements, load estimates for 1 million users, the architecture diagram, request flows, trade-offs, and how single points of failure are avoided.

## Files

```
index.html          the page
api.js              GET, POST and DELETE requests, and the page logic
style.css           the styling
README.md           this file
docs/
  api-design.md     REST API design
  data-model.md     database design
  architecture.md   system architecture
```

## What I learned

- **`fetch` does not fail on error statuses.** A `404` or `500` is still a "successful" fetch, so a reusable `request()` function has to check `response.ok` and throw its own error. Then every GET, POST and DELETE can share one `try` / `catch` / `finally` pattern, and the buttons are always switched back on.
- **A practice API behaves differently from a real one.** JSONPlaceholder gives every new note the same id and never stores it, so I needed my own key for each note on the page and a sensible way to delete notes the server never saved.
- **Estimates show where the pressure is.** Working out about 116 reads and 12 writes per second (579 and 58 at peak) showed that the service is read-heavy, which is why the design uses a cache and a read replica rather than a more complicated way of scaling writes.
- **A many-to-many relationship needs a join table.** Notes and tags need `note_tags`, and an index such as `(user_id, created_at DESC)` should be chosen to match the most common query.
- **Every component solves one problem and adds a cost.** The cache and the queue make the service faster but can show slightly out-of-date data, so good design means stating the trade-offs and making sure nothing is a single point of failure.
