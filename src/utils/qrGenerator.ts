import QRCode from 'qrcode';
import { customAlphabet } from 'nanoid';

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

// Sanitize URL
export const sanitizeUrl = (url: string): string => {
  url = url.trim();
  
  // Add protocol if missing
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }
  
  return url;
};