// ============================================================
// PUBLIC BOOKING WIDGET — Embeddable on any website
// Usage: <script src="https://cdn.goboki.com/widget.js" data-tenant="blue-horizon" />
// ============================================================
'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { format, addDays, eachDayOfInterval, isBefore, isToday } from 'date-fns';
import { ChevronLeft, ChevronRight, Users, Calendar, CreditCard, Check } from 'lucide-react';
import api from '@/lib/api-client';
import type { Experience } from '@/types';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

// ── Booking form schema ───────────────────────────────────────
const bookingSchema = z.object({
  firstName: z.string().min(2, 'First name required'),
  lastName: z.string().min(2, 'Last name required'),
  email: z.string().email('Valid email required'),
  phone: z.string().optional(),
  adults: z.number().min(1).max(20),
  children: z.number().min(0).max(10),
  specialRequests: z.string().optional(),
});
type BookingFormData = z.infer<typeof bookingSchema>;

// ── Step indicator ────────────────────────────────────────────
const STEPS = ['Choose dates', 'Your details', 'Payment', 'Confirmed'];

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {STEPS.map((step, i) => (
        <div key={step} className="flex items-center gap-2">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-all ${
            i < current ? 'bg-teal-500 text-white'
            : i === current ? 'bg-teal-600 text-white ring-2 ring-teal-200'
            : 'bg-gray-100 text-gray-400'
          }`}>
            {i < current ? <Check size={12} /> : i + 1}
          </div>
          <span className={`text-xs hidden sm:block ${i === current ? 'text-teal-700 font-medium' : 'text-gray-400'}`}>
            {step}
          </span>
          {i < STEPS.length - 1 && <div className="w-8 h-px bg-gray-200 mx-1" />}
        </div>
      ))}
    </div>
  );
}

// ── Date picker ───────────────────────────────────────────────
function DatePicker({
  experienceId, durationDays, onSelect, selected,
}: {
  experienceId: string; durationDays: number;
  onSelect: (start: Date, end: Date) => void;
  selected?: { start: Date; end: Date };
}) {
  const [viewDate, setViewDate] = useState(new Date());

  const daysInMonth = eachDayOfInterval({
    start: new Date(viewDate.getFullYear(), viewDate.getMonth(), 1),
    end: new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0),
  });

  const startBlank = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay();

  // In production: fetch availability from API
  const blockedDates = new Set(['2025-08-14', '2025-08-16', '2025-08-21']);

  const handleDayClick = (day: Date) => {
    if (isBefore(day, new Date()) || blockedDates.has(format(day, 'yyyy-MM-dd'))) return;
    const end = addDays(day, durationDays);
    onSelect(day, end);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => setViewDate(d => new Date(d.getFullYear(), d.getMonth() - 1))}>
          <ChevronLeft size={16} className="text-gray-500" />
        </button>
        <span className="text-sm font-semibold text-gray-800">
          {format(viewDate, 'MMMM yyyy')}
        </span>
        <button onClick={() => setViewDate(d => new Date(d.getFullYear(), d.getMonth() + 1))}>
          <ChevronRight size={16} className="text-gray-500" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
          <div key={d} className="text-xs font-medium text-gray-400 py-1">{d}</div>
        ))}
        {Array.from({ length: startBlank }).map((_, i) => <div key={i} />)}
        {daysInMonth.map(day => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const isPast = isBefore(day, new Date()) && !isToday(day);
          const isBlocked = blockedDates.has(dateStr);
          const isSelected = selected && format(selected.start, 'yyyy-MM-dd') === dateStr;
          const inRange = selected && day >= selected.start && day <= selected.end;

          return (
            <button
              key={dateStr}
              onClick={() => handleDayClick(day)}
              disabled={isPast || isBlocked}
              className={`py-1.5 text-xs rounded-lg transition-all ${
                isSelected ? 'bg-teal-600 text-white font-semibold'
                : inRange ? 'bg-teal-100 text-teal-800'
                : isPast || isBlocked ? 'text-gray-200 cursor-not-allowed'
                : 'text-gray-700 hover:bg-teal-50 hover:text-teal-700'
              }`}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Payment form (Stripe Elements) ───────────────────────────
function StripePaymentForm({
  clientSecret, amount, currency, onSuccess
}: {
  clientSecret: string; amount: number; currency: string; onSuccess: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setIsProcessing(true);
    setError(null);

    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
    });

    if (confirmError) {
      setError(confirmError.message ?? 'Payment failed');
      setIsProcessing(false);
      return;
    }

    onSuccess();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      {error && (
        <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
      )}
      <button
        type="submit"
        disabled={isProcessing || !stripe}
        className="w-full py-3 bg-teal-600 text-white rounded-xl font-semibold text-sm disabled:opacity-50 hover:bg-teal-700 transition-colors"
      >
        {isProcessing ? 'Processing…' : `Pay ${currency} ${amount.toLocaleString()}`}
      </button>
    </form>
  );
}

// ── Main Booking Widget ───────────────────────────────────────
export function BookingWidget({
  experienceId,
  tenantSlug,
}: {
  experienceId: string;
  tenantSlug: string;
}) {
  const [step, setStep] = useState(0);
  const [selectedDates, setSelectedDates] = useState<{ start: Date; end: Date } | undefined>();
  const [guests, setGuests] = useState({ adults: 2, children: 0 });
  const [price, setPrice] = useState<number | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [bookingId, setBookingId] = useState<string | null>(null);

  const { data: experience } = useQuery<Experience>({
    queryKey: ['experience', experienceId],
    queryFn: () => api.getExperience(experienceId),
  });

  const { data: availability } = useQuery({
    queryKey: ['availability', experienceId, selectedDates, guests],
    queryFn: () => selectedDates ? api.checkAvailability({
      experienceId,
      startDate: format(selectedDates.start, 'yyyy-MM-dd'),
      endDate: format(selectedDates.end, 'yyyy-MM-dd'),
      guests: guests.adults + guests.children,
    }) : null,
    enabled: !!selectedDates,
  });

  const form = useForm<BookingFormData>({
    resolver: zodResolver(bookingSchema),
    defaultValues: { adults: 2, children: 0 },
  });

  useEffect(() => {
    if (availability?.price) setPrice(availability.price);
  }, [availability]);

  const createBookingMutation = useMutation({
    mutationFn: async (formData: BookingFormData) => {
      // 1. Find or create customer
      // 2. Create booking
      // 3. Create payment intent
      const booking = await api.createBooking({
        customerId: 'demo', // real: create customer first
        experienceId,
        startDate: format(selectedDates!.start, 'yyyy-MM-dd'),
        endDate: format(selectedDates!.end, 'yyyy-MM-dd'),
        adults: formData.adults,
        children: formData.children,
        specialRequests: formData.specialRequests,
      });

      setBookingId(booking.id);

      const intent = await api.createPaymentIntent({
        bookingId: booking.id,
        amount: booking.totalAmount,
        currency: booking.currency,
        isDeposit: true,
      });

      setClientSecret(intent.clientSecret);
      setStep(2);
    },
  });

  if (!experience) return <div className="animate-pulse bg-gray-100 h-64 rounded-2xl" />;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-lg overflow-hidden max-w-md w-full">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-900 to-teal-900 p-5 text-white">
        <h2 className="font-semibold text-base">{experience.name}</h2>
        <p className="text-xs text-white/60 mt-1">
          {experience.durationDays} days · {experience.location?.city}, {experience.location?.country}
        </p>
      </div>

      <div className="p-5">
        <StepIndicator current={step} />

        {/* Step 0: Choose dates + guests */}
        {step === 0 && (
          <div className="space-y-5">
            <DatePicker
              experienceId={experienceId}
              durationDays={experience.durationDays}
              onSelect={(s, e) => setSelectedDates({ start: s, end: e })}
              selected={selectedDates}
            />

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">Guests</label>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-xs text-gray-500">Adults</span>
                  <div className="flex items-center gap-1 ml-auto">
                    <button onClick={() => setGuests(g => ({ ...g, adults: Math.max(1, g.adults - 1) }))}
                      className="w-7 h-7 rounded-full border border-gray-200 text-sm hover:bg-gray-50 flex items-center justify-center">−</button>
                    <span className="w-8 text-center text-sm font-medium">{guests.adults}</span>
                    <button onClick={() => setGuests(g => ({ ...g, adults: Math.min(experience.maxGuests, g.adults + 1) }))}
                      className="w-7 h-7 rounded-full border border-gray-200 text-sm hover:bg-gray-50 flex items-center justify-center">+</button>
                  </div>
                </div>
              </div>
            </div>

            {selectedDates && (
              <div className="bg-teal-50 border border-teal-100 rounded-xl p-3 flex items-center justify-between">
                <div>
                  <div className="text-xs text-teal-700">
                    {format(selectedDates.start, 'MMM d')} – {format(selectedDates.end, 'MMM d, yyyy')}
                  </div>
                  <div className="text-lg font-bold text-teal-800 mt-0.5">
                    ${(experience.basePrice * guests.adults).toLocaleString()}
                  </div>
                  <div className="text-xs text-teal-600">
                    30% deposit due today: ${Math.round(experience.basePrice * guests.adults * 0.3).toLocaleString()}
                  </div>
                </div>
                <button
                  onClick={() => setStep(1)}
                  className="bg-teal-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-teal-700 transition-colors"
                >
                  Continue →
                </button>
              </div>
            )}
          </div>
        )}

        {/* Step 1: Guest details */}
        {step === 1 && (
          <form onSubmit={form.handleSubmit((data) => createBookingMutation.mutate(data))} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">First name</label>
                <input {...form.register('firstName')}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-300" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Last name</label>
                <input {...form.register('lastName')}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-300" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Email</label>
              <input {...form.register('email')} type="email"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-300" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Phone (optional)</label>
              <input {...form.register('phone')} type="tel"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-300" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Special requests</label>
              <textarea {...form.register('specialRequests')} rows={2}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-300 resize-none" />
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setStep(0)}
                className="px-4 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm hover:bg-gray-50">
                ← Back
              </button>
              <button type="submit" disabled={createBookingMutation.isPending}
                className="flex-1 py-2.5 bg-teal-600 text-white rounded-xl font-semibold text-sm hover:bg-teal-700 disabled:opacity-50 transition-colors">
                {createBookingMutation.isPending ? 'Creating booking…' : 'Proceed to Payment'}
              </button>
            </div>
          </form>
        )}

        {/* Step 2: Payment (Stripe) */}
        {step === 2 && clientSecret && (
          <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: 'stripe' } }}>
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800">
                🔒 You're paying a 30% deposit to confirm your booking. Balance due 30 days before arrival.
              </div>
              <StripePaymentForm
                clientSecret={clientSecret}
                amount={Math.round((experience?.basePrice ?? 0) * guests.adults * 0.3)}
                currency="USD"
                onSuccess={() => setStep(3)}
              />
            </div>
          </Elements>
        )}

        {/* Step 3: Confirmed */}
        {step === 3 && (
          <div className="text-center py-6 space-y-3">
            <div className="w-14 h-14 bg-teal-100 rounded-full flex items-center justify-center mx-auto">
              <Check size={24} className="text-teal-600" />
            </div>
            <h3 className="font-bold text-lg text-gray-900">Booking Confirmed! 🎉</h3>
            <p className="text-sm text-gray-500">
              A confirmation email has been sent. We can't wait to see you!
            </p>
            <div className="bg-gray-50 rounded-xl p-3 text-left text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-500">Experience</span>
                <span className="font-medium">{experience.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Dates</span>
                <span className="font-medium">
                  {selectedDates && `${format(selectedDates.start, 'MMM d')} – ${format(selectedDates.end, 'MMM d')}`}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Guests</span>
                <span className="font-medium">{guests.adults} adults</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default BookingWidget;
