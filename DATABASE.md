# Database

This document describes the MongoDB data models, schemas, collections, and persistence layer used by AI Interviewer.

## Overview

MongoDB is **optional** but **recommended** for the AI Interviewer system. The application gracefully degrades without it:

| Feature | With MongoDB | Without MongoDB |
|---------|--------------|-----------------|
| User accounts | ✅ Enabled | ❌ Disabled (503 on auth endpoints) |
| Interview history | ✅ Saved | ❌ Lost on server restart |
| Question cache | ✅ Persisted | ❌ In-memory only |
| Voice interviews | ✅ Saved | ✅ Still work (ephemeral) |
| Text interviews | ✅ Saved | ✅ Still work (ephemeral) |

For development, MongoDB is optional. For production with user accounts, MongoDB is required.

## Connection

### Local MongoDB

```javascript
// from backend/config.js
mongoUri: process.env.MONGO_URI || ''
```

**Development default** (no connection):
```
MONGO_URI=mongodb://127.0.0.1:27017/ai-interviewer
```

**MongoDB Atlas** (cloud):
```
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/ai-interviewer?retryWrites=true&w=majority
```

See [SETUP.md - Database Setup](./SETUP.md#4-database-setup-optional-but-recommended) for detailed connection instructions.

### Connection Behavior

From `backend/db.js` (`backend/db.js:8-24`):

```javascript
async function connectDB() {
  if (!config.mongoUri) {
    console.warn('MONGO_URI is not set. Running without database persistence.');
    return null;
  }
  try {
    await mongoose.connect(config.mongoUri, {
      serverSelectionTimeoutMS: 20000,
    });
    console.log('MongoDB connected.');
    return mongoose.connection;
  } catch (err) {
    console.warn('MongoDB connection failed:', err.message);
    console.warn('Continuing without database persistence.');
    return null;
  }
}
```

**Key points**:
- Server startup continues even if MongoDB is unavailable
- Connection timeout: 20 seconds
- Graceful fallback if connection fails
- Non-blocking: async connection doesn't delay startup

## Collections

Three collections are created automatically by Mongoose:

| Collection | Model | Purpose |
|-----------|-------|---------|
| `users` | User | User accounts, authentication, verification |
| `interviewsessions` | InterviewSession | Interview sessions, questions, answers, evaluation |
| `questions` | Question | Question cache for efficient retrieval |

## Schema: User

**Location**: `backend/models/User.js`

**Collection**: `users`

### Structure

```javascript
{
  _id: ObjectId (auto-generated),
  email: String (required, unique, lowercase),
  name: String,
  passwordHash: String (required, bcryptjs hash),
  emailVerified: Boolean (default: false),
  verificationCode: String or null,
  verificationExpires: Date or null,
  resetCode: String or null,
  resetExpires: Date or null,
  resetVerified: Boolean (default: false),
  createdAt: Date (auto),
  updatedAt: Date (auto)
}
```

### Field Descriptions

| Field | Type | Constraints | Purpose |
|-------|------|-----------|---------|
| `_id` | ObjectId | Auto-generated | Unique user identifier |
| `email` | String | Required, unique, lowercase, trimmed | User's login email |
| `name` | String | 0-80 chars (validated) | User's display name |
| `passwordHash` | String | Required (bcryptjs) | Hashed password (never plain text) |
| `emailVerified` | Boolean | Default: false | Whether email has been verified |
| `verificationCode` | String | 6 digits or null | OTP for email verification |
| `verificationExpires` | Date | 10 minutes from generation | When verification code expires |
| `resetCode` | String | 6 digits or null | OTP for password reset |
| `resetExpires` | Date | 10 minutes from generation | When reset code expires |
| `resetVerified` | Boolean | Default: false | Whether reset code was verified |
| `createdAt` | Date | Auto (Mongoose) | Account creation timestamp |
| `updatedAt` | Date | Auto (Mongoose) | Last modification timestamp |

### Indices

**Unique constraint**:
```javascript
email: { unique: true, lowercase: true }
```

**Query performance**: Email lookups are instant (unique index)

### Example Document

```json
{
  "_id": {
    "$oid": "507f1f77bcf86cd799439011"
  },
  "email": "jane@example.com",
  "name": "Jane Smith",
  "passwordHash": "$2a$10$p.2PSNjlgvWsZ3sLvLm7X.qL7WqGXHqY...",
  "emailVerified": true,
  "verificationCode": null,
  "verificationExpires": null,
  "resetCode": null,
  "resetExpires": null,
  "resetVerified": false,
  "createdAt": {
    "$date": "2024-01-15T10:30:00.000Z"
  },
  "updatedAt": {
    "$date": "2024-01-15T10:35:00.000Z"
  }
}
```

---

## Schema: InterviewSession

**Location**: `backend/models/Session.js`

**Collection**: `interviewsessions`

**Size per document**: Typically 5-50 KB depending on number of questions and answer length

### Structure

```javascript
{
  _id: String (UUID),
  user: ObjectId or null,
  mode: String (enum: 'text', 'voice'),
  config: {
    position: String,
    customPosition: String,
    interviewType: String,
    difficulty: String,
    questionCount: Number
  },
  status: String (default: 'in_progress'),
  startedAt: Date or null,
  completedAt: Date or null,
  questions: [
    {
      number: Number,
      text: String,
      isFollowUp: Boolean,
      difficulty: String,
      source: String (default: 'generated')
    }
  ],
  answers: [
    {
      questionNumber: Number,
      answer: String,
      wordCount: Number,
      elapsedMs: Number,
      difficulty: String,
      eval: { /* Evaluation schema */ }
    }
  ],
  transcript: [
    {
      role: String ('interviewer' or 'candidate'),
      text: String
    }
  ],
  evaluation: { /* Evaluation schema */ },
  stats: Mixed or null,
  questionTiming: [Mixed],
  createdAt: Date (auto),
  updatedAt: Date (auto)
}
```

### Field Descriptions

| Field | Type | Purpose |
|-------|------|---------|
| `_id` | String (UUID) | Interview session ID (generated by app, not MongoDB) |
| `user` | ObjectId or null | Reference to User._id (null for anonymous sessions) |
| `mode` | String | Interview mode: `'text'` (REST-based) or `'voice'` (WebSocket) |
| `config.position` | String | Job position (e.g., "Software Engineer") |
| `config.customPosition` | String | Custom position if not in predefined list |
| `config.interviewType` | String | Type: `'behavioral'`, `'technical'`, or `'mixed'` |
| `config.difficulty` | String | Difficulty level: `'beginner'`, `'intermediate'`, `'advanced'` |
| `config.questionCount` | Number | Planned number of questions (1-10) |
| `status` | String | `'in_progress'` or `'completed'` |
| `startedAt` | Date or null | When first question was asked (null until started) |
| `completedAt` | Date or null | When interview was finalized (null until complete) |
| `questions` | Array | Questions asked in this interview |
| `questions[].number` | Number | Question sequence number (1-indexed) |
| `questions[].text` | String | Full question text |
| `questions[].isFollowUp` | Boolean | Whether this is a follow-up question |
| `questions[].difficulty` | String | Difficulty assigned to this question |
| `questions[].source` | String | How question was obtained (`'generated'` or `'cached'`) |
| `answers` | Array | Answers provided by the candidate |
| `answers[].questionNumber` | Number | Which question this answers |
| `answers[].answer` | String | Full answer text |
| `answers[].wordCount` | Number | Number of words in answer |
| `answers[].elapsedMs` | Number | Milliseconds spent on this answer |
| `answers[].difficulty` | String | Difficulty of the question |
| `answers[].eval` | Evaluation | Evaluation scores for this answer |
| `transcript` | Array | Full conversation transcript for reference |
| `evaluation` | Evaluation | Final overall evaluation and scores |
| `stats` | Mixed | Custom statistics (implementation-specific) |
| `questionTiming` | Array | Timing data for each question (for analysis) |
| `createdAt` | Date | Session creation timestamp |
| `updatedAt` | Date | Last modification timestamp |

### Evaluation Schema

Used in `answers[].eval` and `evaluation` fields:

```javascript
{
  technical: Number (0-10),
  problemSolving: Number (0-10),
  communication: Number (0-10),
  clarity: Number (0-10),
  confidence: Number (0-10),
  adaptability: Number (0-10),
  note: String,
  suggestions: [String],
  overall: Number (0-10)
}
```

| Field | Type | Range | Purpose |
|-------|------|-------|---------|
| `technical` | Number | 0-10 | Technical knowledge and accuracy |
| `problemSolving` | Number | 0-10 | Problem-solving approach and logic |
| `communication` | Number | 0-10 | Ability to articulate ideas clearly |
| `clarity` | Number | 0-10 | Clarity and organization of response |
| `confidence` | Number | 0-10 | Confidence demonstrated during interview |
| `adaptability` | Number | 0-10 | Ability to adjust to feedback or new questions |
| `note` | String | Any length | Summary of interview performance |
| `suggestions` | Array of Strings | Any length | Actionable improvement suggestions |
| `overall` | Number | 0-10 | Average overall score |

### Indices

**Primary query pattern** (`backend/models/Session.js:60`):

```javascript
sessionSchema.index({ user: 1, createdAt: -1 });
```

This index optimizes:
- `GET /api/me/sessions` - List user's interviews by user + date
- **Query**: `db.interviewsessions.find({ user: userId }).sort({ createdAt: -1 })`
- **Performance**: O(log n) with index vs O(n) without

### Example Document

```json
{
  "_id": "interview-uuid-123",
  "user": {
    "$oid": "507f1f77bcf86cd799439011"
  },
  "mode": "text",
  "config": {
    "position": "Frontend Engineer",
    "customPosition": "",
    "interviewType": "technical",
    "difficulty": "intermediate",
    "questionCount": 3
  },
  "status": "completed",
  "startedAt": {
    "$date": "2024-01-15T10:30:30.000Z"
  },
  "completedAt": {
    "$date": "2024-01-15T10:45:00.000Z"
  },
  "questions": [
    {
      "number": 1,
      "text": "Tell me about your most recent project. What was your role?",
      "isFollowUp": false,
      "difficulty": "intermediate",
      "source": "generated"
    },
    {
      "number": 2,
      "text": "What was the most challenging part of that project?",
      "isFollowUp": true,
      "difficulty": "intermediate",
      "source": "generated"
    }
  ],
  "answers": [
    {
      "questionNumber": 1,
      "answer": "I led a team of 3 engineers on a React-based dashboard...",
      "wordCount": 145,
      "elapsedMs": 45000,
      "difficulty": "intermediate",
      "eval": {
        "technical": 7.5,
        "communication": 8,
        "problemSolving": 7.8,
        "clarity": 8.2,
        "confidence": 7.5,
        "adaptability": 7.8,
        "note": "Good project overview with clear explanations.",
        "suggestions": ["Provide more specific metrics about project impact"]
      }
    }
  ],
  "transcript": [
    {
      "role": "interviewer",
      "text": "Tell me about your most recent project..."
    },
    {
      "role": "candidate",
      "text": "I led a team of 3 engineers on a React-based dashboard..."
    }
  ],
  "evaluation": {
    "technical": 7.6,
    "problemSolving": 7.5,
    "communication": 8.1,
    "clarity": 8.0,
    "confidence": 7.6,
    "adaptability": 7.8,
    "note": "Strong technical fundamentals with good communication skills.",
    "suggestions": [
      "Study advanced system design patterns",
      "Practice explaining complex architectures",
      "Work on handling edge cases in solutions"
    ],
    "overall": 7.77
  },
  "stats": null,
  "questionTiming": [],
  "createdAt": {
    "$date": "2024-01-15T10:30:00.000Z"
  },
  "updatedAt": {
    "$date": "2024-01-15T10:45:00.000Z"
  }
}
```

---

## Schema: Question

**Location**: `backend/models/Question.js`

**Collection**: `questions`

**Purpose**: Cache of pre-written interview questions for faster retrieval

### Structure

```javascript
{
  _id: ObjectId (auto-generated),
  position: String (required),
  customPosition: String,
  interviewType: String (enum: 'behavioral', 'technical', 'mixed'),
  difficulty: String (enum: 'beginner', 'intermediate', 'advanced'),
  text: String (required),
  isFollowUp: Boolean (default: false),
  quality: Number (0-10, default: 0),
  uses: Number (default: 1),
  selectedCount: Number (default: 0),
  createdBy: ObjectId or null,
  createdAt: Date (auto),
  updatedAt: Date (auto)
}
```

### Field Descriptions

| Field | Type | Purpose |
|-------|------|---------|
| `_id` | ObjectId | Unique question identifier |
| `position` | String | Job position this question targets (e.g., "Backend Engineer") |
| `customPosition` | String | Custom position field if not in predefined list |
| `interviewType` | String | Type: `'behavioral'`, `'technical'`, or `'mixed'` |
| `difficulty` | String | Level: `'beginner'`, `'intermediate'`, `'advanced'` |
| `text` | String | The actual question text |
| `isFollowUp` | Boolean | Whether this is typically a follow-up question |
| `quality` | Number | Manual quality rating (0-10) for question sorting |
| `uses` | Number | How many times this question has been used |
| `selectedCount` | Number | How many times selected for interviews |
| `createdBy` | ObjectId or null | User who created the question (if admin-created) |
| `createdAt` | Date | When question was added to cache |
| `updatedAt` | Date | Last modification timestamp |

### Indices

**Composite index** (`backend/models/Question.js:19`):

```javascript
questionSchema.index({ position: 1, customPosition: 1, interviewType: 1, difficulty: 1 });
```

This optimizes question selection queries:
- **Query pattern**: Find questions matching position + interviewType + difficulty
- **Performance**: O(log n) with index vs O(n) without
- **Use case**: `scripts/seed-questions.js` and question generation

### Example Document

```json
{
  "_id": {
    "$oid": "507f1f77bcf86cd799439012"
  },
  "position": "Software Engineer",
  "customPosition": "",
  "interviewType": "technical",
  "difficulty": "intermediate",
  "text": "Design a system to handle real-time notifications. What data structures and technologies would you use?",
  "isFollowUp": false,
  "quality": 8,
  "uses": 5,
  "selectedCount": 4,
  "createdBy": null,
  "createdAt": {
    "$date": "2024-01-01T00:00:00.000Z"
  },
  "updatedAt": {
    "$date": "2024-01-15T10:30:00.000Z"
  }
}
```

---

## Persistence Layer

**Location**: `backend/interview/store.js`

The store module handles all MongoDB read/write operations with graceful degradation.

### Key Functions

#### `isMongoConfigured()`

Check if MongoDB is connected.

```javascript
// from backend/db.js:4-6
function isMongoConfigured() {
  return Boolean(config.mongoUri);
}
```

Used before all database operations to skip if not configured.

#### `createSessionDoc(data)`

Create a new session document.

```javascript
async function createSessionDoc(data) {
  if (!isMongoConfigured()) return null;
  try {
    return await InterviewSessionModel.create(data);
  } catch (err) {
    console.error('Create session doc failed:', err.message);
    return null;
  }
}
```

**Returns**: Created document or null if failed

#### `upsertSession(session)`

Update or insert session (used after each answer/update).

```javascript
async function upsertSession(session) {
  if (!isMongoConfigured() || !session || !session._id) return null;
  try {
    const doc = {
      user: session.userId || null,
      mode: session.config.mode,
      config: session.config,
      status: session.status,
      // ... other fields
    };
    return await InterviewSessionModel.updateOne(
      { _id: session._id },
      { $set: doc }
    );
  } catch (err) {
    return null;
  }
}
```

**Pattern**: Upsert (update if exists, otherwise insert) via `$set`

#### `loadSessionDoc(id)`

Load session by ID.

```javascript
async function loadSessionDoc(id) {
  if (!isMongoConfigured()) return null;
  try {
    return await InterviewSessionModel.findById(id).lean();
  } catch (err) {
    return null;
  }
}
```

**Note**: Uses `.lean()` for read-only performance

#### `listUserSessions(userId, limit)`

List user's interviews with pagination.

```javascript
async function listUserSessions(userId, limit = 20) {
  if (!isMongoConfigured()) return [];
  try {
    return await InterviewSessionModel.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  } catch (err) {
    return [];
  }
}
```

**Order**: Newest first (`createdAt: -1`)

**Uses index**: `{ user: 1, createdAt: -1 }` for performance

#### `clearUserSessions(userId)`

Delete all sessions for a user.

```javascript
async function clearUserSessions(userId) {
  if (!isMongoConfigured()) return 0;
  try {
    const result = await InterviewSessionModel.deleteMany({ user: userId });
    return result && result.deletedCount ? result.deletedCount : 0;
  } catch (err) {
    return 0;
  }
}
```

**Returns**: Number of deleted documents

---

## Data Flow

### Session Creation & Persistence

```mermaid
graph TD
    API["POST /api/interview/start"]
    Engine["Interview Engine<br/>Creates Session"]
    MemStore["In-Memory Store<br/>(Session object)"]
    DB["MongoDB<br/>(Async persist)"]
    
    API -->|Validate config| Engine
    Engine -->|Create session| MemStore
    Engine -->|Return to client| API
    MemStore -->|After each answer| DB
    MemStore -->|On completion| DB
```

**Key pattern**:
1. Session lives in memory (fast)
2. Persisted to MongoDB after each significant event
3. On server restart, sessions in memory are lost (expected)
4. Completed sessions are queryable from history

### Session Retrieval

```mermaid
graph TD
    Request["GET /api/me/sessions"]
    Auth["Validate JWT"]
    UserID["Extract userId"]
    Query["Query MongoDB<br/>{ user: userId }"]
    Index["Use Index<br/>{ user, createdAt }"]
    Return["Return 20 newest"]
    
    Request --> Auth
    Auth --> UserID
    UserID --> Query
    Query --> Index
    Index --> Return
```

---

## Query Patterns

### Common Queries

**Find user's sessions** (from `backend/interview/store.js:61-71`):
```javascript
InterviewSessionModel.find({ user: userId })
  .sort({ createdAt: -1 })
  .limit(20)
```

**Find specific session**:
```javascript
InterviewSessionModel.findById(sessionId)
```

**Find questions by criteria**:
```javascript
Question.find({
  position: "Software Engineer",
  interviewType: "technical",
  difficulty: "intermediate"
})
```

**Update session**:
```javascript
InterviewSessionModel.updateOne(
  { _id: sessionId },
  { $set: { status: 'completed', evaluation: {...} } }
)
```

**Delete user's sessions**:
```javascript
InterviewSessionModel.deleteMany({ user: userId })
```

---

## Storage Estimates

### Document Sizes

| Collection | Avg Size | Notes |
|-----------|----------|-------|
| User | ~1 KB | Email, name, hashes |
| Question | ~2 KB | Text + metadata |
| InterviewSession | 10-50 KB | Depends on Q count and answer length |

### Example Capacity

For a 10GB MongoDB instance:

| Collection | Documents | Space |
|-----------|-----------|-------|
| users | ~1 million | ~1 GB |
| questions | ~10,000 | ~20 MB |
| interviewsessions | ~50,000 | ~1-2.5 GB |
| **Total** | ~1M + | ~2-3.5 GB |

Typical usage will not exceed MongoDB's free tier (512 MB - 1 GB for Atlas).

---

## Backup & Recovery

### MongoDB Atlas Backup

Automatic backups available with paid MongoDB Atlas tier. For free tier:

1. **Export via mongoexport**:
   ```bash
   mongoexport --uri "mongodb+srv://user:pass@cluster.mongodb.net/ai-interviewer" \
     --collection users \
     --out users.json
   ```

2. **Import via mongoimport**:
   ```bash
   mongoimport --uri "mongodb+srv://user:pass@cluster.mongodb.net/ai-interviewer" \
     --collection users \
     --file users.json
   ```

### Data Retention

- **Sessions**: Indefinite (set `TTL` index if desired to auto-delete old sessions)
- **Users**: Keep indefinitely
- **Questions**: Keep indefinitely (or archive rarely-used ones)

---

## Migration Notes

### Adding Fields

If you need to add fields to existing documents:

```javascript
// Example: Add new field to users
db.users.updateMany(
  { newField: { $exists: false } },
  { $set: { newField: defaultValue } }
)
```

### Schema Changes

For major schema changes:

1. Add new field to model
2. Run migration script to backfill existing documents
3. Deploy
4. (Optional) Remove old field after verification

### Index Management

To add a new index:

```javascript
// In model file
sessionSchema.index({ status: 1, createdAt: -1 });
```

Mongoose will create it on next connect. Existing data is indexed retroactively (may take time for large collections).

---

## Debugging & Monitoring

### MongoDB Shell Queries

Connect to MongoDB and run queries:

```bash
mongosh "mongodb+srv://user:pass@cluster.mongodb.net/ai-interviewer"
```

**Basic queries**:
```javascript
// Count sessions
db.interviewsessions.countDocuments()

// Find recent sessions
db.interviewsessions.find().sort({ createdAt: -1 }).limit(5)

// Find user's sessions
db.interviewsessions.find({ user: ObjectId("507f1f77bcf86cd799439011") })

// Get avg interview duration
db.interviewsessions.aggregate([
  {
    $group: {
      _id: null,
      avgDurationMs: {
        $avg: {
          $subtract: ["$completedAt", "$startedAt"]
        }
      }
    }
  }
])

// Find sessions by difficulty
db.interviewsessions.find({ "config.difficulty": "advanced" })
```

### Performance Monitoring

In MongoDB Atlas dashboard:

1. Go to **Metrics** tab
2. Monitor:
   - Operations/sec
   - CPU usage
   - Memory usage
   - Network I/O
3. Check **Slow Query Logs** if performance degrades

### Connection Issues

If MongoDB connection fails:

```bash
# Check logs
npm run dev:backend

# Look for:
# "MongoDB connection failed: ..."
# "Running without database persistence"

# Test connection
mongosh "mongodb://127.0.0.1:27017/ai-interviewer"
# or
mongosh "mongodb+srv://user:pass@cluster.mongodb.net/ai-interviewer"
```

---

## Best Practices

1. **Always check `isMongoConfigured()`** before database operations
2. **Use indices** for frequently queried fields
3. **Limit query results** with `.limit()` to avoid fetching huge datasets
4. **Use `.lean()`** when you only need data to read (not modify)
5. **Handle null gracefully** - database operations can fail, return null instead of throwing
6. **Monitor storage** - use MongoDB Atlas dashboard to track growth
7. **Back up regularly** - especially before major operations
8. **Use transactions** for multi-document updates (available in MongoDB 4.0+)
9. **Validate data** on application layer before persisting
10. **Log errors** but don't expose sensitive data in logs (no PII)
