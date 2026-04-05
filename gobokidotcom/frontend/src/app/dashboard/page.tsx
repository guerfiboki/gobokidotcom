// ============================================================
// GOBOKI Frontend — Zustand Stores + Key Pages
// ============================================================

// ── stores/auth.store.ts ──────────────────────────────────────
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface AuthState {
  user: User | null;
  tenant: Tenant | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  setTenant: (tenant: Tenant | null) => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      tenant: null,
      isAuthenticated: false,
      isLoading: false,
      setUser: (user) => set({ user, isAuthenticated: !!user }),
      setTenant: (tenant) => set({ tenant }),
      login: async (email, password) => {
        set({ isLoading: true });
        try {
          await api.login(email, password);
          const user = await api.getMe();
          set({ user, isAuthenticated: true });
        } finally {
          set({ isLoading: false });
        }
      },
      logout: () => {
        api.logout();
        set({ user: null, tenant: null, isAuthenticated: false });
      },
    }),
    {
      name: 'goboki-auth',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ user: state.user, tenant: state.tenant, isAuthenticated: state.isAuthenticated }),
    }
  )
);

// Import types (assumed co-located)
import type { User, Tenant, Booking, BookingStatus, DashboardOverview } from '../types';
import api from '../lib/api-client';


// ── stores/bookings.store.ts ──────────────────────────────────
import { create } from 'zustand';

interface BookingsState {
  bookings: Booking[];
  total: number;
  page: number;
  isLoading: boolean;
  filters: { status?: BookingStatus; search?: string; dateFrom?: string; dateTo?: string };
  fetchBookings: (page?: number) => Promise<void>;
  setFilter: (key: string, value: any) => void;
  updateBookingStatus: (id: string, status: BookingStatus) => Promise<void>;
}

export const useBookingsStore = create<BookingsState>((set, get) => ({
  bookings: [],
  total: 0,
  page: 1,
  isLoading: false,
  filters: {},
  fetchBookings: async (page = 1) => {
    set({ isLoading: true });
    try {
      const res = await api.getBookings({ page, limit: 25, ...get().filters });
      set({ bookings: res.data, total: res.meta.total, page });
    } finally {
      set({ isLoading: false });
    }
  },
  setFilter: (key, value) => {
    set((s) => ({ filters: { ...s.filters, [key]: value }, page: 1 }));
    get().fetchBookings(1);
  },
  updateBookingStatus: async (id, status) => {
    await api.updateBooking(id, { status });
    set((s) => ({
      bookings: s.bookings.map((b) => (b.id === id ? { ...b, status } : b)),
    }));
  },
}));


// ── app/dashboard/page.tsx ────────────────────────────────────
'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend
} from 'recharts';
import {
  TrendingUp, Calendar, Users, CreditCard,
  ArrowUpRight, ArrowDownRight
} from 'lucide-react';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const COLORS = ['#0d9f80','#1a6fd4','#f59f00','#e03131'];

function StatCard({
  label, value, trend, trendLabel, icon: Icon, color
}: {
  label: string; value: string; trend: number;
  trendLabel: string; icon: any; color: string;
}) {
  const isPositive = trend >= 0;
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500 font-medium">{label}</span>
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${color}`}>
          <Icon size={16} className="text-white" />
        </div>
      </div>
      <div className="text-2xl font-bold text-gray-900 tracking-tight">{value}</div>
      <div className="flex items-center gap-1.5 text-sm">
        {isPositive
          ? <ArrowUpRight size={14} className="text-emerald-500" />
          : <ArrowDownRight size={14} className="text-red-500" />
        }
        <span className={isPositive ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'}>
          {isPositive ? '+' : ''}{trend}%
        </span>
        <span className="text-gray-400">{trendLabel}</span>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { data: overview, isLoading } = useQuery({
    queryKey: ['dashboard-overview'],
    queryFn: () => api.getDashboardOverview(),
    staleTime: 30_000,
  });

  const { data: revenueData } = useQuery({
    queryKey: ['revenue-monthly'],
    queryFn: () => api.getRevenueByMonth(),
  });

  if (isLoading) return <DashboardSkeleton />;

  const stats = overview ?? ({} as DashboardOverview);
  const chartData = (revenueData ?? []).map((d: any) => ({
    month: MONTHS[d.month - 1],
    revenue: d.revenue,
    bookings: d.bookings,
  }));

  const pieData = [
    { name: 'Surf Retreats', value: 40 },
    { name: 'Dive Packages', value: 20 },
    { name: 'Safari Tours', value: 22 },
    { name: 'Yoga Camps', value: 18 },
  ];

  return (
    <div className="p-7 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Good morning 👋</h1>
          <p className="text-sm text-gray-500 mt-1">Here's what's happening with your business today</p>
        </div>
        <button className="flex items-center gap-2 bg-teal-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-teal-700 transition-colors">
          + New Booking
        </button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          label="Monthly Revenue"
          value={`$${stats.revenue?.thisMonth?.toLocaleString() ?? '-'}`}
          trend={stats.revenue?.growth ?? 0}
          trendLabel="vs last month"
          icon={CreditCard}
          color="bg-teal-500"
        />
        <StatCard
          label="Active Bookings"
          value={String(stats.bookings?.total ?? '-')}
          trend={stats.bookings?.growth ?? 0}
          trendLabel="this week"
          icon={Calendar}
          color="bg-blue-500"
        />
        <StatCard
          label="Occupancy Rate"
          value={`${stats.occupancy?.overall ?? '-'}%`}
          trend={12}
          trendLabel="vs target"
          icon={TrendingUp}
          color="bg-violet-500"
        />
        <StatCard
          label="New Customers"
          value={String(stats.customers?.newThisMonth ?? '-')}
          trend={stats.customers?.growth ?? 0}
          trendLabel="this month"
          icon={Users}
          color="bg-amber-500"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 bg-white rounded-2xl border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-semibold text-gray-900">Revenue Overview</h3>
            <div className="text-xs text-gray-400">2025</div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} barSize={24}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#9ca3af' }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#9ca3af' }}
                tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => [`$${v.toLocaleString()}`, 'Revenue']} />
              <Bar dataKey="revenue" fill="#0d9f80" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <h3 className="font-semibold text-gray-900 mb-4">Experience Mix</h3>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={65} dataKey="value">
                {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v: number) => [`${v}%`]} />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-1.5 mt-2">
            {pieData.map((d, i) => (
              <div key={d.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ background: COLORS[i] }} />
                  <span className="text-gray-600">{d.name}</span>
                </div>
                <span className="font-medium text-gray-900">{d.value}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="p-7 space-y-6 animate-pulse">
      <div className="h-8 bg-gray-200 rounded w-48" />
      <div className="grid grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-gray-100 rounded-2xl h-32" />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 bg-gray-100 rounded-2xl h-72" />
        <div className="bg-gray-100 rounded-2xl h-72" />
      </div>
    </div>
  );
}
