const mongoose = require('mongoose');

const QRCodeSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false // Allow anonymous QR codes
  },
  url: {
    type: String,
    required: true,
    validate: {
      validator: function(v) {
        return /^https?:\/\/.+/.test(v);
      },
      message: 'Please enter a valid URL starting with http:// or https://'
    }
  },
  shortId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  qrCodeData: {
    type: String,
    required: true
  },
  title: {
    type: String,
    maxlength: 100
  },
  description: {
    type: String,
    maxlength: 500
  },
  customization: {
    size: {
      type: Number,
      default: 256,
      min: 128,
      max: 1024
    },
    errorCorrectionLevel: {
      type: String,
      enum: ['L', 'M', 'Q', 'H'],
      default: 'M'
    },
    foregroundColor: {
      type: String,
      default: '#000000',
      validate: {
        validator: function(v) {
          return /^#[0-9A-F]{6}$/i.test(v);
        },
        message: 'Please enter a valid hex color'
      }
    },
    backgroundColor: {
      type: String,
      default: '#FFFFFF',
      validate: {
        validator: function(v) {
          return /^#[0-9A-F]{6}$/i.test(v);
        },
        message: 'Please enter a valid hex color'
      }
    },
    logoUrl: {
      type: String,
      required: false
    }
  },
  analytics: {
    totalScans: {
      type: Number,
      default: 0
    },
    lastScanned: {
      type: Date
    },
    scanHistory: [{
      timestamp: {
        type: Date,
        default: Date.now
      },
      userAgent: String,
      ipAddress: String,
      location: {
        country: String,
        city: String
      }
    }]
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isPremium: {
    type: Boolean,
    default: false
  },
  expiresAt: {
    type: Date,
    required: false
  }
}, {
  timestamps: true
});

// Index for analytics queries
QRCodeSchema.index({ 'analytics.totalScans': -1 });
QRCodeSchema.index({ createdAt: -1 });
QRCodeSchema.index({ userId: 1, createdAt: -1 });

// Virtual for short URL
QRCodeSchema.virtual('shortUrl').get(function() {
  return `${process.env.BASE_URL || 'http://localhost:5001'}/r/${this.shortId}`;
});

module.exports = mongoose.model('QRCode', QRCodeSchema);