const Canvas = require('../controller/canvas.controller.js');
const crypto = require('crypto');

// GET /api/v1/canvas/my  — All canvases for logged-in user
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

// POST /api/v1/canvas/create  — Create new canvas
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

// GET /api/v1/canvas/:canvasId  — Get single canvas
exports.getCanvas = async (req, res) => {
  try {
    const { canvasId } = req.params;
    const canvas = await Canvas.findById(canvasId)
      .populate('owner', 'fullName email avatarId')
      .populate('collaborators.user', 'fullName email avatarId');

    if (!canvas) return res.status(404).json({ message: 'Canvas not found' });

    const isOwner = canvas.owner._id.toString() === req.user._id.toString();
    const isCollaborator = canvas.collaborators.some(
      (c) => c.user?._id.toString() === req.user._id.toString()
    );

    if (!canvas.isPublic && !isOwner && !isCollaborator) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json({ canvas });
  } catch (err) {
    console.error('getCanvas:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// DELETE /api/v1/canvas/:canvasId  — Delete canvas (owner only)
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
    console.error('deleteCanvas:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// PATCH /api/v1/canvas/:canvasId/title  — Rename canvas
exports.updateTitle = async (req, res) => {
  try {
    const { title } = req.body;
    const canvas = await Canvas.findOneAndUpdate(
      { _id: req.params.canvasId, owner: req.user._id },
      { title },
      { new: true }
    );
    if (!canvas) return res.status(404).json({ message: 'Canvas not found or not owner' });
    res.json({ canvas });
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' });
  }
};

// POST /api/v1/canvas/:canvasId/share  — Generate share link
exports.generateShareLink = async (req, res) => {
  try {
    const canvas = await Canvas.findById(req.params.canvasId);
    if (!canvas) return res.status(404).json({ message: 'Canvas not found' });
    if (canvas.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only owner can share' });
    }

    const token = crypto.randomBytes(16).toString('hex');
    canvas.shareToken = token;
    canvas.isPublic = true;
    await canvas.save();

    const shareUrl = `${process.env.FRONTEND_URL}/canvas/shared/${token}`;
    res.json({ shareUrl, token });
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' });
  }
};

// GET /api/v1/canvas/shared/:token  — Access shared canvas (no auth)
exports.getSharedCanvas = async (req, res) => {
  try {
    const canvas = await Canvas.findOne({ shareToken: req.params.token });
    if (!canvas || !canvas.isPublic) {
      return res.status(404).json({ message: 'Shared canvas not found' });
    }
    res.json({ canvas });
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' });
  }
};

// POST /api/v1/canvas/:canvasId/collaborator  — Add collaborator
exports.addCollaborator = async (req, res) => {
  try {
    const { userId, role } = req.body;
    const canvas = await Canvas.findById(req.params.canvasId);

    if (!canvas) return res.status(404).json({ message: 'Canvas not found' });
    if (canvas.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only owner can add collaborators' });
    }

    const already = canvas.collaborators.some((c) => c.user?.toString() === userId);
    if (already) return res.status(400).json({ message: 'User already a collaborator' });

    canvas.collaborators.push({ user: userId, role: role || 'editor' });
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

// POST /api/v1/canvas/:canvasId/save  — Save full canvas state (fallback / manual save)
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