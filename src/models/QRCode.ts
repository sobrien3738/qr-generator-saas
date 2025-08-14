import mongoose, { Schema, Document } from 'mongoose';

export interface IQRCode extends Document {
  _id: string;
  userId?: string;
  url: string;
  shortId: string;
  qrCodeData: string;
  title?: string;
  description?: string;
  customization: {
    size: number;
    errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H';
    foregroundColor: string;
    backgroundColor: string;
    logoUrl?: string;
  };
  analytics: {
    totalScans: number;
    lastScanned?: Date;
    scanHistory: Array<{
      timestamp: Date;
      userAgent?: string;
      ipAddress?: string;
      location?: {
        country?: string;
        city?: string;
      };
    }>;
  };
  isActive: boolean;
  isPremium: boolean;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const QRCodeSchema: Schema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: false // Allow anonymous QR codes
  },
  url: {
    type: String,
    required: true,
    validate: {
      validator: function(v: string) {
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
        validator: function(v: string) {
          return /^#[0-9A-F]{6}$/i.test(v);
        },
        message: 'Please enter a valid hex color'
      }
    },
    backgroundColor: {
      type: String,
      default: '#FFFFFF',
      validate: {
        validator: function(v: string) {
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

export default mongoose.model<IQRCode>('QRCode', QRCodeSchema);