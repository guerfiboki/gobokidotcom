// ============================================================
// GOBOKI Frontend — API Client + TypeScript Types
// ============================================================

// ── types/index.ts ────────────────────────────────────────────
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: 'starter' | 'pro' | 'enterprise';
  settings: TenantSettings;
}

export interface TenantSettings {
  primaryColor: string;
  timezone: string;
  currency: string;
  language: string;
  depositPercent: number;
  logo?: string;
}

export interface User {
  id: string;
  tenantId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'owner' | 'admin' | 'staff';
  avatarUrl?: string;
}

export interface Experience {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  type: 'retreat' | 'tour' | 'package' | 'room' | 'activity' | 'camp';
  description: string;
  shortDesc: string;
  images: string[];
  basePrice: number;
  currency: string;
  durationDays: number;
  maxCapacity: number;
  maxGuests: number;
  location: { country: string; city: string; coordinates: { lat: number; lng: number } };
  inclusions: string[];
  exclusions: string[];
  isActive: boolean;
}

export interface Customer {
  id: string;
  tenantId: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  nationality?: string;
  tags: string[];
  notes?: string;
  source: string;
  totalBookings: number;
  totalSpent: number;
  createdAt: string;
}

export type BookingStatus =
  | 'pending' | 'confirmed' | 'deposit_paid'
  | 'fully_paid' | 'cancelled' | 'refunded' | 'completed' | 'no_show';

export interface Booking {
  id: string;
  tenantId: string;
  reference: string;
  customerId: string;
  customer?: Customer;
  experienceId: string;
  experience?: Experience;
  status: BookingStatus;
  startDate: string;
  endDate: string;
  guests: number;
  adults: number;
  children: number;
  baseAmount: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  balanceDue: number;
  currency: string;
  depositPercent: number;
  depositDueDate?: string;
  balanceDueDate?: string;
  specialRequests?: string;
  internalNotes?: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: string;
  bookingId: string;
  type: 'charge' | 'refund' | 'partial_refund' | 'deposit';
  status: 'pending' | 'processing' | 'succeeded' | 'failed' | 'cancelled';
  amount: number;
  currency: string;
  provider: 'stripe' | 'paypal' | 'manual' | 'bank_transfer';
  providerPaymentId?: string;
  paymentMethod?: { brand: string; last4: string };
  receiptUrl?: string;
  processedAt?: string;
  createdAt: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface DashboardOverview {
  revenue: {
    total: number;
    thisMonth: number;
    lastMonth: number;
    growth: number;
    currency: string;
  };
  bookings: {
    total: number;
    confirmed: number;
    pending: number;
    cancelled: number;
    avgValue: number;
    growth: number;
  };
  occupancy: {
    overall: number;
    target: number;
    byExperience: Array<{ name: string; rate: number; capacity: number; booked: number }>;
  };
  customers: {
    total: number;
    newThisMonth: number;
    returning: number;
    retentionRate: number;
    avgLifetimeValue: number;
    growth: number;
  };
}


// ── lib/api-client.ts ─────────────────────────────────────────
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

class GobokiApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: BASE_URL,
      timeout: 15000,
      headers: { 'Content-Type': 'application/json' },
    });

    // Request interceptor: inject JWT
    this.client.interceptors.request.use((config) => {
      const token = typeof window !== 'undefined'
        ? localStorage.getItem('goboki_access_token')
        : null;
      if (token) config.headers.Authorization = `Bearer ${token}`;
      return config;
    });

    // Response interceptor: refresh on 401
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;
        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;
          try {
            const refreshToken = localStorage.getItem('goboki_refresh_token');
            const { data } = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken });
            localStorage.setItem('goboki_access_token', data.accessToken);
            localStorage.setItem('goboki_refresh_token', data.refreshToken);
            originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
            return this.client(originalRequest);
          } catch {
            // Refresh failed: redirect to login
            localStorage.removeItem('goboki_access_token');
            localStorage.removeItem('goboki_refresh_token');
            window.location.href = '/login';
          }
        }
        return Promise.reject(error);
      }
    );
  }

  // ── Auth ──────────────────────────────────────────────────
  async login(email: string, password: string) {
    const { data } = await this.client.post('/auth/login', { email, password });
    localStorage.setItem('goboki_access_token', data.accessToken);
    localStorage.setItem('goboki_refresh_token', data.refreshToken);
    return data;
  }

  async logout() {
    localStorage.removeItem('goboki_access_token');
    localStorage.removeItem('goboki_refresh_token');
  }

  async getMe(): Promise<User> {
    const { data } = await this.client.get('/auth/me');
    return data;
  }

  // ── Bookings ──────────────────────────────────────────────
  async getBookings(params?: {
    page?: number; limit?: number; status?: BookingStatus;
    search?: string; dateFrom?: string; dateTo?: string;
  }): Promise<PaginatedResponse<Booking>> {
    const { data } = await this.client.get('/bookings', { params });
    return data;
  }

  async getBooking(id: string): Promise<Booking> {
    const { data } = await this.client.get(`/bookings/${id}`);
    return data;
  }

  async createBooking(payload: {
    customerId: string; experienceId: string;
    startDate: string; endDate: string;
    adults: number; children?: number;
    specialRequests?: string; depositPercent?: number;
  }): Promise<Booking> {
    const { data } = await this.client.post('/bookings', payload);
    return data;
  }

  async updateBooking(id: string, payload: Partial<{ status: BookingStatus; internalNotes: string }>) {
    const { data } = await this.client.patch(`/bookings/${id}`, payload);
    return data;
  }

  async cancelBooking(id: string, reason?: string) {
    await this.client.delete(`/bookings/${id}`, { data: { reason } });
  }

  async getCalendarBookings(year: number, month: number): Promise<Booking[]> {
    const { data } = await this.client.get('/bookings/calendar', { params: { year, month } });
    return data;
  }

  // ── Customers ─────────────────────────────────────────────
  async getCustomers(params?: { page?: number; limit?: number; search?: string; tags?: string[] }) {
    const { data } = await this.client.get('/customers', { params });
    return data as PaginatedResponse<Customer>;
  }

  async getCustomer(id: string): Promise<Customer> {
    const { data } = await this.client.get(`/customers/${id}`);
    return data;
  }

  async createCustomer(payload: Partial<Customer>): Promise<Customer> {
    const { data } = await this.client.post('/customers', payload);
    return data;
  }

  // ── Experiences ───────────────────────────────────────────
  async getExperiences(): Promise<Experience[]> {
    const { data } = await this.client.get('/experiences');
    return data;
  }

  async getExperience(id: string): Promise<Experience> {
    const { data } = await this.client.get(`/experiences/${id}`);
    return data;
  }

  async checkAvailability(params: {
    experienceId: string; startDate: string; endDate: string; guests: number;
  }) {
    const { data } = await this.client.get('/availability/check', { params });
    return data as { available: boolean; remainingCapacity: number; price: number };
  }

  // ── Payments ──────────────────────────────────────────────
  async createPaymentIntent(payload: {
    bookingId: string; amount: number; currency: string; isDeposit?: boolean;
  }) {
    const { data } = await this.client.post('/payments/stripe/intent', payload);
    return data as { clientSecret: string; paymentIntentId: string };
  }

  async createPayPalOrder(payload: {
    bookingId: string; amount: number; currency: string;
  }) {
    const { data } = await this.client.post('/payments/paypal/order', payload);
    return data as { orderId: string; approvalUrl: string };
  }

  async issueRefund(payload: {
    paymentIntentId: string; amount?: number; reason?: string;
  }) {
    const { data } = await this.client.post('/payments/refund', payload);
    return data;
  }

  // ── Analytics ─────────────────────────────────────────────
  async getDashboardOverview(): Promise<DashboardOverview> {
    const { data } = await this.client.get('/analytics/overview');
    return data;
  }

  async getRevenueByMonth(year?: number) {
    const { data } = await this.client.get('/analytics/revenue', { params: { year } });
    return data;
  }

  async getOccupancyRates() {
    const { data } = await this.client.get('/analytics/occupancy');
    return data;
  }
}

export const api = new GobokiApiClient();
export default api;
