const http = require('http');
const url = require('url');
const QRCode = require('qrcode');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { 
  createCheckoutSession, 
  createPortalSession, 
  handleSubscriptionChange,
  PLANS 
} = require('./src/services/stripe');

require('dotenv').config();

// Dynamic import for nanoid (ES module)
let generateShortId;
let generateUserId;

const initNanoid = async () => {
  const { customAlphabet } = await import('nanoid');
  generateShortId = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 8);
  generateUserId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 12);
};

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
  if (!urlString || typeof urlString !== 'string') {
    throw new Error('Invalid URL provided');
  }
  
  urlString = urlString.trim();
  
  // If it already has a protocol, return as-is
  if (/^https?:\/\//i.test(urlString)) {
    return urlString;
  }
  
  // If it starts with www. or looks like a domain, add https://
  if (/^(www\.)?[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\.[a-zA-Z]{2,}/.test(urlString)) {
    return 'https://' + urlString;
  }
  
  // If it looks like a domain without www, add https://
  if (/^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\.[a-zA-Z]{2,}/.test(urlString)) {
    return 'https://' + urlString;
  }
  
  // If it contains a slash (path), assume it's a domain with path
  if (urlString.includes('/')) {
    return 'https://' + urlString;
  }
  
  // Last resort: assume it's a domain and add https://
  return 'https://' + urlString;
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
  const allowedOrigins = [
    'http://localhost:3000',
    'https://qr-generator-frontend.vercel.app',
    'https://qr-generator-frontend-git-main.vercel.app',
    process.env.FRONTEND_URL
  ].filter(Boolean);
  
  res.setHeader('Access-Control-Allow-Origin', '*'); // Allow all origins for now
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
      const baseUrl = process.env.BASE_URL || 'https://qr-generator-api-production-a8fb.up.railway.app';
      const redirectUrl = `${baseUrl}/r/${shortId}`;

      console.log('🔗 BASE_URL env var:', process.env.BASE_URL);
      console.log('🔗 Using baseUrl:', baseUrl);
      console.log('🔗 Generated redirect URL for QR code:', redirectUrl);
      console.log('🎯 Target URL after sanitization:', sanitizedUrl);

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
        .select('-analytics.scanHistory'); // Exclude scan history but keep qrCodeData

      // Format for dashboard
      const formattedQRCodes = qrCodes.map(qr => ({
        id: qr._id,
        shortUrl: `${process.env.BASE_URL || 'https://qr-generator-api-production-a8fb.up.railway.app'}/r/${qr.shortId}`,
        shortId: qr.shortId,
        originalUrl: qr.url,
        title: qr.title,
        description: qr.description,
        createdAt: qr.createdAt,
        qrCodeData: qr.qrCodeData, // Include QR code image data
        analytics: {
          totalScans: qr.analytics.totalScans,
          lastScanned: qr.analytics.lastScanned
        },
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

    // Update QR Code
    if (method === 'PUT' && path.startsWith('/api/qr/')) {
      const pathParts = path.split('/');
      if (pathParts.length === 4) {
        const qrId = pathParts[3];
        const user = await getUserFromToken(req.headers.authorization);
        
        if (!user) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Authentication required' }));
          return;
        }

        const body = await parseJSON(req);
        const { title, description, isActive } = body;

        const qrCode = await QRCodeModel.findOne({ _id: qrId, userId: user._id });
        if (!qrCode) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'QR code not found' }));
          return;
        }

        // Update fields
        if (title !== undefined) qrCode.title = title;
        if (description !== undefined) qrCode.description = description;
        if (isActive !== undefined) qrCode.isActive = isActive;

        await qrCode.save();

        console.log(`✅ QR code updated in MongoDB: ${qrId}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: qrCode._id,
          title: qrCode.title,
          description: qrCode.description,
          isActive: qrCode.isActive,
          message: 'QR code updated successfully'
        }));
        return;
      }
    }

    // Delete QR Code
    if (method === 'DELETE' && path.startsWith('/api/qr/')) {
      const pathParts = path.split('/');
      if (pathParts.length === 4) {
        const qrId = pathParts[3];
        const user = await getUserFromToken(req.headers.authorization);
        
        if (!user) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Authentication required' }));
          return;
        }

        const qrCode = await QRCodeModel.findOne({ _id: qrId, userId: user._id });
        if (!qrCode) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'QR code not found' }));
          return;
        }

        await QRCodeModel.findByIdAndDelete(qrId);

        // Update user's QR code count
        if (user.usage.qrCodesCreated > 0) {
          user.usage.qrCodesCreated -= 1;
          await user.save();
        }

        console.log(`✅ QR code deleted from MongoDB: ${qrId}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'QR code deleted successfully' }));
        return;
      }
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

    // Get subscription plans
    if (method === 'GET' && path === '/api/billing/plans') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        plans: Object.values(PLANS),
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
      }));
      return;
    }

    // Create checkout session
    if (method === 'POST' && path === '/api/billing/create-checkout-session') {
      const user = await getUserFromToken(req.headers.authorization);
      
      if (!user) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Authentication required' }));
        return;
      }

      const body = await parseJSON(req);
      const { planType } = body;

      if (!planType || !['pro', 'business'].includes(planType)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid plan type' }));
        return;
      }

      try {
        const baseUrl = process.env.BASE_URL || 'https://qr-generator-api-production-a8fb.up.railway.app';
        const frontendUrl = process.env.FRONTEND_URL || 'https://qr-generator-frontend-gules.vercel.app';
        
        const priceId = planType === 'pro' ? PLANS.PRO.stripePriceId : PLANS.BUSINESS.stripePriceId;
        const successUrl = `${frontendUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`;
        const cancelUrl = `${frontendUrl}/pricing?canceled=true`;

        const session = await createCheckoutSession(
          user._id,
          priceId,
          successUrl,
          cancelUrl
        );

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          sessionId: session.id,
          url: session.url
        }));
      } catch (error) {
        console.error('❌ Checkout session error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to create checkout session' }));
      }
      return;
    }

    // Create customer portal session
    if (method === 'POST' && path === '/api/billing/create-portal-session') {
      const user = await getUserFromToken(req.headers.authorization);
      
      if (!user) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Authentication required' }));
        return;
      }

      if (!user.subscription.customerId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No active subscription found' }));
        return;
      }

      try {
        const frontendUrl = process.env.FRONTEND_URL || 'https://qr-generator-frontend-gules.vercel.app';
        const returnUrl = `${frontendUrl}/dashboard`;

        const session = await createPortalSession(
          user.subscription.customerId,
          returnUrl
        );

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ url: session.url }));
      } catch (error) {
        console.error('❌ Portal session error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to create portal session' }));
      }
      return;
    }

    // Stripe webhooks
    if (method === 'POST' && path === '/api/billing/webhook') {
      let event;

      try {
        const sig = req.headers['stripe-signature'];
        const body = await parseJSON(req);
        
        // In production, verify the webhook signature
        if (process.env.STRIPE_WEBHOOK_SECRET) {
          event = require('stripe').webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);
        } else {
          event = body; // For testing
        }
      } catch (err) {
        console.error('❌ Webhook signature verification failed:', err.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Webhook signature verification failed' }));
        return;
      }

      // Handle the event
      try {
        switch (event.type) {
          case 'customer.subscription.created':
          case 'customer.subscription.updated':
          case 'customer.subscription.deleted':
            await handleSubscriptionChange(event.data.object);
            break;
          default:
            console.log(`Unhandled event type ${event.type}`);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: true }));
      } catch (error) {
        console.error('❌ Webhook handler error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Webhook handler failed' }));
      }
      return;
    }

    // Health check - super simple for Railway
    if (method === 'GET' && path === '/health') {
      console.log('📊 Health check requested');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'OK' }));
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

// Parse and validate PORT
let port = parseInt(process.env.PORT);
if (isNaN(port) || port < 0 || port > 65535) {
  console.error('❌ Invalid PORT value:', process.env.PORT);
  console.log('🔧 Using default port 5001');
  port = 5001;
}
const PORT = port;

const startServer = async () => {
  try {
    console.log('🔄 Starting server...');
    console.log('📡 Environment:', {
      NODE_ENV: process.env.NODE_ENV,
      PORT: PORT,
      MONGODB_URI: process.env.MONGODB_URI ? 'Set' : 'Not set'
    });
    
    // Initialize nanoid
    console.log('🔄 Initializing nanoid...');
    await initNanoid();
    console.log('✅ Nanoid initialized');
    
    // Start server first, then connect to database
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 QR Generator API running on port ${PORT}`);
      console.log(`📊 Health check: http://0.0.0.0:${PORT}/health`);
      console.log('🎉 Server started successfully!');
    });
    
    // Connect to database after server is listening
    console.log('🔄 Connecting to MongoDB Atlas...');
    await connectDB();
    console.log('🌐 Railway deployment successful!');
    
    // Handle server errors
    server.on('error', (error) => {
      console.error('❌ Server error:', error);
      process.exit(1);
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    // Don't exit - let server run even if DB connection fails
    console.log('⚠️ Server running without database connection');
  }
};

startServer().catch(console.error);