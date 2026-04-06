'use strict';
const crypto        = require('crypto');
const Canvas        = require('../models/canvas.model');
const CanvasElement = require('../models/canvas-element.model');
const User          = require('../models/user.model');
const logger        = require('../utils/logger');

// ── Role helpers ──────────────────────────────────────────────────────────────
const getEffectiveRole = (canvas, userId, shareTokenHeader = null) => {
  const uid = userId.toString();
  if (canvas.owner.toString() === uid) return 'owner';
  const collab = canvas.collaborators.find((c) => c.user?.toString() === uid);
  if (collab) return collab.role;
  if (shareTokenHeader) {
    const entry = canvas.shareTokens.find((t) => t.token === shareTokenHeader);
    if (entry) return entry.role;
  }
  return null;
};

const canEdit = (role) => role === 'owner' || role === 'editor';

const ELEMENT_ALLOWED_FIELDS = new Set([
  'elementId', 'type', 'subtype',
  'x', 'y', 'width', 'height', 'rotation',
  'points', 'fromElementId', 'toElementId', 'fromPoint', 'toPoint', 'controlPoints',
  'text', 'label', 'fontSize', 'fontFamily', 'fontWeight', 'fontStyle',
  'textAlign', 'textColor', 'lineHeight',
  'strokeColor', 'fillColor', 'strokeWidth', 'opacity',
  'dashed', 'dashArray', 'roughness', 'roundness',
  'arrowStart', 'arrowEnd', 'arrowHeadStyle',
  'imageUrl', 'imageData',
  'zIndex', 'isDeleted',
]);

const sanitizeElement = (raw) => {
  const out = {};
  for (const key of ELEMENT_ALLOWED_FIELDS) {
    if (key in raw) out[key] = raw[key];
  }
  return out;
};

// ── Helper: get MongoDB User _id from Firebase UID ───────────────────────────
const getMongoUser = async (firebaseUid) => {
  return User.findOne({ fId: firebaseUid }).select('_id fullName email').lean();
};

// ── Canvas list / search ──────────────────────────────────────────────────────
exports.getMyCanvases = async (req, res) => {
  try {
    const mongoUser = await getMongoUser(req.user.uid);
    if (!mongoUser) return res.status(404).json({ message: 'User not found' });

    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, parseInt(req.query.limit) || 20);
    const search = (req.query.search || '').trim();

    const filter = { owner: mongoUser._id };
    if (search) filter.title = { $regex: search, $options: 'i' };

    const [canvases, total] = await Promise.all([
      Canvas.find(filter)
        .select('title thumbnail createdAt updatedAt isPublic elementCount tags collaborators')
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Canvas.countDocuments(filter),
    ]);

    return res.json({ canvases, total, page, limit });
  } catch (err) {
    logger.error('getMyCanvases:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getSharedWithMe = async (req, res) => {
  try {
    const mongoUser = await getMongoUser(req.user.uid);
    if (!mongoUser) return res.status(404).json({ message: 'User not found' });

    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);

    const filter = {
      'collaborators.user': mongoUser._id,
      owner: { $ne: mongoUser._id },
    };

    const [canvases, total] = await Promise.all([
      Canvas.find(filter)
        .populate('owner', 'fullName email avatarUrl avatarId')
        .select('title thumbnail createdAt updatedAt isPublic elementCount collaborators owner')
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Canvas.countDocuments(filter),
    ]);

    const result = canvases.map((c) => {
      const collab = c.collaborators.find(
        (col) => col.user?.toString() === mongoUser._id.toString()
      );
      return {
        _id:          c._id,
        title:        c.title,
        thumbnail:    c.thumbnail,
        createdAt:    c.createdAt,
        updatedAt:    c.updatedAt,
        isPublic:     c.isPublic,
        elementCount: c.elementCount,
        myRole:       collab?.role || 'viewer',
        owner:        c.owner,
      };
    });

    return res.json({ canvases: result, total, page, limit });
  } catch (err) {
    logger.error('getSharedWithMe:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.createCanvas = async (req, res) => {
  try {
    const mongoUser = await getMongoUser(req.user.uid);
    if (!mongoUser) return res.status(404).json({ message: 'User not found' });

    const title = (req.body.title || 'Untitled Canvas').trim().slice(0, 200);
    const canvas = await Canvas.create({ title, owner: mongoUser._id });
    return res.status(201).json({ canvas });
  } catch (err) {
    logger.error('createCanvas:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getCanvas = async (req, res) => {
  try {
    const mongoUser = await getMongoUser(req.user.uid);
    if (!mongoUser) return res.status(403).json({ message: 'User not found' });

    const canvas = await Canvas.findById(req.params.canvasId)
      .populate('owner', 'fullName email avatarUrl avatarId')
      .populate('collaborators.user', 'fullName email avatarUrl avatarId')
      .lean();

    if (!canvas) return res.status(404).json({ message: 'Canvas not found' });

    const shareToken = req.headers['x-share-token'] || null;
    const role = getEffectiveRole(canvas, mongoUser._id, shareToken);
    if (!role) {
      return res.status(403).json({ message: 'Access denied. Ask the owner for an invite link.' });
    }

    if (role !== 'owner') {
      const alreadyCollab = canvas.collaborators.some(
        (c) => c.user?._id?.toString() === mongoUser._id.toString()
      );
      if (!alreadyCollab && shareToken) {
        await Canvas.findByIdAndUpdate(canvas._id, {
          $push: { collaborators: { user: mongoUser._id, role } },
        });
      }
    }

    return res.json({ canvas, userRole: role });
  } catch (err) {
    logger.error('getCanvas:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updateCanvas = async (req, res) => {
  try {
    const mongoUser = await getMongoUser(req.user.uid);
    if (!mongoUser) return res.status(403).json({ message: 'User not found' });

    const canvas = await Canvas.findById(req.params.canvasId).lean();
    if (!canvas) return res.status(404).json({ message: 'Canvas not found' });

    const role = getEffectiveRole(canvas, mongoUser._id);
    if (!canEdit(role)) return res.status(403).json({ message: 'Editors and owners can update a canvas' });

    const allowed = {};
    if (req.body.title    !== undefined) allowed.title    = String(req.body.title).trim().slice(0, 200);
    if (req.body.tags     !== undefined) allowed.tags     = Array.isArray(req.body.tags) ? req.body.tags.slice(0, 20) : [];
    if (req.body.isPublic !== undefined && role === 'owner') allowed.isPublic = Boolean(req.body.isPublic);

    if (!Object.keys(allowed).length) return res.status(400).json({ message: 'No valid fields to update' });

    const updated = await Canvas.findByIdAndUpdate(canvas._id, allowed, { new: true }).lean();
    return res.json({ canvas: updated });
  } catch (err) {
    logger.error('updateCanvas:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.deleteCanvas = async (req, res) => {
  try {
    const mongoUser = await getMongoUser(req.user.uid);
    if (!mongoUser) return res.status(403).json({ message: 'User not found' });

    const canvas = await Canvas.findById(req.params.canvasId).lean();
    if (!canvas) return res.status(404).json({ message: 'Canvas not found' });
    if (canvas.owner.toString() !== mongoUser._id.toString()) {
      return res.status(403).json({ message: 'Only the owner can delete this canvas' });
    }

    await Promise.all([
      Canvas.deleteOne({ _id: canvas._id }),
      CanvasElement.deleteMany({ canvasId: canvas._id }),
    ]);

    return res.json({ message: 'Canvas deleted' });
  } catch (err) {
    logger.error('deleteCanvas:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.duplicateCanvas = async (req, res) => {
  try {
    const mongoUser = await getMongoUser(req.user.uid);
    if (!mongoUser) return res.status(403).json({ message: 'User not found' });

    const source = await Canvas.findById(req.params.canvasId).lean();
    if (!source) return res.status(404).json({ message: 'Canvas not found' });

    const role = getEffectiveRole(source, mongoUser._id);
    if (!role) return res.status(403).json({ message: 'Access denied' });

    const newCanvas = await Canvas.create({
      title: (req.body.title || `${source.title} (Copy)`).trim().slice(0, 200),
      owner: mongoUser._id,
      isPublic: false,
    });

    const elements = await CanvasElement.find({ canvasId: source._id, isDeleted: false }).lean();
    if (elements.length) {
      const copies = elements.map(({ _id, createdAt, updatedAt, __v, ...el }) => ({
        ...el,
        canvasId:  newCanvas._id,
        createdBy: mongoUser._id,
        updatedBy: mongoUser._id,
        version:   1,
      }));
      await CanvasElement.insertMany(copies, { ordered: false });
      await Canvas.findByIdAndUpdate(newCanvas._id, { elementCount: copies.length });
    }

    return res.status(201).json({ canvas: newCanvas });
  } catch (err) {
    logger.error('duplicateCanvas:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// ── Elements ──────────────────────────────────────────────────────────────────
exports.getElements = async (req, res) => {
  try {
    const mongoUser = await getMongoUser(req.user.uid);
    if (!mongoUser) return res.status(403).json({ message: 'User not found' });

    const canvas = await Canvas.findById(req.params.canvasId).lean();
    if (!canvas) return res.status(404).json({ message: 'Canvas not found' });

    const role = getEffectiveRole(canvas, mongoUser._id, req.headers['x-share-token']);
    if (!role) return res.status(403).json({ message: 'Access denied' });

    const elements = await CanvasElement.find({ canvasId: canvas._id, isDeleted: false })
      .select('-__v')
      .sort({ zIndex: 1, createdAt: 1 })
      .lean();

    return res.json({ elements, canvasId: canvas._id });
  } catch (err) {
    logger.error('getElements:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.saveCanvasState = async (req, res) => {
  try {
    const mongoUser = await getMongoUser(req.user.uid);
    if (!mongoUser) return res.status(403).json({ message: 'User not found' });

    const canvas = await Canvas.findById(req.params.canvasId).lean();
    if (!canvas) return res.status(404).json({ message: 'Canvas not found' });

    const role = getEffectiveRole(canvas, mongoUser._id);
    if (!canEdit(role)) return res.status(403).json({ message: 'No permission to save' });

    let elements = [], deletedIds = [], viewport = null;
    try {
      const raw = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      elements   = Array.isArray(raw.elements)   ? raw.elements   : [];
      deletedIds = Array.isArray(raw.deletedIds) ? raw.deletedIds : [];
      viewport   = raw.viewport ?? null;
    } catch {
      return res.status(400).json({ message: 'Invalid request body' });
    }

    const ops = [];
    for (const el of elements) {
      if (!el.elementId) continue;
      ops.push({
        updateOne: {
          filter: { canvasId: canvas._id, elementId: el.elementId },
          update: {
            $set: { ...sanitizeElement(el), canvasId: canvas._id, updatedBy: mongoUser._id },
            $setOnInsert: { createdBy: mongoUser._id },
            $inc: { version: 1 },
          },
          upsert: true,
        },
      });
    }
    for (const elementId of deletedIds) {
      ops.push({
        updateOne: {
          filter: { canvasId: canvas._id, elementId },
          update: { $set: { isDeleted: true, updatedBy: mongoUser._id } },
        },
      });
    }
    if (ops.length) await CanvasElement.bulkWrite(ops, { ordered: false });

    const activeCount = await CanvasElement.countDocuments({ canvasId: canvas._id, isDeleted: false });
    const metaUpdate  = { elementCount: activeCount };
    if (viewport) metaUpdate.lastViewport = viewport;
    await Canvas.findByIdAndUpdate(canvas._id, metaUpdate);

    return res.status(202).json({ message: 'Saved', elementCount: activeCount });
  } catch (err) {
    logger.error('saveCanvasState:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.saveThumbnail = async (req, res) => {
  try {
    const mongoUser = await getMongoUser(req.user.uid);
    if (!mongoUser) return res.status(403).json({ message: 'User not found' });

    const canvas = await Canvas.findById(req.params.canvasId).lean();
    if (!canvas) return res.status(404).json({ message: 'Canvas not found' });

    const role = getEffectiveRole(canvas, mongoUser._id);
    if (!canEdit(role)) return res.status(403).json({ message: 'No permission' });

    const { thumbnail } = req.body;
    if (!thumbnail || typeof thumbnail !== 'string') {
      return res.status(400).json({ message: 'thumbnail (base64 string) is required' });
    }

    await Canvas.findByIdAndUpdate(canvas._id, { thumbnail });
    return res.json({ message: 'Thumbnail saved' });
  } catch (err) {
    logger.error('saveThumbnail:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// ── Sharing ───────────────────────────────────────────────────────────────────
exports.resolveShareToken = async (req, res) => {
  try {
    const canvas = await Canvas.findOne({ 'shareTokens.token': req.params.token })
      .select('_id title shareTokens')
      .lean();
    if (!canvas) return res.status(404).json({ message: 'Invalid or expired link' });
    const entry = canvas.shareTokens.find((t) => t.token === req.params.token);
    return res.json({ canvasId: canvas._id, title: canvas.title, role: entry.role });
  } catch (err) {
    logger.error('resolveShareToken:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.generateShareLinks = async (req, res) => {
  try {
    const mongoUser = await getMongoUser(req.user.uid);
    if (!mongoUser) return res.status(403).json({ message: 'User not found' });

    const canvas = await Canvas.findById(req.params.canvasId);
    if (!canvas) return res.status(404).json({ message: 'Canvas not found' });
    if (canvas.owner.toString() !== mongoUser._id.toString()) {
      return res.status(403).json({ message: 'Only the owner can manage share links' });
    }

    const roles = (req.body.roles || ['viewer', 'editor', 'voice'])
      .filter((r) => ['viewer', 'editor', 'voice'].includes(r));

    const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:3000';
    for (const role of roles) {
      if (!canvas.shareTokens.find((t) => t.role === role)) {
        canvas.shareTokens.push({ token: crypto.randomBytes(20).toString('hex'), role });
      }
    }
    await canvas.save();

    const links = {};
    canvas.shareTokens
      .filter((t) => roles.includes(t.role))
      .forEach(({ token, role }) => { links[role] = `${FRONTEND}/canvas/join/${token}`; });

    return res.json({ links });
  } catch (err) {
    logger.error('generateShareLinks:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.revokeShareLink = async (req, res) => {
  try {
    const mongoUser = await getMongoUser(req.user.uid);
    if (!mongoUser) return res.status(403).json({ message: 'User not found' });

    const canvas = await Canvas.findById(req.params.canvasId);
    if (!canvas) return res.status(404).json({ message: 'Canvas not found' });
    if (canvas.owner.toString() !== mongoUser._id.toString()) {
      return res.status(403).json({ message: 'Only the owner can revoke share links' });
    }

    const role = req.params.role;
    canvas.shareTokens = canvas.shareTokens.filter((t) => t.role !== role);
    await canvas.save();
    return res.json({ message: `Share link for '${role}' revoked` });
  } catch (err) {
    logger.error('revokeShareLink:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// ── Collaborators ─────────────────────────────────────────────────────────────
exports.addCollaborator = async (req, res) => {
  try {
    const mongoUser = await getMongoUser(req.user.uid);
    if (!mongoUser) return res.status(403).json({ message: 'User not found' });

    const canvas = await Canvas.findById(req.params.canvasId);
    if (!canvas) return res.status(404).json({ message: 'Canvas not found' });
    if (canvas.owner.toString() !== mongoUser._id.toString()) {
      return res.status(403).json({ message: 'Only the owner can add collaborators' });
    }

    const { email, userId, role = 'viewer' } = req.body;
    let targetUser;
    if (userId) targetUser = await User.findById(userId).lean();
    else if (email) targetUser = await User.findOne({ email: email.toLowerCase().trim() }).lean();
    if (!targetUser) return res.status(404).json({ message: 'User not found' });

    const existingIdx = canvas.collaborators.findIndex(
      (c) => c.user?.toString() === targetUser._id.toString()
    );
    if (existingIdx !== -1) canvas.collaborators[existingIdx].role = role;
    else canvas.collaborators.push({ user: targetUser._id, role });
    await canvas.save();

    return res.json({ message: 'Collaborator added' });
  } catch (err) {
    logger.error('addCollaborator:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updateCollaboratorRole = async (req, res) => {
  try {
    const mongoUser = await getMongoUser(req.user.uid);
    if (!mongoUser) return res.status(403).json({ message: 'User not found' });

    const canvas = await Canvas.findById(req.params.canvasId);
    if (!canvas) return res.status(404).json({ message: 'Canvas not found' });
    if (canvas.owner.toString() !== mongoUser._id.toString()) {
      return res.status(403).json({ message: 'Only the owner can change roles' });
    }

    const { role } = req.body;
    const collab = canvas.collaborators.find(
      (c) => c.user?.toString() === req.params.userId
    );
    if (!collab) return res.status(404).json({ message: 'Collaborator not found' });
    collab.role = role;
    await canvas.save();
    return res.json({ message: 'Role updated' });
  } catch (err) {
    logger.error('updateCollaboratorRole:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.removeCollaborator = async (req, res) => {
  try {
    const mongoUser = await getMongoUser(req.user.uid);
    if (!mongoUser) return res.status(403).json({ message: 'User not found' });

    const canvas = await Canvas.findById(req.params.canvasId);
    if (!canvas) return res.status(404).json({ message: 'Canvas not found' });
    if (canvas.owner.toString() !== mongoUser._id.toString()) {
      return res.status(403).json({ message: 'Only the owner can remove collaborators' });
    }
    canvas.collaborators = canvas.collaborators.filter(
      (c) => c.user?.toString() !== req.params.userId
    );
    await canvas.save();
    return res.json({ message: 'Collaborator removed' });
  } catch (err) {
    logger.error('removeCollaborator:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.leaveCanvas = async (req, res) => {
  try {
    const mongoUser = await getMongoUser(req.user.uid);
    if (!mongoUser) return res.status(403).json({ message: 'User not found' });

    const canvas = await Canvas.findById(req.params.canvasId);
    if (!canvas) return res.status(404).json({ message: 'Canvas not found' });
    if (canvas.owner.toString() === mongoUser._id.toString()) {
      return res.status(400).json({ message: 'Owner cannot leave. Delete the canvas instead.' });
    }
    canvas.collaborators = canvas.collaborators.filter(
      (c) => c.user?.toString() !== mongoUser._id.toString()
    );
    await canvas.save();
    return res.json({ message: 'You have left the canvas' });
  } catch (err) {
    logger.error('leaveCanvas:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// ── AI Chat ───────────────────────────────────────────────────────────────────
// POST /api/v1/canvas/:canvasId/ai-chat
// Body: { message: string, canvasContext: string, history: [{role,content}] }
//
// Works with or without ANTHROPIC_API_KEY:
//   • With key   → calls claude-haiku for a real AI reply
//   • Without key → returns a helpful rule-based fallback
exports.aiChat = async (req, res) => {
  try {
    const mongoUser = await getMongoUser(req.user.uid);
    if (!mongoUser) return res.status(403).json({ message: 'User not found' });

    const canvas = await Canvas.findById(req.params.canvasId).lean();
    if (!canvas) return res.status(404).json({ message: 'Canvas not found' });

    const role = getEffectiveRole(canvas, mongoUser._id, req.headers['x-share-token']);
    if (!role) return res.status(403).json({ message: 'Access denied' });

    const { message, canvasContext = '', history = [] } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ message: 'message is required' });
    }

    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

    // ── No API key: rule-based fallback ──────────────────────────────────────
    if (!ANTHROPIC_API_KEY) {
      const lc = message.toLowerCase();
      let reply = '';

      if (lc.includes('what') && (lc.includes('canvas') || lc.includes('drawn') || lc.includes('on'))) {
        reply = canvasContext
          ? `Here's what I can see on the canvas:\n\n${canvasContext}`
          : 'The canvas appears to be empty right now. Start drawing to add content!';
      } else if (lc.includes('explain') || lc.includes('describe')) {
        reply = canvasContext
          ? `Let me describe what's on the canvas:\n\n${canvasContext}\n\nFor detailed AI analysis, add an ANTHROPIC_API_KEY to your backend .env file.`
          : 'The canvas is empty. Draw something first and I can describe it!';
      } else if (lc.includes('suggest') || lc.includes('next') || lc.includes('should')) {
        reply = 'Here are some suggestions:\n• Add more shapes to build your diagram\n• Use connectors to link flowchart elements\n• Add text labels to explain your drawing\n• Try the AI toggle (✨) in the toolbar for smart shape suggestions';
      } else if (lc.includes('help') || lc.includes('how')) {
        reply = 'I can help you with:\n• **Explaining** what\'s drawn on the canvas\n• **Suggesting** next steps for your diagram\n• **Describing** the flowchart structure\n\nFor full AI responses, add ANTHROPIC_API_KEY to your .env file.';
      } else {
        reply = canvasContext
          ? `You asked: "${message}"\n\nCanvas context:\n${canvasContext}\n\n*Full AI responses require ANTHROPIC_API_KEY in your backend .env file.*`
          : `You asked: "${message}"\n\nThe canvas is currently empty.\n\n*Full AI responses require ANTHROPIC_API_KEY in your .env file.*`;
      }

      return res.json({ reply, generated: false });
    }

    // ── With API key: call Claude ────────────────────────────────────────────
    const systemPrompt = `You are a helpful AI assistant embedded in a collaborative whiteboard application called Canvas.
You can see the current state of the whiteboard and help users understand, analyze, and improve their drawings.

Current canvas state:
${canvasContext || 'The canvas is empty.'}

Guidelines:
- Be concise and helpful (2-4 sentences max unless explaining something complex)
- When explaining diagrams, be specific about what shapes and connections you see
- Suggest actionable next steps when appropriate
- Use simple markdown (bold with **, bullets with •)
- If canvas is empty, encourage the user to start drawing`;

    const messages = [
      // Include conversation history (max 8 messages = 4 turns)
      ...history.slice(-8).map(h => ({
        role:    h.role,
        content: h.content,
      })),
      { role: 'user', content: message },
    ];

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-api-key':       ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system:     systemPrompt,
        messages,
      }),
    });

    if (!aiRes.ok) {
      const errBody = await aiRes.text();
      logger.error('Anthropic API error:', aiRes.status, errBody);
      throw new Error(`Anthropic API returned ${aiRes.status}`);
    }

    const aiData = await aiRes.json();
    const reply  = aiData.content?.[0]?.text || 'Sorry, I could not generate a response.';

    return res.json({ reply, generated: true });
  } catch (err) {
    logger.error('aiChat:', err);
    return res.status(500).json({ message: 'AI chat failed. Please try again.' });
  }
};

// ── Legacy AI endpoints (kept for compatibility) ──────────────────────────────
exports.getAISummary = async (req, res) => {
  try {
    const mongoUser = await getMongoUser(req.user.uid);
    if (!mongoUser) return res.status(403).json({ message: 'User not found' });

    const canvas = await Canvas.findById(req.params.canvasId).lean();
    if (!canvas) return res.status(404).json({ message: 'Canvas not found' });

    const role = getEffectiveRole(canvas, mongoUser._id);
    if (!role) return res.status(403).json({ message: 'Access denied' });

    const elements = await CanvasElement.find({ canvasId: canvas._id, isDeleted: false }).lean();
    if (elements.length === 0) {
      return res.json({ summary: 'Canvas is empty — nothing to summarize yet.' });
    }

    const counts = { stroke: 0, shape: 0, text: 0 };
    const texts = [], shapes = [];
    elements.forEach((el) => {
      if (el.type === 'stroke') { counts.stroke++; }
      else if (el.type === 'text') { counts.text++; if (el.text) texts.push(el.text.trim().slice(0, 120)); }
      else { counts.shape++; shapes.push(el.subtype || el.type || 'shape'); }
    });

    const description = [
      `Canvas has ${elements.length} element(s):`,
      counts.stroke > 0 ? `- ${counts.stroke} freehand stroke(s)` : '',
      counts.shape  > 0 ? `- ${counts.shape} shape(s): ${[...new Set(shapes)].join(', ')}` : '',
      counts.text   > 0 ? `- ${counts.text} text element(s)` : '',
      texts.length  > 0 ? `Text content: ${texts.join(' | ')}` : '',
    ].filter(Boolean).join('\n');

    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
      return res.json({
        summary: `This canvas contains ${elements.length} element(s): ${counts.stroke} stroke(s), ${counts.shape} shape(s), ${counts.text} text block(s).`,
        generated: false,
      });
    }

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: `Summarize this collaborative whiteboard in 2-3 sentences:\n\n${description}` }],
      }),
    });

    if (!aiRes.ok) throw new Error('AI API error');
    const aiData = await aiRes.json();
    res.json({ summary: aiData.content?.[0]?.text || 'Could not generate summary.', generated: true });
  } catch (err) {
    logger.error('getAISummary:', err);
    res.status(500).json({ message: 'Failed to generate summary' });
  }
};

exports.getAIStrokeSuggestion = async (req, res) => {
  try {
    const { strokeDescription } = req.body;
    if (!strokeDescription) return res.json({ suggestion: null });
    const { isClosed, aspectRatio } = strokeDescription;
    if (isClosed) {
      if (aspectRatio > 0.7 && aspectRatio < 1.4) return res.json({ suggestion: 'Circle' });
      if (Math.abs(aspectRatio - 1) < 0.5)        return res.json({ suggestion: 'Diamond (Decision)' });
      return res.json({ suggestion: 'Rectangle (Process)' });
    }
    return res.json({ suggestion: 'Line/Connector' });
  } catch (err) {
    res.json({ suggestion: null });
  }
};

// ── Update title (legacy alias) ───────────────────────────────────────────────
exports.updateTitle = exports.updateCanvas;