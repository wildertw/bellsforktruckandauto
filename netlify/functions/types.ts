/**
 * Shared types for Netlify serverless functions.
 * Import these when writing new functions in TypeScript.
 */

export interface NetlifyEvent {
  httpMethod: string;
  headers: Record<string, string>;
  body: string | null;
  queryStringParameters: Record<string, string> | null;
  path: string;
  isBase64Encoded?: boolean;
}

export interface NetlifyResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
  isBase64Encoded?: boolean;
}

export type NetlifyHandler = (
  event: NetlifyEvent,
  context?: unknown
) => Promise<NetlifyResponse>;

export interface CorsHeaders {
  'Access-Control-Allow-Origin': string;
  'Access-Control-Allow-Methods': string;
  'Access-Control-Allow-Headers': string;
  Vary: string;
}

export interface Vehicle {
  sku: string;
  stockNumber?: string;
  vin?: string;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  engine?: string;
  transmission?: string;
  mileage?: number;
  price?: number;
  salePrice?: number;
  category?: string;
  status?: 'available' | 'pending' | 'sold';
  exteriorColor?: string;
  interiorColor?: string;
  features?: string[];
  images?: string[];
  description?: string;
  condition?: string;
  titleState?: string;
  warranty?: string;
  doors?: string;
  cylinders?: string;
  mpgCity?: number;
  mpgHighway?: number;
  fuelType?: string;
  soldDate?: string;
  salesperson?: string;
  buyerName?: string;
  leadType?: string;
}

export interface Lead {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  formType: string;
  status: 'hot' | 'warm' | 'cold';
  outcome?: string;
  createdAt: string;
  updatedAt?: string;
  vehicleInterest?: string;
}

export interface BlogPost {
  slug: string;
  title: string;
  content: string;
  excerpt?: string;
  author?: string;
  status: 'published' | 'draft';
  createdAt: string;
  updatedAt?: string;
  featuredImage?: string;
  tags?: string[];
}
