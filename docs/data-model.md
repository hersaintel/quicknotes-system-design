# QuickNotes Data Model

The service stores four kinds of things: **users**, their **notes**, their **tags**, and the links between notes and tags (**note_tags**). The SQL below is written for PostgreSQL.

## Entities

### `users`

| Column | Type | Key / rules | Notes |
|--------|------|-------------|-------|
| `id` | BIGINT | **Primary key** | Generated automatically. |
| `email` | VARCHAR(255) | NOT NULL, UNIQUE | Used to log in; two users cannot share one. |
| `password_hash` | VARCHAR(255) | NOT NULL | A hash of the password, never the password itself. |
| `display_name` | VARCHAR(100) | NOT NULL | |
| `created_at` | TIMESTAMPTZ | NOT NULL, default now | |

### `notes`

| Column | Type | Key / rules | Notes |
|--------|------|-------------|-------|
| `id` | BIGINT | **Primary key** | Generated automatically. |
| `user_id` | BIGINT | **Foreign key** to `users(id)`, NOT NULL | The owner of the note. |
| `title` | VARCHAR(100) | NOT NULL | Same 100-character limit as the API and the web page. |
| `body` | TEXT | | Optional. |
| `created_at` | TIMESTAMPTZ | NOT NULL, default now | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, default now | Set again on every edit. |

### `tags`

| Column | Type | Key / rules | Notes |
|--------|------|-------------|-------|
| `id` | BIGINT | **Primary key** | Generated automatically. |
| `user_id` | BIGINT | **Foreign key** to `users(id)`, NOT NULL | Tags belong to one user, so people never see each other's tags. |
| `name` | VARCHAR(50) | NOT NULL | For example `work`. Unique for each user. |

### `note_tags`

| Column | Type | Key / rules | Notes |
|--------|------|-------------|-------|
| `note_id` | BIGINT | **Foreign key** to `notes(id)`, part of the primary key | |
| `tag_id` | BIGINT | **Foreign key** to `tags(id)`, part of the primary key | |

The primary key is the pair (`note_id`, `tag_id`), which also stops the same tag being attached to the same note twice.

## Relationships

```
users 1 ---< N notes          one user has many notes
users 1 ---< N tags           one user has many tags
notes 1 ---< N note_tags      one note appears in many note_tags rows
tags  1 ---< N note_tags      one tag appears in many note_tags rows
```

- **One-to-many: users to notes.** One user writes many notes, but each note has exactly one owner. This is stored as `notes.user_id`.
- **One-to-many: users to tags.** One user creates many tags, and each tag belongs to one user (`tags.user_id`).
- **Many-to-many: notes and tags.** One note can have many tags (`work`, `urgent`), and one tag can be on many notes.
- **Why `note_tags` is needed:** a single column cannot hold a list, so there is nowhere to put "many tags" on a note or "many notes" on a tag without repeating rows or cramming values together. The join table turns the many-to-many link into two one-to-many links, with one row for every pairing of a note and a tag.
- **Deleting:** `ON DELETE CASCADE` means that deleting a user removes their notes and tags, and deleting a note or a tag removes the matching `note_tags` rows, so no orphaned rows are left behind.

## CREATE TABLE statements

```sql
CREATE TABLE users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  display_name  VARCHAR(100) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notes (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title      VARCHAR(100) NOT NULL CHECK (length(trim(title)) > 0),
  body       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tags (
  id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name    VARCHAR(50) NOT NULL,
  UNIQUE (user_id, name)
);

CREATE TABLE note_tags (
  note_id BIGINT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
  tag_id  BIGINT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);

CREATE INDEX idx_notes_user_created ON notes (user_id, created_at DESC);
CREATE INDEX idx_note_tags_tag_id ON note_tags (tag_id, note_id);
```

## Example queries

**1. A user's newest notes, one page at a time** (this is `GET /notes`):

```sql
SELECT id, title, created_at
FROM notes
WHERE user_id = 1
ORDER BY created_at DESC
LIMIT 20 OFFSET 0;
```

**2. A user's notes that have a given tag**, using a JOIN (this is `GET /notes?tag=work`):

```sql
SELECT n.id, n.title, t.name AS tag
FROM notes AS n
JOIN note_tags AS nt ON nt.note_id = n.id
JOIN tags AS t ON t.id = nt.tag_id
WHERE n.user_id = 1
  AND t.name = 'work'
ORDER BY n.created_at DESC;
```

**3. How many notes each of a user's tags is used on**, including tags nobody has used yet (this is a `LEFT JOIN` with `GROUP BY`, for `GET /tags`):

```sql
SELECT t.name, COUNT(nt.note_id) AS notes_with_tag
FROM tags AS t
LEFT JOIN note_tags AS nt ON nt.tag_id = t.id
WHERE t.user_id = 1
GROUP BY t.id, t.name
ORDER BY notes_with_tag DESC, t.name;
```

**4. Edit a note's title, only if it belongs to the user** (this is `PATCH /notes/{id}`; if no row is updated the API answers `403` or `404`):

```sql
UPDATE notes
SET title = 'Plan the Day 8 demo', updated_at = now()
WHERE id = 2 AND user_id = 1;
```

## Indexes

- **`idx_notes_user_created` on `notes (user_id, created_at DESC)`.** The most common request, listing "my newest notes", filters by `user_id` and sorts by date. With this index the database jumps straight to one user's notes and reads them already in order, instead of scanning every note of all 1 million users and then sorting them. Without it, the cost of the main screen would grow every time any user adds a note.
- **`idx_note_tags_tag_id` on `note_tags (tag_id, note_id)`.** The primary key (`note_id`, `tag_id`) is only fast when you start from a note. Filtering by tag starts from the tag, so this reversed index makes "all notes with this tag" (query 2) fast too.
- **The trade-off:** every index uses extra disk space and makes inserts slightly slower, so only indexes that match real queries are added. The primary keys and the unique rules (email, tag name per user) already create their own indexes.

## SQL or NoSQL?

I would choose **SQL (PostgreSQL)**. QuickNotes data is structured and connected: users own notes, notes have tags, and the most important requests, such as "this user's notes with this tag" or "how many notes use each tag", are exactly what `JOIN` and `GROUP BY` do well. The database itself can enforce the rules that must never break (unique emails, no duplicate tag on a note, no note without an owner), and a transaction lets us save a note and its tags together or not at all. The size also suits SQL: about 0.3 TB of new data a year and roughly 12 writes per second on average is comfortably handled by one primary database with read replicas, and sharding by `user_id` is possible much later if needed. A document database such as MongoDB would store a note with its tags inside it, which is simple and scales out easily, but renaming a tag, counting tag usage or finding every note with a tag would mean searching through or rewriting many documents, and the consistency rules would move into our application code. NoSQL can still help beside the main database, for example a search engine for full-text search or a key-value cache, but the core records belong in SQL.
