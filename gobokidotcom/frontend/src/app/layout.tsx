// ============================================================
// GOBOKI Frontend — Layout, TailwindCSS Config & Key Pages
// ============================================================

// ── tailwind.config.ts ───────────────────────────────────────
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        teal: {
          50: '#e0f5f0',
          100: '#b3e6d9',
          200: '#7dd4c0',
          300: '#4ac2a8',
          400: '#1fb395',
          500: '#0d9f80',
          600: '#0c8a6e',
          700: '#097559',
          800: '#065f45',
          900: '#034a34',
        },
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        serif: ['Playfair Display', 'Georgia', 'serif'],
      },
      borderRadius: {
        '2xl': '16px',
        '3xl': '24px',
      },
    },
  },
  plugins: [],
};
export default config;


// ── app/layout.tsx ────────────────────────────────────────────
import type { Metadata } from 'next';
import { DM_Sans, Playfair_Display } from 'next/font/google';
import { Providers } from './providers';
import './globals.css';

const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-sans' });
const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-serif',
  weight: ['700'],
});

export const metadata: Metadata = {
  title: 'GOBOKI — Travel Business Platform',
  description: 'All-in-one booking & operations for tour operators, retreats, and experience providers.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${playfair.variable}`}>
      <body className="bg-gray-50 antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}


// ── app/providers.tsx ─────────────────────────────────────────
'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Toaster } from 'react-hot-toast';
import { useState } from 'react';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 2,
        refetchOnWindowFocus: false,
      },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster position="bottom-right" toastOptions={{
        style: { borderRadius: '10px', background: '#0f1923', color: '#fff', fontSize: '13px' },
        success: { iconTheme: { primary: '#0d9f80', secondary: '#fff' } },
      }} />
      {process.env.NODE_ENV === 'development' && <ReactQueryDevtools />}
    </QueryClientProvider>
  );
}


// ── app/(dashboard)/layout.tsx — Authenticated shell ─────────
'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth.store';
import {
  LayoutDashboard, Calendar, Users, CreditCard,
  Globe, Star, Settings, LogOut, ChevronRight, Bell
} from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/bookings', label: 'Bookings', icon: Calendar, badge: 12 },
  { href: '/calendar', label: 'Calendar', icon: Calendar },
  { href: '/customers', label: 'Customers', icon: Users },
  { href: '/payments', label: 'Payments', icon: CreditCard, badge: 3, badgeColor: 'amber' },
  { href: '/website', label: 'Website', icon: Globe },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, tenant, logout } = useAuthStore();

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-gray-100 flex flex-col flex-shrink-0">
        {/* Logo */}
        <div className="h-14 flex items-center px-5 border-b border-gray-100">
          <div className="w-8 h-8 rounded-full bg-teal-500 flex items-center justify-center mr-2.5">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" className="w-4 h-4">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/>
            </svg>
          </div>
          <span className="font-serif font-bold text-lg text-gray-900">
            GO<span className="text-teal-500">BOKI</span>
          </span>
        </div>

        {/* Tenant info */}
        <div className="px-4 py-3 border-b border-gray-50">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-teal-100 flex items-center justify-center">
              <span className="text-xs font-bold text-teal-700">
                {tenant?.name?.charAt(0) ?? 'B'}
              </span>
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-gray-800 truncate">
                {tenant?.name ?? 'Blue Horizon'}
              </div>
              <div className="text-[10px] text-teal-600 font-medium capitalize">
                {tenant?.plan ?? 'Pro'} plan
              </div>
            </div>
            <ChevronRight size={12} className="text-gray-300 ml-auto flex-shrink-0" />
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          <div className="text-[10px] font-semibold text-gray-400 px-3 pb-1 pt-1 uppercase tracking-wider">
            Operations
          </div>
          {NAV_ITEMS.map(({ href, label, icon: Icon, badge, badgeColor }) => {
            const isActive = pathname === href || pathname.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all',
                  isActive
                    ? 'bg-teal-50 text-teal-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                )}
              >
                <Icon size={15} className={isActive ? 'text-teal-600' : 'text-gray-400'} />
                <span className="flex-1">{label}</span>
                {badge && (
                  <span className={cn(
                    'text-[10px] font-semibold px-1.5 py-0.5 rounded-full',
                    badgeColor === 'amber'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-teal-500 text-white'
                  )}>
                    {badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Upgrade prompt */}
        <div className="p-3">
          <div className="bg-gradient-to-br from-gray-900 to-teal-900 rounded-xl p-3.5 text-white">
            <div className="flex items-center gap-1.5 mb-1">
              <Star size={12} className="text-yellow-400 fill-yellow-400" />
              <span className="text-xs font-semibold">AI Features</span>
            </div>
            <p className="text-[11px] text-white/60 mb-2.5">
              Smart recommendations & forecasting
            </p>
            <button className="w-full bg-teal-500 hover:bg-teal-400 text-white text-xs font-semibold py-1.5 rounded-lg transition-colors">
              Upgrade to Enterprise
            </button>
          </div>
        </div>

        {/* User */}
        <div className="px-3 py-3 border-t border-gray-100 flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-violet-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
            {user?.firstName?.charAt(0) ?? 'J'}{user?.lastName?.charAt(0) ?? 'D'}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-gray-800 truncate">
              {user?.firstName} {user?.lastName}
            </div>
            <div className="text-[10px] text-gray-400 truncate">{user?.email}</div>
          </div>
          <button onClick={handleLogout} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <LogOut size={13} />
          </button>
        </div>
      </aside>

      {/* Top bar */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 bg-white border-b border-gray-100 flex items-center px-6 gap-4 flex-shrink-0">
          <div className="flex-1" />
          <button className="relative p-2 rounded-xl hover:bg-gray-50 text-gray-500 transition-colors">
            <Bell size={16} />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-teal-500 rounded-full" />
          </button>
          <div className="w-7 h-7 rounded-full bg-violet-500 flex items-center justify-center text-white text-xs font-bold cursor-pointer">
            {user?.firstName?.charAt(0) ?? 'J'}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}


// ── lib/utils.ts ──────────────────────────────────────────────
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(date: string | Date, fmt = 'MMM d, yyyy'): string {
  // use date-fns format
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric'
  });
}

export const BOOKING_STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  pending:      { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Pending' },
  confirmed:    { bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'Confirmed' },
  deposit_paid: { bg: 'bg-violet-100', text: 'text-violet-800', label: 'Deposit Paid' },
  fully_paid:   { bg: 'bg-teal-100', text: 'text-teal-800', label: 'Fully Paid' },
  cancelled:    { bg: 'bg-red-100', text: 'text-red-800', label: 'Cancelled' },
  refunded:     { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Refunded' },
  completed:    { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Completed' },
  no_show:      { bg: 'bg-orange-100', text: 'text-orange-800', label: 'No Show' },
};

export function getBookingStatusBadge(status: string) {
  return BOOKING_STATUS_COLORS[status] ?? BOOKING_STATUS_COLORS.pending;
}


// ── app/(auth)/login/page.tsx ─────────────────────────────────
'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth.store';
import toast from 'react-hot-toast';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export default function LoginPage() {
  const router = useRouter();
  const { login, isLoading } = useAuthStore();
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: 'jordan@bluehorizon.com', password: 'Demo1234!' },
  });

  const onSubmit = async (data: any) => {
    try {
      await login(data.email, data.password);
      toast.success('Welcome back!');
      router.push('/dashboard');
    } catch {
      toast.error('Invalid email or password');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-teal-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="font-serif text-3xl font-bold text-white mb-1">
            GO<span className="text-teal-400">BOKI</span>
          </div>
          <p className="text-white/50 text-sm">Sign in to your workspace</p>
        </div>

        <div className="bg-white rounded-2xl p-7 shadow-2xl">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Email</label>
              <input
                {...register('email')}
                type="email"
                className="w-full px-3.5 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-300 focus:border-transparent"
              />
              {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email.message}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Password</label>
              <input
                {...register('password')}
                type="password"
                className="w-full px-3.5 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-300 focus:border-transparent"
              />
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 bg-teal-600 text-white rounded-xl font-semibold text-sm hover:bg-teal-700 disabled:opacity-50 transition-colors mt-2"
            >
              {isLoading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          <div className="mt-5 pt-5 border-t border-gray-100 text-center">
            <p className="text-xs text-gray-400">Demo credentials pre-filled above</p>
          </div>
        </div>
      </div>
    </div>
  );
}
