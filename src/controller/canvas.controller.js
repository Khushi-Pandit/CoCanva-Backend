// FILE: src/controller/canvas.controller.js
const Canvas = require('../models/canvas.model');
const User   = require('../models/user.model');
const crypto = require('crypto');

// ── Helper: get MongoDB User _id from Firebase UID ───────────────────────────
// BUG FIX: req.user is the decoded Firebase token — req.user.uid is the
// Firebase UID string. But canvas.owner and canvas.collaborators[].user store
// the MongoDB User._id (ObjectId). We must look up the User document first.
// Previously all isOwner checks were comparing ObjectId vs Firebase UID string
// which ALWAYS returned false, so every authenticated user got 403 Access Denied
// unless they happened to have a share token.
const getMongoUser = async (firebaseUid) => {
  return User.findOne({ firebaseUid }).select('_id').lean();
};

// GET /api/v1/canvas
exports.getMyCanvases = async (req, res) => {
  try {
    const mongoUser = await getMongoUser(req.user.uid);
    if (!mongoUser) return res.status(404).json({ message: 'User not found' });

    const canvases = await Canvas.find({ owner: mongoUser._id })
      .select('title thumbnail createdAt updatedAt collaborators isPublic')
      .sort({ updatedAt: -1 });
    res.json({ canvases });
  } catch (err) {
    console.error('getMyCanvases:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// GET /api/v1/canvas/shared
exports.getSharedWithMe = async (req, res) => {
  try {
    const mongoUser = await getMongoUser(req.user.uid);
    if (!mongoUser) return res.status(404).json({ message: 'User not found' });

    const canvases = await Canvas.find({
      'collaborators.user': mongoUser._id,
      owner: { $ne: mongoUser._id },
    })
      .populate('owner', 'fullName email avatarId')
      .select('title thumbnail createdAt updatedAt collaborators owner isPublic')
      .sort({ updatedAt: -1 });

    const result = canvases.map((c) => {
      const collab = c.collaborators.find(
        (col) => col.user?.toString() === mongoUser._id.toString()
      );
      return {
        _id:       c._id,
        title:     c.title,
        thumbnail: c.thumbnail,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        isPublic:  c.isPublic,
        myRole:    collab?.role || 'viewer',
        owner: {
          _id:      c.owner._id,
          fullName: c.owner.fullName,
          email:    c.owner.email,
          avatarId: c.owner.avatarId,
        },
      };
    });

    res.json({ canvases: result });
  } catch (err) {
    console.error('getSharedWithMe:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// POST /api/v1/canvas
exports.createCanvas = async (req, res) => {
  try {
    const mongoUser = await getMongoUser(req.user.uid);
    if (!mongoUser) return res.status(404).json({ message: 'User not found' });

    const canvas = new Canvas({
      title: req.body.title || 'Untitled Canvas',
      owner: mongoUser._id,
    });
    await canvas.save();
    res.status(201).json({ canvas });
  } catch (err) {
    console.error('createCanvas:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// GET /api/v1/canvas/:canvasId
exports.getCanvas = async (req, res) => {
  try {
    const mongoUser = await getMongoUser(req.user.uid);
    if (!mongoUser) return res.status(403).json({ message: 'User not found' });

    const canvas = await Canvas.findById(req.params.canvasId)
      .populate('owner', 'fullName email avatarId')
      .populate('collaborators.user', 'fullName email avatarId');

    if (!canvas) return res.status(404).json({ message: 'Canvas not found' });

    const isOwner      = canvas.owner._id.toString() === mongoUser._id.toString();
    const collaborator = canvas.collaborators.find(
      (c) => c.user?._id.toString() === mongoUser._id.toString()
    );

    // Check share token from header
    const shareTokenHeader = req.headers['x-share-token'];
    let shareTokenRole = null;
    if (shareTokenHeader) {
      const entry = canvas.shareTokens.find((t) => t.token === shareTokenHeader);
      if (entry) shareTokenRole = entry.role;
    }

    const hasAccess = isOwner || !!collaborator || !!shareTokenRole;
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied. Ask the owner for an invite link.' });
    }

    let userRole = 'viewer';
    if (isOwner)             userRole = 'owner';
    else if (collaborator)   userRole = collaborator.role;
    else if (shareTokenRole) userRole = shareTokenRole;

    // Auto-add as collaborator if first access via share token
    if (!isOwner && !collaborator && shareTokenRole) {
      canvas.collaborators.push({ user: mongoUser._id, role: shareTokenRole });
      await canvas.save();
    }

    res.json({ canvas, userRole });
  } catch (err) {
    console.error('getCanvas:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// DELETE /api/v1/canvas/:canvasId
exports.deleteCanvas = async (req, res) => {
  try {
    const mongoUser = await getMongoUser(req.user.uid);
    if (!mongoUser) return res.status(403).json({ message: 'User not found' });

    const canvas = await Canvas.findById(req.params.canvasId);
    if (!canvas) return res.status(404).json({ message: 'Canvas not found' });
    if (canvas.owner.toString() !== mongoUser._id.toString()) {
      return res.status(403).json({ message: 'Only the owner can delete this canvas' });
    }
    await canvas.deleteOne();
    res.json({ message: 'Canvas deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' });
  }
};

// PUT /api/v1/canvas/:canvasId
exports.updateTitle = async (req, res) => {
  try {
    const mongoUser = await getMongoUser(req.user.uid);
    if (!mongoUser) return res.status(403).json({ message: 'User not found' });

    const canvas = await Canvas.findOneAndUpdate(
      { _id: req.params.canvasId, owner: mongoUser._id },
      { title: req.body.title },
      { new: true }
    );
    if (!canvas) return res.status(404).json({ message: 'Canvas not found or not owner' });
    res.json({ canvas });
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' });
  }
};

// POST /api/v1/canvas/:canvasId/share
exports.generateShareLinks = async (req, res) => {
  try {
    const mongoUser = await getMongoUser(req.user.uid);
    if (!mongoUser) return res.status(403).json({ message: 'User not found' });

    const canvas = await Canvas.findById(req.params.canvasId);
    if (!canvas) return res.status(404).json({ message: 'Canvas not found' });
    if (canvas.owner.toString() !== mongoUser._id.toString()) {
      return res.status(403).json({ message: 'Only the owner can share this canvas' });
    }

    const roles        = req.body.roles || ['viewer', 'editor', 'voice'];
    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

    for (const role of roles) {
      const exists = canvas.shareTokens.find((t) => t.role === role);
      if (!exists) {
        canvas.shareTokens.push({ token: crypto.randomBytes(16).toString('hex'), role });
      }
    }
    await canvas.save();

    const links = {};
    canvas.shareTokens
      .filter((t) => roles.includes(t.role))
      .forEach(({ token, role }) => {
        links[role] = `${FRONTEND_URL}/canvas/join/${token}`;
      });

    res.json({ links });
  } catch (err) {
    console.error('generateShareLinks:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// GET /api/v1/canvas/join/:token  — PUBLIC, no auth required
exports.resolveShareToken = async (req, res) => {
  try {
    const canvas = await Canvas.findOne({ 'shareTokens.token': req.params.token })
      .select('_id title shareTokens');
    if (!canvas) return res.status(404).json({ message: 'Invalid or expired link' });
    const entry = canvas.shareTokens.find((t) => t.token === req.params.token);
    res.json({ canvasId: canvas._id, role: entry.role, title: canvas.title });
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' });
  }
};

// POST /api/v1/canvas/:canvasId/collaborator
exports.addCollaborator = async (req, res) => {
  try {
    const mongoUser = await getMongoUser(req.user.uid);
    if (!mongoUser) return res.status(403).json({ message: 'User not found' });

    const { userId, role } = req.body;
    const canvas = await Canvas.findById(req.params.canvasId);
    if (!canvas) return res.status(404).json({ message: 'Canvas not found' });
    if (canvas.owner.toString() !== mongoUser._id.toString()) {
      return res.status(403).json({ message: 'Only the owner can add collaborators' });
    }
    if (canvas.collaborators.some((c) => c.user?.toString() === userId)) {
      return res.status(400).json({ message: 'Already a collaborator' });
    }
    canvas.collaborators.push({ user: userId, role: role || 'viewer' });
    await canvas.save();
    res.json({ message: 'Collaborator added', canvas });
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' });
  }
};

// DELETE /api/v1/canvas/:canvasId/collaborator/:userId
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
    res.json({ message: 'Collaborator removed' });
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' });
  }
};

// POST /api/v1/canvas/:canvasId/save
exports.saveCanvasState = async (req, res) => {
  try {
    const mongoUser = await getMongoUser(req.user.uid);
    if (!mongoUser) return res.status(403).json({ message: 'User not found' });

    let elements, viewport;
    if (typeof req.body === 'string') {
      try { ({ elements, viewport } = JSON.parse(req.body)); }
      catch { return res.status(400).json({ message: 'Invalid body' }); }
    } else {
      elements = req.body.elements;
      viewport = req.body.viewport;
    }

    const canvas = await Canvas.findById(req.params.canvasId);
    if (!canvas) return res.status(404).json({ message: 'Canvas not found' });

    const isOwner      = canvas.owner.toString() === mongoUser._id.toString();
    const collaborator = canvas.collaborators.find(
      (c) => c.user?.toString() === mongoUser._id.toString()
    );
    const canSave = isOwner || (collaborator && ['editor', 'voice'].includes(collaborator.role));
    if (!canSave) return res.status(403).json({ message: 'No permission to save' });

    const updated = await Canvas.findByIdAndUpdate(
      req.params.canvasId,
      { elements, viewport },
      { new: true }
    );
    res.json({ message: 'Saved', updatedAt: updated.updatedAt });
  } catch (err) {
    console.error('saveCanvasState:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// POST /api/v1/canvas/:canvasId/ai-summary
exports.getAISummary = async (req, res) => {
  try {
    const mongoUser = await getMongoUser(req.user.uid);
    if (!mongoUser) return res.status(403).json({ message: 'User not found' });

    const canvas = await Canvas.findById(req.params.canvasId);
    if (!canvas) return res.status(404).json({ message: 'Canvas not found' });

    const isOwner      = canvas.owner.toString() === mongoUser._id.toString();
    const collaborator = canvas.collaborators.find(
      (c) => c.user?.toString() === mongoUser._id.toString()
    );
    if (!isOwner && !collaborator) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const elements = canvas.elements || [];
    if (elements.length === 0) {
      return res.json({ summary: 'Canvas is empty — nothing to summarize yet.' });
    }

    const counts = { stroke: 0, shape: 0, text: 0 };
    const texts = [], shapes = [];
    elements.forEach((el) => {
      if (el.kind === 'stroke') counts.stroke++;
      else if (el.kind === 'shape') { counts.shape++; shapes.push(el.shapeType || 'shape'); }
      else if (el.kind === 'text')  { counts.text++;  if (el.text) texts.push(el.text.trim().slice(0, 120)); }
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
        model: 'claude-3-haiku-20240307',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `Summarize this collaborative whiteboard in 2-3 sentences:\n\n${description}`,
        }],
      }),
    });

    if (!aiRes.ok) throw new Error('AI API error');
    const aiData = await aiRes.json();
    res.json({ summary: aiData.content?.[0]?.text || 'Could not generate summary.', generated: true });
  } catch (err) {
    console.error('getAISummary:', err);
    res.status(500).json({ message: 'Failed to generate summary' });
  }
};

// POST /api/v1/canvas/:canvasId/ai-stroke
exports.getAIStrokeSuggestion = async (req, res) => {
  try {
    const { strokeDescription } = req.body;
    if (!strokeDescription) return res.json({ suggestion: null });
    const { isClosed, aspectRatio, width, height } = strokeDescription;
    if (isClosed) {
      if (aspectRatio > 0.7 && aspectRatio < 1.4) return res.json({ suggestion: 'Circle — use the circle flowchart tool' });
      if (Math.abs(aspectRatio - 1) < 0.5)        return res.json({ suggestion: 'Diamond (Decision) — press Tab to accept' });
      return res.json({ suggestion: 'Rectangle (Process) — press Tab to accept' });
    } else {
      if (width < 20 && height < 20) return res.json({ suggestion: null });
      return res.json({ suggestion: 'Line/Connector — use the connector tool' });
    }
  } catch (err) {
    console.error('getAIStrokeSuggestion:', err);
    res.json({ suggestion: null });
  }
};