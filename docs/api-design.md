# QuickNotes API Design

This is the real API that the backend team should build for the online QuickNotes service. The web page in this repository only uses the JSONPlaceholder practice API to prove that a front end can talk to an API. Its `/posts` resource plays the part of this API's `/notes`.

- **Base URL:** `https://api.quicknotes.example/v1`
- **Format:** every request body and response body is JSON (`Content-Type: application/json`).
- **Authentication:** every endpoint except `POST /auth/login` needs the header `Authorization: Bearer <access_token>`. The token comes from the login endpoint.

## Design rules

- **Resources are plural nouns** (`/notes`, `/tags`), never verbs.
- **The HTTP method says what to do:** `GET` reads, `POST` creates, `PUT` replaces, `PATCH` changes part of a resource, and `DELETE` removes it.
- **The API is stateless.** Each request carries its own token and the server remembers nothing between requests, so any app server can answer any request.
- **The version is in the path** (`/v1`), so a future breaking change can be released as `/v2` without breaking old apps.
- **Standard status codes** tell the client what happened, and every error uses the same JSON shape.
- **Lists are paginated** so one request never returns an unlimited amount of data.
- **Users only see their own data.** A user can never read or change another user's notes.

## Endpoints

| # | Method | Path | Description | Success status |
|---|--------|------|-------------|----------------|
| 1 | `POST` | `/auth/login` | Log in with an email and password and receive an access token. | `200 OK` |
| 2 | `GET` | `/notes` | List the current user's notes, newest first (paginated; can filter by tag or search text). | `200 OK` |
| 3 | `GET` | `/notes/{id}` | Get one note by its id. | `200 OK` |
| 4 | `POST` | `/notes` | Create a new note. | `201 Created` |
| 5 | `PUT` | `/notes/{id}` | Replace a note completely (title, body and tags). | `200 OK` |
| 6 | `PATCH` | `/notes/{id}` | Change only some fields of a note, for example just the title. | `200 OK` |
| 7 | `DELETE` | `/notes/{id}` | Delete a note. | `204 No Content` |
| 8 | `GET` | `/tags` | List the current user's tags. | `200 OK` |
| 9 | `POST` | `/notes/{id}/tags` | Attach a tag to a note (the tag is created if it is new). | `201 Created` |
| 10 | `DELETE` | `/notes/{id}/tags/{tag_id}` | Remove a tag from a note. | `204 No Content` |

### Query parameters for `GET /notes`

- `page`: which page to return. Default `1`.
- `limit`: notes per page. Default `20`, maximum `50`.
- `tag`: only notes with this tag, for example `tag=work`.
- `q`: only notes whose title or body contains this text.
- `sort`: `-created_at` (newest first, the default) or `created_at` (oldest first).

## The note object

| Field | Type | Notes |
|-------|------|-------|
| `id` | number | Set by the server. |
| `title` | string | Required, 1 to 100 characters. |
| `body` | string | Optional. |
| `tags` | array of strings | Optional, for example `["work", "urgent"]`. |
| `created_at` | string | Date and time in ISO 8601, UTC. Set by the server. |
| `updated_at` | string | Changes every time the note is edited. |

## Example: create a note

**Request**

```http
POST /v1/notes
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json
```

```json
{
  "title": "Plan the Day 8 presentation",
  "body": "Cover the architecture diagram and the two trade-offs.",
  "tags": ["study", "presentation"]
}
```

**Response:** `201 Created`, with the header `Location: /v1/notes/1042`

```json
{
  "id": 1042,
  "title": "Plan the Day 8 presentation",
  "body": "Cover the architecture diagram and the two trade-offs.",
  "tags": ["study", "presentation"],
  "created_at": "2026-10-08T09:15:30Z",
  "updated_at": "2026-10-08T09:15:30Z"
}
```

## Example: list notes

**Request:** the first page of the user's notes tagged `study`, two per page.

```http
GET /v1/notes?page=1&limit=2&tag=study
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": 1042,
      "title": "Plan the Day 8 presentation",
      "body": "Cover the architecture diagram and the two trade-offs.",
      "tags": ["study", "presentation"],
      "created_at": "2026-10-08T09:15:30Z",
      "updated_at": "2026-10-08T09:15:30Z"
    },
    {
      "id": 1031,
      "title": "Revise SQL joins",
      "body": "",
      "tags": ["study"],
      "created_at": "2026-10-07T18:02:11Z",
      "updated_at": "2026-10-07T18:40:02Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 2,
    "total": 37,
    "total_pages": 19
  }
}
```

## Errors

When a request fails, the API returns the matching status code and a JSON body in this shape: a `code` that programs can check, a `message` that people can read, and optional `details`.

| Status | Name | When it happens |
|--------|------|-----------------|
| `400` | Bad Request | The request is invalid: a missing or too-long title, malformed JSON, or a bad query value such as `limit=500`. |
| `401` | Unauthorized | The access token is missing, invalid or expired, or the login password is wrong. |
| `403` | Forbidden | The token is valid, but the user is not allowed to do this, for example changing a note that belongs to someone else. |
| `404` | Not Found | The note or tag does not exist, or the path is wrong. |
| `500` | Internal Server Error | A bug or a failure on the server side, such as the database being unreachable. |
| `429` | Too Many Requests | The user sent too many requests in a short time (rate limiting protects the service). |

### 400 Bad Request

Example: `POST /v1/notes` with a title that is 140 characters long.

```json
{
  "error": {
    "code": "validation_error",
    "message": "The request body is not valid.",
    "details": [
      { "field": "title", "issue": "must be 100 characters or fewer" }
    ]
  }
}
```

### 401 Unauthorized

Example: `GET /v1/notes` with an expired token.

```json
{
  "error": {
    "code": "unauthorized",
    "message": "The access token is missing or has expired. Please log in again."
  }
}
```

### 403 Forbidden

Example: `DELETE /v1/notes/7` where note 7 belongs to a different user.

```json
{
  "error": {
    "code": "forbidden",
    "message": "You do not have permission to change this note."
  }
}
```

### 404 Not Found

Example: `GET /v1/notes/9999` when no note has that id.

```json
{
  "error": {
    "code": "not_found",
    "message": "No note with id 9999 exists."
  }
}
```

### 500 Internal Server Error

Example: any request while the database is down. The `request_id` lets the team find the failure in the logs.

```json
{
  "error": {
    "code": "internal_error",
    "message": "Something went wrong on our side. Please try again later.",
    "request_id": "req_8f3a2c"
  }
}
```

## Notes for the backend team

- `PUT` and `DELETE` are **idempotent**: sending the same request twice leaves the system in the same state. Deleting a note that is already gone returns `404`, and the QuickNotes client treats that as "already deleted".
- `POST` is not idempotent, so a retry could create a duplicate note. The client should only retry a `POST` if it is sure the first one failed.
- Some services return `404` instead of `403` for another user's note, so that outsiders cannot tell which ids exist. This design uses `403` so that the difference between "does not exist" and "not yours" is clear.
