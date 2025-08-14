import express from 'express';
import QRCodeModel from '../models/QRCode';
import { generateQRCode, generateQRCodeSVG, validateUrl, sanitizeUrl } from '../utils/qrGenerator';
import { authenticateToken } from '../middleware/auth';

const router = express.Router();

// Create QR Code (public endpoint - no auth required)
router.post('/generate', async (req, res) => {
  try {
    const { 
      url, 
      title, 
      description,
      size = 256,
      errorCorrectionLevel = 'M',
      foregroundColor = '#000000',
      backgroundColor = '#FFFFFF'
    } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const sanitizedUrl = sanitizeUrl(url);
    
    if (!validateUrl(sanitizedUrl)) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Generate QR code
    const qrResult = await generateQRCode(sanitizedUrl, {
      size: parseInt(size),
      errorCorrectionLevel,
      foregroundColor,
      backgroundColor
    });

    // Save to database
    const qrCode = new QRCodeModel({
      userId: req.user?.id || null, // Optional user association
      url: sanitizedUrl,
      shortId: qrResult.shortId,
      qrCodeData: qrResult.dataURL,
      title,
      description,
      customization: {
        size: parseInt(size),
        errorCorrectionLevel,
        foregroundColor,
        backgroundColor
      },
      isPremium: req.user?.plan !== 'free' || false
    });

    await qrCode.save();

    res.json({
      id: qrCode._id,
      qrCodeData: qrResult.dataURL,
      shortUrl: qrResult.redirectUrl,
      shortId: qrResult.shortId,
      originalUrl: sanitizedUrl,
      title,
      description,
      createdAt: qrCode.createdAt
    });

  } catch (error) {
    console.error('QR generation error:', error);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// Get QR Code details
router.get('/:id', async (req, res) => {
  try {
    const qrCode = await QRCodeModel.findById(req.params.id);
    
    if (!qrCode) {
      return res.status(404).json({ error: 'QR code not found' });
    }

    // Check if user owns this QR code (for premium features)
    const isOwner = req.user && qrCode.userId?.toString() === req.user.id;

    const response: any = {
      id: qrCode._id,
      qrCodeData: qrCode.qrCodeData,
      shortUrl: `${process.env.BASE_URL || 'http://localhost:5000'}/r/${qrCode.shortId}`,
      shortId: qrCode.shortId,
      originalUrl: qrCode.url,
      title: qrCode.title,
      description: qrCode.description,
      createdAt: qrCode.createdAt,
      customization: qrCode.customization
    };

    // Include analytics only for owners or premium features
    if (isOwner && qrCode.isPremium) {
      response.analytics = {
        totalScans: qrCode.analytics.totalScans,
        lastScanned: qrCode.analytics.lastScanned
      };
    }

    res.json(response);

  } catch (error) {
    console.error('QR fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch QR code' });
  }
});

// Get user's QR codes (requires auth)
router.get('/user/list', authenticateToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const qrCodes = await QRCodeModel
      .find({ userId: req.user!.id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-qrCodeData -analytics.scanHistory'); // Exclude large fields

    const total = await QRCodeModel.countDocuments({ userId: req.user!.id });

    res.json({
      qrCodes: qrCodes.map(qr => ({
        id: qr._id,
        shortUrl: `${process.env.BASE_URL || 'http://localhost:5000'}/r/${qr.shortId}`,
        shortId: qr.shortId,
        originalUrl: qr.url,
        title: qr.title,
        description: qr.description,
        createdAt: qr.createdAt,
        totalScans: qr.analytics.totalScans,
        lastScanned: qr.analytics.lastScanned,
        isActive: qr.isActive
      })),
      pagination: {
        current: page,
        total: Math.ceil(total / limit),
        count: qrCodes.length,
        totalItems: total
      }
    });

  } catch (error) {
    console.error('QR list error:', error);
    res.status(500).json({ error: 'Failed to fetch QR codes' });
  }
});

// Update QR code (requires auth and ownership)
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { title, description, isActive } = req.body;

    const qrCode = await QRCodeModel.findOne({
      _id: req.params.id,
      userId: req.user!.id
    });

    if (!qrCode) {
      return res.status(404).json({ error: 'QR code not found or unauthorized' });
    }

    // Update allowed fields
    if (title !== undefined) qrCode.title = title;
    if (description !== undefined) qrCode.description = description;
    if (isActive !== undefined) qrCode.isActive = isActive;

    await qrCode.save();

    res.json({
      id: qrCode._id,
      title: qrCode.title,
      description: qrCode.description,
      isActive: qrCode.isActive,
      updatedAt: qrCode.updatedAt
    });

  } catch (error) {
    console.error('QR update error:', error);
    res.status(500).json({ error: 'Failed to update QR code' });
  }
});

// Delete QR code (requires auth and ownership)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const qrCode = await QRCodeModel.findOneAndDelete({
      _id: req.params.id,
      userId: req.user!.id
    });

    if (!qrCode) {
      return res.status(404).json({ error: 'QR code not found or unauthorized' });
    }

    res.json({ message: 'QR code deleted successfully' });

  } catch (error) {
    console.error('QR delete error:', error);
    res.status(500).json({ error: 'Failed to delete QR code' });
  }
});

// Redirect endpoint (handles QR code scans)
router.get('/redirect/:shortId', async (req, res) => {
  try {
    const qrCode = await QRCodeModel.findOne({ 
      shortId: req.params.shortId,
      isActive: true 
    });

    if (!qrCode) {
      return res.status(404).json({ error: 'QR code not found or inactive' });
    }

    // Track analytics
    const scanData = {
      timestamp: new Date(),
      userAgent: req.get('User-Agent'),
      ipAddress: req.ip || req.connection.remoteAddress
    };

    qrCode.analytics.totalScans += 1;
    qrCode.analytics.lastScanned = new Date();
    qrCode.analytics.scanHistory.push(scanData);

    // Keep only last 1000 scans to prevent data bloat
    if (qrCode.analytics.scanHistory.length > 1000) {
      qrCode.analytics.scanHistory = qrCode.analytics.scanHistory.slice(-1000);
    }

    await qrCode.save();

    // Redirect to original URL
    res.redirect(qrCode.url);

  } catch (error) {
    console.error('QR redirect error:', error);
    res.status(500).json({ error: 'Redirect failed' });
  }
});

export default router;