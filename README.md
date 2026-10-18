# DriveCoach

**Full name:** Hodaya Fridland

DriveCoach turns each uploaded driving-lesson file into a decision about the
student (PASS / REVIEW / FAIL / INVALID), updates the student's progress through
their program, and keeps an auditable trail of every decision.

This submission implements **Level 1 (Required)**. The design was chosen so that
Levels 2 and 3 slot in without rework (see "Design choices for later levels").

---

## Architecture

```
  in-car box
      │ uploads <lesson>.csv
      ▼
  ┌──────────────────────────┐        ┌─────────────────────────────┐
  │  S3 bucket  (private,     │  s3:   │  Lambda: process-lesson      │
  │  SSE-encrypted)           │ Object │  (Node.js 20)                │
  │  incoming/<car>/<date>/.. │ Created│                              │
  │  config/rules_v1.json     │───────▶│  parse → metrics → rules     │
  └──────────────────────────┘        │  → replay student state      │
                                       └──────────────┬───────────────┘
                                                      │
                                                      ▼
                                       ┌─────────────────────────────┐
                                       │  DynamoDB (one table)        │
                                       │  SEED / STATE / LESSON / AUDIT│
                                       └─────────────────────────────┘
```

- **S3 (raw):** private, encrypted at rest. Lesson files land under `incoming/`;
  the versioned rules config lives under `config/`.
- **Lambda (process-lesson):** triggered by `s3:ObjectCreated`. It parses the
  file, computes the section-5 metrics, loads the rules from S3, and **replays**
  the student to produce the new state and audit records.
- **DynamoDB (one table, keyed by `pk`/`sk`):**
  | item   | pk              | sk                  | holds                                   |
  |--------|-----------------|---------------------|-----------------------------------------|
  | SEED   | `STUDENT#<id>`  | `SEED`              | immutable starting record (incl. PII)   |
  | STATE  | `STUDENT#<id>`  | `STATE`             | current computed state (no PII)         |
  | LESSON | `STUDENT#<id>`  | `LESSON#<lesson_id>`| per-lesson metrics (facts)              |
  | AUDIT  | `STUDENT#<id>`  | `AUDIT#<lesson_id>` | rules version, metrics, result, change  |

### Why "replay"?

On each new lesson we rebuild the student's state from their immutable SEED plus
all stored lessons, sorted by `started_at`. State is therefore a **pure function
of (seed, lessons, rules)**:

- order-independent — files can arrive in any order and still produce the right
  result (this already covers much of Level 2);
- idempotent — reprocessing a lesson never double-counts;
- explainable — re-running the rules over stored metrics reproduces any past
  decision, which is exactly what rules-versioning (Level 3) needs.

---

## Code layout

```
src/lib/parse.js      parse headers + CSV, normalize speed to km/h
src/lib/metrics.js    section-5 metrics, incl. event detection
src/lib/rules.js      data-driven rules engine (section 6)
src/lib/state.js      student state transitions + replay (section 7)
src/lib/config.js     load versioned rules from S3 (cached)
src/lib/ddb.js        DynamoDB helpers
src/lib/logger.js     structured logs that never emit PII
src/handlers/processLesson.js   the S3-triggered Lambda; wires the libs together
scripts/run_local.js  run the whole pipeline on sample data, no AWS
scripts/seed_students.js   load students.csv into DynamoDB
terraform/            all infrastructure (one table, one bucket, one Lambda, IAM)
test/                 unit tests for every pure module
```

The business logic is pure and AWS-free, so `npm run local` and the Lambda run
the **same** code. We verify correctness offline, then deploy.

---

## How to run

### Locally (no AWS, no cost)

```bash
npm install
npm test        # unit tests
npm run local   # full pipeline over sample_data; prints the results below
```

### On AWS

Prerequisites: AWS credentials configured, Terraform ≥ 1.5, Node 20.
**Before deploying, create an AWS Budget alert at $10** (as the assignment asks).

```bash
make deploy     # terraform init + apply  (one command)
make seed       # load students.csv into DynamoDB (run once)
make upload     # run scripts/upload_lessons.sh against the deployed bucket
make destroy    # tear everything down   (one command)
```

(On Windows without `make`, run the commands inside the Makefile directly.)

---

## Deployment

The stack is deployed live on AWS (region `us-east-1`) and verified end-to-end: the
sample files were uploaded to S3, processed by the Lambda, and the results read back
from DynamoDB match the local run exactly (see Results below).

Everything is defined as Infrastructure as Code in `terraform/` and comes up with
`make deploy` (and tears down with `make destroy`); `make seed` loads the students and
`make upload` runs the sample files through the live pipeline. Processing is
event-driven (S3 upload → Lambda), so there is no public endpoint to call at Level 1;
the authenticated instructor read API is Level 2.

## Results (Required item 8)

Produced by `npm run local` over the 16 sample files. One file (`L-1007_retry1`)
is a re-upload of `L-1007` and is de-duplicated, leaving 15 distinct lessons.

> These results were produced by the **live AWS deployment**: the sample files were
> uploaded to S3, processed by the Lambda, and read back from DynamoDB. They match the
> local run (`npm run local`) exactly. You can also reproduce them locally in ~30
> seconds with Node.js and no AWS account (see "How to run").

### Lesson results (in processing order)

| lesson  | student | type     | result  | score | over% | brake | accel | turn |
|---------|---------|----------|---------|-------|-------|-------|-------|------|
| L-1001  | S-001   | REGULAR  | PASS    | 90.44 | 0.78  | 1     | 1     | 0    |
| L-1004  | S-002   | REGULAR  | PASS    | 91.74 | 0.63  | 0     | 1     | 1    |
| L-1009  | S-003   | REGULAR  | REVIEW  | 68.61 | 9.69  | 1     | 1     | 1    |
| L-1012  | S-004   | REGULAR  | REVIEW  | 65.29 | 1.85  | 3     | 4     | 1    |
| L-1002  | S-001   | REGULAR  | PASS    | 88.19 | 0.91  | 0     | 2     | 1    |
| L-1005  | S-002   | REGULAR  | REVIEW  | 72.00 | 0.50  | 4     | 1     | 1    |
| L-1010  | S-003   | PRACTICE | FAIL    | 34.91 | 22.55 | 2     | 2     | 1    |
| L-1013  | S-004   | PRACTICE | PASS    | 86.77 | 0.62  | 1     | 1     | 1    |
| L-1006  | S-002   | PRACTICE | PASS    | 91.42 | 0.29  | 1     | 1     | 0    |
| L-1003  | S-001   | REGULAR  | PASS    | 90.57 | 0.22  | 1     | 0     | 1    |
| L-1007  | S-002   | REGULAR  | REVIEW  | 60.72 | 8.14  | 1     | 2     | 3    |
| L-1014  | S-004   | REGULAR  | INVALID | 13.77 | 19.62 | 6     | 3     | 2    |
| L-1008  | S-002   | PRACTICE | PASS    | 91.83 | 0.58  | 0     | 1     | 1    |
| L-1011  | S-003   | REGULAR  | PASS    | 90.52 | 0.74  | 1     | 1     | 0    |
| L-1015  | S-004   | REGULAR  | FAIL    | 49.91 | 1.04  | 6     | 2     | 3    |

### Final student state

| student | program  | completed | reviews | next    | status            | final_score |
|---------|----------|-----------|---------|---------|-------------------|-------------|
| S-001   | STANDARD | 12        | 0       | REGULAR | COMPLETED         | 89.73       |
| S-002   | STANDARD | 5         | 2       | REGULAR | ACTIVE            | –           |
| S-003   | EXTENDED | 7         | 0       | REGULAR | ACTIVE            | –           |
| S-004   | EXTENDED | 10        | 2       | REGULAR | INSTRUCTOR_REVIEW | –           |

Notable paths: **S-001** reaches 12 completed REGULAR passes and completes with
`final_score` = mean of its three pass scores. **S-003** fails in STANDARD and
moves to EXTENDED (review count reset). **S-004** gets an INVALID (8-min lesson,
below the 15-min minimum) and later a FAIL in EXTENDED, landing in
INSTRUCTOR_REVIEW.

---

## Security

- **S3 is private and encrypted** (SSE-S3); all public access is blocked.
- **Least-privilege IAM:** the Lambda role may only `GetObject` on the bucket,
  the four DynamoDB actions it uses on the one table, and write its own logs.
- **No secrets in the repo** (see starter-kit fixes below).
- **PII protection:** personal data (name, national id, DOB, phone, email) lives
  only in the encrypted SEED item. STATE and AUDIT items carry logic fields only,
  and the logger strips any PII-looking field so it can never reach CloudWatch.

---

## What we changed in the inherited starter kit

The starter `terraform/` was "a quick demo from the previous engineer" and had
three serious problems, all fixed here:

1. **World-readable S3 bucket** — public access block was disabled and the bucket
   policy allowed `s3:GetObject` to `Principal: "*"`. For a bucket holding files
   tied to personal data this is a data breach. → All public access blocked, the
   public policy removed, SSE encryption added.
2. **Wildcard IAM** — the Lambda role allowed `Action: "*"` on `Resource: "*"`.
   → Replaced with a least-privilege policy scoped to the exact S3/DynamoDB/Logs
   actions needed.
3. **Secret committed to the repo** — a real-looking `instructor_api_key` default
   in `variables.tf`, stored as a plain-text SSM `String`. → Removed. The
   instructor API is Level 2; its secret will be supplied at deploy time and
   stored as an SSM `SecureString`, never committed.

We also added the missing pieces the demo lacked: the DynamoDB table, the
processing Lambda + S3 trigger, the versioned rules object, a scoped log group,
and `make deploy` / `make destroy`.

---

## Assumptions

- **Speed units:** 3 of 16 files report `mph`; everything downstream uses km/h,
  so the parser converts `speed` to `speed_kmh` once (mph × 1.609344).
- **Retries:** a lesson is identified by `lesson_id`; a re-upload (e.g.
  `L-1007_retry1`) is the same lesson and the latest upload wins.
- **Events (section 5):** "15 consecutive samples" is tested on raw consecutive
  runs; runs shorter than 15 are ignored, and two qualifying runs less than 50
  samples apart count as one event.
- **`final_score`** averages only the REGULAR lessons that passed *in our system*
  (prior `lessons_completed` from the CSV has no score we could average).
- **FAIL/INVALID** leave `next_lesson_type` unchanged (section 7 specifies the
  next type only for PASS → REGULAR and REVIEW → PRACTICE).
- **Ordering at L1:** the sample uploader spaces files 5s apart, so there is no
  real concurrency. Replay already handles out-of-order arrival; concurrency-safe
  processing (FIFO/conditional writes) is deferred to Level 2.

---

## Design choices that make later levels easy

- **Replay** → out-of-order and late files are already correct (L2).
- **Rules loaded from a versioned S3 object**, active version in an env var →
  switching to rules v2 is a config change, and past decisions stay reproducible
  (L3).
- **Pure, tested core** → a read API (L2) or an Elixir rules engine (bonus) can
  reuse the same logic/contracts.

## What I'd do with another week

- Level 2: SQS FIFO per `student_id` for concurrency-safe ordering, a dead-letter
  queue with a replay script, a CloudWatch alarm on Lambda errors, and the
  authenticated instructor read API (`GET /students/{id}`, `GET /lessons/{id}`).
- Level 3: a `rules/active` pointer so v2 can be rolled out (and rolled back)
  without redeploying, plus an instructor-facing "trend per student" view.
- A small integration test against LocalStack in CI.
```
