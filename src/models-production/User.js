const mongoose = require('mongoose');
const bcrypt = require('crypto');

const UserSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    validate: {
      validator: function(v) {
        return /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(v);
      },
      message: 'Please enter a valid email'
    }
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  name: {
    type: String,
    required: true,
    maxlength: 50
  },
  plan: {
    type: String,
    enum: ['free', 'pro', 'enterprise'],
    default: 'free'
  },
  subscription: {
    isActive: {
      type: Boolean,
      default: false
    },
    currentPeriodEnd: Date,
    customerId: String,
    subscriptionId: String
  },
  usage: {
    qrCodesCreated: {
      type: Number,
      default: 0
    },
    monthlyScans: {
      type: Number,
      default: 0
    },
    lastResetDate: {
      type: Date,
      default: Date.now
    }
  },
  limits: {
    maxQRCodes: {
      type: Number,
      default: 5 // Free plan limit
    },
    maxScansPerMonth: {
      type: Number,
      default: 100 // Free plan limit
    },
    canCustomize: {
      type: Boolean,
      default: false
    },
    canTrackAnalytics: {
      type: Boolean,
      default: false
    },
    canExportData: {
      type: Boolean,
      default: false
    }
  },
  emailVerified: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Hash password before saving
UserSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    // Use same hashing as minimal server for compatibility
    this.password = bcrypt.pbkdf2Sync(this.password, 'salt', 10000, 64, 'sha512').toString('hex');
    next();
  } catch (error) {
    next(error);
  }
});

// Update limits based on plan
UserSchema.pre('save', function(next) {
  if (this.isModified('plan')) {
    switch (this.plan) {
      case 'free':
        this.limits = {
          maxQRCodes: 5,
          maxScansPerMonth: 100,
          canCustomize: false,
          canTrackAnalytics: false,
          canExportData: false
        };
        break;
      case 'pro':
        this.limits = {
          maxQRCodes: 100,
          maxScansPerMonth: 10000,
          canCustomize: true,
          canTrackAnalytics: true,
          canExportData: true
        };
        break;
      case 'enterprise':
        this.limits = {
          maxQRCodes: -1, // Unlimited
          maxScansPerMonth: -1, // Unlimited
          canCustomize: true,
          canTrackAnalytics: true,
          canExportData: true
        };
        break;
    }
  }
  next();
});

// Compare password method
UserSchema.methods.comparePassword = function(candidatePassword) {
  const hashedCandidate = bcrypt.pbkdf2Sync(candidatePassword, 'salt', 10000, 64, 'sha512').toString('hex');
  return hashedCandidate === this.password;
};

module.exports = mongoose.model('User', UserSchema);