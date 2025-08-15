import QRCode from 'qrcode';
import { customAlphabet } from 'nanoid';
import { createCanvas, loadImage } from 'canvas';

export interface QRCodeOptions {
  size?: number;
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
  foregroundColor?: string;
  backgroundColor?: string;
  margin?: number;
}

export interface QRCodeResult {
  dataURL: string;
  shortId: string;
  redirectUrl: string;
}

// Generate unique short ID for QR codes
const generateShortId = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 8);

export const generateQRCode = async (
  originalUrl: string, 
  options: QRCodeOptions = {}
): Promise<QRCodeResult> => {
  const {
    size = 256,
    errorCorrectionLevel = 'M',
    foregroundColor = '#000000',
    backgroundColor = '#FFFFFF',
    margin = 4
  } = options;

  // Generate unique short ID
  const shortId = generateShortId();
  
  // Create redirect URL that will track analytics
  const baseUrl = process.env.BASE_URL || 'http://localhost:5000';
  const redirectUrl = `${baseUrl}/r/${shortId}`;

  try {
    // Generate QR code as data URL
    const dataURL = await QRCode.toDataURL(redirectUrl, {
      width: size,
      margin,
      color: {
        dark: foregroundColor,
        light: backgroundColor
      },
      errorCorrectionLevel: errorCorrectionLevel as any
    });

    return {
      dataURL,
      shortId,
      redirectUrl
    };
  } catch (error) {
    throw new Error(`Failed to generate QR code: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

export const generateQRCodeSVG = async (
  originalUrl: string,
  options: QRCodeOptions = {}
): Promise<string> => {
  const {
    size = 256,
    errorCorrectionLevel = 'M',
    foregroundColor = '#000000',
    backgroundColor = '#FFFFFF',
    margin = 4
  } = options;

  // Generate unique short ID
  const shortId = generateShortId();
  
  // Create redirect URL
  const baseUrl = process.env.BASE_URL || 'http://localhost:5000';
  const redirectUrl = `${baseUrl}/r/${shortId}`;

  try {
    // Generate QR code as SVG
    const svg = await QRCode.toString(redirectUrl, {
      type: 'svg',
      width: size,
      margin,
      color: {
        dark: foregroundColor,
        light: backgroundColor
      },
      errorCorrectionLevel: errorCorrectionLevel as any
    });

    return svg;
  } catch (error) {
    throw new Error(`Failed to generate QR code SVG: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

// Validate URL format
export const validateUrl = (url: string): boolean => {
  try {
    const parsedUrl = new URL(url);
    return ['http:', 'https:'].includes(parsedUrl.protocol);
  } catch {
    return false;
  }
};

export const generateQRCodePDF = async (
  originalUrl: string,
  options: QRCodeOptions = {},
  metadata?: { title?: string; description?: string; url?: string }
): Promise<Buffer> => {
  const {
    size = 256,
    errorCorrectionLevel = 'M',
    foregroundColor = '#000000',
    backgroundColor = '#FFFFFF',
    margin = 4
  } = options;

  // Generate unique short ID
  const shortId = generateShortId();
  
  // Create redirect URL
  const baseUrl = process.env.BASE_URL || 'http://localhost:5000';
  const redirectUrl = `${baseUrl}/r/${shortId}`;

  try {
    // Create canvas for PDF generation
    const canvas = createCanvas(600, 800);
    const ctx = canvas.getContext('2d');

    // Set background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 600, 800);

    // Generate QR code on canvas
    const qrCanvas = createCanvas(size, size);
    await QRCode.toCanvas(qrCanvas, redirectUrl, {
      width: size,
      margin,
      color: {
        dark: foregroundColor,
        light: backgroundColor
      },
      errorCorrectionLevel: errorCorrectionLevel as any
    });

    // Draw QR code centered
    const qrX = (600 - size) / 2;
    const qrY = 100;
    ctx.drawImage(qrCanvas, qrX, qrY);

    // Add title if provided
    if (metadata?.title) {
      ctx.fillStyle = '#1f2937';
      ctx.font = 'bold 24px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(metadata.title, 300, 60);
    }

    // Add description if provided
    if (metadata?.description) {
      ctx.fillStyle = '#6b7280';
      ctx.font = '16px Arial';
      ctx.textAlign = 'center';
      const maxWidth = 500;
      const words = metadata.description.split(' ');
      let line = '';
      let y = qrY + size + 50;
      
      for (let i = 0; i < words.length; i++) {
        const testLine = line + words[i] + ' ';
        const metrics = ctx.measureText(testLine);
        const testWidth = metrics.width;
        
        if (testWidth > maxWidth && i > 0) {
          ctx.fillText(line, 300, y);
          line = words[i] + ' ';
          y += 25;
        } else {
          line = testLine;
        }
      }
      ctx.fillText(line, 300, y);
      y += 25;
    }

    // Add URL
    if (originalUrl) {
      ctx.fillStyle = '#3b82f6';
      ctx.font = '14px Arial';
      ctx.textAlign = 'center';
      const urlY = metadata?.description ? qrY + size + 150 : qrY + size + 50;
      ctx.fillText(originalUrl, 300, urlY);
    }

    // Add footer
    ctx.fillStyle = '#9ca3af';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Generated by QRGen Pro', 300, 750);
    ctx.fillText(new Date().toLocaleDateString(), 300, 770);

    return canvas.toBuffer('image/png');
  } catch (error) {
    throw new Error(`Failed to generate QR code PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

// Sanitize URL
export const sanitizeUrl = (url: string): string => {
  url = url.trim();
  
  // Add protocol if missing
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }
  
  return url;
};