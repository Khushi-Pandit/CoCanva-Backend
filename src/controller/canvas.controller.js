const Canvas = require('../models/canvas.model');
const crypto = require('crypto');

// GET /api/v1/canvas/my
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

// POST /api/v1/canvas/create
exports.createCanvas = async (req, res) => {
  try {
    const { title } = req.body;
    const canvas = new Canvas({ title: title || 'Untitled Canvas', owner: req.user._id });
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

    const isOwner        = canvas.owner._id.toString() === req.user._id.toString();
    const isCollaborator = canvas.collaborators.some(c => c.user?._id.toString() === req.user._id.toString());

    if (!canvas.isPublic && !isOwner && !isCollaborator) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json({ canvas });
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

// PATCH /api/v1/canvas/:canvasId/title
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
// Body: { roles: ['viewer','editor','voice'] }  — generate links for requested roles
exports.generateShareLinks = async (req, res) => {
  try {
    const canvas = await Canvas.findById(req.params.canvasId);
    if (!canvas) return res.status(404).json({ message: 'Canvas not found' });
    if (canvas.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only owner can share' });
    }

    const roles = req.body.roles || ['viewer', 'editor', 'voice'];
    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

    // Generate a token for each role if it doesn't exist yet
    for (const role of roles) {
      const exists = canvas.shareTokens.find(t => t.role === role);
      if (!exists) {
        canvas.shareTokens.push({ token: crypto.randomBytes(16).toString('hex'), role });
      }
    }

    canvas.isPublic = true;
    await canvas.save();

    // Return { viewer: url, editor: url, voice: url }
    const links = {};
    canvas.shareTokens.forEach(({ token, role }) => {
      links[role] = `${FRONTEND_URL}/canvas/join/${token}`;
    });

    res.json({ links });
  } catch (err) {
    console.error('generateShareLinks:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// GET /api/v1/canvas/join/:token  — resolve token → canvasId + role (requires login)
exports.resolveShareToken = async (req, res) => {
  try {
    const canvas = await Canvas.findOne({ 'shareTokens.token': req.params.token });
    if (!canvas) return res.status(404).json({ message: 'Invalid or expired link' });

    const entry = canvas.shareTokens.find(t => t.token === req.params.token);
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

    const already = canvas.collaborators.some(c => c.user?.toString() === userId);
    if (already) return res.status(400).json({ message: 'User already a collaborator' });

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
      c => c.user?.toString() !== req.params.userId
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
    const { elements, viewport } = req.body;
    const canvas = await Canvas.findOneAndUpdate(
      { _id: req.params.canvasId },
      { elements, viewport },
      { new: true }
    );
    if (!canvas) return res.status(404).json({ message: 'Canvas not found' });
    res.json({ message: 'Saved', updatedAt: canvas.updatedAt });
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' });
  }
};