import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

import qrRoutes from './routes/qr';
import authRoutes from './routes/auth';
import analyticsRoutes from './routes/analytics';

dotenv.config();

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.FRONTEND_URL 
    : 'http://localhost:3000',
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

// Routes
app.use('/api/qr', qrRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/analytics', analyticsRoutes);

// QR Code redirect route (handled directly here to avoid import issues)
app.get('/r/:shortId', async (req, res) => {
  try {
    const QRCodeModel = require('./models/QRCode').default;
    
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

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
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

// Database connection
const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/qrcode-generator';
    await mongoose.connect(mongoUri);
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

export default app;
export { startServer };