# Canvas Collaboration Backend — Architecture & Frontend Integration Guide

## 1. System Architecture Overview

```
Browser (React/Next.js)
        │
        ├─── HTTPS REST ──────→ Express (port 4000)  /api/v1/*
        │                              │
        └─── WSS Socket.IO ───→ Socket.IO Server     ws://...
                                       │
                              MongoDB Atlas / Local
                              ┌────────────────────────┐
                              │  Users                 │
                              │  Canvas (metadata)     │
                              │  CanvasElement (data)  │
                              │  ActiveSession         │
                              └────────────────────────┘
```

### Key Architectural Decisions

| Decision | Choice | Reason |
|---|---|---|
| Elements collection | Separate `CanvasElement` (not embedded in `Canvas`) | Avoids MongoDB's 16 MB per-document limit for infinite canvases |
| Real-time latency | Broadcast-first, persist-async | Peers see changes instantly; DB is not on the critical path |
| Presence tracking | In-memory `Map` + TTL-indexed DB | Cursor moves never hit DB; sessions survive server restarts via DB |
| Element locking | In-memory `Map` per socket | Zero DB writes for lock/unlock; released on disconnect |
| Authentication | Firebase ID Token verified server-side | Token never trusted if only verified on client; `fId` extracted from server-verified token |

---

## 2. Database Models

### `User`
```
fId       String  – Firebase UID (primary lookup key)
email     String  – unique, lowercase
fullName  String
avatarUrl String  – optional URL
avatarId  Number  – numeric avatar index
```

### `Canvas` (metadata only — NO elements)
```
title         String
owner         ObjectId → User
collaborators [{ user: ObjectId, role: 'viewer'|'editor', addedAt }]
shareTokens   [{ token: String, role: 'viewer'|'editor', createdAt }]
isPublic      Boolean
thumbnail     String  – small base64 preview
elementCount  Number  – cached count, updated on save
lastViewport  { x, y, zoom }
tags          [String]
```

### `CanvasElement` (one document per drawing element)
```
canvasId      ObjectId → Canvas   (indexed)
elementId     String              (UUID from client, unique per canvas)
type          'stroke'|'shape'|'text'|'image'|'frame'|'connector'|'sticky'
subtype       String              (pen/marker/rectangle/ellipse/...)

x, y, width, height, rotation

points        [{x,y,p}]          (stroke path — p=pressure)
fromElementId, toElementId       (connector anchors)
fromPoint, toPoint, controlPoints

text, label, fontSize, fontFamily, fontWeight, fontStyle,
textAlign, textColor, lineHeight

strokeColor, fillColor, strokeWidth, opacity
dashed, dashArray, roughness, roundness
arrowStart, arrowEnd, arrowHeadStyle

imageUrl, imageData

zIndex        Number
isDeleted     Boolean             (soft-delete — undo can restore)
isLocked      Boolean

createdBy, updatedBy  ObjectId → User
version       Number              (increment on each update)
```

### `ActiveSession`
```
canvasId   ObjectId
userId     ObjectId
socketId   String (unique)
userName, userColor, role
joinedAt, lastSeen  (TTL: auto-purged after 2 hours)
```

---

## 3. Complete REST API Reference

### Base URL: `http://localhost:4000/api/v1`

### Users

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/user/signup` | Bearer token in header | Create account. Verifies Firebase token server-side to extract `fId`. Body: `{ fullName }` |
| POST | `/user/login`  | Bearer token in header | Returns existing user document |
| GET  | `/user/me`     | Required | Get own profile |
| PUT  | `/user/me`     | Required | Update `fullName`, `avatarUrl`, `avatarId` |

### Canvas

| Method | Path | Auth | Description |
|---|---|---|---|
| GET    | `/canvas`                     | Required | List own canvases. Query: `?page&limit&search` |
| POST   | `/canvas`                     | Required | Create canvas. Body: `{ title? }` |
| GET    | `/canvas/shared`              | Required | Canvases shared with me. Query: `?page&limit` |
| GET    | `/canvas/join/:token`         | **Public** | Resolve share token → `{ canvasId, title, role }` |
| GET    | `/canvas/:id`                 | Required | Canvas metadata + `userRole`. Header: `x-share-token` optional |
| PUT    | `/canvas/:id`                 | Editor+  | Update `title`, `tags`, `isPublic` |
| DELETE | `/canvas/:id`                 | Owner    | Delete canvas + all its elements |
| POST   | `/canvas/:id/duplicate`       | Any role | Clone canvas (new owner = requester) |
| GET    | `/canvas/:id/elements`        | Any role | All non-deleted elements. Query: `?minX&minY&maxX&maxY` (viewport filter) |
| POST   | `/canvas/:id/save`            | Editor+  | Bulk upsert. Body: `{ elements[], deletedIds[], viewport? }`. Works with `sendBeacon` |
| POST   | `/canvas/:id/thumbnail`       | Editor+  | Save preview. Body: `{ thumbnail: base64 }` |
| POST   | `/canvas/:id/share`           | Owner    | Generate share links. Body: `{ roles: ['viewer','editor'] }` |
| DELETE | `/canvas/:id/share/:role`     | Owner    | Revoke share token for that role |
| POST   | `/canvas/:id/collaborator`    | Owner    | Add by email or userId. Body: `{ email?, userId?, role }` |
| PUT    | `/canvas/:id/collaborator/:uid` | Owner  | Change role. Body: `{ role }` |
| DELETE | `/canvas/:id/collaborator/:uid` | Owner  | Remove collaborator |
| POST   | `/canvas/:id/leave`           | Collab   | Self-remove from canvas |

---

## 4. Socket.IO Event Reference

### Connection
```js
const socket = io('http://localhost:4000', {
  auth: { token: await firebase.auth().currentUser.getIdToken() },
  transports: ['websocket'],
});
```

### Events: Client → Server

| Event | Payload | Description |
|---|---|---|
| `canvas:join`      | `{ canvasId, shareToken? }` | Join canvas room |
| `canvas:leave`     | _(none)_ | Leave current canvas room |
| `canvas:save`      | `{ canvasId, elements[], deletedIds?, viewport? }` | Periodic explicit save |
| `canvas:clear`     | `{ canvasId }` | Soft-delete all elements (editor+) |
| `canvas:undo`      | `{ canvasId, restored[], deletedIds[] }` | Broadcast undo op + persist |
| `canvas:redo`      | `{ canvasId, restored[], deletedIds[] }` | Broadcast redo op + persist |
| `element:add`      | `{ canvasId, element }` | Persist + broadcast new element |
| `element:update`   | `{ canvasId, element }` | Persist + broadcast element change |
| `element:delete`   | `{ canvasId, elementIds[] }` | Soft-delete elements |
| `elements:batch`   | `{ canvasId, added[], updated[], deletedIds[] }` | Atomic batch (paste, multi-move) |
| `element:lock`     | `{ canvasId, elementId }` | Lock element for editing |
| `element:unlock`   | `{ canvasId, elementId }` | Release element lock |
| `stroke:preview`   | `{ canvasId, points[], style }` | **Live stroke while drawing** — no DB write |
| `cursor:move`      | `{ canvasId, x, y }` | Cursor position — no DB write |
| `selection:update` | `{ canvasId, elementIds[] }` | Selected elements (for awareness) |
| `viewport:update`  | `{ canvasId, viewport }` | Viewport for "Follow me" mode |

### Events: Server → Client

| Event | Payload | Description |
|---|---|---|
| `canvas:joined`     | `{ canvasId, title, role, lastViewport }` | Join confirmed |
| `canvas:role`       | `{ role, canvasId }` | Your effective role |
| `canvas:state`      | `{ elements[], canvasId }` | **Initial full element snapshot** |
| `canvas:saved`      | `{ savedAt, elementCount, savedBy }` | Save acknowledged |
| `canvas:cleared`    | `{ userId, userName }` | Canvas was cleared |
| `canvas:undo`       | `{ restored[], deletedIds[], userId }` | Propagate undo |
| `canvas:redo`       | `{ restored[], deletedIds[], userId }` | Propagate redo |
| `element:added`     | `{ element, userId, socketId }` | New element from a peer |
| `element:updated`   | `{ element, userId, socketId }` | Updated element from a peer |
| `element:deleted`   | `{ elementIds[], userId, socketId }` | Deleted elements |
| `elements:batch`    | `{ added[], updated[], deletedIds[], userId }` | Batch from a peer |
| `element:locked`    | `{ elementId, userId, userName, socketId }` | Element locked by peer |
| `element:unlocked`  | `{ elementId, userId }` | Lock released |
| `element:lock_conflict` | `{ elementId, lockedBy, lockedByName }` | Tried to lock an already-locked element |
| `element:persist_error` | `{ elementId, event }` | DB write failed (show a toast) |
| `stroke:preview`    | `{ userId, socketId, points[], style }` | Peer's live stroke |
| `cursor:moved`      | `{ userId, socketId, userName, userColor, x, y }` | Peer cursor |
| `selection:updated` | `{ userId, socketId, elementIds[] }` | Peer selection |
| `viewport:updated`  | `{ userId, socketId, viewport }` | Peer viewport |
| `users:active`      | `[{ socketId, userId, userName, userColor, role, cursor }]` | Current room occupants |
| `user:joined`       | `{ userId, userName, userColor, role, socketId }` | Someone joined |
| `user:left`         | `{ userId, socketId, userName }` | Someone left |
| `error`             | `{ code, message }` | Server-side error |

---

## 5. Frontend Integration: Step-by-Step Flow

### 5.1 Authentication

```js
// After Firebase sign-in, ALWAYS verify server-side before any API call
const token = await firebase.auth().currentUser.getIdToken();

// Signup (first time)
await fetch('/api/v1/user/signup', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ fullName: 'Alice' }),
});

// Login (subsequent visits)
const { user } = await fetch('/api/v1/user/login', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
}).then(r => r.json());
```

### 5.2 Opening an Existing Canvas

```
┌─────────────────────────────────────────────────────────────────┐
│ Step 1 — REST: GET /api/v1/canvas/:id                           │
│   Returns: { canvas: { title, ... }, userRole: 'owner'|'editor'|'viewer' }
│   Purpose: Verify access, get metadata, know your role          │
└─────────────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 2 — REST: GET /api/v1/canvas/:id/elements                  │
│   Returns: { elements: [...] }                                  │
│   Purpose: Load all existing elements for initial render        │
│   Tip: Render these immediately while the socket connects       │
└─────────────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 3 — Socket: canvas:join  { canvasId }                      │
│   Server emits back:                                            │
│   • canvas:role    — confirms role                              │
│   • canvas:joined  — title + lastViewport hint                  │
│   • canvas:state   — full elements snapshot (source of truth    │
│                       at the moment you join; merge with step 2 │
│                       by replacing with this more recent copy)  │
│   • users:active   — list of peers currently in the room        │
└─────────────────────────────────────────────────────────────────┘
```

**Full code example:**
```js
// 1. Metadata + role check
const { canvas, userRole } = await api.get(`/canvas/${id}`);

// 2. Pre-load elements (show loading skeleton)
const { elements: initialElements } = await api.get(`/canvas/${id}/elements`);
renderCanvas(initialElements);

// 3. Connect socket
const socket = io(WS_URL, { auth: { token } });

socket.emit('canvas:join', { canvasId: id });

socket.on('canvas:state', ({ elements }) => {
  // Replace initialElements with this fresh DB snapshot
  replaceAll(elements);
});

socket.on('users:active', (users) => setActiveUsers(users));

socket.on('element:added',   ({ element }) => addElement(element));
socket.on('element:updated', ({ element }) => updateElement(element));
socket.on('element:deleted', ({ elementIds }) => deleteElements(elementIds));
socket.on('stroke:preview',  ({ userId, points, style }) => drawLiveStroke(userId, points, style));
socket.on('cursor:moved',    ({ userId, x, y, userName, userColor }) => movePeerCursor(userId, x, y));
```

### 5.3 Drawing and Real-time Sync

```
User draws stroke
    │
    ├─ While drawing (mousemove/pointermove):
    │     emit  stroke:preview  { canvasId, points, style }
    │     peers receive it and draw live preview
    │
    └─ On mouseup / pointerup (stroke finished):
          emit  element:add  { canvasId, element: { elementId: uuid(), type:'stroke', ... } }
          Server: broadcasts element:added to peers + persists to DB


User moves/resizes element
    │
    ├─ On mousedown:  emit  element:lock   { canvasId, elementId }
    ├─ While dragging: emit  element:update { canvasId, element }  (throttled ~60fps)
    └─ On mouseup:
          emit  element:update  (final position)
          emit  element:unlock  { canvasId, elementId }


User selects elements:
    emit  selection:update  { canvasId, elementIds: ['id1', 'id2'] }


User zooms/pans viewport:
    emit  viewport:update  { canvasId, viewport: { x, y, zoom } }
```

### 5.4 Saving on Page Unload

```js
// Use sendBeacon for reliable save when user closes the tab
// Works even if the page is being unloaded
window.addEventListener('beforeunload', () => {
  const payload = JSON.stringify({
    elements:   getModifiedElements(),   // only changed elements
    deletedIds: getDeletedElementIds(),
    viewport:   getViewport(),
  });

  navigator.sendBeacon(`/api/v1/canvas/${canvasId}/save`, payload);
  // Note: sendBeacon sends Content-Type: text/plain — the server handles this
});

// Also set up a periodic auto-save every 30 seconds via socket
setInterval(() => {
  socket.emit('canvas:save', {
    canvasId,
    elements:   getModifiedElements(),
    deletedIds: getDeletedElementIds(),
    viewport:   getViewport(),
  });
  clearDirtyState();
}, 30_000);
```

### 5.5 Thumbnail Generation

```js
// Render the canvas to a small image (e.g. 400×300) and send to server
const thumbnail = canvasRef.current.toDataURL('image/jpeg', 0.5);

await api.post(`/canvas/${canvasId}/thumbnail`, { thumbnail });
```

### 5.6 Share Links

```js
// Owner generates links
const { links } = await api.post(`/canvas/${canvasId}/share`, {
  roles: ['viewer', 'editor'],
});
// links = { viewer: 'http://localhost:3000/canvas/join/abc123',
//           editor: 'http://localhost:3000/canvas/join/def456' }

// On the share link page (/canvas/join/:token), BEFORE login:
const { canvasId, title, role } = await api.get(`/api/v1/canvas/join/${token}`);
// Redirect to /login?redirect=/canvas/${canvasId}&shareToken=${token}

// After login, open canvas with share token in the header:
// Pass x-share-token header to GET /canvas/:id
```

### 5.7 Undo / Redo (Collaborative)

The server does **not** maintain per-user undo stacks. Undo/redo is managed client-side using a history stack. When undone, the client sends the reverse operation to the server so all peers stay in sync.

```js
// Push to history on every element operation
history.push({ type: 'add', element });

// On Ctrl+Z:
const op = history.pop();
if (op.type === 'add') {
  // reverse: delete
  socket.emit('canvas:undo', {
    canvasId,
    restored:   [],
    deletedIds: [op.element.elementId],
  });
  localDelete(op.element.elementId);
}
```

---

## 6. Element ID Strategy

Every element **must** have a client-generated UUID as `elementId`. Use the `uuid` package or `crypto.randomUUID()`:

```js
import { v4 as uuidv4 } from 'uuid';
const element = {
  elementId: uuidv4(),  // Must be globally unique
  type: 'stroke',
  subtype: 'pen',
  points: [...],
  strokeColor: '#000000',
  strokeWidth: 2,
  // x, y, width, height computed from points bounding box
  x: minX, y: minY, width: maxX - minX, height: maxY - minY,
};
```

---

## 7. Element Schema Reference (Frontend)

```ts
type ElementType = 'stroke' | 'shape' | 'text' | 'image' | 'frame' | 'connector' | 'sticky';

type Subtype =
  | 'pen' | 'pencil' | 'marker' | 'brush' | 'eraser' | 'highlighter'  // stroke
  | 'rectangle' | 'ellipse' | 'triangle' | 'line' | 'arrow'           // shape
  | 'diamond' | 'parallelogram' | 'cylinder' | 'hexagon' | 'star'     // flowchart
  | 'straight' | 'curved' | 'elbow';                                  // connector

interface Point { x: number; y: number; p?: number; }  // p = pressure 0-1

interface CanvasElement {
  elementId:  string;          // UUID — generated by client
  type:       ElementType;
  subtype?:   Subtype;

  // Bounding box (canvas coordinate space)
  x:         number;
  y:         number;
  width:     number;
  height:    number;
  rotation?: number;           // degrees, default 0

  // Stroke
  points?:   Point[];

  // Connector endpoints
  fromElementId?: string;
  toElementId?:   string;
  fromPoint?:     Point;
  toPoint?:       Point;
  controlPoints?: Point[];

  // Text
  text?:       string;
  label?:      string;
  fontSize?:   number;
  fontFamily?: string;
  fontWeight?: string;
  fontStyle?:  string;
  textAlign?:  'left' | 'center' | 'right';
  textColor?:  string;
  lineHeight?: number;

  // Style
  strokeColor?: string;
  fillColor?:   string;
  strokeWidth?: number;
  opacity?:     number;        // 0-1
  dashed?:      boolean;
  dashArray?:   number[];
  roughness?:   number;        // 0=smooth, 1-2=sketchy
  roundness?:   number;

  // Arrows
  arrowStart?:     boolean;
  arrowEnd?:       boolean;
  arrowHeadStyle?: 'triangle' | 'open' | 'dot' | 'none';

  // Image
  imageUrl?:  string;
  imageData?: string;          // base64 fallback

  zIndex?:    number;
  isDeleted?: boolean;         // soft-delete flag
}
```

---

## 8. Performance Guidelines for Frontend

| Concern | Recommendation |
|---|---|
| Cursor events | Throttle `cursor:move` to max **30/sec** with `requestAnimationFrame` or lodash throttle |
| Live stroke preview | Emit `stroke:preview` on every pointer move (high freq is OK — no DB) |
| Element updates while dragging | Throttle `element:update` to **~15/sec** while dragging; always send the final position on mouseup |
| Viewport sync | Only emit `viewport:update` if another user is in "Follow me" mode |
| Large canvases | Use the `?minX&minY&maxX&maxY` query on `GET /elements` to load only visible elements on initial load |
| Re-connection | Socket.IO `connectionStateRecovery` is enabled (2 min window). On reconnect after a gap, always re-emit `canvas:join` to get a fresh `canvas:state` |

---

## 9. Environment Variables (`.env`)

```env
MONGO_URL=mongodb+srv://user:pass@cluster.mongodb.net/canvasdb?retryWrites=true&w=majority
PORT=4000
FRONTEND_URL=http://localhost:3000

# Firebase — either use a service account file OR set this env var (for production)
# FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"..."}

LOG_LEVEL=debug      # debug | info | warn | error
NODE_ENV=development
```

---

## 10. File Structure

```
server.js                        — Entry point (HTTP + Socket.IO)
src/
  config/
    db.js                        — MongoDB connection
    firebase.js                  — Firebase Admin SDK
  utils/
    logger.js                    — Winston logger
  models/
    user.model.js                — User schema
    canvas.model.js              — Canvas metadata schema (NO elements)
    canvas-element.model.js      — Drawing elements (separate collection)
    activesession.model.js       — Live session presence + TTL
  middleware/
    auth.middleware.js           — verifyFirebaseToken + optionalAuth
  controller/
    user.controller.js           — Signup, login, profile
    canvas.controller.js         — Canvas CRUD, elements, sharing
  routes/
    user.routes.js               — /api/v1/user/*
    canvas.routes.js             — /api/v1/canvas/*
  socket/
    socketHandlers.js            — All Socket.IO events
```
