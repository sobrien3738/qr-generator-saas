const http = require('http');
const url = require('url');
const QRCode = require('qrcode');
const { customAlphabet } = require('nanoid');
const crypto = require('crypto');
const mongoose = require('mongoose');

require('dotenv').config();

const generateShortId = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 8);
const generateUserId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 12);

// Import models
const User = require('./src/models-production/User');
const QRCodeModel = require('./src/models-production/QRCode');

// In-memory sessions (upgrade to Redis for production scaling)
const sessions = new Map();

// Database connection
const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI not found in environment variables');
    }
    
    console.log('🔄 Connecting to MongoDB Atlas...');
    console.log('📡 Connection string:', mongoUri.replace(/:[^:@]+@/, ':****@'));
    
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000, // 5 second timeout
      connectTimeoutMS: 10000,
    });
    
    console.log('✅ MongoDB Atlas connected successfully');
    console.log('🗄️  Database:', mongoose.connection.db.databaseName);
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    console.log('');
    console.log('🔧 Common solutions:');
    console.log('1. Whitelist your IP in MongoDB Atlas → Network Access');
    console.log('2. Check your connection string is correct');
    console.log('3. Verify your username/password');
    process.exit(1);
  }
};

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

// CORS headers
const setCORSHeaders = (res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
};

// Parse JSON body
const parseJSON = (req) => {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const path = parsedUrl.pathname;
  const method = req.method;

  // Set CORS headers
  setCORSHeaders(res);

  // Handle preflight requests
  if (method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  console.log(`${method} ${path}`);

  try {
    // User Registration
    if (method === 'POST' && path === '/api/auth/register') {
      const body = await parseJSON(req);
      console.log('Registration request:', { email: body.email, name: body.name });

      const { email, password, name } = body;

      if (!email || !password || !name) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'All fields are required' }));
        return;
      }

      if (!validateEmail(email)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid email format' }));
        return;
      }

      if (password.length < 6) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Password must be at least 6 characters' }));
        return;
      }

      // Check if user already exists
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'User already exists with this email' }));
        return;
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

      console.log('✅ User registered successfully in MongoDB:', user._id);

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        token,
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          plan: user.plan,
          limits: user.limits
        }
      }));
      return;
    }

    // User Login
    if (method === 'POST' && path === '/api/auth/login') {
      const body = await parseJSON(req);
      console.log('Login request:', { email: body.email });

      const { email, password } = body;

      if (!email || !password) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Email and password are required' }));
        return;
      }

      // Find user in MongoDB
      const user = await User.findOne({ email });
      if (!user) {
        console.log('Login failed: User not found for email:', email);
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid credentials' }));
        return;
      }

      // Check password
      if (!user.comparePassword(password)) {
        console.log('Login failed: Password does not match');
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid credentials' }));
        return;
      }

      // Generate session token
      const token = generateToken();
      sessions.set(token, {
        userId: user._id.toString(),
        expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000) // 7 days
      });

      console.log('✅ User logged in successfully from MongoDB:', user._id);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        token,
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          plan: user.plan,
          limits: user.limits,
          usage: user.usage
        }
      }));
      return;
    }

    // Get current user
    if (method === 'GET' && path === '/api/auth/me') {
      const user = await getUserFromToken(req.headers.authorization);
      
      if (!user) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid or expired token' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          plan: user.plan,
          limits: user.limits,
          usage: user.usage,
          createdAt: user.createdAt
        }
      }));
      return;
    }

    // Generate QR Code
    if (method === 'POST' && path === '/api/qr/generate') {
      const body = await parseJSON(req);
      console.log('QR generation request:', body);

      // Check if user is authenticated (optional for QR generation)
      const currentUser = await getUserFromToken(req.headers.authorization);

      const { 
        url: inputUrl, 
        title, 
        description,
        size = 256,
        errorCorrectionLevel = 'M',
        foregroundColor = '#000000',
        backgroundColor = '#FFFFFF'
      } = body;

      if (!inputUrl) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'URL is required' }));
        return;
      }

      // Sanitize and validate URL
      const sanitizedUrl = sanitizeUrl(inputUrl);
      
      if (!validateUrl(sanitizedUrl)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid URL format' }));
        return;
      }

      // Check plan limits for authenticated users
      if (currentUser) {
        const userQRCodes = await QRCodeModel.countDocuments({ userId: currentUser._id });
        if (userQRCodes >= currentUser.limits.maxQRCodes) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            error: `Plan limit reached. You can create up to ${currentUser.limits.maxQRCodes} QR codes on the ${currentUser.plan} plan.`,
            upgradeUrl: '/pricing'
          }));
          return;
        }
      }

      // Generate unique short ID
      const shortId = generateShortId();
      const baseUrl = process.env.BASE_URL || 'http://localhost:5001';
      const redirectUrl = `${baseUrl}/r/${shortId}`;

      console.log('Generating QR for:', redirectUrl);

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

      // Create QR code in MongoDB
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
        console.log(`✅ QR code created for user ${currentUser._id} in MongoDB. Total: ${currentUser.usage.qrCodesCreated}`);
      }

      console.log('✅ QR code generated successfully in MongoDB:', shortId);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: qrCode._id,
        qrCodeData: dataURL,
        shortUrl: redirectUrl,
        shortId,
        originalUrl: sanitizedUrl,
        title: qrCode.title,
        description: qrCode.description,
        createdAt: qrCode.createdAt
      }));
      return;
    }

    // Get user's QR codes (for dashboard)
    if (method === 'GET' && path === '/api/qr/user/list') {
      const user = await getUserFromToken(req.headers.authorization);
      
      if (!user) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Authentication required' }));
        return;
      }

      // Get all QR codes for this user from MongoDB
      const qrCodes = await QRCodeModel
        .find({ userId: user._id })
        .sort({ createdAt: -1 })
        .select('-qrCodeData -analytics.scanHistory'); // Exclude large fields

      // Format for dashboard
      const formattedQRCodes = qrCodes.map(qr => ({
        id: qr._id,
        shortUrl: `${process.env.BASE_URL || 'http://localhost:5001'}/r/${qr.shortId}`,
        shortId: qr.shortId,
        originalUrl: qr.url,
        title: qr.title,
        description: qr.description,
        createdAt: qr.createdAt,
        totalScans: qr.analytics.totalScans,
        lastScanned: qr.analytics.lastScanned,
        isActive: qr.isActive
      }));

      console.log(`✅ Returning ${formattedQRCodes.length} QR codes from MongoDB for user ${user._id}`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        qrCodes: formattedQRCodes,
        pagination: {
          current: 1,
          total: 1,
          count: formattedQRCodes.length,
          totalItems: formattedQRCodes.length
        }
      }));
      return;
    }

    // QR Code redirect (handles scans)
    if (method === 'GET' && path.startsWith('/r/')) {
      const shortId = path.split('/')[2];
      console.log('Redirect request for:', shortId);
      
      const qrCode = await QRCodeModel.findOne({ 
        shortId: shortId,
        isActive: true 
      });
      
      if (!qrCode) {
        console.log('QR code not found:', shortId);
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
              <h1>QR Code Not Found</h1>
              <p>The QR code you're looking for doesn't exist or has expired.</p>
            </body>
          </html>
        `);
        return;
      }

      // Track analytics
      const scanData = {
        timestamp: new Date(),
        userAgent: req.headers['user-agent'],
        ipAddress: req.connection.remoteAddress
      };

      qrCode.analytics.totalScans += 1;
      qrCode.analytics.lastScanned = new Date();
      qrCode.analytics.scanHistory.push(scanData);

      // Keep only last 1000 scans
      if (qrCode.analytics.scanHistory.length > 1000) {
        qrCode.analytics.scanHistory = qrCode.analytics.scanHistory.slice(-1000);
      }

      await qrCode.save();

      console.log('✅ QR redirect tracked in MongoDB:', shortId, '→', qrCode.url);
      
      // Redirect to original URL
      res.writeHead(302, { 'Location': qrCode.url });
      res.end();
      return;
    }

    // Health check
    if (method === 'GET' && path === '/health') {
      try {
        const totalUsers = await User.countDocuments();
        const totalQRCodes = await QRCodeModel.countDocuments();
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          status: 'OK', 
          timestamp: new Date().toISOString(),
          database: 'MongoDB Atlas Connected',
          totalUsers,
          totalQRCodes,
          message: 'QR Generator API (Production with MongoDB) is running!'
        }));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ERROR',
          message: 'Database connection failed'
        }));
      }
      return;
    }

    // 404 handler
    console.log('404 - Route not found:', path);
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Route not found', path: path }));

  } catch (error) {
    console.error('Server error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
});

const PORT = process.env.PORT || 5001;

const startServer = async () => {
  await connectDB();
  server.listen(PORT, () => {
    console.log(`🚀 QR Generator API (MongoDB Atlas) running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`🎯 Generate QR: POST http://localhost:${PORT}/api/qr/generate`);
    console.log(`🔄 Redirects: http://localhost:${PORT}/r/:shortId`);
    console.log('');
    console.log('🎉 Production server with MongoDB Atlas ready!');
  });
};

startServer().catch(console.error);