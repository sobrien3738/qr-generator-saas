import express from 'express';
import QRCodeModel from '../models/QRCode';
import { authenticateToken } from '../middleware/auth';

const router = express.Router();

// Get analytics for a specific QR code
router.get('/qr/:id', authenticateToken, async (req, res) => {
  try {
    const qrCode = await QRCodeModel.findOne({
      _id: req.params.id,
      userId: req.user!.id
    });

    if (!qrCode) {
      return res.status(404).json({ error: 'QR code not found or unauthorized' });
    }

    // Check if user has analytics access
    if (!req.user!.limits.canTrackAnalytics) {
      return res.status(403).json({ error: 'Analytics access requires premium plan' });
    }

    // Prepare analytics data
    const analytics = {
      totalScans: qrCode.analytics.totalScans,
      lastScanned: qrCode.analytics.lastScanned,
      createdAt: qrCode.createdAt,
      
      // Scan history for the last 30 days
      recentScans: qrCode.analytics.scanHistory
        .filter(scan => {
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          return scan.timestamp >= thirtyDaysAgo;
        })
        .map(scan => ({
          timestamp: scan.timestamp,
          userAgent: scan.userAgent,
          location: scan.location
        })),

      // Daily scan counts for the last 30 days
      dailyScans: getDailyScans(qrCode.analytics.scanHistory),
      
      // Browser/device analytics
      deviceStats: getDeviceStats(qrCode.analytics.scanHistory),
      
      // Geographic data if available
      locationStats: getLocationStats(qrCode.analytics.scanHistory)
    };

    res.json(analytics);

  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// Get dashboard analytics for user
router.get('/dashboard', authenticateToken, async (req, res) => {
  try {
    if (!req.user!.limits.canTrackAnalytics) {
      return res.status(403).json({ error: 'Analytics access requires premium plan' });
    }

    const userId = req.user!.id;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Get user's QR codes
    const qrCodes = await QRCodeModel.find({ userId });

    // Calculate overall stats
    const totalQRCodes = qrCodes.length;
    const totalScans = qrCodes.reduce((sum, qr) => sum + qr.analytics.totalScans, 0);
    const activeQRCodes = qrCodes.filter(qr => qr.isActive).length;

    // Recent activity
    const recentScans = qrCodes
      .flatMap(qr => 
        qr.analytics.scanHistory
          .filter(scan => scan.timestamp >= thirtyDaysAgo)
          .map(scan => ({
            qrCodeId: qr._id,
            title: qr.title || 'Untitled',
            shortId: qr.shortId,
            timestamp: scan.timestamp
          }))
      )
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 20);

    // Top performing QR codes
    const topQRCodes = qrCodes
      .sort((a, b) => b.analytics.totalScans - a.analytics.totalScans)
      .slice(0, 10)
      .map(qr => ({
        id: qr._id,
        title: qr.title || 'Untitled',
        shortId: qr.shortId,
        totalScans: qr.analytics.totalScans,
        lastScanned: qr.analytics.lastScanned,
        createdAt: qr.createdAt
      }));

    // Daily scan totals for chart
    const allScanHistory = qrCodes.flatMap(qr => qr.analytics.scanHistory);
    const dailyTotals = getDailyScans(allScanHistory);

    res.json({
      overview: {
        totalQRCodes,
        activeQRCodes,
        totalScans,
        scansThisMonth: allScanHistory.filter(scan => scan.timestamp >= thirtyDaysAgo).length
      },
      recentActivity: recentScans,
      topPerforming: topQRCodes,
      chartData: {
        dailyScans: dailyTotals
      },
      deviceStats: getDeviceStats(allScanHistory),
      locationStats: getLocationStats(allScanHistory)
    });

  } catch (error) {
    console.error('Dashboard analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard analytics' });
  }
});

// Export analytics data
router.get('/export/:id', authenticateToken, async (req, res) => {
  try {
    if (!req.user!.limits.canExportData) {
      return res.status(403).json({ error: 'Data export requires premium plan' });
    }

    const qrCode = await QRCodeModel.findOne({
      _id: req.params.id,
      userId: req.user!.id
    });

    if (!qrCode) {
      return res.status(404).json({ error: 'QR code not found or unauthorized' });
    }

    const exportData = {
      qrCode: {
        id: qrCode._id,
        title: qrCode.title,
        description: qrCode.description,
        originalUrl: qrCode.url,
        shortId: qrCode.shortId,
        createdAt: qrCode.createdAt
      },
      analytics: {
        totalScans: qrCode.analytics.totalScans,
        lastScanned: qrCode.analytics.lastScanned,
        scanHistory: qrCode.analytics.scanHistory.map(scan => ({
          timestamp: scan.timestamp,
          userAgent: scan.userAgent,
          ipAddress: scan.ipAddress,
          location: scan.location
        }))
      }
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="qr-analytics-${qrCode.shortId}.json"`);
    res.json(exportData);

  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

// Helper functions
function getDailyScans(scanHistory: any[]): { date: string; scans: number }[] {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const dailyMap = new Map<string, number>();
  
  // Initialize all days with 0
  for (let i = 0; i < 30; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    dailyMap.set(dateStr, 0);
  }

  // Count scans per day
  scanHistory
    .filter(scan => scan.timestamp >= thirtyDaysAgo)
    .forEach(scan => {
      const dateStr = scan.timestamp.toISOString().split('T')[0];
      dailyMap.set(dateStr, (dailyMap.get(dateStr) || 0) + 1);
    });

  return Array.from(dailyMap.entries())
    .map(([date, scans]) => ({ date, scans }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function getDeviceStats(scanHistory: any[]): { device: string; count: number; percentage: number }[] {
  const deviceMap = new Map<string, number>();
  const total = scanHistory.length;

  scanHistory.forEach(scan => {
    if (scan.userAgent) {
      let device = 'Unknown';
      const ua = scan.userAgent.toLowerCase();
      
      if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
        device = 'Mobile';
      } else if (ua.includes('tablet') || ua.includes('ipad')) {
        device = 'Tablet';
      } else if (ua.includes('bot') || ua.includes('crawler')) {
        device = 'Bot';
      } else {
        device = 'Desktop';
      }
      
      deviceMap.set(device, (deviceMap.get(device) || 0) + 1);
    }
  });

  return Array.from(deviceMap.entries())
    .map(([device, count]) => ({
      device,
      count,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0
    }))
    .sort((a, b) => b.count - a.count);
}

function getLocationStats(scanHistory: any[]): { country: string; count: number }[] {
  const locationMap = new Map<string, number>();

  scanHistory.forEach(scan => {
    if (scan.location?.country) {
      const country = scan.location.country;
      locationMap.set(country, (locationMap.get(country) || 0) + 1);
    }
  });

  return Array.from(locationMap.entries())
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10); // Top 10 countries
}

export default router;