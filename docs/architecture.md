# QuickNotes Architecture

QuickNotes is moving from a browser-only app to an online service for **1 million users**. This document sets out what the service must do, how much load to expect, and the architecture the backend team should build. The API itself is described in [api-design.md](api-design.md) and the tables in [data-model.md](data-model.md).

## 1. Requirements

### Functional requirements

What the service must do:

- Users can register and log in.
- Users can create, read, edit and delete their own notes.
- Users can list their notes, newest first, one page at a time.
- Users can add tags to notes and filter their notes by tag.
- Users can search their notes by text.
- A user's notes are available on every device they log in from.
- Users can only see and change their own notes.

### Non-functional requirements

How well the service must do it:

- **Availability:** 99.9% uptime, which allows about 8.8 hours of downtime in a year. One failed server or one failed data-centre zone must not take the service down.
- **Performance:** 95% of note-list requests answered in under 300 ms.
- **Scalability:** handle 1 million users today, handle peaks of 5 times the average load, and be able to grow 10 times without a redesign.
- **Durability:** a note that the service has confirmed (`201 Created`) is never lost, even if a server fails.
- **Consistency:** a user sees their own changes immediately, and their other devices see them within a few seconds.
- **Security:** all traffic over HTTPS, passwords stored only as hashes, every request checked for a valid token, and users kept apart from each other.
- **Operability:** health checks, logs and alerts, so that the team knows about a problem before the users do.

## 2. Load estimate for 1 million users

**Assumptions** (my own, chosen to be realistic for a notes app):

- 1,000,000 registered users, of whom 20% are active on a given day, so **200,000 daily active users**.
- Each active user makes **50 read requests a day** (opening the app, listing and viewing notes) and **5 write requests a day** (2 of them create a new note; the others are edits, deletes and tag changes).
- Traffic is spread over 24 hours (86,400 seconds), and the busiest moments are **5 times** the average.
- An average stored note takes **2 KB** (title, body, dates, ids). Indexes and tag links add about 50% on top.
- The cache answers about 80% of read requests.

| Measure | Working | Average | Peak (5×) |
|---------|---------|---------|-----------|
| **Reads per second** | 200,000 × 50 = 10,000,000 a day ÷ 86,400 | about **116 / s** | about **579 / s** |
| **Writes per second** | 200,000 × 5 = 1,000,000 a day ÷ 86,400 | about **12 / s** | about **58 / s** |
| **Reads reaching the database** (20% cache misses) | 116 × 20% and 579 × 20% | about 23 / s | about 116 / s |

**Storage per year**

- New notes: 200,000 users × 2 notes = 400,000 a day, which is about 146 million a year.
- Raw size: 400,000 × 2 KB = 0.8 GB a day, so **about 292 GB a year**.
- With indexes and tag links (× 1.5): **about 440 GB a year**. The read replica holds a second copy, so the total disk space is about twice that.

**What this tells us**

- The service is **read-heavy**: there are about 10 reads for every write.
- The numbers are small enough for one primary database. About 58 writes per second at peak is far below what a single PostgreSQL server can handle, so the real design pressure comes from availability and reads, not from write volume.

## 3. Architecture diagram

```
                             +-----------------+          +-----------+
                             |      Client     |<-lookup->|    DNS    |
                             +-----------------+          +-----------+
                                      | HTTPS requests
                                      v
                             +-----------------+
                             |       CDN       |
                             +-----------------+
                                      | API calls pass through
                                      v
                             +-----------------+
                             |  Load balancer  |
                             +-----------------+
                                      |
                    +-----------------+-----------------+
                    |                                   |
                    v                                   v
           +-----------------+                 +-----------------+
           |   App server 1  |                 |   App server 2  |
           |     (zone A)    |                 |     (zone B)    |
           +-----------------+                 +-----------------+
                    |                                   |
                    +-----------------+-----------------+
                                      | reads, writes, jobs
          +---------------------------+---------------------------+
          |                           |                           |
          v                           v                           v
 +-----------------+          +---------------+        +---------------------+
 |      Cache      |          |   DB primary  |        |        Queue        |
 |(Redis + replica)|          |    (zone A)   |        |(replicated, managed)|
 +-----------------+          +---------------+        +---------------------+
                                      | replication               |
                                      v                           v
                              +---------------+        +---------------------+
                              |  Read replica |        |  Worker (2+ copies) |
                              |    (zone B)   |        |(search, push, email)|
                              +---------------+        +---------------------+
```

- The CDN serves the web page's own files (HTML, CSS and JavaScript). Requests for the API pass straight through it.
- App servers **write** to the DB primary, and **read** through the cache first and then from the read replica.
- The app servers put jobs on the queue and the worker takes them off.

## 4. What each component does

- **Client:** it is the web page or app that people use, and it solves the need for a friendly screen by showing notes and sending the user's actions to the API.
- **DNS:** it solves the problem of finding the service by turning the name `api.quicknotes.example` into the address of the servers, and it can send people to a healthy location if one fails.
- **CDN:** it solves slow page loads for faraway users by keeping copies of the page's static files at locations close to them, so those files never have to reach our servers.
- **Load balancer:** it solves the problem of one server being overloaded or failing by sharing requests across the app servers and skipping any that fail their health check.
- **App servers (two or more):** they solve the need to run the QuickNotes logic (login, validation, notes and tags), and because they keep no data of their own we can simply add more of them as traffic grows.
- **Cache:** it solves the repeated cost of asking the database for the same note lists by keeping recent answers in fast memory, which gives quicker replies and a lighter database.
- **Primary database:** it solves the need for one trusted, consistent copy of all users, notes and tags by being the only place where writes happen.
- **Read replica:** it solves the problem of reads competing with writes by holding a live copy of the data that handles read queries, and it can take over if the primary fails.
- **Queue:** it solves the problem of slow side tasks holding up the user by accepting a job straight away and keeping it safe until a worker is ready.
- **Worker:** it solves the need to do slow background jobs, such as updating the search index and sending sync notifications to the user's other devices, without making the user wait.

## 5. Request flows

### `GET /notes`: list a user's notes

1. The client sends `GET /v1/notes?page=1&limit=20` with the user's access token.
2. **DNS** turns `api.quicknotes.example` into an address (the answer is cached by the browser after the first time).
3. The request arrives at the **CDN**. API answers are private to each user, so the CDN does not cache them and forwards the request on.
4. The **load balancer** picks a healthy app server.
5. The **app server** checks the token's signature and expiry (no database call is needed) and learns the user's id. A bad token gets `401`, and a bad parameter such as `limit=500` gets `400`.
6. The app server builds a cache key from the user's id, the page and the user's "notes version" number, then asks the **cache**.
7. **Cache hit** (about 80% of requests): the stored JSON is returned straight away with `200 OK`.
8. **Cache miss:** the app server runs the "newest notes" query on the **read replica**. If the user saved a change in the last few seconds, it uses the **primary** instead, so the user always sees their own latest changes.
9. The app server stores the result in the cache for 60 seconds and returns it with `200 OK`.
10. The client draws the list.

### `POST /notes`: create a note

1. The client sends `POST /v1/notes` with the token and a JSON body such as `{"title": "...", "body": "...", "tags": [...]}`. DNS, the CDN and the load balancer pass it to an **app server** as above.
2. The app server checks the token (`401` if bad) and validates the body: the title must be present and at most 100 characters (`400` if not).
3. The app server opens a **transaction on the primary database**. It inserts the note with the user's id taken from the token (never from the request body), then inserts or finds the tags and the `note_tags` links, and commits. The note is now durable.
4. The app server **updates the cache**. It raises the user's "notes version" number so that old cached lists are no longer used, and it sets a 5-second "recent write" marker so the next reads go to the primary.
5. The app server **publishes a `note.created` message** to the **queue**. The note is already safely stored, so if publishing fails it is retried and the note is never lost.
6. The app server returns `201 Created` with a `Location` header and the new note as JSON. The user does not wait for step 7.
7. Later, a **worker** takes the message from the queue, updates the search index and sends a sync notification to the user's other devices. If the job fails, it is retried a few times and then moved to a "failed jobs" list and an alert is raised.
8. Meanwhile, the **read replica** receives the change from the primary within moments.

## 6. Trade-offs

- **Fast reads versus fresh data (cache and read replica).**
  - We gain quick answers and a database that is not overloaded.
  - We give up perfect freshness: another device can see a list that is up to 60 seconds old, and the replica can lag the primary slightly.
  - We reduce the pain with the "recent write" marker, so a user always sees their own changes at once. Seeing a note a few seconds late is acceptable for a notes app, but it would not be for something like a bank balance.
- **Quick responses versus extra complexity (queue and worker).**
  - We gain fast `201` replies and a way to scale slow jobs separately.
  - We give up simplicity: there are more parts to run and watch, search results can be a few seconds behind, and a job may be delivered twice, so workers must be written so that repeating a job is harmless.
- **Simple, consistent data versus unlimited write scaling (one SQL primary).**
  - A single primary keeps transactions and rules simple and strictly correct.
  - It has a ceiling on writes. At 58 writes per second at peak we are far below it, and if the service grows 10 times we can first use a bigger server and later split the data by `user_id`.
- **Reliability versus cost (running in two zones).**
  - Every important part exists twice, so the service survives a zone failure.
  - It costs roughly double the servers and storage, and it needs more careful operation. For a service people depend on for their notes, we think this is worth paying for.

## 7. Avoiding single points of failure

A single point of failure is any part that, if it stopped, would stop the whole service. Each part below has a plan.

| Component | If it fails | How the single point of failure is avoided |
|-----------|-------------|--------------------------------------------|
| DNS | Nobody can find the service. | Use a managed DNS provider with name servers in many places, plus health-checked records that can point to another location. |
| CDN | Static files are not delivered. | A CDN already runs in many locations, so traffic moves to another one. The page files can also be served from the origin. |
| Load balancer | No requests reach the app servers. | Use a managed load balancer that runs in both zones behind one address, so it has no single machine to lose. |
| App servers | Some or all of the logic is unavailable. | Run at least two, in different zones, with no data stored on them. The load balancer skips a failed one, and more can be added automatically at busy times. |
| Cache | Reads become slower. | Use a cache cluster with a replica. If the whole cache is lost, requests fall back to the read replica, which is slower but still works, and the cache refills itself. |
| Primary database | Writes stop. | A standby copy in another zone is promoted automatically (failover), and the app servers switch to it. Daily backups and point-in-time recovery protect against data corruption. |
| Read replica | Cache misses lose their source. | Reads can fall back to the primary, and a second replica can be added. |
| Queue | Background jobs are lost. | Use a managed, replicated queue that stores messages in several zones until a worker confirms them. |
| Worker | Background jobs pile up. | Run two or more workers. If one dies in the middle of a job, the message becomes visible again and another worker takes it. |
| A whole zone | Half of everything is gone. | Everything important runs in two zones, so the other zone carries on. Backups are also copied to a second region in case a whole region is lost. |
