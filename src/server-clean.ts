import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import QRCode from 'qrcode';
import { customAlphabet } from 'nanoid';

dotenv.config();

const app = express();
const generateShortId = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 8);

// Security middleware
app.use(helmet());
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests from this IP, please try again later.' }
});
app.use('/api', limiter);

// Logging
app.use(morgan('combined'));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// In-memory storage for demo
const qrCodes = new Map();

// Utility functions
const validateUrl = (url: string): boolean => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

const sanitizeUrl = (url: string): string => {
  url = url.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }
  return url;
};

// QR Code generation endpoint
app.post('/api/qr/generate', async (req, res) => {
  try {
    console.log('QR generation request:', req.body);
    
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

    // Sanitize and validate URL
    const sanitizedUrl = sanitizeUrl(url);
    
    if (!validateUrl(sanitizedUrl)) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Generate unique short ID
    const shortId = generateShortId();
    const baseUrl = process.env.BASE_URL || 'http://localhost:5000';
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
      errorCorrectionLevel: errorCorrectionLevel as any
    });

    // Store QR code data
    const qrCodeData = {
      id: shortId,
      originalUrl: sanitizedUrl,
      shortId,
      qrCodeData: dataURL,
      shortUrl: redirectUrl,
      title: title || 'Untitled QR Code',
      description: description || '',
      createdAt: new Date().toISOString(),
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

    qrCodes.set(shortId, qrCodeData);

    console.log('QR code generated successfully:', shortId);

    res.json(qrCodeData);

  } catch (error) {
    console.error('QR generation error:', error);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// Get QR code details
app.get('/api/qr/:id', (req, res) => {
  try {
    const qrCode = qrCodes.get(req.params.id);
    
    if (!qrCode) {
      return res.status(404).json({ error: 'QR code not found' });
    }

    res.json(qrCode);

  } catch (error) {
    console.error('QR fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch QR code' });
  }
});

// Redirect endpoint (handles QR code scans)
app.get('/r/:shortId', (req, res) => {
  try {
    console.log('Redirect request for:', req.params.shortId);
    
    const qrCode = qrCodes.get(req.params.shortId);
    
    if (!qrCode) {
      console.log('QR code not found:', req.params.shortId);
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
    qrCode.analytics.totalScans += 1;
    qrCode.analytics.lastScanned = new Date().toISOString();
    
    qrCodes.set(req.params.shortId, qrCode);

    console.log('Redirecting to:', qrCode.originalUrl);
    
    // Redirect to original URL
    res.redirect(qrCode.originalUrl);

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

// List all QR codes (for demo purposes)
app.get('/api/qr', (req, res) => {
  try {
    const allQRCodes = Array.from(qrCodes.values()).map(qr => ({
      id: qr.id,
      shortUrl: qr.shortUrl,
      originalUrl: qr.originalUrl,
      title: qr.title,
      createdAt: qr.createdAt,
      totalScans: qr.analytics.totalScans
    }));

    res.json({ qrCodes: allQRCodes, total: allQRCodes.length });

  } catch (error) {
    console.error('List QR codes error:', error);
    res.status(500).json({ error: 'Failed to fetch QR codes' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    totalQRCodes: qrCodes.size,
    message: 'QR Generator API is running!'
  });
});

// 404 handler
app.use('*', (req, res) => {
  console.log('404 - Route not found:', req.originalUrl);
  res.status(404).json({ error: 'Route not found', path: req.originalUrl });
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 QR Generator API running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🎯 Generate QR: POST http://localhost:${PORT}/api/qr/generate`);
  console.log(`🔄 Redirects: http://localhost:${PORT}/r/:shortId`);
  console.log('');
  console.log('Ready to generate QR codes! 🎉');
});

export default app;