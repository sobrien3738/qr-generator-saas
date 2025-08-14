const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const QRCode = require('qrcode');
const { customAlphabet } = require('nanoid');
const crypto = require('crypto');

// Import models
const User = require('./src/models-production/User');
const QRCodeModel = require('./src/models-production/QRCode');

require('dotenv').config();

const app = express();
const generateShortId = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 8);
const generateUserId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 12);

// In-memory sessions (upgrade to Redis for production scaling)
const sessions = new Map();

// Database connection
const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/qrcode-generator';
    await mongoose.connect(mongoUri);
    console.log('✅ MongoDB connected successfully');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

// Security middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001', process.env.FRONTEND_URL].filter(Boolean),
  credentials: true
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Utility functions
const validateUrl = (urlString) => {
  try {
    new URL(urlString);
    return true;
  } catch {
    return false;
  }
};

const sanitizeUrl = (urlString) => {
  urlString = urlString.trim();
  if (!/^https?:\/\//i.test(urlString)) {
    urlString = 'https://' + urlString;
  }
  return urlString;
};

const hashPassword = (password) => {
  return crypto.pbkdf2Sync(password, 'salt', 10000, 64, 'sha512').toString('hex');
};

const generateToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

const validateEmail = (email) => {
  return /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(email);
};

const getUserFromToken = async (authHeader) => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  
  const token = authHeader.split(' ')[1];
  const session = sessions.get(token);
  
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  
  try {
    const user = await User.findById(session.userId);
    return user;
  } catch (error) {
    console.error('Error fetching user:', error);
    return null;
  }
};

// Routes

// User Registration
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (!validateEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists with this email' });
    }

    // Create user
    const user = new User({
      email,
      password,
      name
    });

    await user.save();

    // Generate session token
    const token = generateToken();
    sessions.set(token, {
      userId: user._id.toString(),
      expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000) // 7 days
    });

    console.log('✅ User registered successfully:', user._id);

    res.status(201).json({
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        plan: user.plan,
        limits: user.limits
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// User Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check password
    if (!user.comparePassword(password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate session token
    const token = generateToken();
    sessions.set(token, {
      userId: user._id.toString(),
      expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000) // 7 days
    });

    console.log('✅ User logged in successfully:', user._id);

    res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        plan: user.plan,
        limits: user.limits,
        usage: user.usage
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get current user
app.get('/api/auth/me', async (req, res) => {
  try {
    const user = await getUserFromToken(req.headers.authorization);
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    res.json({
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        plan: user.plan,
        limits: user.limits,
        usage: user.usage,
        createdAt: user.createdAt
      }
    });

  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to fetch user data' });
  }
});

// Generate QR Code
app.post('/api/qr/generate', async (req, res) => {
  try {
    const { 
      url: inputUrl, 
      title, 
      description,
      size = 256,
      errorCorrectionLevel = 'M',
      foregroundColor = '#000000',
      backgroundColor = '#FFFFFF'
    } = req.body;

    if (!inputUrl) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Check if user is authenticated (optional for QR generation)
    const currentUser = await getUserFromToken(req.headers.authorization);

    // Sanitize and validate URL
    const sanitizedUrl = sanitizeUrl(inputUrl);
    
    if (!validateUrl(sanitizedUrl)) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Check plan limits for authenticated users
    if (currentUser) {
      const userQRCodes = await QRCodeModel.countDocuments({ userId: currentUser._id });
      if (userQRCodes >= currentUser.limits.maxQRCodes) {
        return res.status(403).json({ 
          error: `Plan limit reached. You can create up to ${currentUser.limits.maxQRCodes} QR codes on the ${currentUser.plan} plan.`,
          upgradeUrl: '/pricing'
        });
      }
    }

    // Generate unique short ID
    const shortId = generateShortId();
    const baseUrl = process.env.BASE_URL || 'http://localhost:5001';
    const redirectUrl = `${baseUrl}/r/${shortId}`;

    // Generate QR code as data URL
    const dataURL = await QRCode.toDataURL(redirectUrl, {
      width: parseInt(size),
      margin: 4,
      color: {
        dark: foregroundColor,
        light: backgroundColor
      },
      errorCorrectionLevel: errorCorrectionLevel
    });

    // Create QR code in database
    const qrCode = new QRCodeModel({
      userId: currentUser?._id || null,
      url: sanitizedUrl,
      shortId,
      qrCodeData: dataURL,
      title: title || 'Untitled QR Code',
      description: description || '',
      customization: {
        size: parseInt(size),
        errorCorrectionLevel,
        foregroundColor,
        backgroundColor
      },
      isPremium: currentUser?.plan !== 'free' || false
    });

    await qrCode.save();

    // Update user's QR code count if authenticated
    if (currentUser) {
      currentUser.usage.qrCodesCreated += 1;
      await currentUser.save();
      console.log(`✅ QR code created for user ${currentUser._id}. Total: ${currentUser.usage.qrCodesCreated}`);
    }

    console.log('✅ QR code generated successfully:', shortId);

    res.json({
      id: qrCode._id,
      qrCodeData: dataURL,
      shortUrl: redirectUrl,
      shortId,
      originalUrl: sanitizedUrl,
      title: qrCode.title,
      description: qrCode.description,
      createdAt: qrCode.createdAt
    });

  } catch (error) {
    console.error('QR generation error:', error);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// Get user's QR codes (for dashboard)
app.get('/api/qr/user/list', async (req, res) => {
  try {
    const user = await getUserFromToken(req.headers.authorization);
    
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const qrCodes = await QRCodeModel
      .find({ userId: user._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-qrCodeData -analytics.scanHistory'); // Exclude large fields

    const total = await QRCodeModel.countDocuments({ userId: user._id });

    const formattedQRCodes = qrCodes.map(qr => ({
      id: qr._id,
      shortUrl: qr.shortUrl,
      shortId: qr.shortId,
      originalUrl: qr.url,
      title: qr.title,
      description: qr.description,
      createdAt: qr.createdAt,
      totalScans: qr.analytics.totalScans,
      lastScanned: qr.analytics.lastScanned,
      isActive: qr.isActive
    }));

    console.log(`✅ Returning ${formattedQRCodes.length} QR codes for user ${user._id}`);

    res.json({
      qrCodes: formattedQRCodes,
      pagination: {
        current: page,
        total: Math.ceil(total / limit),
        count: formattedQRCodes.length,
        totalItems: total
      }
    });

  } catch (error) {
    console.error('QR list error:', error);
    res.status(500).json({ error: 'Failed to fetch QR codes' });
  }
});

// QR Code redirect (handles scans)
app.get('/r/:shortId', async (req, res) => {
  try {
    const qrCode = await QRCodeModel.findOne({ 
      shortId: req.params.shortId,
      isActive: true 
    });

    if (!qrCode) {
      return res.status(404).send(`
        <html>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1>QR Code Not Found</h1>
            <p>The QR code you're looking for doesn't exist or has expired.</p>
          </body>
        </html>
      `);
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

    console.log(`✅ QR redirect: ${req.params.shortId} → ${qrCode.url}`);

    // Redirect to original URL
    res.redirect(qrCode.url);

  } catch (error) {
    console.error('Redirect error:', error);
    res.status(500).send(`
      <html>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h1>Redirect Failed</h1>
          <p>Sorry, there was an error processing your request.</p>
        </body>
      </html>
    `);
  }
});

// Health check
app.get('/health', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalQRCodes = await QRCodeModel.countDocuments();
    
    res.json({ 
      status: 'OK', 
      timestamp: new Date().toISOString(),
      database: 'connected',
      totalUsers,
      totalQRCodes,
      message: 'QR Generator API is running!'
    });
  } catch (error) {
    res.status(500).json({
      status: 'ERROR',
      message: 'Database connection failed'
    });
  }
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found', path: req.originalUrl });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = process.env.PORT || 5001;

const startServer = async () => {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`🚀 QR Generator API (Production) running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`🎯 Ready for production deployment!`);
  });
};

startServer().catch(console.error);