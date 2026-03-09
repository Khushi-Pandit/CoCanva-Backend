// FILE: src/controller/canvas.controller.js
const Canvas = require('../models/canvas.model');
const crypto = require('crypto');

// GET /api/v1/canvas  — canvases owned by me
exports.getMyCanvases = async (req, res) => {
  try {
    const canvases = await Canvas.find({ owner: req.user._id })
      .select('title thumbnail createdAt updatedAt collaborators isPublic')
      .sort({ updatedAt: -1 });
    res.json({ canvases });
  } catch (err) {
    console.error('getMyCanvases:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ── TASK 5: GET /api/v1/canvas/shared ─────────────────────────────────────────
// Returns all canvases where I am a collaborator (NOT owner)
exports.getSharedWithMe = async (req, res) => {
  try {
    const canvases = await Canvas.find({
      'collaborators.user': req.user._id,
      owner: { $ne: req.user._id },   // exclude canvases I own
    })
      .populate('owner', 'fullName email avatarId')
      .select('title thumbnail createdAt updatedAt collaborators owner isPublic')
      .sort({ updatedAt: -1 });

    // Attach my role for each canvas
    const result = canvases.map((c) => {
      const collab = c.collaborators.find(
        (col) => col.user?.toString() === req.user._id.toString()
      );
      return {
        _id:          c._id,
        title:        c.title,
        thumbnail:    c.thumbnail,
        createdAt:    c.createdAt,
        updatedAt:    c.updatedAt,
        isPublic:     c.isPublic,
        myRole:       collab?.role || 'viewer',
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
    const { title } = req.body;
    const canvas = new Canvas({
      title: title || 'Untitled Canvas',
      owner: req.user._id,
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
    const canvas = await Canvas.findById(req.params.canvasId)
      .populate('owner', 'fullName email avatarId')
      .populate('collaborators.user', 'fullName email avatarId');

    if (!canvas) return res.status(404).json({ message: 'Canvas not found' });

    const isOwner      = canvas.owner._id.toString() === req.user._id.toString();
    const collaborator = canvas.collaborators.find(
      (c) => c.user?._id.toString() === req.user._id.toString()
    );

    const shareTokenHeader = req.headers['x-share-token'];
    let shareTokenRole = null;
    if (shareTokenHeader) {
      const entry = canvas.shareTokens.find((t) => t.token === shareTokenHeader);
      if (entry) shareTokenRole = entry.role;
    }

    const hasAccess = isOwner || !!collaborator || !!shareTokenRole;
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied. You need an invite link.' });
    }

    let userRole = 'viewer';
    if (isOwner)             userRole = 'owner';
    else if (collaborator)   userRole = collaborator.role;
    else if (shareTokenRole) userRole = shareTokenRole;

    // ── TASK 5: if user joined via share token, auto-add as collaborator ─────
    if (!isOwner && !collaborator && shareTokenRole) {
      canvas.collaborators.push({ user: req.user._id, role: shareTokenRole });
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
    const canvas = await Canvas.findById(req.params.canvasId);
    if (!canvas) return res.status(404).json({ message: 'Canvas not found' });
    if (canvas.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only owner can delete' });
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
    const canvas = await Canvas.findOneAndUpdate(
      { _id: req.params.canvasId, owner: req.user._id },
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
    const canvas = await Canvas.findById(req.params.canvasId);
    if (!canvas) return res.status(404).json({ message: 'Canvas not found' });
    if (canvas.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only owner can share' });
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

// GET /api/v1/canvas/join/:token
exports.resolveShareToken = async (req, res) => {
  try {
    const canvas = await Canvas.findOne({ 'shareTokens.token': req.params.token });
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
    const { userId, role } = req.body;
    const canvas = await Canvas.findById(req.params.canvasId);
    if (!canvas) return res.status(404).json({ message: 'Canvas not found' });
    if (canvas.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only owner can add collaborators' });
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
    const canvas = await Canvas.findById(req.params.canvasId);
    if (!canvas) return res.status(404).json({ message: 'Canvas not found' });
    if (canvas.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only owner can remove collaborators' });
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
    let elements, viewport;
    if (typeof req.body === 'string') {
      try {
        const parsed = JSON.parse(req.body);
        elements = parsed.elements;
        viewport = parsed.viewport;
      } catch {
        return res.status(400).json({ message: 'Invalid body' });
      }
    } else {
      elements = req.body.elements;
      viewport = req.body.viewport;
    }

    const canvas = await Canvas.findById(req.params.canvasId);
    if (!canvas) return res.status(404).json({ message: 'Canvas not found' });

    const isOwner      = canvas.owner.toString() === req.user._id.toString();
    const collaborator = canvas.collaborators.find(
      (c) => c.user?.toString() === req.user._id.toString()
    );
    const canSave =
      isOwner || (collaborator && ['editor', 'voice'].includes(collaborator.role));
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

// ── TASK 2: POST /api/v1/canvas/:canvasId/ai-summary ─────────────────────────
// Generates AI summary of canvas elements
exports.getAISummary = async (req, res) => {
  try {
    const canvas = await Canvas.findById(req.params.canvasId);
    if (!canvas) return res.status(404).json({ message: 'Canvas not found' });

    const isOwner      = canvas.owner.toString() === req.user._id.toString();
    const collaborator = canvas.collaborators.find(
      (c) => c.user?.toString() === req.user._id.toString()
    );
    if (!isOwner && !collaborator) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const elements = canvas.elements || [];
    if (elements.length === 0) {
      return res.json({ summary: 'Canvas is empty — nothing to summarize yet.' });
    }

    // Build a structured description for Anthropic API
    const counts = { stroke: 0, shape: 0, text: 0 };
    const texts  = [];
    const shapes = [];

    elements.forEach((el) => {
      if (el.kind === 'stroke') counts.stroke++;
      else if (el.kind === 'shape') {
        counts.shape++;
        shapes.push(`${el.shapeType || 'shape'}`);
      } else if (el.kind === 'text') {
        counts.text++;
        if (el.text) texts.push(el.text.trim().slice(0, 120));
      }
    });

    const description = [
      `Canvas has ${elements.length} element(s):`,
      counts.stroke > 0 ? `- ${counts.stroke} freehand stroke(s)` : '',
      counts.shape  > 0 ? `- ${counts.shape} shape(s): ${[...new Set(shapes)].join(', ')}` : '',
      counts.text   > 0 ? `- ${counts.text} text element(s)` : '',
      texts.length  > 0 ? `Text content: ${texts.join(' | ')}` : '',
    ].filter(Boolean).join('\n');

    // Call Anthropic API
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
      // Fallback summary without AI
      return res.json({
        summary: `This canvas contains ${elements.length} element(s): ${counts.stroke} drawing stroke(s), ${counts.shape} shape(s), and ${counts.text} text block(s).${texts.length > 0 ? ` Key text: "${texts.slice(0, 3).join('", "')}"` : ''}`,
        generated: false,
      });
    }

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-3-haiku-20240307',
        max_tokens: 300,
        messages: [{
          role:    'user',
          content: `You are summarizing a collaborative whiteboard canvas. Based on the following element breakdown, write a clear 2-3 sentence summary of what this canvas appears to contain or represent. Be concise and insightful.\n\n${description}`,
        }],
      }),
    });

    if (!aiRes.ok) throw new Error('AI API error');
    const aiData = await aiRes.json();
    const summary = aiData.content?.[0]?.text || 'Could not generate summary.';

    res.json({ summary, generated: true });
  } catch (err) {
    console.error('getAISummary:', err);
    res.status(500).json({ message: 'Failed to generate summary' });
  }
};

// ── TASK 2b: POST /api/v1/canvas/:canvasId/ai-stroke ──────────────────────
// AI Pencil — interprets a stroke description and suggests what user meant
exports.getAIStrokeSuggestion = async (req, res) => {
  try {
    const { strokeDescription } = req.body;
    if (!strokeDescription) return res.json({ suggestion: null });

    const { isClosed, aspectRatio, width, height, pointCount } = strokeDescription;

    // Rule-based fast path (no API needed for obvious cases)
    if (isClosed) {
      if (aspectRatio > 0.7 && aspectRatio < 1.4) return res.json({ suggestion: 'Circle — use the circle flowchart tool for a clean shape' });
      if (aspectRatio > 0.4 && aspectRatio < 2.5) {
        if (Math.abs(aspectRatio - 1) < 0.5) return res.json({ suggestion: 'Diamond (Decision) — press Tab to accept ghost shape' });
        return res.json({ suggestion: 'Rectangle (Process) — press Tab to accept ghost shape' });
      }
    } else {
      if (width < 20 && height < 20) return res.json({ suggestion: null }); // too small
      return res.json({ suggestion: 'Line/Connector — use connector tool to link flowchart shapes' });
    }

    res.json({ suggestion: null });
  } catch (err) {
    console.error('getAIStrokeSuggestion:', err);
    res.json({ suggestion: null });
  }
};
