const Canvas = require('../models/canvas.model');
const crypto = require('crypto');

// GET /api/v1/canvas
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
// Accepts optional x-share-token header to resolve role for share-link users
exports.getCanvas = async (req, res) => {
  try {
    const canvas = await Canvas.findById(req.params.canvasId)
      .populate('owner', 'fullName email avatarId')
      .populate('collaborators.user', 'fullName email avatarId');

    if (!canvas) return res.status(404).json({ message: 'Canvas not found' });

    const isOwner      = canvas.owner._id.toString() === req.user._id.toString();
    const collaborator = canvas.collaborators.find(
      c => c.user?._id.toString() === req.user._id.toString()
    );

    // Check if user arrived via a share token (sent as x-share-token header by frontend)
    const shareTokenHeader = req.headers['x-share-token'];
    let shareTokenRole = null;
    if (shareTokenHeader) {
      const entry = canvas.shareTokens.find(t => t.token === shareTokenHeader);
      if (entry) shareTokenRole = entry.role;
    }

    // Access check: owner OR collaborator OR valid share token
    const hasAccess = isOwner || !!collaborator || !!shareTokenRole;
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied. You need an invite link to view this canvas.' });
    }

    // Determine role — priority: owner > collaborator > shareToken
    let userRole = 'viewer';
    if (isOwner)             userRole = 'owner';
    else if (collaborator)   userRole = collaborator.role;
    else if (shareTokenRole) userRole = shareTokenRole;

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
// Generates per-role invite links. Only owner can call this.
exports.generateShareLinks = async (req, res) => {
  try {
    const canvas = await Canvas.findById(req.params.canvasId);
    if (!canvas) return res.status(404).json({ message: 'Canvas not found' });
    if (canvas.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only owner can share' });
    }

    const roles = req.body.roles || ['viewer', 'editor', 'voice'];
    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

    // Generate token per role if not already existing
    for (const role of roles) {
      const exists = canvas.shareTokens.find(t => t.role === role);
      if (!exists) {
        canvas.shareTokens.push({ token: crypto.randomBytes(16).toString('hex'), role });
      }
    }
    await canvas.save();

    // Return share links in /canvas/join/:token format
    // This is the ONLY way to get access — direct /canvas/:id will 403 without a token
    const links = {};
    canvas.shareTokens
      .filter(t => roles.includes(t.role))
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
// Resolves share token → canvasId + role. Login required (enforced by middleware).
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
    if (already) return res.status(400).json({ message: 'Already a collaborator' });
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