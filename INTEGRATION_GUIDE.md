# DrawSync Backend — Web App Integration Guide

> Complete guide for connecting a Next.js / React frontend to the DrawSync backend.

---

## 1. Environment Setup

### Backend `.env` (copy from `.env.example`)

```bash
cp .env.example .env
```

Fill in at minimum:

| Variable | Required | Notes |
|---|---|---|
| `MONGO_URL` | ✅ | MongoDB Atlas connection string |
| `REDIS_URL` | ✅ | Redis 7 URL |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | ✅ | Full JSON string from Firebase console |
| `ANTHROPIC_API_KEY` | ✅ | For all AI features |
| `FRONTEND_URL` | ✅ | e.g. `http://localhost:3000` |
| `R2_*` | Optional | For cloud file storage |
| `RESEND_API_KEY` | Optional | For invite emails |
| `DEV_AUTH_BYPASS` | Dev only | Set `true` to skip Firebase |

### Local development (Docker)

```bash
# Start MongoDB + Redis via Docker
docker-compose up -d mongo redis

# Start the API in dev mode
npm run dev
# → Server: http://localhost:4000
# → WebSocket: ws://localhost:4000
```

---

## 2. Authentication Flow

DrawSync uses **Firebase Authentication** for identity. The flow:

```
Frontend (Firebase SDK) → Get ID Token → Send to DrawSync API → API verifies → Returns MongoDB user
```

### Step 1 — Initialize Firebase in your frontend

```typescript
// lib/firebase.ts
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
};

export const firebase = initializeApp(firebaseConfig);
export const auth = getAuth(firebase);
```

### Step 2 — Get Firebase ID token and call `/auth/login`

```typescript
// lib/auth.ts
import { getIdToken } from 'firebase/auth';
import { auth } from './firebase';

export async function getAuthToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');
  return getIdToken(user, /* forceRefresh */ false);
}

export async function loginToDrawSync() {
  const token = await getAuthToken();
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/v1/auth/login`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json(); // { user: { _id, email, fullName, plan, ... } }
}
```

### Step 3 — Attach token to every API request

```typescript
// lib/api-client.ts
import { getAuthToken } from './auth';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL + '/v1';

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getAuthToken();
  
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error?.message ?? 'Request failed');
  }

  return res.json() as Promise<T>;
}
```

---

## 3. REST API Usage Examples

### Create and manage canvases

```typescript
// Create a canvas
const { canvas } = await apiRequest('/canvases', {
  method: 'POST',
  body: JSON.stringify({
    title: 'System Architecture',
    category: 'architecture',
    settings: { aiEnabled: true },
  }),
});

// Load canvas
const { canvas } = await apiRequest(`/canvases/${canvasId}`);

// Save elements (bulk upsert — call on pointerup / autosave)
await apiRequest(`/canvases/${canvasId}/elements/save`, {
  method: 'POST',
  body: JSON.stringify({ elements: localElements, deletedIds }),
});
```

### Share links

```typescript
// Generate share link
const { token } = await apiRequest(`/canvases/${canvasId}/share`, {
  method: 'POST',
  body: JSON.stringify({ role: 'editor', label: 'Team link', expiresIn: 7 }),
});
// Share URL: https://drawsync.app/canvas/join/${token}

// Resolve a share token (public — no auth)
const info = await fetch(`${BASE_URL}/canvases/join/${token}`).then(r => r.json());
```

### AI features (REST)

```typescript
// AI chat (blocking — use Socket.IO for streaming)
const { message } = await apiRequest(`/canvases/${canvasId}/ai/chat`, {
  method: 'POST',
  body: JSON.stringify({ message: 'What is missing from this flow?', history: [] }),
});

// Ghost AI suggestions
const { suggestions, summary } = await apiRequest(`/canvases/${canvasId}/ai/suggest`, {
  method: 'POST',
  body: JSON.stringify({ message: 'Complete the auth flow' }),
});

// Auto-layout
const { updates } = await apiRequest(`/canvases/${canvasId}/ai/layout`, {
  method: 'POST',
  body: JSON.stringify({ algorithm: 'TB' }),
});
// Apply updates to local element positions

// Code → Diagram
const result = await apiRequest(`/canvases/${canvasId}/ai/code-to-diagram`, {
  method: 'POST',
  body: JSON.stringify({ code: tsCode, language: 'typescript', diagramType: 'architecture' }),
});
// result.elements — add to canvas

// Diagram → Code
const result = await apiRequest(`/canvases/${canvasId}/ai/diagram-to-code`, {
  method: 'POST',
  body: JSON.stringify({ language: 'typescript' }),
});
// result.code — show in code panel
```

---

## 4. Socket.IO Real-time Connection

### Install Socket.IO client

```bash
npm install socket.io-client
```

### Connect to DrawSync WebSocket

```typescript
// lib/socket.ts
import { io, Socket } from 'socket.io-client';
import { getAuthToken } from './auth';

let socket: Socket | null = null;

export async function connectSocket(): Promise<Socket> {
  if (socket?.connected) return socket;

  const token = await getAuthToken();

  socket = io(process.env.NEXT_PUBLIC_WS_URL!, {
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  socket.on('connect', () => console.log('✅ Socket connected:', socket!.id));
  socket.on('disconnect', (reason) => console.log('Socket disconnected:', reason));
  socket.on('error', (err) => console.error('Socket error:', err));

  return socket;
}

export function getSocket(): Socket {
  if (!socket) throw new Error('Socket not connected');
  return socket;
}
```

### Join a canvas room

```typescript
// In your canvas page component
import { connectSocket } from '@/lib/socket';

const socket = await connectSocket();

// Join the canvas
socket.emit('canvas:join', { canvasId });

// Receive initial state
socket.on('canvas:joined', ({ role, lastViewport, settings }) => {
  console.log('Joined as:', role);
  applyViewport(lastViewport);
});

socket.on('canvas:state', ({ elements }) => {
  // Load all elements into local store
  loadElements(elements);
});

socket.on('users:active', (peers) => {
  // Render peer cursors
  updatePresence(peers);
});
```

### Real-time drawing events

```typescript
// ── Sending events ────────────────────────────────────────────────────────

// While drawing (60fps, no DB write)
socket.emit('stroke:preview', { canvasId, points, style });

// Element added (broadcast + async DB write)
socket.emit('element:add', { canvasId, element: newElement });

// Element updated
socket.emit('element:update', { canvasId, element: updatedElement });

// Element deleted
socket.emit('element:delete', { canvasId, elementIds: ['uuid-1'] });

// Cursor position
socket.emit('cursor:move', { canvasId, x, y });

// Selection
socket.emit('selection:update', { canvasId, elementIds: selectedIds });

// Viewport (for follow-me)
socket.emit('viewport:update', { canvasId, viewport: { x, y, zoom } });

// Bulk save (beacon-safe, use on page unload)
socket.emit('canvas:save', { canvasId, elements: allElements, deletedIds, viewport });

// ── Receiving events ──────────────────────────────────────────────────────

socket.on('element:added', ({ element, userId }) => {
  if (userId !== myUserId) addElement(element);
});

socket.on('element:updated', ({ element, userId }) => {
  if (userId !== myUserId) updateElement(element);
});

socket.on('element:deleted', ({ elementIds, userId }) => {
  if (userId !== myUserId) removeElements(elementIds);
});

socket.on('cursor:moved', ({ userId, socketId, userName, userColor, x, y }) => {
  updatePeerCursor(socketId, { x, y, userName, userColor });
});

socket.on('stroke:preview', ({ socketId, points, style }) => {
  renderLiveStroke(socketId, points, style);
});

socket.on('user:joined', (peer) => addPeer(peer));
socket.on('user:left', ({ socketId }) => removePeer(socketId));
```

### Element locking (collaborative editing)

```typescript
// Lock before editing
socket.emit('element:lock', { canvasId, elementId });

// Successful lock
socket.on('element:locked', ({ elementId, userId, userName }) => {
  markElementLocked(elementId, { userId, userName });
});

// Lock conflict
socket.on('element:lock_conflict', ({ elementId, lockedByName }) => {
  showToast(`${lockedByName} is already editing this element`);
});

// Unlock when done
socket.emit('element:unlock', { canvasId, elementId });
```

### AI via Socket (streaming)

```typescript
import { v4 as uuidv4 } from 'uuid';

const requestId = uuidv4();

// Send AI request
socket.emit('ai:request', {
  canvasId,
  requestId,
  type: 'chat', // or 'ghost_suggest', 'layout', 'code_to_diagram', 'diagram_to_code'
  message: 'What components are missing from this auth flow?',
  history: chatHistory,
});

// Stream response
let responseText = '';
socket.on('ai:stream', ({ requestId: rId, chunk, done, elements }) => {
  if (rId !== requestId) return;
  responseText += chunk;
  updateChatUI(responseText);
  if (done) { finishStreaming(); }
  if (elements) addGhostElements(elements); // For ghost suggest
});

socket.on('ai:error', ({ requestId: rId, error }) => {
  if (rId === requestId) showError(error);
});

// Cancel in-flight request
socket.emit('ai:stop', { canvasId, requestId });
```

### Ghost AI Collaborator

```typescript
// Request ghost suggestions
socket.emit('ai:request', {
  canvasId,
  requestId: uuidv4(),
  type: 'ghost_suggest',
  message: 'Complete the missing parts of this OAuth flow',
});

// All room members receive ghost elements
socket.on('element:ghost:added', ({ elements, reasoning }) => {
  // Render ghosts at 40% opacity with glowing border
  addGhostElements(elements);
  showGhostPanel({ count: elements.length, reasoning });
});

// Accept a ghost
socket.emit('element:ghost:accept', { canvasId, elementIds: ['ghost-uuid-1'] });

// Dismiss specific ghosts
socket.emit('element:ghost:dismiss', { canvasId, elementIds: ['ghost-uuid-1'] });
```

---

## 5. WebRTC Voice Chat (Spatial Audio)

```typescript
// Join voice channel
socket.emit('voice:join', { canvasId });

// Get existing participants
socket.on('voice:participants', ({ participants }) => {
  initWebRTCWithParticipants(participants);
});

// New participant joined
socket.on('voice:user_joined', ({ participant, participants }) => {
  initiateWebRTC(participant.socketId);
});

// ── Full WebRTC signaling ──────────────────────────────────────────────

const peerConnections = new Map<string, RTCPeerConnection>();
const audioContext = new AudioContext();
const pannerNodes = new Map<string, PannerNode>();

async function initiateWebRTC(targetSocketId: string) {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  peerConnections.set(targetSocketId, pc);

  // Add local audio
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach(track => pc.addTrack(track, stream));

  // ICE candidates
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) {
      socket.emit('voice:ice', { canvasId, targetSocketId, candidate });
    }
  };

  // Remote audio → spatial panner
  pc.ontrack = ({ streams: [stream] }) => {
    const source = audioContext.createMediaStreamSource(stream);
    const panner = audioContext.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.rolloffFactor = 1.5;
    panner.refDistance = 2;
    panner.maxDistance = 15;
    source.connect(panner);
    panner.connect(audioContext.destination);
    pannerNodes.set(targetSocketId, panner);
  };

  // Create offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('voice:offer', { canvasId, targetSocketId, sdp: offer });
}

// Handle incoming offer
socket.on('voice:offer', async ({ fromSocketId, sdp }) => {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  peerConnections.set(fromSocketId, pc);

  await pc.setRemoteDescription(sdp);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('voice:answer', { canvasId, targetSocketId: fromSocketId, sdp: answer });
});

// Handle answer
socket.on('voice:answer', async ({ fromSocketId, sdp }) => {
  await peerConnections.get(fromSocketId)?.setRemoteDescription(sdp);
});

// Handle ICE
socket.on('voice:ice', async ({ fromSocketId, candidate }) => {
  await peerConnections.get(fromSocketId)?.addIceCandidate(candidate);
});

// Spatial audio: update panner position when peer viewport changes
socket.on('voice:position', ({ socketId, x, y }) => {
  const panner = pannerNodes.get(socketId);
  if (!panner) return;
  const myCenter = getMyViewportCenter(); // your canvas viewport centre
  const scale = 0.001;
  const dx = Math.max(-10, Math.min(10, (x - myCenter.x) * scale));
  const dz = Math.max(-10, Math.min(10, (y - myCenter.y) * scale));
  panner.positionX.setTargetAtTime(dx, audioContext.currentTime, 0.1);
  panner.positionZ.setTargetAtTime(dz, audioContext.currentTime, 0.1);
});

// Broadcast your position every 500ms
setInterval(() => {
  const { x, y } = getMyViewportCenter();
  socket.emit('voice:position', { canvasId, x, y, zoom: currentZoom });
}, 500);

// Mute toggle
socket.emit('voice:mute_toggle', { canvasId, muted: true });
socket.on('voice:mute_changed', ({ socketId, muted }) => updateMuteUI(socketId, muted));
```

---

## 6. Error Handling

All API errors follow this format:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Access denied",
    "details": { "field": "..." },
    "requestId": "uuid"
  }
}
```

| Code | HTTP | Meaning |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing or invalid Firebase token |
| `FORBIDDEN` | 403 | Role insufficient |
| `NOT_FOUND` | 404 | Resource doesn't exist |
| `VALIDATION` | 400 | Request body failed Zod validation |
| `CONFLICT` | 409 | Duplicate (e.g. collaborator already added) |
| `RATE_LIMIT` | 429 | Too many requests |
| `SERVICE_UNAVAILABLE` | 503 | AI or storage not configured |

---

## 7. Share Token Access

For guests accessing via share link, pass the token in the header:

```typescript
// REST API
await fetch(`${BASE_URL}/canvases/${canvasId}`, {
  headers: { 'x-share-token': shareToken },
});

// Socket.IO
socket = io(WS_URL, {
  auth: { token: firebaseToken, shareToken: optionalShareToken },
});
```

---

## 8. Postman Quick Start

1. Open Postman → **Import** → select `DrawSync_API.postman_collection.json`
2. Create a **new Environment** with:
   - `base_url` = `http://localhost:4000/v1`
   - `firebase_token` = your Firebase ID token (from browser DevTools → Application → IndexedDB → firebaseLocalStorage or `await auth.currentUser.getIdToken()`)
3. Run **POST /auth/login** first — sets `user_id`
4. Run **POST /canvases** — sets `canvas_id`
5. Run **POST /canvases/:id/elements/save** — adds diagram elements
6. Run any AI endpoint — requires `ANTHROPIC_API_KEY` in `.env`

---

## 9. Frontend Environment Variables

```env
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_WS_URL=ws://localhost:4000
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
```

---

## 10. Production Checklist

- [ ] Set `NODE_ENV=production` in backend `.env`
- [ ] Set `FRONTEND_URL` to your actual domain (used for CORS)
- [ ] Use MongoDB Atlas M10+ for production (free tier has 5s cold starts)
- [ ] Use Redis Cloud or Upstash for managed Redis
- [ ] Set `DEV_AUTH_BYPASS=false` (should already be default)
- [ ] Configure `R2_*` variables for cloud file storage
- [ ] Configure `RESEND_API_KEY` for invite emails
- [ ] Set `ENABLE_VECTOR_SEARCH=true` and configure Atlas Search indexes for semantic search
- [ ] Deploy with `docker-compose` (single server) or Kubernetes manifests in `/infrastructure/k8s/`
- [ ] Point NGINX reverse proxy to port 4000, enable WSS upgrade

---

*DrawSync API v1.0 — Built with Node.js + TypeScript + Express + Socket.IO + MongoDB + Redis + Anthropic Claude*
