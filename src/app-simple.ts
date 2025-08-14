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
  origin: 'http://localhost:3000',
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api', limiter);

// Logging
app.use(morgan('combined'));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// In-memory storage for demo (replace with database later)
const qrCodes = new Map();

// Simple QR code generation endpoint
app.post('/api/qr/generate', async (req, res) => {
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

    // Sanitize URL
    let sanitizedUrl = url.trim();
    if (!/^https?:\/\//i.test(sanitizedUrl)) {
      sanitizedUrl = 'https://' + sanitizedUrl;
    }

    // Generate unique short ID
    const shortId = generateShortId();
    const redirectUrl = `http://localhost:5000/r/${shortId}`;

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
      title,
      description,
      createdAt: new Date().toISOString(),
      scans: 0
    };

    qrCodes.set(shortId, qrCodeData);

    res.json(qrCodeData);

  } catch (error) {
    console.error('QR generation error:', error);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// Simple redirect endpoint
app.get('/r/:shortId', (req, res) => {
  try {
    const qrCode = qrCodes.get(req.params.shortId);
    
    if (!qrCode) {
      return res.status(404).send('QR code not found');
    }

    // Track scan
    qrCode.scans += 1;
    qrCodes.set(req.params.shortId, qrCode);

    // Redirect to original URL
    res.redirect(qrCode.originalUrl);

  } catch (error) {
    console.error('Redirect error:', error);
    res.status(500).send('Redirect failed');
  }
});

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    totalQRCodes: qrCodes.size
  });
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Simple QR Generator server running on port ${PORT}`);
  console.log('Ready to generate QR codes!');
});

export default app;