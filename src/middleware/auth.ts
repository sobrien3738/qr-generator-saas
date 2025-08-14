import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import User from '../models/User';

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    plan: string;
    limits: {
      maxQRCodes: number;
      maxScansPerMonth: number;
      canCustomize: boolean;
      canTrackAnalytics: boolean;
      canExportData: boolean;
    };
  };
}

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        plan: string;
        limits: {
          maxQRCodes: number;
          maxScansPerMonth: number;
          canCustomize: boolean;
          canTrackAnalytics: boolean;
          canExportData: boolean;
        };
      };
    }
  }
}

export const authenticateToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'your-secret-key'
    ) as { id: string; email: string };

    // Fetch user data to get current limits
    const user = await User.findById(decoded.id).select('-password');
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid token - user not found' });
    }

    req.user = {
      id: user._id.toString(),
      email: user.email,
      plan: user.plan,
      limits: user.limits
    };

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    console.error('Auth middleware error:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
};

// Optional authentication - sets user if token is valid, but doesn't require it
export const optionalAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || 'your-secret-key'
      ) as { id: string; email: string };

      const user = await User.findById(decoded.id).select('-password');
      
      if (user) {
        req.user = {
          id: user._id.toString(),
          email: user.email,
          plan: user.plan,
          limits: user.limits
        };
      }
    }

    next();
  } catch (error) {
    // Don't fail - just continue without user
    next();
  }
};