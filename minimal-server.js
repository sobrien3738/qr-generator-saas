const http = require('http');
const url = require('url');
const QRCode = require('qrcode');
const { customAlphabet } = require('nanoid');
const crypto = require('crypto');

const generateShortId = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 8);
const generateUserId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 12);

// In-memory storage
const qrCodes = new Map();
const users = new Map();
const sessions = new Map();

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

// Authentication utilities
const hashPassword = (password) => {
  return crypto.pbkdf2Sync(password, 'salt', 10000, 64, 'sha512').toString('hex');
};

const generateToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

const validateEmail = (email) => {
  return /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(email);
};

const getUserFromToken = (authHeader) => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  
  const token = authHeader.split(' ')[1];
  const session = sessions.get(token);
  
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  
  return users.get(session.userId);
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
    // Generate QR Code
    if (method === 'POST' && path === '/api/qr/generate') {
      const body = await parseJSON(req);
      console.log('QR generation request:', body);

      // Check if user is authenticated (optional for QR generation)
      const currentUser = getUserFromToken(req.headers.authorization);

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
        const userQRCodes = Array.from(qrCodes.values()).filter(qr => qr.userId === currentUser.id);
        if (userQRCodes.length >= currentUser.limits.maxQRCodes) {
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
      const baseUrl = 'http://localhost:5001';
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

      // Store QR code data
      const qrCodeData = {
        id: shortId,
        userId: currentUser?.id || null, // Associate with user if logged in
        originalUrl: sanitizedUrl,
        shortId,
        qrCodeData: dataURL,
        shortUrl: redirectUrl,
        title: title || 'Untitled QR Code',
        description: description || '',
        createdAt: new Date().toISOString(),
        isActive: true,
        analytics: {
          totalScans: 0,
          lastScanned: null
        },
        customization: {
          size: parseInt(size),
          errorCorrectionLevel,
          foregroundColor,
          backgroundColor
        }
      };

      // Update user's QR code count if authenticated
      if (currentUser) {
        currentUser.usage.qrCodesCreated += 1;
        users.set(currentUser.id, currentUser);
        console.log(`QR code created for user ${currentUser.id}. Total: ${currentUser.usage.qrCodesCreated}`);
      }

      qrCodes.set(shortId, qrCodeData);

      console.log('QR code generated successfully:', shortId);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(qrCodeData));
      return;
    }

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
      const existingUser = Array.from(users.values()).find(user => user.email === email);
      if (existingUser) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'User already exists with this email' }));
        return;
      }

      // Create user
      const userId = generateUserId();
      const hashedPassword = hashPassword(password);
      
      const user = {
        id: userId,
        email,
        name,
        password: hashedPassword,
        plan: 'free',
        limits: {
          maxQRCodes: 5,
          maxScansPerMonth: 100,
          canCustomize: false,
          canTrackAnalytics: false,
          canExportData: false
        },
        usage: {
          qrCodesCreated: 0,
          monthlyScans: 0,
          lastResetDate: new Date().toISOString()
        },
        createdAt: new Date().toISOString()
      };

      users.set(userId, user);

      // Generate session token
      const token = generateToken();
      sessions.set(token, {
        userId,
        expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000) // 7 days
      });

      console.log('User registered successfully:', userId);

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        token,
        user: {
          id: user.id,
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
        console.log('Login failed: Missing email or password');
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Email and password are required' }));
        return;
      }

      // Debug: Log current users
      console.log('Current users in memory:', Array.from(users.keys()));
      console.log('Total users stored:', users.size);

      // Find user
      const user = Array.from(users.values()).find(u => u.email === email);
      if (!user) {
        console.log('Login failed: User not found for email:', email);
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid credentials' }));
        return;
      }

      console.log('User found:', { id: user.id, email: user.email });

      // Check password
      const hashedPassword = hashPassword(password);
      console.log('Password check - Provided hash:', hashedPassword.substring(0, 20) + '...');
      console.log('Password check - Stored hash:', user.password.substring(0, 20) + '...');
      
      if (hashedPassword !== user.password) {
        console.log('Login failed: Password does not match');
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid credentials' }));
        return;
      }

      // Generate session token
      const token = generateToken();
      sessions.set(token, {
        userId: user.id,
        expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000) // 7 days
      });

      console.log('User logged in successfully:', user.id);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        token,
        user: {
          id: user.id,
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
      const user = getUserFromToken(req.headers.authorization);
      
      if (!user) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid or expired token' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        user: {
          id: user.id,
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

    // Get user's QR codes (for dashboard)
    if (method === 'GET' && path === '/api/qr/user/list') {
      const user = getUserFromToken(req.headers.authorization);
      
      if (!user) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Authentication required' }));
        return;
      }

      // Get all QR codes for this user
      const userQRCodes = Array.from(qrCodes.values())
        .filter(qr => qr.userId === user.id)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()); // Sort by newest first

      // Format for dashboard
      const formattedQRCodes = userQRCodes.map(qr => ({
        id: qr.id,
        shortUrl: qr.shortUrl,
        shortId: qr.shortId,
        originalUrl: qr.originalUrl,
        title: qr.title,
        description: qr.description,
        createdAt: qr.createdAt,
        totalScans: qr.analytics.totalScans,
        lastScanned: qr.analytics.lastScanned,
        isActive: qr.isActive
      }));

      console.log(`Returning ${formattedQRCodes.length} QR codes for user ${user.id}`);

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

    // Get QR code details
    if (method === 'GET' && path.startsWith('/api/qr/')) {
      const id = path.split('/')[3];
      const qrCode = qrCodes.get(id);
      
      if (!qrCode) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'QR code not found' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(qrCode));
      return;
    }

    // Redirect endpoint (handles QR code scans)
    if (method === 'GET' && path.startsWith('/r/')) {
      const shortId = path.split('/')[2];
      console.log('Redirect request for:', shortId);
      
      const qrCode = qrCodes.get(shortId);
      
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
      qrCode.analytics.totalScans += 1;
      qrCode.analytics.lastScanned = new Date().toISOString();
      
      qrCodes.set(shortId, qrCode);

      console.log('Redirecting to:', qrCode.originalUrl);
      
      // Redirect to original URL
      res.writeHead(302, { 'Location': qrCode.originalUrl });
      res.end();
      return;
    }

    // Debug: List users (for debugging only)
    if (method === 'GET' && path === '/debug/users') {
      const userList = Array.from(users.values()).map(u => ({
        id: u.id,
        email: u.email,
        name: u.name,
        plan: u.plan,
        createdAt: u.createdAt
      }));
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        totalUsers: users.size,
        users: userList
      }));
      return;
    }

    // Health check
    if (method === 'GET' && path === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        totalQRCodes: qrCodes.size,
        totalUsers: users.size,
        message: 'QR Generator API is running!'
      }));
      return;
    }

    // List all QR codes
    if (method === 'GET' && path === '/api/qr') {
      const allQRCodes = Array.from(qrCodes.values()).map(qr => ({
        id: qr.id,
        shortUrl: qr.shortUrl,
        originalUrl: qr.originalUrl,
        title: qr.title,
        createdAt: qr.createdAt,
        totalScans: qr.analytics.totalScans
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ qrCodes: allQRCodes, total: allQRCodes.length }));
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

const PORT = 5001;

server.listen(PORT, () => {
  console.log(`🚀 QR Generator API running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🎯 Generate QR: POST http://localhost:${PORT}/api/qr/generate`);
  console.log(`🔄 Redirects: http://localhost:${PORT}/r/:shortId`);
  console.log('');
  console.log('Ready to generate QR codes! 🎉');
});